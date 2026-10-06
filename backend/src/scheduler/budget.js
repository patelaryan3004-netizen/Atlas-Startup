// How much one run of the scheduler may take: requests, sites and minutes. A run that reaches a limit stops
// starting new work and finishes what is in flight; whatever was left stays due for the next run. Nothing is lost
// and nothing is skipped silently: the run log says which limit stopped it.
//
// The numbers are kept small on purpose. This runs beside a public site and against other people's websites;
// a run is meant to be a few minutes of polite, paced reading, repeated often, not a crawl.
import { FetchPolicyError } from '../discovery/http.js';

export const DEFAULT_LIMITS = { maxRequests: 300, maxSites: 40, maxMinutes: 20, concurrency: 2 };

// A task in flight can still make a handful of requests (robots.txt, the homepage, three pages, two job boards), so
// new tasks stop being started a little before the request limit, and the hard stop is a margin beyond it.
const RESERVE = 12;
const HARD_MARGIN = 1.25;

export function createBudget({ maxRequests = DEFAULT_LIMITS.maxRequests, maxSites = DEFAULT_LIMITS.maxSites, maxMinutes = DEFAULT_LIMITS.maxMinutes, now = Date.now } = {}) {
  const startedAt = now();
  let stoppedFor = null;
  let counter = () => 0;
  const elapsedMs = () => now() - startedAt;

  return {
    limits: { max_requests: maxRequests, max_sites: maxSites, max_minutes: maxMinutes },
    maxSites,
    requests: () => counter(),
    elapsedMs,
    stoppedFor: () => stoppedFor,
    // True once a new task should not be started. The first reason is the one remembered.
    shouldStop() {
      if (stoppedFor) return true;
      if (counter() >= maxRequests - RESERVE) stoppedFor = 'requests';
      else if (elapsedMs() >= maxMinutes * 60000) stoppedFor = 'time';
      return stoppedFor != null;
    },
    // The fetcher, counting what actually goes out (robots.txt reads included) and refusing past the hard limit.
    // A refusal here is a FetchPolicyError like any other, and the worker treats it as something to try again later.
    wrap(fetcher) {
      counter = () => fetcher.log.requests.length;
      return {
        ...fetcher,
        get: (url, options) => {
          if (counter() >= maxRequests * HARD_MARGIN) {
            stoppedFor ??= 'requests';
            return Promise.reject(new FetchPolicyError('budget_exhausted', `this run's limit of ${maxRequests} requests has been reached`, url));
          }
          return fetcher.get(url, options);
        },
      };
    },
  };
}

// The same address asked for twice in one run is answered once: two jobs that read one feed, or a second attempt at
// a write that found the data had moved, cost one request between them.
export function memoFetcher(fetcher) {
  const seen = new Map();
  return {
    ...fetcher,
    get(url, options = {}) {
      const key = `${url}|${options.accept ?? ''}`;
      if (!seen.has(key)) seen.set(key, fetcher.get(url, options));
      return seen.get(key);
    },
  };
}
