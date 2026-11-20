// The job-board providers the sync can read. Kept apart from adapters.js (which pulls in the compliant fetcher) so the public server can say which boards
// are read without loading anything that fetches. A test pins that this list and the adapters' own PROVIDERS agree.
//
// Each reads the provider's own PUBLIC postings feed over GET, through the project's one compliant fetcher (robots.txt first). A feed whose robots.txt says no for a given company (Pinpoint lets
// each company decide) is refused for that company and said so; nothing here works around it.
export const SUPPORTED = Object.freeze(['greenhouse', 'lever', 'workable', 'ashby', 'recruitee', 'breezy', 'pinpoint', 'bamboohr', 'teamtailor', 'rippling']);

// Providers whose boards the careers-page reader recognises and the sync does NOT read, and why. Said on the coverage view; never worked around.
export const UNSUPPORTED_REASONS = Object.freeze({
  smartrecruiters: 'its postings API (api.smartrecruiters.com) says Disallow: / to every robot in its robots.txt, so it is not read',
  workday: 'no public feed the sync can ask for with GET has been confirmed (Workday lists jobs through a POST request)',
  notion: 'a Notion page is a document, not a job feed',
  'a-notion-page': 'a Notion page is a document, not a job feed',
  'employment-hero': 'no public jobs feed the sync can read has been confirmed',
  elmo: 'no public jobs feed the sync can read has been confirmed',
  jazzhr: 'no public jobs feed the sync can read has been confirmed (JazzHR\'s API needs the employer\'s key)',
  successfactors: 'no public jobs feed the sync can read has been confirmed',
});

// The one host whose robots.txt answers 401 instead of a file, and whose API is the provider's documented public job-posting API: read as "no rules" (http.js, noRulesWhenRobotsForbiddenHosts).
export const PUBLIC_API_HOSTS = Object.freeze(['api.ashbyhq.com']);
