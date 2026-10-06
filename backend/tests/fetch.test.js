import { describe, it, expect } from 'vitest';
import { parseRobots, isAllowed, crawlDelay } from '../src/discovery/robots.js';
import { createFetcher, FetchPolicyError, blockedReason, isPrivateAddress, isInternalName, DEFAULT_USER_AGENT, FEED_TYPES } from '../src/discovery/http.js';
import { decodeEntities, stripTags, metaContent, titleOf, jsonLd, typesOf, links } from '../src/discovery/html.js';

const TOKEN = 'austartupmapbot';

describe('robots.txt', () => {
  const STARTUP_DAILY = 'User-agent: *\nDisallow: /wp-admin/\nUser-agent: ia_archiver\nDisallow: /\nUser-agent: GPTBot\nDisallow: /\n';

  it("applies the '*' group to a crawler that is not named, as on a real publisher's file", () => {
    const robots = parseRobots(STARTUP_DAILY);
    expect(isAllowed(robots, TOKEN, '/topic/funding/feed/')).toBe(true);
    expect(isAllowed(robots, TOKEN, '/wp-admin/options.php')).toBe(false);
    expect(isAllowed(robots, 'gptbot', '/feed/')).toBe(false);
  });

  it('uses the group that names the crawler instead of the "*" group', () => {
    const robots = parseRobots('User-agent: *\nDisallow:\n\nUser-agent: AUStartupMapBot\nDisallow: /private/\n');
    expect(isAllowed(robots, TOKEN, '/anything')).toBe(true);
    expect(isAllowed(robots, TOKEN, '/private/x')).toBe(false);
    expect(isAllowed(robots, 'otherbot', '/private/x')).toBe(true);
  });

  it('lets the longest matching rule win, and Allow win a tie', () => {
    const robots = parseRobots('User-agent: *\nDisallow: /a/\nAllow: /a/public/\nDisallow: /b\nAllow: /b\n');
    expect(isAllowed(robots, TOKEN, '/a/secret')).toBe(false);
    expect(isAllowed(robots, TOKEN, '/a/public/page')).toBe(true);
    expect(isAllowed(robots, TOKEN, '/b/page')).toBe(true);
  });

  it('understands * and a trailing $, and an empty Disallow', () => {
    const robots = parseRobots('User-agent: *\nDisallow: /*?add-to-cart=\nDisallow: /*.pdf$\n');
    expect(isAllowed(robots, TOKEN, '/shop?add-to-cart=3')).toBe(false);
    expect(isAllowed(robots, TOKEN, '/files/report.pdf')).toBe(false);
    expect(isAllowed(robots, TOKEN, '/files/report.pdf.html')).toBe(true);
    expect(isAllowed(parseRobots('User-agent: *\nDisallow:\n'), TOKEN, '/x')).toBe(true);
  });

  it('shares one rule set across several User-agent lines, and ignores comments and blank lines', () => {
    const robots = parseRobots('# hello\nUser-agent: a\nUser-agent: austartup\n\nDisallow: /x # no\n');
    expect(isAllowed(robots, TOKEN, '/x')).toBe(false);
  });

  it("reads the site's Crawl-delay, as Techboard publishes", () => {
    const robots = parseRobots('User-agent: *\nDisallow: /wp-admin/\nCrawl-delay: 10\n');
    expect(crawlDelay(robots, TOKEN)).toBe(10);
    expect(crawlDelay(parseRobots('User-agent: *\nDisallow:\n'), TOKEN)).toBeNull();
  });

  it('allows everything when there are no rules', () => {
    expect(isAllowed(parseRobots(''), TOKEN, '/anything')).toBe(true);
  });
});

describe('what the fetcher will never read', () => {
  it('blocks LinkedIn, its subdomains and shortener, and proprietary databases and search pages', () => {
    for (const host of ['linkedin.com', 'www.linkedin.com', 'au.linkedin.com', 'lnkd.in', 'media.licdn.com']) expect(blockedReason(host), host).toMatch(/LinkedIn/);
    for (const host of ['crunchbase.com', 'www.pitchbook.com', 'app.dealroom.co', 'cbinsights.com']) expect(blockedReason(host), host).toMatch(/proprietary/);
    for (const host of ['www.google.com', 'duckduckgo.com', 'news.google.com']) expect(blockedReason(host), host).toMatch(/not scraped/);
    expect(blockedReason('startupdaily.net')).toBeNull();
    expect(blockedReason('notlinkedin.com')).toBeNull();
  });

  it('recognises internal addresses', () => {
    for (const a of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '[::1]', 'fe80::1', 'fd00::1']) expect(isPrivateAddress(a), a).toBe(true);
    for (const a of ['8.8.8.8', '93.184.216.34', '172.32.0.1', '2606:4700:4700::1111']) expect(isPrivateAddress(a), a).toBe(false);
    for (const h of ['localhost', 'printer.local', 'db.internal', 'intranet', 'x.localhost']) expect(isInternalName(h), h).toBe(true);
    expect(isInternalName('acme.com.au')).toBe(false);
  });
});

// A scripted web: URL -> { status, headers, body } or an Error to throw.
function web(routes) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, headers: init.headers, redirect: init.redirect });
    const hit = routes[url] ?? routes[`${new URL(url).origin}${new URL(url).pathname}`];
    if (hit instanceof Error) throw hit;
    if (!hit) return new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } });
    return new Response(hit.body ?? '', { status: hit.status ?? 200, headers: hit.headers ?? { 'content-type': 'text/html' } });
  };
  return { fetchImpl, calls, pages: () => calls.filter((c) => !c.url.endsWith('/robots.txt')).map((c) => c.url) };
}
function clock() {
  let t = 1000000;
  const sleeps = [];
  return { now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; }, sleeps };
}
const PUBLIC = async () => ['93.184.216.34'];
const make = (routes, extra = {}) => {
  const w = web(routes);
  const c = clock();
  return { w, c, fetcher: createFetcher({ fetchImpl: w.fetchImpl, resolveHost: PUBLIC, now: c.now, sleep: c.sleep, ...extra }) };
};
const refusal = async (promise) => { try { await promise; } catch (e) { return e; } throw new Error('expected a refusal'); };
const OPEN_ROBOTS = { 'https://acme.example/robots.txt': { body: 'User-agent: *\nDisallow: /wp-admin/\n', headers: { 'content-type': 'text/plain' } } };

describe('a response that fails while it is still arriving', () => {
  // Real sites do this: the headers arrive, then the connection drops or the time runs out mid-body.
  const failingBody = (error) => ({
    body: new ReadableStream({ pull(controller) { controller.enqueue(new TextEncoder().encode('<html>')); controller.error(error); } }),
    headers: { 'content-type': 'text/html' },
  });
  const timeout = () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });

  it('is a timeout, a refusal the caller can retry, not an unexplained crash', async () => {
    const { fetcher } = make({ ...OPEN_ROBOTS, 'https://acme.example/': failingBody(timeout()) });
    const err = await refusal(fetcher.get('https://acme.example/'));
    expect(err).toMatchObject({ name: 'FetchPolicyError', code: 'timeout', message: expect.stringMatching(/aborted due to timeout/) });
    expect(fetcher.log.refused).toEqual([{ url: 'https://acme.example/', code: 'timeout', message: expect.any(String) }]);
  });

  it('is a network error when the connection simply drops', async () => {
    const { fetcher } = make({ ...OPEN_ROBOTS, 'https://acme.example/': failingBody(new TypeError('terminated')) });
    expect(await refusal(fetcher.get('https://acme.example/'))).toMatchObject({ name: 'FetchPolicyError', code: 'network_error' });
  });
});

describe('fetching', () => {
  it('identifies itself honestly and sends no cookies or credentials', async () => {
    const { w, fetcher } = make({ ...OPEN_ROBOTS, 'https://acme.example/': { body: '<html>hi</html>' } });
    const res = await fetcher.get('https://acme.example/');
    expect(res.status).toBe(200);
    for (const call of w.calls) {
      expect(call.headers['user-agent']).toBe(DEFAULT_USER_AGENT);
      expect(DEFAULT_USER_AGENT).toMatch(/^AUStartupMapBot\//);
      expect(Object.keys(call.headers).map((k) => k.toLowerCase())).not.toEqual(expect.arrayContaining(['cookie']));
      expect(Object.keys(call.headers).map((k) => k.toLowerCase())).not.toEqual(expect.arrayContaining(['authorization']));
      expect(call.redirect).toBe('manual');
    }
  });

  it("sends a licensed API's key to the site asked for only: never along a redirect to another site, and never as a cookie", async () => {
    const robots = { body: '', headers: { 'content-type': 'text/plain' } };
    const { w, fetcher } = make({
      'https://api.example/robots.txt': robots, 'https://cdn.example/robots.txt': robots,
      'https://api.example/data': { status: 302, headers: { location: 'https://cdn.example/data' } },
      'https://cdn.example/data': { body: '[]', headers: { 'content-type': 'application/json' } },
    });
    await fetcher.get('https://api.example/data', { allow: ['application/json'], headers: { 'x-api-key': 'k-123', Cookie: 'session=1', 'User-Agent': 'Mozilla/5.0' } });
    const sent = Object.fromEntries(w.calls.filter((c) => !c.url.endsWith('/robots.txt')).map((c) => [c.url, c.headers]));
    expect(sent['https://api.example/data']['x-api-key']).toBe('k-123');
    expect(sent['https://api.example/data']['user-agent']).toBe(DEFAULT_USER_AGENT);
    expect(JSON.stringify(sent)).not.toMatch(/session=1|Mozilla/);
    expect(sent['https://cdn.example/data']['x-api-key']).toBeUndefined();
  });

  it('never makes a request to LinkedIn, however it is reached', async () => {
    const { w, fetcher } = make({});
    for (const url of ['https://www.linkedin.com/company/acme', 'https://au.linkedin.com/in/someone', 'https://lnkd.in/abc']) {
      const err = await refusal(fetcher.get(url));
      expect(err).toBeInstanceOf(FetchPolicyError);
      expect(err.code).toBe('blocked_host');
    }
    expect(w.calls).toEqual([]);
    expect(fetcher.log.refused.map((r) => r.code)).toEqual(['blocked_host', 'blocked_host', 'blocked_host']);
  });

  it('never requests a proprietary startup database or a search page', async () => {
    const { w, fetcher } = make({});
    for (const url of ['https://www.crunchbase.com/organization/acme', 'https://www.google.com/search?q=acme']) expect((await refusal(fetcher.get(url))).code).toBe('blocked_host');
    expect(w.calls).toEqual([]);
  });

  it('refuses internal addresses by name and by what the name resolves to, without a request', async () => {
    const { w, fetcher } = make({});
    for (const url of ['http://localhost:4000/api/submissions', 'http://127.0.0.1/', 'http://10.0.0.5/', 'http://169.254.169.254/latest/meta-data', 'http://[::1]/', 'http://intranet/', 'http://2130706433/']) {
      expect((await refusal(fetcher.get(url))).code, url).toBe('private_host');
    }
    const sneaky = createFetcher({ fetchImpl: w.fetchImpl, resolveHost: async () => ['127.0.0.1'] });
    expect((await refusal(sneaky.get('https://looks-public.example/'))).code).toBe('private_host');
    expect(w.calls).toEqual([]);
  });

  it('refuses non-http schemes and URLs carrying credentials', async () => {
    const { fetcher } = make({});
    expect((await refusal(fetcher.get('ftp://acme.example/file'))).code).toBe('bad_scheme');
    expect((await refusal(fetcher.get('https://user:pass@acme.example/'))).code).toBe('bad_url');
    expect((await refusal(fetcher.get('not a url'))).code).toBe('bad_url');
  });

  it('obeys robots.txt: a disallowed page is never requested', async () => {
    const { w, fetcher } = make({ 'https://acme.example/robots.txt': { body: 'User-agent: *\nDisallow: /private/\n', headers: { 'content-type': 'text/plain' } }, 'https://acme.example/private/x': { body: 'secret' }, 'https://acme.example/open': { body: 'ok' } });
    expect((await refusal(fetcher.get('https://acme.example/private/x'))).code).toBe('robots_disallow');
    expect((await fetcher.get('https://acme.example/open')).text).toBe('ok');
    expect(w.pages()).toEqual(['https://acme.example/open']);
  });

  it('reads robots.txt once per site', async () => {
    const { w, fetcher } = make({ ...OPEN_ROBOTS, 'https://acme.example/a': { body: 'a' }, 'https://acme.example/b': { body: 'b' } });
    await fetcher.get('https://acme.example/a');
    await fetcher.get('https://acme.example/b');
    expect(w.calls.filter((c) => c.url.endsWith('/robots.txt'))).toHaveLength(1);
  });

  it('treats a missing robots.txt as no rules, but an unreadable one as closed', async () => {
    const missing = make({ 'https://acme.example/': { body: 'hi' } });
    expect((await missing.fetcher.get('https://acme.example/')).status).toBe(200);
    for (const robots of [{ status: 403 }, { status: 401 }, { status: 500 }, { status: 503 }, new Error('connection reset')]) {
      const { w, fetcher } = make({ 'https://acme.example/robots.txt': robots, 'https://acme.example/': { body: 'hi' } });
      expect((await refusal(fetcher.get('https://acme.example/'))).code, String(robots.status ?? robots.message)).toBe('robots_unavailable');
      expect(w.pages()).toEqual([]);
    }
  });

  it('follows a redirect on robots.txt itself', async () => {
    const { fetcher } = make({
      'https://acme.example/robots.txt': { status: 301, headers: { location: 'https://www.acme.example/robots.txt' } },
      'https://www.acme.example/robots.txt': { body: 'User-agent: *\nDisallow: /x\n', headers: { 'content-type': 'text/plain' } },
    });
    expect((await refusal(fetcher.get('https://acme.example/x'))).code).toBe('robots_disallow');
  });

  it("honours a site's Crawl-delay", async () => {
    const { fetcher, c } = make({
      'https://acme.example/robots.txt': { body: 'User-agent: *\nCrawl-delay: 10\n', headers: { 'content-type': 'text/plain' } },
      'https://acme.example/a': { body: 'a' }, 'https://acme.example/b': { body: 'b' },
    });
    await fetcher.get('https://acme.example/a');
    c.sleeps.length = 0;
    await fetcher.get('https://acme.example/b');
    expect(Math.max(...c.sleeps)).toBeGreaterThanOrEqual(9999);
  });

  it('paces requests to one host, but not across hosts', async () => {
    const routes = {
      'https://acme.example/robots.txt': { body: '', headers: { 'content-type': 'text/plain' } }, 'https://acme.example/a': { body: 'a' }, 'https://acme.example/b': { body: 'b' },
      'https://other.example/robots.txt': { body: '', headers: { 'content-type': 'text/plain' } }, 'https://other.example/a': { body: 'a' },
    };
    const { fetcher, c } = make(routes, { minDelayMs: 2000 });
    await fetcher.get('https://acme.example/a');
    await fetcher.get('https://acme.example/b');
    expect(c.sleeps.some((ms) => ms > 0 && ms <= 2000)).toBe(true);
    c.sleeps.length = 0;
    await fetcher.get('https://other.example/a');
    expect(c.sleeps).toEqual([]);
  });

  it('treats 401 and 403 as final: no retry, no workaround', async () => {
    for (const status of [401, 403]) {
      const { w, fetcher } = make({ ...OPEN_ROBOTS, 'https://acme.example/members': { status, body: 'no' } });
      const err = await refusal(fetcher.get('https://acme.example/members'));
      expect(err.code).toBe('access_controlled');
      expect(w.pages()).toEqual(['https://acme.example/members']);
    }
  });

  it('treats a redirect to a login page as the same refusal', async () => {
    const { fetcher } = make({ ...OPEN_ROBOTS, 'https://acme.example/team': { status: 302, headers: { location: '/login?next=/team' } }, 'https://acme.example/login': { body: '<form>' } });
    expect((await refusal(fetcher.get('https://acme.example/team'))).code).toBe('access_controlled');
  });

  it('backs off a host that says 429 or 503, for the rest of the run', async () => {
    for (const status of [429, 503]) {
      const { w, fetcher } = make({ ...OPEN_ROBOTS, 'https://acme.example/a': { status, headers: { 'retry-after': '120' } }, 'https://acme.example/b': { body: 'b' } });
      expect((await refusal(fetcher.get('https://acme.example/a'))).code).toBe('rate_limited');
      expect((await refusal(fetcher.get('https://acme.example/b'))).code).toBe('rate_limited');
      expect(w.pages()).toEqual(['https://acme.example/a']);
    }
  });

  it('checks every redirect hop, not just the first URL', async () => {
    const hop = (to) => ({ ...OPEN_ROBOTS, 'https://acme.example/go': { status: 301, headers: { location: to } } });
    expect((await refusal(make(hop('https://www.linkedin.com/company/x')).fetcher.get('https://acme.example/go'))).code).toBe('blocked_host');
    expect((await refusal(make(hop('http://169.254.169.254/')).fetcher.get('https://acme.example/go'))).code).toBe('private_host');
    const { fetcher } = make({ ...OPEN_ROBOTS, 'https://acme.example/go': { status: 301, headers: { location: '/landed' } }, 'https://acme.example/landed': { body: 'here' } });
    const res = await fetcher.get('https://acme.example/go');
    expect(res.text).toBe('here');
    expect(res.finalUrl).toBe('https://acme.example/landed');
  });

  it('gives up on a redirect loop', async () => {
    const { fetcher } = make({ ...OPEN_ROBOTS, 'https://acme.example/a': { status: 301, headers: { location: '/b' } }, 'https://acme.example/b': { status: 301, headers: { location: '/a' } } }, { maxRedirects: 3 });
    expect((await refusal(fetcher.get('https://acme.example/a'))).code).toBe('too_many_redirects');
  });

  it('accepts only the content types asked for', async () => {
    const routes = { ...OPEN_ROBOTS, 'https://acme.example/file': { body: '%PDF', headers: { 'content-type': 'application/pdf' } }, 'https://acme.example/feed': { body: '<rss/>', headers: { 'content-type': 'application/rss+xml; charset=UTF-8' } } };
    const { fetcher } = make(routes);
    expect((await refusal(fetcher.get('https://acme.example/file'))).code).toBe('unsupported_content');
    expect((await refusal(fetcher.get('https://acme.example/feed'))).code).toBe('unsupported_content');
    expect((await fetcher.get('https://acme.example/feed', { allow: FEED_TYPES })).text).toBe('<rss/>');
  });

  it('caps response size, whether declared or not', async () => {
    const big = 'x'.repeat(500);
    const declared = make({ ...OPEN_ROBOTS, 'https://acme.example/big': { body: big, headers: { 'content-type': 'text/html', 'content-length': '500' } } }, { maxBytes: 100 });
    expect((await refusal(declared.fetcher.get('https://acme.example/big'))).code).toBe('too_large');
    const undeclared = make({ ...OPEN_ROBOTS, 'https://acme.example/big': { body: big } }, { maxBytes: 100 });
    expect((await refusal(undeclared.fetcher.get('https://acme.example/big'))).code).toBe('too_large');
  });

  it('reports errors and non-success statuses as refusals, with the code', async () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    expect((await refusal(make({ ...OPEN_ROBOTS, 'https://acme.example/t': timeout }).fetcher.get('https://acme.example/t'))).code).toBe('timeout');
    expect((await refusal(make({ ...OPEN_ROBOTS, 'https://acme.example/n': new Error('reset') }).fetcher.get('https://acme.example/n'))).code).toBe('network_error');
    expect((await refusal(make(OPEN_ROBOTS).fetcher.get('https://acme.example/missing'))).code).toBe('http_error');
  });

  it('fails closed when a name does not resolve', async () => {
    const w = web({});
    const fetcher = createFetcher({ fetchImpl: w.fetchImpl, resolveHost: async () => { throw new Error('ENOTFOUND'); } });
    expect((await refusal(fetcher.get('https://nowhere.example/'))).code).toBe('dns_failed');
    expect(w.calls).toEqual([]);
  });
});

describe('html', () => {
  it('decodes entities, including numeric, hex and CDATA', () => {
    expect(decodeEntities('R&#038;D &#8216;x&#8217; &amp; &quot;y&quot; &#x2013; &nbsp;z &unknown;')).toBe('R&D ‘x’ & "y" –  z &unknown;');
    expect(decodeEntities('<![CDATA[Foo & bar]]>')).toBe('Foo & bar');
    expect(decodeEntities('&#0; &#99999999;')).toBe('&#0; &#99999999;');
  });

  it('reads the visible text and ignores scripts, styles and comments', () => {
    expect(stripTags('<style>p{}</style><p>Hello <b>there</b></p><script>alert(1)</script><!-- c -->!')).toBe('Hello there !');
  });

  it('reads meta tags in either attribute order and quote style', () => {
    const html = '<meta name="description" content="Hi &amp; bye"><meta content=\'Acme\' property=\'og:site_name\'>';
    expect(metaContent(html, 'description')).toBe('Hi & bye');
    expect(metaContent(html, 'og:site_name')).toBe('Acme');
    expect(metaContent(html, 'missing')).toBeNull();
    expect(titleOf('<title>  Acme |  Home </title>')).toBe('Acme | Home');
    expect(titleOf('<p>none</p>')).toBeNull();
  });

  it('collects JSON-LD, flattening @graph and skipping a malformed block', () => {
    const html = '<script type="application/ld+json">{"@graph":[{"@type":"Organization","name":"Acme"},{"@type":["WebSite","Thing"]}]}</script>'
      + '<script type="application/ld+json">{ broken</script><script type="application/ld+json">[{"@type":"Person","name":"Jane"}]</script>';
    const nodes = jsonLd(html);
    expect(nodes.map((n) => typesOf(n))).toEqual([['Organization'], ['WebSite', 'Thing'], ['Person']]);
    expect(jsonLd('<p>none</p>')).toEqual([]);
  });

  it('resolves links against the page, drops fragments, mailto and duplicates', () => {
    const html = '<a href="/about">About us</a><a href="/about#team">again</a><a href="mailto:x@y.z">mail</a><a href="https://other.example/p">Other</a><a href="javascript:void(0)">js</a>';
    expect(links(html, 'https://acme.example/')).toEqual([
      { href: 'https://acme.example/about', text: 'About us' },
      { href: 'https://other.example/p', text: 'Other' },
    ]);
  });
});
