// Collections the Community shows: each one is a question put to the directory's own data, with the rule in words beside it, so a reader can see what is in it and why. They are never ranked
// and never endorsed: a collection is "what matches this filter", listed the way the directory lists (by name, or pictures first), and the number beside it is the server's own count for exactly
// that filter. Nothing here is a judgement about quality.
//
// `kind: 'startups'` opens on Discover with the filter applied; `kind: 'investors'` opens the investor directory with its filter.
export const COLLECTIONS = [
  {
    id: 'fintech', kind: 'startups', title: 'Australian fintech startups to discover',
    rule: 'Every company in the directory whose sector is Fintech.', filters: { sector: 'Fintech' },
  },
  {
    id: 'melbourne-early', kind: 'startups', title: 'Emerging Melbourne founders',
    rule: 'Founders named on the public page of an early-stage company based in Melbourne.', filters: { city: 'Melbourne', maturity: 'Early' },
  },
  {
    id: 'ai', kind: 'startups', title: 'Australian AI companies',
    rule: 'Every company in the directory whose sector is AI & Data.', filters: { sector: 'AI & Data' },
  },
  {
    id: 'early-investors', kind: 'investors', title: 'Investors backing early-stage founders',
    rule: 'Investor firms whose own pages say they invest at Pre-seed or Seed.', filters: { kind: 'firm', scope: 'au', stage: 'Pre-seed,Seed' },
  },
];
export const collectionById = (id) => COLLECTIONS.find((c) => c.id === id) ?? null;

// Where a collection opens. The query is the one the destination page already reads.
export function collectionHref(collection) {
  const params = new URLSearchParams();
  if (collection.kind === 'investors') {
    for (const [key, value] of Object.entries(collection.filters)) if (key === 'stage') params.set(key, value);
    const query = params.toString();
    return `/investors${query ? `?${query}` : ''}`;
  }
  for (const [key, value] of Object.entries(collection.filters)) params.set(key, value);
  return `/discover?${params.toString()}`;
}
