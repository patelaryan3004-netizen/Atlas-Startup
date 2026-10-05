// Shared scaffolding for the discovery tests: a small dataset, scripted sources, and a
// scripted web read through the real compliance fetcher.
import { migrateDataset } from '../../src/models/dataset.js';
import { createFetcher } from '../../src/discovery/http.js';

export const NOW = Date.parse('2026-10-05T04:00:00.000Z');
export const ISO = '2026-10-05T04:00:00.000Z';

export const co = (name, over = {}) => ({
  name, sector: 'AI', sectorFull: 'AI', city: 'Sydney', lat: -33.87, lng: 151.2, investors: [], stage: 'Seed', hiring: false,
  verified: true, website: '', blurb: 'A company.', taskGate: { enabled: false }, ...over,
});

export const COMPANIES = () => [
  co('Leonardo AI', { website: 'https://leonardo.ai', stage: 'Acquired', hiring: true }),
  co('Acme Robotics', { website: 'https://acme.com.au', founders: ['Jane Doe', 'John Roe'], investors: ['Blackbird'] }),
  co('Hone (HoneAg)', { website: 'https://honeag.com', city: 'Newcastle' }),
  co('Hex'),
];

export function dataset(companies = COMPANIES(), extra = {}) {
  return migrateDataset({
    companies, people: [], investors: [], sources: [], evidence: [], identifiers: [], candidates: [], funding_rounds: [], jobs: [], news: [], ...extra,
  });
}

export const lead = (over = {}) => ({
  key: over.key ?? over.name, name: 'Zorbly', url: null, title: null, publisher: 'Test feed', observed_at: ISO, retrieved_at: ISO,
  evidence: [], text: '', extraction: { method: 'test', agreed: false }, ...over,
});

export const fakeSource = ({ id = 'test.feed', kind = 'press', region = 'AU', licenseBasis = 'public_feed', leads = [], fail = null } = {}) => ({
  id, kind, region, licenseBasis, license: { basis: licenseBasis },
  async discover() { if (fail) throw fail; return leads; },
});

// A scripted web: URL -> { status, headers, body } or an Error. Everything goes through
// the real fetcher, so robots.txt, blocking and pacing apply in these tests too.
export function web(routes) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const hit = routes[url];
    if (hit instanceof Error) throw hit;
    if (!hit) return new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } });
    return new Response(hit.body ?? '', { status: hit.status ?? 200, headers: hit.headers ?? { 'content-type': 'text/html' } });
  };
  return { calls, pages: () => calls.filter((u) => !u.endsWith('/robots.txt')), fetchImpl };
}
export function fetcherFor(routes = {}) {
  const w = web(routes);
  return { w, fetcher: createFetcher({ fetchImpl: w.fetchImpl, resolveHost: async () => ['93.184.216.34'], sleep: async () => {}, now: () => NOW }) };
}

// An Australian company's homepage: structured data, an address, a phone number.
export const auPage = (name, { abn = null, address = true } = {}) => `<html><head><title>${name} | Home</title>
  <meta property="og:site_name" content="${name}"><meta name="description" content="${name} makes things.">
  <script type="application/ld+json">${JSON.stringify({
    '@type': 'Organization', name, legalName: `${name} Pty Ltd`, foundingDate: '2022-02-01',
    ...(address ? { address: { '@type': 'PostalAddress', streetAddress: '5 Collins Street', addressLocality: 'Melbourne', addressRegion: 'VIC', postalCode: '3000', addressCountry: 'AU' } } : {}),
  })}</script></head><body><p>${name} Pty Ltd${abn ? ` ABN ${abn}` : ''}. Call +61 3 9999 1234.</p></body></html>`;

export const page = (body, title = 'Home') => `<html><head><title>${title}</title></head><body>${body}</body></html>`;
