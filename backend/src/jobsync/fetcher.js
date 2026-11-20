// The one fetcher the job sync uses: the project's compliant fetcher (robots.txt, pacing, an honest user agent, a size cap, a timeout, no access control bypassed) with the job sync's
// own settings. The only addition to the rules is the one named in providers.js (PUBLIC_API_HOSTS).
import { createFetcher } from '../discovery/http.js';
import { PUBLIC_API_HOSTS } from './providers.js';

export const JOBSYNC_USER_AGENT = 'AUStartupMapBot/1.0 (+https://stillearly-au.vercel.app/; job board sync)';

export function jobSyncFetcher(options = {}) {
  return createFetcher({
    userAgent: JOBSYNC_USER_AGENT, maxBytes: 4000000, minDelayMs: 1500, timeoutMs: 20000,
    noRulesWhenRobotsForbiddenHosts: [...PUBLIC_API_HOSTS], ...options,
  });
}
