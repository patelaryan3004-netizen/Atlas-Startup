// The only way the discovery engine reads anything from the network. Every
// adapter and the enrichment step go through this, so the rules cannot be
// forgotten by one of them:
//
//   - A block list. LinkedIn is never read. Neither are proprietary startup
//     databases or search-result pages: a licensed API gets its own adapter with
//     its own credentials, it is not scraped.
//   - robots.txt, always: Disallow, Allow, and Crawl-delay. If it cannot be read
//     (error, 401/403, 5xx) the site is treated as closed for this run.
//   - Pacing: at most one request per host every few seconds, and a host that
//     answers 429 or 503 is left alone for the rest of the run.
//   - No access control is bypassed. A 401 or 403 is final: no retry, no other
//     user agent, no cookies, no credentials. A redirect to a login page counts
//     as the same refusal.
//   - An honest user agent that says what we are, never a browser's.
//   - No private or internal addresses (localhost, 10.x, 169.254.x ...), by name
//     or by what the name resolves to, at every redirect hop, so a hostile URL in
//     a submission or feed cannot point the engine at an internal service.
//   - Bounded: a timeout, a response size cap, a redirect limit, expected content types.
//
// A refusal throws FetchPolicyError with a code, and is also recorded, so a run
// can report exactly what it declined to read and why.
import { lookup } from 'node:dns/promises';
import { parseRobots, isAllowed, crawlDelay } from './robots.js';

export const DEFAULT_USER_AGENT = 'AUStartupMapBot/1.0 (+https://au-startup-map.netlify.app/; discovery)';

const PROPRIETARY = 'a proprietary startup database: use a licensed API adapter, never scrape it';
const SEARCH = 'search and aggregator results are not scraped: use the publisher\'s own feed';
export const BLOCKED_HOSTS = {
  'linkedin.com': 'LinkedIn forbids scraping and this engine never reads it',
  'lnkd.in': 'LinkedIn link shortener',
  'licdn.com': 'LinkedIn content',
  'crunchbase.com': PROPRIETARY, 'pitchbook.com': PROPRIETARY, 'dealroom.co': PROPRIETARY, 'cbinsights.com': PROPRIETARY,
  'tracxn.com': PROPRIETARY, 'zoominfo.com': PROPRIETARY, 'apollo.io': PROPRIETARY, 'rocketreach.co': PROPRIETARY,
  'owler.com': PROPRIETARY, 'wellfound.com': PROPRIETARY, 'angel.co': PROPRIETARY, 'f6s.com': PROPRIETARY,
  'google.com': SEARCH, 'bing.com': SEARCH, 'duckduckgo.com': SEARCH, 'baidu.com': SEARCH, 'yahoo.com': SEARCH,
};

export class FetchPolicyError extends Error {
  constructor(code, message, url) {
    super(message);
    this.name = 'FetchPolicyError';
    this.code = code;
    this.url = url;
  }
}

// Why this host is off limits, or null.
export function blockedReason(hostname) {
  const host = hostname.toLowerCase();
  const hit = Object.keys(BLOCKED_HOSTS).find((d) => host === d || host.endsWith(`.${d}`));
  return hit ? BLOCKED_HOSTS[hit] : null;
}

function isPrivateIPv4(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

// A literal address or internal-looking name that must never be fetched.
export function isPrivateAddress(value) {
  const v = String(value).toLowerCase().replace(/^\[|\]$/g, '');
  if (isPrivateIPv4(v)) return true;
  if (v.includes(':')) return !/^[23][0-9a-f]{3}:/.test(v) || v === '::1'; // only global-unicast IPv6 passes
  return false;
}

export function isInternalName(hostname) {
  const h = hostname.toLowerCase();
  return !h.includes('.') || h === 'localhost' || /\.(?:localhost|local|internal|lan|home\.arpa|intranet)$/.test(h);
}

const defaultResolveHost = async (host) => (await lookup(host, { all: true })).map((a) => a.address);
// Refusals about the address itself, which must not be hidden behind "robots.txt unavailable".
const HARD_REFUSALS = new Set(['blocked_host', 'private_host', 'dns_failed', 'bad_url', 'bad_scheme']);
const LOGIN_PATH = /\/(?:log-?in|sign-?in|sso|auth(?:orize)?|account\/login)(?:\/|$|\?)/i;

async function readCapped(res, maxBytes, url) {
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new FetchPolicyError('too_large', `response is larger than ${maxBytes} bytes`, url);
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  }
  const text = await res.text();
  if (text.length > maxBytes) throw new FetchPolicyError('too_large', `response is larger than ${maxBytes} bytes`, url);
  return text;
}

export function createFetcher({
  fetchImpl = globalThis.fetch,
  userAgent = DEFAULT_USER_AGENT,
  minDelayMs = 2000,
  maxDelayMs = 30000,
  timeoutMs = 15000,
  maxBytes = 1500000,
  maxRedirects = 3,
  respectRobots = true,
  resolveHost = defaultResolveHost,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
  // Hosts that asked us to slow down in an earlier run: left alone from the first request, as if they had just asked.
  coolDownHosts = [],
} = {}) {
  const productToken = userAgent.split('/')[0].trim().toLowerCase();
  const robotsByOrigin = new Map();
  const lastRequestAt = new Map();
  const coolingDown = new Set(coolDownHosts);
  const askedToWait = new Map(); // the hosts that said so during this run, with how long they asked for (seconds, or null)
  const noteWait = (host, res) => {
    const asked = res.headers.get('retry-after');
    const seconds = asked == null ? null : /^\d+$/.test(asked.trim()) ? Number(asked) : Math.max(0, Math.round((Date.parse(asked) - now()) / 1000));
    askedToWait.set(host, Number.isFinite(seconds) ? Math.min(seconds, 7 * 86400) : null);
  };
  const log = { requests: [], refused: [] };

  const refuse = (code, message, url) => {
    log.refused.push({ url, code, message });
    throw new FetchPolicyError(code, message, url);
  };

  function checkUrl(raw) {
    let u;
    try { u = new URL(raw); } catch { return refuse('bad_url', 'not a valid URL', raw); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') refuse('bad_scheme', `${u.protocol} is not http(s)`, raw);
    if (u.username || u.password) refuse('bad_url', 'URLs with credentials are not fetched', raw);
    const blocked = blockedReason(u.hostname);
    if (blocked) refuse('blocked_host', `${u.hostname} is blocked: ${blocked}`, raw);
    if (isInternalName(u.hostname) || isPrivateAddress(u.hostname)) refuse('private_host', `${u.hostname} is an internal address`, raw);
    return u;
  }

  async function pace(host, minMs) {
    const wait = (lastRequestAt.get(host) ?? -Infinity) + minMs - now();
    if (wait > 0) await sleep(wait);
    lastRequestAt.set(host, now());
  }

  // One request, never following a redirect itself. The single robots.txt read per
  // site is not paced, so it does not delay the first page.
  async function single(url, accept, minMs, { paced = true, headers = {} } = {}) {
    const u = checkUrl(url);
    if (coolingDown.has(u.hostname)) refuse('rate_limited', `${u.hostname} asked us to slow down; leaving it alone for this run`, url);
    let addresses;
    try { addresses = await resolveHost(u.hostname); } catch { return refuse('dns_failed', `could not resolve ${u.hostname}`, url); }
    if (addresses.some(isPrivateAddress)) refuse('private_host', `${u.hostname} resolves to an internal address`, url);
    if (paced) await pace(u.hostname, minMs);
    log.requests.push({ url });
    try {
      return await fetchImpl(u.href, { method: 'GET', redirect: 'manual', headers: { ...headers, 'user-agent': userAgent, accept }, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      return refuse(err.name === 'TimeoutError' ? 'timeout' : 'network_error', err.message, url);
    }
  }

  async function robotsFor(origin) {
    if (robotsByOrigin.has(origin)) return robotsByOrigin.get(origin);
    let entry;
    try {
      let url = `${origin}/robots.txt`;
      let res;
      for (let hop = 0; hop <= maxRedirects; hop += 1) {
        res = await single(url, 'text/plain', 0, { paced: false });
        if (![301, 302, 303, 307, 308].includes(res.status)) break;
        url = new URL(res.headers.get('location') || '', url).href;
      }
      if (res.status === 200) entry = { robots: parseRobots(await readCapped(res, 500000, url)) };
      else if (res.status === 401 || res.status === 403) entry = { deny: 'robots.txt is access-controlled' };
      else if (res.status === 429 || res.status >= 500) {
        if (res.status === 429) { coolingDown.add(new URL(origin).hostname); noteWait(new URL(origin).hostname, res); }
        entry = { deny: `robots.txt is unavailable (HTTP ${res.status})` };
      } else entry = { robots: parseRobots('') }; // 404 and the like: the site states no rules
    } catch (err) {
      // A host we must not touch at all stays that reason; an unreadable robots.txt just closes the site.
      if (err instanceof FetchPolicyError && HARD_REFUSALS.has(err.code)) throw err;
      entry = { deny: err.message };
    }
    robotsByOrigin.set(origin, entry);
    return entry;
  }

  async function finish(res, original, finalUrl, allow) {
    const host = new URL(finalUrl).hostname;
    if (res.status === 401 || res.status === 403) refuse('access_controlled', `HTTP ${res.status}: access-controlled, so not retried or worked around`, finalUrl);
    if (res.status === 429 || res.status === 503) { coolingDown.add(host); noteWait(host, res); refuse('rate_limited', `HTTP ${res.status}: ${host} asked us to slow down`, finalUrl); }
    if (res.status >= 400) refuse('http_error', `HTTP ${res.status}`, finalUrl);
    if (finalUrl !== original && LOGIN_PATH.test(new URL(finalUrl).pathname) && !LOGIN_PATH.test(new URL(original).pathname)) {
      refuse('access_controlled', 'redirected to a login page', finalUrl);
    }
    const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!allow.some((a) => type === a)) refuse('unsupported_content', `unexpected content type "${type || 'unknown'}"`, finalUrl);
    const declared = Number(res.headers.get('content-length'));
    if (declared > maxBytes) refuse('too_large', `response is ${declared} bytes, over the ${maxBytes} limit`, finalUrl);
    let text;
    try {
      text = await readCapped(res, maxBytes, finalUrl);
    } catch (err) {
      if (err instanceof FetchPolicyError) { log.refused.push({ url: finalUrl, code: err.code, message: err.message }); throw err; }
      // The connection dropped, or the time ran out, while the body was still arriving: the same kinds of
      // failure as before the headers, and handled the same way.
      return refuse(err.name === 'TimeoutError' || err.name === 'AbortError' ? 'timeout' : 'network_error', err.message, finalUrl);
    }
    return { url: original, finalUrl, status: res.status, contentType: type, text };
  }

  // headers: for a licensed API's key. Sent only to the origin first asked for, never
  // along a redirect to another site, and never as a cookie or a replacement user agent.
  async function get(url, { accept = 'text/html,application/xhtml+xml;q=0.9', allow = ['text/html', 'application/xhtml+xml'], headers = {} } = {}) {
    let current = url;
    const firstOrigin = (() => { try { return new URL(url).origin; } catch { return null; } })();
    const extra = Object.fromEntries(Object.entries(headers).filter(([k]) => !['cookie', 'user-agent', 'host', 'origin', 'referer'].includes(k.toLowerCase())));
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      const u = checkUrl(current);
      let minMs = minDelayMs;
      if (respectRobots) {
        const entry = await robotsFor(u.origin);
        if (entry.deny) refuse('robots_unavailable', entry.deny, current);
        if (!isAllowed(entry.robots, productToken, `${u.pathname}${u.search}`)) refuse('robots_disallow', `robots.txt disallows ${u.pathname}`, current);
        const delay = crawlDelay(entry.robots, productToken);
        if (delay != null) minMs = Math.min(maxDelayMs, Math.max(minMs, delay * 1000));
      }
      const res = await single(current, accept, minMs, { headers: u.origin === firstOrigin ? extra : {} });
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const location = res.headers.get('location');
        if (!location) refuse('http_error', `HTTP ${res.status} without a location`, current);
        current = new URL(location, current).href;
        continue;
      }
      return finish(res, url, current, allow);
    }
    return refuse('too_many_redirects', `more than ${maxRedirects} redirects`, url);
  }

  return { get, log, userAgent, askedToWait: () => [...askedToWait].map(([host, retryAfterSeconds]) => ({ host, retryAfterSeconds })) };
}

export const FEED_TYPES = ['application/rss+xml', 'application/atom+xml', 'application/xml', 'text/xml'];
export const DATA_TYPES = ['application/json', 'text/csv', 'text/plain', 'application/csv'];
