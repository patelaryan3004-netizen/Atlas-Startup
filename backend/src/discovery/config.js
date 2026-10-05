// The sources the engine runs. Add a source by adding an entry here (and, for a new
// kind of source, one adapter in sources/). Nothing in this list may be scraped
// without the licence or permission stated in its `license`.
//
// Only sources that need no credential and no special permission are enabled by
// default: a publisher's own RSS feed (read with robots.txt honoured, headline and
// link only) and our own submissions queue. A licensed API or an open dataset is
// added as a 'structured-feed' source with its licence attestation - see
// sources/structuredFeed.js for the shape. Nothing here reads LinkedIn or copies a
// proprietary database, and the fetcher would refuse if a source tried.

export function buildSourceConfig(env = process.env) {
  return [
    {
      // A funding-only feed whose excerpts open with the company's name.
      id: 'rss.startupdaily-funding', adapter: 'rss', enabled: true, region: 'AU', publisher: 'Startup Daily',
      feed_url: 'https://www.startupdaily.net/topic/funding/feed/',
      license: { basis: 'public_feed' },
    },
    {
      // Founder and company submissions. Set DISCOVERY_SUBMISSIONS_URL to the deployed
      // API (https://.../api/submissions) and ADMIN_KEY to read the live queue; otherwise
      // the local copy of submissions.json is read.
      id: 'submissions', adapter: 'submissions', enabled: true, region: 'AU',
      url: env.DISCOVERY_SUBMISSIONS_URL || undefined,
      license: { basis: 'user_submission' },
    },
  ];
}
