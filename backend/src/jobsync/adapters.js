// Reading an employer's job board through the provider's own public postings feed: the feed an "open positions" widget on the employer's site uses.
//
// Every read either returns the COMPLETE list of what the board lists, or throws a SyncError saying why not. There is no third outcome: a timeout, a rate limit, a server
// error, a board that says it holds 12 jobs and returns 9, a page that repeats, a response that is not what the provider sends: none of them returns a short list, because a
// short list read as "the rest are gone" would close real roles. Whoever calls this closes nothing on a SyncError.
//
// Greenhouse, Lever and Workable are read here. The other providers the careers-page reader recognises (Ashby, Recruitee, SmartRecruiters) are not, yet: their companies
// stay with the slower hiring reader (docs/jobs-sync.md says which).
//
// Everything goes through the project's one fetcher (discovery/http.js): robots.txt, pacing, an honest user agent, no access control bypassed, a size cap, a timeout.
import { SUPPORTED } from './providers.js';
import { FetchPolicyError } from '../discovery/http.js';
import { canonicalUrl } from './canonical.js';

export class SyncError extends Error {
  constructor(code, message, { retryAfterSeconds = null, transient = true } = {}) {
    super(message);
    this.name = 'SyncError';
    this.code = code; // timeout, network, rate_limited, server, gone, refused, malformed, incomplete, unsupported
    this.retryAfterSeconds = retryAfterSeconds;
    this.transient = transient; // worth trying again soon; false: a person should look at the source
  }
}

const hostOf = (url) => { try { return new URL(url).hostname; } catch (e) { return ''; } };

// What the fetcher refused or hit, as a SyncError.
export function toSyncError(err, fetcher, url) {
  if (err instanceof SyncError) return err;
  if (!(err instanceof FetchPolicyError)) return new SyncError('network', String(err?.message ?? err).slice(0, 200));
  const host = hostOf(url);
  switch (err.code) {
    case 'timeout': return new SyncError('timeout', 'The employer\'s feed did not answer in time');
    case 'network_error': case 'dns_failed': return new SyncError('network', `Could not reach the employer's feed (${err.message})`.slice(0, 200));
    case 'rate_limited': {
      const asked = fetcher?.askedToWait?.().find((a) => a.host === host);
      return new SyncError('rate_limited', 'The feed asked us to slow down', { retryAfterSeconds: asked?.retryAfterSeconds ?? null });
    }
    case 'http_error': {
      const status = Number(/HTTP (\d{3})/.exec(err.message)?.[1]);
      if (status === 404 || status === 410) return new SyncError('gone', `The feed answered ${status}: the board is not there`, { transient: false });
      if (status >= 500) return new SyncError('server', `The feed answered ${status}`);
      return new SyncError('refused', `The feed answered ${status || 'an error'}`, { transient: false });
    }
    case 'robots_unavailable': return new SyncError('network', `robots.txt could not be read (${err.message})`.slice(0, 200));
    case 'access_controlled': case 'robots_disallow': return new SyncError('refused', err.message.slice(0, 200), { transient: false });
    case 'unsupported_content': case 'too_large': return new SyncError('malformed', err.message.slice(0, 200));
    default: return new SyncError('refused', err.message.slice(0, 200), { transient: false });
  }
}

async function getJson(fetcher, url) {
  let res;
  try { res = await fetcher.get(url, { accept: 'application/json', allow: ['application/json'] }); } catch (err) { throw toSyncError(err, fetcher, url); }
  try { return JSON.parse(res.text); } catch (e) { throw new SyncError('malformed', 'The feed did not return JSON'); }
}

const text = (v, max = 160) => (typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ').slice(0, max) : null);

// A date the employer supplied, as an ISO time, or null: never a future date, never "now" (a role we merely checked today is not posted today).
export function postedAt(value, now) {
  if (value == null || value === '') return null;
  const d = typeof value === 'number' ? new Date(value) : new Date(String(value));
  if (!Number.isFinite(d.valueOf()) || d.valueOf() > now + 86400000 || d.getUTCFullYear() < 2000) return null;
  return d.toISOString();
}

// The apply link must be the employer's own: https, on the provider's host or on the company's own domain.
function applyLink(url, allowed) {
  let u;
  try { u = new URL(url); } catch (e) { return null; }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase();
  return allowed.some((h) => host === h || host.endsWith(`.${h}`)) ? u.href : null;
}

// Each provider: where its feed is, and how a posting in it becomes the one shape the importer works with:
//   { external_id, title, apply_url, canonical_url, labels[], workplaceType, employment, team, posted_at }
// `seen` is every external id the feed listed, including postings that could not be used (a link that is not the employer's): a role that is still listed is not absent.
export const PROVIDERS = {
  greenhouse: {
    name: 'Greenhouse', hosts: ['greenhouse.io'],
    page: (token) => `https://boards.greenhouse.io/${token}`,
    async read(source, { fetcher, now, allowed }) {
      const body = await getJson(fetcher, `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(source.token)}/jobs`);
      if (!body || !Array.isArray(body.jobs)) throw new SyncError('malformed', 'The Greenhouse feed has no list of jobs');
      const total = body.meta?.total;
      if (Number.isFinite(total) && total !== body.jobs.length) throw new SyncError('incomplete', `The board says it lists ${total} jobs and returned ${body.jobs.length}`);
      const out = { postings: [], seen: new Set(), skipped: [], pages: 1 };
      for (const j of body.jobs) {
        if (j?.id == null) throw new SyncError('malformed', 'A Greenhouse job has no id');
        const id = String(j.id);
        if (out.seen.has(id)) continue;
        out.seen.add(id);
        const apply = applyLink(j.absolute_url, allowed);
        const title = text(j.title, 200);
        if (!title || !apply) { out.skipped.push({ id, reason: !title ? 'no title' : 'the link is not the employer\'s' }); continue; }
        const employment = Array.isArray(j.metadata) ? text(j.metadata.find((m) => /employment type|commitment|job type|contract type/i.test(m?.name ?? ''))?.value) : null;
        out.postings.push({
          external_id: id, title, apply_url: apply, canonical_url: canonicalUrl(apply), labels: [text(j.location?.name)].filter(Boolean), workplaceType: null,
          employment: employment ?? null, team: null, posted_at: postedAt(j.first_published, now),
        });
      }
      return { complete: true, ...out };
    },
  },
  lever: {
    name: 'Lever', hosts: ['lever.co'],
    page: (token) => `https://jobs.lever.co/${token}`,
    async read(source, { fetcher, now, allowed, maxPages = 40 }) {
      const PAGE = 50; // a page of Lever postings carries their full descriptions: a small page keeps it under the fetcher's size cap
      const out = { postings: [], seen: new Set(), skipped: [], pages: 0 };
      for (let page = 0; page < maxPages; page += 1) {
        const body = await getJson(fetcher, `https://api.lever.co/v0/postings/${encodeURIComponent(source.token)}?mode=json&limit=${PAGE}&skip=${page * PAGE}`);
        if (!Array.isArray(body)) throw new SyncError('malformed', 'The Lever feed is not a list of postings');
        out.pages += 1;
        let added = 0;
        for (const j of body) {
          if (!j?.id) throw new SyncError('malformed', 'A Lever posting has no id');
          const id = String(j.id);
          if (out.seen.has(id)) continue;
          out.seen.add(id);
          added += 1;
          const apply = applyLink(j.hostedUrl ?? j.applyUrl, allowed);
          const title = text(j.text, 200);
          if (!title || !apply) { out.skipped.push({ id, reason: !title ? 'no title' : 'the link is not the employer\'s' }); continue; }
          const c = j.categories ?? {};
          const labels = [...new Set([c.location, ...(Array.isArray(c.allLocations) ? c.allLocations : [])].map((v) => text(v)).filter(Boolean))];
          out.postings.push({
            external_id: id, title, apply_url: apply, canonical_url: canonicalUrl(apply), labels, workplaceType: text(j.workplaceType),
            employment: text(c.commitment), team: text(c.team ?? c.department), posted_at: postedAt(j.createdAt, now),
          });
        }
        if (body.length < PAGE) return { complete: true, ...out };
        if (!added) throw new SyncError('incomplete', 'The Lever feed repeated a page');
      }
      throw new SyncError('incomplete', `The Lever board has more than ${maxPages * PAGE} postings: not all were read`);
    },
  },
  workable: {
    name: 'Workable', hosts: ['workable.com'],
    page: (token) => `https://apply.workable.com/${token}/`,
    async read(source, { fetcher, now, allowed }) {
      const body = await getJson(fetcher, `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(source.token)}`);
      if (!body || !Array.isArray(body.jobs)) throw new SyncError('malformed', 'The Workable feed has no list of jobs');
      const out = { postings: [], seen: new Set(), skipped: [], pages: 1 };
      for (const j of body.jobs) {
        const id = String(j?.shortcode ?? j?.code ?? '');
        if (!id) throw new SyncError('malformed', 'A Workable job has no id');
        if (out.seen.has(id)) continue;
        out.seen.add(id);
        const apply = applyLink(j.url ?? j.shortlink, allowed);
        const title = text(j.title, 200);
        if (!title || !apply) { out.skipped.push({ id, reason: !title ? 'no title' : 'the link is not the employer\'s' }); continue; }
        const places = Array.isArray(j.locations) && j.locations.length
          ? j.locations.filter((l) => !l.hidden).map((l) => text([l.city, l.region, l.country].filter(Boolean).join(', ')))
          : [text([j.city, j.state, j.country].filter(Boolean).join(', '))];
        out.postings.push({
          external_id: id, title, apply_url: apply, canonical_url: canonicalUrl(apply), labels: [...new Set(places.filter(Boolean))], workplaceType: j.telecommuting === true ? 'remote' : null,
          employment: text(j.employment_type), team: text(j.department), posted_at: postedAt(j.published_on ?? j.created_at, now),
        });
      }
      return { complete: true, ...out };
    },
  },
};

export { SUPPORTED };

// The hosts a role's apply link may be on: the provider's, and the company's own site (some employers put the board behind their own careers page).
export function allowedHosts(provider, companyWebsite) {
  const own = hostOf(companyWebsite).replace(/^www\./, '');
  return [...PROVIDERS[provider].hosts, ...(own ? [own] : [])];
}

// One complete read of one source, or a SyncError. `retries`: how many more times to try a transient failure inside this run (a Retry-After longer than `maxWaitMs` is not waited out:
// it is left for the next run, which is what the state's next_attempt_at is for).
export async function readSource(source, { fetcher, now = Date.now(), companyWebsite = '', retries = 1, backoffMs = 2000, maxWaitMs = 30000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const provider = PROVIDERS[source.provider];
  if (!provider) throw new SyncError('unsupported', `No reader for ${source.provider} boards yet`, { transient: false });
  const allowed = allowedHosts(source.provider, companyWebsite);
  let attempt = 0;
  for (;;) {
    try {
      const read = await provider.read(source, { fetcher, now, allowed });
      return { ...read, attempts: attempt + 1 };
    } catch (err) {
      const e = err instanceof SyncError ? err : toSyncError(err, fetcher, provider.page(source.token));
      const waitMs = e.code === 'rate_limited' ? (e.retryAfterSeconds ?? 5) * 1000 : backoffMs * (attempt + 1);
      if (!e.transient || attempt >= retries || waitMs > maxWaitMs) { e.attempts = attempt + 1; throw e; }
      attempt += 1;
      await sleep(waitMs);
    }
  }
}
