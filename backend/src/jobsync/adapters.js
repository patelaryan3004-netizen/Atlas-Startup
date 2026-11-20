// Reading an employer's job board through the provider's own public postings feed: the feed an "open positions" widget on the employer's site uses.
//
// Every read either returns the COMPLETE list of what the board lists, or throws a SyncError saying why not. There is no third outcome: a timeout, a rate limit, a server
// error, a board that says it holds 12 jobs and returns 9, a page that repeats, a response that is not what the provider sends: none of them returns a short list, because a
// short list read as "the rest are gone" would close real roles. Whoever calls this closes nothing on a SyncError.
//
// Greenhouse, Lever, Workable, Ashby and Recruitee are read here: hosted applicant-tracking systems the careers-page reader recognises. Each reads the provider's own public postings feed
// (the one an "open positions" widget on the employer's site uses); none reads a page, a search or a login. SmartRecruiters is NOT read: its postings API says Disallow: / to every robot
// (api.smartrecruiters.com/robots.txt), so its companies stay on the unsupported list (UNSUPPORTED_REASONS, providers.js) until that changes.
//
// Everything goes through the project's one fetcher (discovery/http.js): robots.txt, pacing, an honest user agent, no access control bypassed, a size cap, a timeout.
import { SUPPORTED } from './providers.js';
import { FetchPolicyError } from '../discovery/http.js';
import { canonicalUrl } from './canonical.js';
import { readPlace } from './locations.js';

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

async function getJson(fetcher, url, { maxBytes } = {}) {
  let res;
  try { res = await fetcher.get(url, { accept: 'application/json', allow: ['application/json'], maxBytes }); } catch (err) { throw toSyncError(err, fetcher, url); }
  try { return JSON.parse(res.text); } catch (e) { throw new SyncError('malformed', 'The feed did not return JSON'); }
}

async function getText(fetcher, url, allow) {
  try { return (await fetcher.get(url, { accept: allow[0], allow })).text; } catch (err) { throw toSyncError(err, fetcher, url); }
}

const text = (v, max = 160) => (typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ').slice(0, max) : null);

// A little XML, enough for an RSS feed: the text of a tag inside a block, with CDATA and the five entities read.
const unxml = (s) => String(s ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&amp;/g, '&').trim();
const xmlTag = (block, tag) => { const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i').exec(block); return m ? unxml(m[1]) : null; };

// A pay range the EMPLOYER states in its feed, as { min, max, currency, period, text }, or null. Nothing is worked out or converted: a figure that is not stated stays unstated.
// `min`/`max` are whole currency units (not cents). `period`: year, month, week, day or hour, only when the feed says.
const periodOf = (v) => { const p = String(v ?? '').toLowerCase(); return /year|annual/.test(p) ? 'year' : /month/.test(p) ? 'month' : /week/.test(p) ? 'week' : /\bday|daily/.test(p) ? 'day' : /hour/.test(p) ? 'hour' : null; }; // "1 YEAR" (Ashby), "per-year-salary" (Lever)
export function salaryOf({ min, max, currency, period, text: label } = {}) {
  const num = (v) => { const n = typeof v === 'string' ? Number(v.replace(/[, ]/g, '')) : v; return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null; };
  const lo = num(min);
  const hi = num(max);
  const cur = typeof currency === 'string' && /^[A-Za-z]{3}$/.test(currency.trim()) ? currency.trim().toUpperCase() : null;
  const per = periodOf(period);
  const words = text(label, 120);
  if (lo == null && hi == null && !words) return null;
  if (lo != null && hi != null && hi < lo) return null; // a range the wrong way round is not a statement we can use
  return { min: lo, max: hi, currency: cur, period: per, text: words };
}

// The words a provider uses for the kind of employment, into the words employmentOf (network/jobs.js) reads.
const KIND = { fulltime: 'Full-time', full_time: 'Full-time', parttime: 'Part-time', part_time: 'Part-time', intern: 'Internship', internship: 'Internship', contract: 'Contract', contractor: 'Contract', permanent: 'Full-time', temporary: null, freelance: 'Contract', casual: 'Casual' };
const kindOf = (v) => { const k = String(v ?? '').toLowerCase().replace(/[\s-]+/g, '_'); return k in KIND ? KIND[k] : text(v, 60); };

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
            salary: j.salaryRange ? salaryOf({ min: j.salaryRange.min, max: j.salaryRange.max, currency: j.salaryRange.currency, period: j.salaryRange.interval }) : null, experience: null,
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
  ashby: {
    name: 'Ashby', hosts: ['ashbyhq.com'],
    page: (token) => `https://jobs.ashbyhq.com/${token}`,
    async read(source, { fetcher, now, allowed }) {
      // Ashby's feed carries every job's full description, so a large board is several megabytes (one board of 480 jobs was 8 MB): a larger cap for this request only.
      const body = await getJson(fetcher, `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(source.token)}?includeCompensation=true`, { maxBytes: 20000000 });
      if (!body || !Array.isArray(body.jobs)) throw new SyncError('malformed', 'The Ashby feed has no list of jobs');
      const out = { postings: [], seen: new Set(), skipped: [], pages: 1 };
      for (const j of body.jobs) {
        if (!j?.id) throw new SyncError('malformed', 'An Ashby job has no id');
        if (j.isListed === false) continue; // not on the board: not listed
        const id = String(j.id);
        if (out.seen.has(id)) continue;
        out.seen.add(id);
        const apply = applyLink(j.jobUrl ?? j.applyUrl, allowed);
        const title = text(j.title, 200);
        if (!title || !apply) { out.skipped.push({ id, reason: !title ? 'no title' : 'the link is not the employer\'s' }); continue; }
        const labels = [...new Set([j.location, ...(Array.isArray(j.secondaryLocations) ? j.secondaryLocations.map((l) => l?.location) : [])].map((v) => text(v)).filter(Boolean))];
        // A label that does not say where ("Remote", "Hybrid") beside a postal address in Australia: the address is the employer's statement of where.
        const home = j.address?.postalAddress;
        if (home?.addressCountry && /australia/i.test(home.addressCountry) && !labels.some((l) => readPlace(l)?.au)) labels.push(text([home.addressLocality, home.addressRegion, home.addressCountry].filter(Boolean).join(', ')));
        const pay = (j.compensation?.summaryComponents ?? []).find((c) => /salary/i.test(c?.compensationType ?? ''));
        out.postings.push({
          external_id: id, title, apply_url: apply, canonical_url: canonicalUrl(apply), labels: labels.filter(Boolean), workplaceType: text(j.workplaceType, 30),
          employment: kindOf(j.employmentType), team: text(j.team ?? j.department), posted_at: postedAt(j.publishedAt, now), experience: null,
          salary: pay ? salaryOf({ min: pay.minValue, max: pay.maxValue, currency: pay.currencyCode, period: pay.interval, text: j.compensation?.compensationTierSummary }) : null,
        });
      }
      return { complete: true, ...out };
    },
  },
  recruitee: {
    name: 'Recruitee', hosts: ['recruitee.com'],
    page: (token) => `https://${token}.recruitee.com/`,
    async read(source, { fetcher, now, allowed }) {
      const body = await getJson(fetcher, `https://${encodeURIComponent(source.token)}.recruitee.com/api/offers/`, { maxBytes: 20000000 });
      if (!body || !Array.isArray(body.offers)) throw new SyncError('malformed', 'The Recruitee feed has no list of offers');
      const out = { postings: [], seen: new Set(), skipped: [], pages: 1 };
      for (const o of body.offers) {
        const id = String(o?.id ?? o?.guid ?? '');
        if (!id) throw new SyncError('malformed', 'A Recruitee offer has no id');
        if (o.status && o.status !== 'published') continue;
        if (out.seen.has(id)) continue;
        out.seen.add(id);
        const apply = applyLink(o.careers_url ?? o.url, allowed);
        const title = text(o.title, 200);
        if (!title || !apply) { out.skipped.push({ id, reason: !title ? 'no title' : 'the link is not the employer\'s' }); continue; }
        const labels = [text(o.location) ?? text([o.city, o.state_name ?? o.state_code, o.country].filter(Boolean).join(', '))].filter(Boolean);
        out.postings.push({
          external_id: id, title, apply_url: apply, canonical_url: canonicalUrl(apply), labels, workplaceType: o.remote === true ? 'remote' : o.hybrid === true ? 'hybrid' : o.on_site === true ? 'on-site' : null,
          employment: kindOf(o.employment_type_code), team: text(o.department), posted_at: postedAt(o.published_at ?? o.created_at, now),
          experience: text(String(o.experience_code ?? '').replace(/_/g, ' '), 40),
          salary: o.salary && typeof o.salary === 'object' ? salaryOf({ min: o.salary.min, max: o.salary.max, currency: o.salary.currency, period: o.salary.period }) : null,
        });
      }
      return { complete: true, ...out };
    },
  },
  breezy: {
    name: 'Breezy', hosts: ['breezy.hr'],
    page: (token) => `https://${token}.breezy.hr/`,
    async read(source, { fetcher, now, allowed }) {
      const body = await getJson(fetcher, `https://${encodeURIComponent(source.token)}.breezy.hr/json`, { maxBytes: 20000000 });
      if (!Array.isArray(body)) throw new SyncError('malformed', 'The Breezy feed is not a list of positions');
      const out = { postings: [], seen: new Set(), skipped: [], pages: 1 };
      for (const j of body) {
        if (!j?.id) throw new SyncError('malformed', 'A Breezy position has no id');
        const id = String(j.id);
        if (out.seen.has(id)) continue;
        out.seen.add(id);
        const apply = applyLink(j.url, allowed);
        const title = text(j.name, 200);
        if (!title || !apply) { out.skipped.push({ id, reason: !title ? 'no title' : 'the link is not the employer\'s' }); continue; }
        const places = (Array.isArray(j.locations) && j.locations.length ? j.locations : j.location ? [j.location] : []).filter((l) => l && typeof l === 'object');
        const labels = [...new Set(places.map((l) => text([l.city, l.state?.name, l.country?.name].filter(Boolean).join(', ')) ?? text(l.name)).filter(Boolean))];
        const how = places.map((l) => String(l.remote_details?.value ?? '').toLowerCase()).find((v) => /^(remote|hybrid)$/.test(v));
        out.postings.push({
          external_id: id, title, apply_url: apply, canonical_url: canonicalUrl(apply), labels, workplaceType: how ?? null,
          employment: kindOf(j.type?.name ?? j.type?.id), team: text(typeof j.department === 'string' ? j.department : j.department?.name), posted_at: postedAt(j.published_date, now), experience: null,
          salary: typeof j.salary === 'string' && j.salary.trim() ? salaryOf({ text: j.salary }) : null,
        });
      }
      return { complete: true, ...out };
    },
  },
  pinpoint: {
    name: 'Pinpoint', hosts: ['pinpointhq.com'],
    page: (token) => `https://${token}.pinpointhq.com/`,
    async read(source, { fetcher, now, allowed }) {
      const body = await getJson(fetcher, `https://${encodeURIComponent(source.token)}.pinpointhq.com/postings.json`, { maxBytes: 20000000 });
      if (!body || !Array.isArray(body.data)) throw new SyncError('malformed', 'The Pinpoint feed has no list of postings');
      const out = { postings: [], seen: new Set(), skipped: [], pages: 1 };
      for (const j of body.data) {
        if (j?.id == null) throw new SyncError('malformed', 'A Pinpoint posting has no id');
        const id = String(j.id);
        if (out.seen.has(id)) continue;
        out.seen.add(id);
        const apply = applyLink(j.url, allowed);
        const title = text(j.title, 200);
        if (!title || !apply) { out.skipped.push({ id, reason: !title ? 'no title' : 'the link is not the employer\'s' }); continue; }
        const l = j.location ?? {};
        const place = text([l.city ?? l.name, l.province].filter(Boolean).join(', '));
        out.postings.push({
          external_id: id, title, apply_url: apply, canonical_url: canonicalUrl(apply), labels: place ? [place] : [], workplaceType: text(j.workplace_type, 20),
          employment: kindOf(j.employment_type_text), team: text(j.job?.department?.name), posted_at: null, experience: null,
          salary: j.compensation_visible === true ? salaryOf({ min: j.compensation_minimum, max: j.compensation_maximum, currency: j.compensation_currency, period: j.compensation_frequency, text: j.compensation }) : null,
        });
      }
      return { complete: true, ...out };
    },
  },
  bamboohr: {
    name: 'BambooHR', hosts: ['bamboohr.com'],
    page: (token) => `https://${token}.bamboohr.com/careers`,
    async read(source, { fetcher, now, allowed }) {
      const body = await getJson(fetcher, `https://${encodeURIComponent(source.token)}.bamboohr.com/careers/list`);
      if (!body || !Array.isArray(body.result)) throw new SyncError('malformed', 'The BambooHR feed has no list of openings');
      const total = body.meta?.totalCount;
      if (Number.isFinite(total) && total !== body.result.length) throw new SyncError('incomplete', `The board says it lists ${total} openings and returned ${body.result.length}`);
      const out = { postings: [], seen: new Set(), skipped: [], pages: 1 };
      for (const j of body.result) {
        if (j?.id == null) throw new SyncError('malformed', 'A BambooHR opening has no id');
        const id = String(j.id);
        if (out.seen.has(id)) continue;
        out.seen.add(id);
        const apply = applyLink(`https://${source.token}.bamboohr.com/careers/${encodeURIComponent(id)}`, allowed);
        const title = text(j.jobOpeningName, 200);
        if (!title || !apply) { out.skipped.push({ id, reason: !title ? 'no title' : 'the link is not the employer\'s' }); continue; }
        const a = j.atsLocation ?? {};
        const place = text([j.location?.city, j.location?.state, j.location?.country].filter(Boolean).join(', ')) ?? text([a.city, a.province ?? a.state, a.country].filter(Boolean).join(', '));
        const how = { 0: 'on-site', 1: 'remote', 2: 'hybrid' }[String(j.locationType)] ?? (j.isRemote === true ? 'remote' : null);
        out.postings.push({
          external_id: id, title, apply_url: apply, canonical_url: canonicalUrl(apply), labels: place ? [place] : [], workplaceType: how,
          employment: kindOf(j.employmentStatusLabel), team: text(j.departmentLabel), posted_at: null, experience: null, salary: null,
        });
      }
      return { complete: true, ...out };
    },
  },
  teamtailor: {
    name: 'Teamtailor', hosts: ['teamtailor.com'],
    page: (token) => `https://${token}.teamtailor.com/jobs`,
    async read(source, { fetcher, now, allowed }) {
      const xml = await getText(fetcher, `https://${encodeURIComponent(source.token)}.teamtailor.com/jobs.rss`, ['application/rss+xml', 'application/xml', 'text/xml']);
      if (!/<rss[\s>]/i.test(xml) || !/<channel[\s>]/i.test(xml)) throw new SyncError('malformed', 'The Teamtailor feed is not an RSS feed');
      const out = { postings: [], seen: new Set(), skipped: [], pages: 1 };
      for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
        const item = m[1];
        const id = xmlTag(item, 'guid') ?? xmlTag(item, 'link');
        if (!id) throw new SyncError('malformed', 'A Teamtailor job has no id');
        if (out.seen.has(id)) continue;
        out.seen.add(id);
        const apply = applyLink(xmlTag(item, 'link'), allowed);
        const title = text(xmlTag(item, 'title'), 200);
        if (!title || !apply) { out.skipped.push({ id, reason: !title ? 'no title' : 'the link is not the employer\'s' }); continue; }
        const labels = [...new Set([...item.matchAll(/<tt:location>([\s\S]*?)<\/tt:location>/gi)].map((l) => text([xmlTag(l[1], 'tt:city'), xmlTag(l[1], 'tt:country')].filter(Boolean).join(', ')) ?? text(xmlTag(l[1], 'tt:name'))).filter(Boolean))];
        const remote = String(xmlTag(item, 'remoteStatus') ?? '').toLowerCase();
        out.postings.push({
          external_id: id, title, apply_url: apply, canonical_url: canonicalUrl(apply), labels, workplaceType: /hybrid/.test(remote) ? 'hybrid' : /remote|fully/.test(remote) ? 'remote' : remote === 'none' ? 'on-site' : null,
          employment: null, team: text(xmlTag(item, 'tt:department')), posted_at: postedAt(xmlTag(item, 'pubDate'), now), experience: null, salary: null,
        });
      }
      return { complete: true, ...out };
    },
  },
  rippling: {
    name: 'Rippling', hosts: ['rippling.com'],
    page: (token) => `https://ats.rippling.com/${token}/jobs`,
    async read(source, { fetcher, now, allowed }) {
      const body = await getJson(fetcher, `https://api.rippling.com/platform/api/ats/v1/board/${encodeURIComponent(source.token)}/jobs`, { maxBytes: 20000000 });
      if (!Array.isArray(body)) throw new SyncError('malformed', 'The Rippling feed is not a list of jobs');
      const out = { postings: [], seen: new Set(), skipped: [], pages: 1 };
      for (const j of body) {
        if (!j?.uuid) throw new SyncError('malformed', 'A Rippling job has no id');
        const id = String(j.uuid);
        if (out.seen.has(id)) continue;
        out.seen.add(id);
        const apply = applyLink(j.url, allowed);
        const title = text(j.name, 200);
        if (!title || !apply) { out.skipped.push({ id, reason: !title ? 'no title' : 'the link is not the employer\'s' }); continue; }
        const place = text(j.workLocation?.label);
        out.postings.push({
          external_id: id, title, apply_url: apply, canonical_url: canonicalUrl(apply), labels: place ? [place] : [], workplaceType: place && /^remote\b/i.test(place) ? 'remote' : null,
          employment: null, team: text(j.department?.label), posted_at: null, experience: null, salary: null,
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
