// How often each kind of fact is looked at again, and what happens to that interval as the answers come in.
//
// Facts change at very different speeds and cost very different amounts to check, so they do not share a clock:
//
//   hiring          every 3 days     roles open and close within days, and a "hiring now" claim is the most visible
//                                    one on the site. A company that is not hiring is looked at every 6 days: there
//                                    is nothing to retract. The careers page and its job board are two requests.
//   funding         every 2 days     read at the feed, not the company: a funding story names the company, so one
//                                    read of a publisher's feed covers every company at once. A feed keeps only
//                                    the last few days of stories, so it is read often enough not to miss any.
//   status          every 14 days    acquired, closed, renamed: rare, but a stale answer is the most misleading
//                                    one. Only the homepage is read.
//   description     every 60 days    a company rewrites its own words occasionally.
//   profile         every 90 days    address, city, state, founders, investors move slowly.
//   founded_year    every 365 days   it does not change. It is checked at all only to catch a record that was wrong.
//
// A check that finds nothing new makes the next wait longer (by `growth`, up to `maxDays`); one that finds
// something brings it back to the base, because a fact that just moved is likely to move again. A failure backs
// off on a ladder instead. Every wait carries a small deterministic jitter: companies that were first read in the
// same minute do not stay due in the same minute for ever, and the same state always gives the same date, so
// running the scheduler twice gives the same answer.
import { createHash } from 'node:crypto';
import { PRIORITY } from '../models/enrichmentQueue.js';

export const DAY_MS = 86400000;

// wants: the fields a read of the site must ask for to answer the facet (they choose which pages are read).
// maxPages: how much of the site that takes. importance: which facet goes first when time is short.
// job: which job the facet belongs to in the run log.
export const CADENCE = {
  company: {
    hiring: { label: 'Hiring and open roles', pace: 'frequent', baseDays: 3, minDays: 2, maxDays: 21, growth: 1.4, jitter: 0.15, wants: ['hiring_status', 'jobs'], maxPages: 3, importance: 5, job: 'hiring' },
    status: { label: 'Company status', pace: 'periodic', baseDays: 14, minDays: 7, maxDays: 90, growth: 1.5, jitter: 0.15, wants: [], maxPages: 1, importance: 4, job: 'status' },
    profile: { label: 'Address, founders and investors', pace: 'occasional', baseDays: 90, minDays: 45, maxDays: 365, growth: 2, jitter: 0.15, wants: ['address', 'city', 'state', 'founders', 'investors'], maxPages: 4, importance: 3, job: 'enrichment' },
    description: { label: 'Description', pace: 'occasional', baseDays: 60, minDays: 30, maxDays: 365, growth: 2, jitter: 0.15, wants: ['description'], maxPages: 3, importance: 2, job: 'enrichment' },
    founded_year: { label: 'Founded year', pace: 'rare', baseDays: 365, minDays: 180, maxDays: 1095, growth: 2, jitter: 0.15, wants: ['founded_year'], maxPages: 3, importance: 1, job: 'enrichment' },
    // Not on a clock: a row appears when a story about the company is found (jobs/funding.js).
    funding: { label: 'Funding news', pace: 'moderate', scheduled: false, wants: [], importance: 0, job: 'funding' },
  },
  source: {
    funding: { label: 'Funding feeds', pace: 'moderate', baseDays: 2, minDays: 0.5, maxDays: 7, growth: 1, jitter: 0.1, job: 'funding' },
    discovery: { label: 'Discovery sources', pace: 'moderate', baseDays: 2, minDays: 0.25, maxDays: 7, growth: 1, jitter: 0.1, job: 'discovery' },
    quality: { label: 'Data quality', pace: 'frequent', baseDays: 1, minDays: 0.5, maxDays: 2, growth: 1, jitter: 0, job: 'quality' },
  },
  host: {
    access: { label: 'Hosts that asked us to slow down', pace: 'back-off', job: null },
  },
};

export const COMPANY_FACETS = Object.entries(CADENCE.company).filter(([, s]) => s.scheduled !== false).map(([name]) => name);
export const specOf = (scope, facet) => CADENCE[scope]?.[facet] ?? null;

// A failed attempt backs off: 6 hours, a day, 3 days, a week, then a fortnight.
export const FAILURE_BACKOFF_DAYS = [0.25, 1, 3, 7, 14];
// A refusal is a result, not a failure, and it says how long to leave the site alone: robots.txt does not change
// often; a 401 or 403 may be a firewall that dislikes a data-centre address, so it is looked at again sooner.
export const REFUSED_DAYS = { robots_disallow: 30, robots_unavailable: 3, access_controlled: 7, bad_url: 30, bad_scheme: 30, blocked_host: 365, private_host: 365, unsupported_content: 14, too_large: 30 };
export const REFUSED_DEFAULT_DAYS = 14;
export const NO_WEBSITE_DAYS = 30;
export const MISMATCH_DAYS = 14;
export const BLOCKED_DAYS = 7;
export const INCOMPLETE_DAYS = 1;

// A number in [0, 1) that depends only on the seed.
export function unit(seed) {
  return createHash('sha256').update(String(seed)).digest().readUInt32BE(0) / 2 ** 32;
}

// 1 +/- amount, by seed.
export const jitterFactor = (seed, amount) => 1 + amount * (2 * unit(seed) - 1);

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// The wait after a check that worked, in days: the base, lengthened by how many checks in a row found nothing new.
export function intervalDays(spec, { unchangedStreak = 0, company = null, seed = '' } = {}) {
  // A company that is hiring is looked at more often than one that is not: that is when the answer changes.
  const base = spec === CADENCE.company.hiring && company && company.hiring !== true ? spec.baseDays * 2 : spec.baseDays;
  const grown = base * spec.growth ** Math.min(unchangedStreak, 6);
  return clamp(grown * jitterFactor(seed, spec.jitter ?? 0), spec.minDays, spec.maxDays);
}

export const addDays = (at, days) => new Date(Date.parse(at) + days * DAY_MS).toISOString();

// When to look again after an attempt, given what it came to. `row` is the state AFTER the attempt was recorded
// (its streak and failures are already updated).
export function nextCheckAt({ scope, facet, at, outcome, row, company = null, code = null, retryAfterSeconds = null, baseDays = null }) {
  const standard = specOf(scope, facet);
  // A source may ask for its own pace (our submissions queue is read every six hours, a feed every two days).
  const spec = baseDays && standard ? { ...standard, baseDays, minDays: Math.min(standard.minDays, baseDays), maxDays: Math.max(standard.maxDays, baseDays) } : standard;
  const seed = `${row.id}|${row.checks}|${row.failures}`;
  let days;
  switch (outcome) {
    case 'changed':
    case 'unchanged':
    case 'read':
      days = intervalDays(spec, { unchangedStreak: row.unchanged_streak, company, seed });
      break;
    case 'incomplete': days = INCOMPLETE_DAYS * jitterFactor(seed, 0.2); break;
    case 'no_website': days = NO_WEBSITE_DAYS; break;
    case 'refused': days = REFUSED_DAYS[code] ?? REFUSED_DEFAULT_DAYS; break;
    case 'mismatch': days = MISMATCH_DAYS; break;
    case 'blocked': days = BLOCKED_DAYS; break;
    default: // failed, unreachable
      days = FAILURE_BACKOFF_DAYS[Math.min(Math.max(row.failures, 1), FAILURE_BACKOFF_DAYS.length) - 1] * jitterFactor(seed, 0.2);
  }
  if (retryAfterSeconds != null) days = Math.max(days, retryAfterSeconds / 86400);
  return addDays(at, days);
}

// Where a refresh task sits among the others in the queue: a person's request and a newly published company go
// first (their priorities are in the thousands), then the facets that matter most.
export const taskPriority = (facetNames) => PRIORITY.refresh + 10 * Math.max(0, ...facetNames.map((f) => specOf('company', f)?.importance ?? 0));
