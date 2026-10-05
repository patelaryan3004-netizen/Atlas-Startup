import { describe, it, expect } from 'vitest';
import { extractFacts, pageMatchesName, enrichFromWebsite } from '../src/discovery/enrich.js';
import { createFetcher } from '../src/discovery/http.js';

const NOW = Date.parse('2026-10-05T04:00:00.000Z');

const LD = JSON.stringify({
  '@context': 'https://schema.org', '@type': 'Organization', name: 'Acme Robotics', alternateName: 'Acme Labs', legalName: 'Acme Robotics Pty Ltd',
  foundingDate: '2019-03-01', founder: [{ '@type': 'Person', name: 'Jane Doe' }, { '@type': 'Person', name: 'John Roe' }, { '@type': 'Person', name: 'Cher' }],
  address: { '@type': 'PostalAddress', streetAddress: '1 George Street', addressLocality: 'Sydney', addressRegion: 'NSW', postalCode: '2000', addressCountry: 'AU' },
});
const HOME = `<html><head><title>Acme Robotics | Robots for warehouses</title>
  <meta name="description" content="Acme builds warehouse robots."><meta property="og:site_name" content="Acme Robotics">
  <script type="application/ld+json">${LD}</script></head>
  <body><nav><a href="/about">About</a><a href="/contact">Contact us</a><a href="/privacy-policy">Privacy</a>
  <a href="https://www.linkedin.com/company/acme">LinkedIn</a><a href="https://other.example/about">Elsewhere</a><a href="/blog/post-1">Blog</a><a href="/files/brochure.pdf">PDF</a></nav>
  <p>Call us on +61 2 9999 1234.</p><footer>Acme Robotics Pty Ltd ABN 53 004 085 616</footer></body></html>`;
const PRIVACY = '<html><head><title>Privacy | Acme</title></head><body><p>Acme Robotics Pty Ltd (ACN 004 085 616) is an Australian company at 1 George Street, Sydney NSW 2000, Australia.</p></body></html>';

describe('what a page says about itself', () => {
  it('reads structured data as the company states it, and the footer by pattern', () => {
    const f = extractFacts(HOME);
    expect(f.names).toEqual(expect.arrayContaining(['Acme Robotics', 'Acme Labs']));
    expect(f.legalNames).toEqual(['Acme Robotics Pty Ltd']);
    expect(f.abns).toEqual(['53004085616']);
    expect(f.foundedYear).toBe(2019);
    expect(f.foundedFrom).toBe('structured');
    expect(f.founders).toEqual(['Jane Doe', 'John Roe']); // "Cher" is one word: not enough to name a person
    expect(f.addresses[0]).toEqual({ text: '1 George Street, Sydney NSW 2000', city: 'Sydney', state: 'NSW', source: 'structured' });
    expect(f.description).toBe('Acme builds warehouse robots.');
    expect(f.phones).toBe(1);
  });

  it("reads Fastlane's privacy-policy sentence: the legal name, the ACN and the street address", () => {
    const f = extractFacts('<p>Possibility Studios Pty Ltd (ACN 690 900 497), trading as Fastlane, an Australian company incorporated in NSW, at 17-19 Bridge Street, Sydney NSW 2000, Australia.</p>');
    expect(f.legalNames).toEqual(['Possibility Studios Pty Ltd']);
    expect(f.acns).toEqual(['690900497']);
    expect(f.addresses).toEqual([{ text: '17-19 Bridge Street, Sydney NSW 2000', city: 'Sydney', state: 'NSW', source: 'text' }]);
  });

  it('finds a street address without a comma, and takes the city from between the street and the state', () => {
    expect(extractFacts('<p>Visit 18 Wangaratta Street Richmond VIC 3121 any time</p>').addresses[0]).toMatchObject({ city: 'Richmond', state: 'VIC', text: '18 Wangaratta Street, Richmond VIC 3121' });
    expect(extractFacts('<p>Level 3, 10 George St, Sydney NSW 2000</p>').addresses[0]).toMatchObject({ text: '10 George St, Sydney NSW 2000', state: 'NSW' });
  });

  it('ignores a registry number that fails its checksum, and an address outside Australia', () => {
    const f = extractFacts('<p>ABN 12 345 678 901. ACN 123 456 789. 500 Market Street, San Francisco CA 94105.</p>');
    expect(f.abns).toEqual([]);
    expect(f.acns).toEqual([]);
    expect(f.addresses).toEqual([]);
  });

  it('reads a founding year stated in the text, as less certain than structured data', () => {
    const f = extractFacts('<p>Founded in 2021 in Melbourne.</p>');
    expect(f).toMatchObject({ foundedYear: 2021, foundedFrom: 'text' });
    expect(extractFacts('<p>Since forever.</p>').foundedYear).toBeNull();
  });

  it('survives a page with nothing useful', () => {
    expect(extractFacts('<html><body></body></html>')).toMatchObject({ names: [], legalNames: [], abns: [], acns: [], addresses: [], foundedYear: null, founders: [] });
    expect(extractFacts('')).toMatchObject({ names: [], addresses: [] });
  });

  it('takes the head of the homepage title as the name the page gives itself, but not an inner page\'s', () => {
    expect(extractFacts('<title>Trendspek – Asset analysis</title>').names).toContain('Trendspek');
    expect(extractFacts('<title>Trendspek | Home</title>').names).toContain('Trendspek');
    expect(extractFacts('<title>Privacy | Trendspek</title>', { home: false }).names).toEqual([]);
  });
});

describe('is this website the candidate', () => {
  const facts = (names, legalNames = []) => ({ names, legalNames });

  it('accepts a page that gives the candidate\'s name, a variant, a legal name, or a close one', () => {
    expect(pageMatchesName(['Acme Robotics'], facts(['Acme Robotics']), 'acme.com.au')).toBe(true);
    expect(pageMatchesName(['Leonardo.Ai'], facts(['Leonardo AI']), 'leonardo.ai')).toBe(true);
    expect(pageMatchesName(['Fastlane'], facts([], ['Possibility Studios Pty Ltd']), 'usefastlane.ai')).toBe(true); // by the domain's own word
    expect(pageMatchesName(['Acme Robotix'], facts(['Acme Robotics']), 'x.example')).toBe(true);
    expect(pageMatchesName(['Sherpa Delivery'], facts(['Sherpa']), 'sherpa.net.au')).toBe(true);
  });

  it('rejects a page that is plainly about someone else', () => {
    expect(pageMatchesName(['Acme Robotics'], facts(['Totally Different Co']), 'different.example')).toBe(false);
    expect(pageMatchesName(['Zorbly'], facts([]), 'unrelated.example')).toBe(false);
  });
});

// A scripted web, as in fetch.test.js.
function web(routes) {
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
const fetcherFor = (routes) => {
  const w = web(routes);
  return { w, fetcher: createFetcher({ fetchImpl: w.fetchImpl, resolveHost: async () => ['93.184.216.34'], sleep: async () => {} }) };
};
const SITE = { 'https://acme.com.au/': { body: HOME }, 'https://acme.com.au/privacy-policy': { body: PRIVACY }, 'https://acme.com.au/contact': { body: '<p>Contact: hello@acme.com.au</p>' }, 'https://acme.com.au/about': { body: '<p>About us. Founded in 2018.</p>' } };
const enrich = (routes, over = {}) => {
  const { w, fetcher } = fetcherFor(routes);
  return enrichFromWebsite(over.website ?? 'https://acme.com.au', { fetcher, now: () => NOW, candidateNames: ['Acme Robotics'], ...over }).then((r) => ({ r, w }));
};

describe('enriching a candidate from its own website', () => {
  it('reads the homepage and the pages it links to, and nothing it was not pointed to', async () => {
    const { r, w } = await enrich(SITE);
    expect(w.pages()).toEqual(['https://acme.com.au/', 'https://acme.com.au/privacy-policy', 'https://acme.com.au/contact']);
    expect(r.pages.map((p) => p.status)).toEqual([200, 200, 200]);
    expect(w.pages().some((u) => /linkedin|other\.example|brochure|blog/.test(u))).toBe(false);
  });

  it('turns what it read into evidence with its source: high for structured data, medium for text, never invented', async () => {
    const { r } = await enrich(SITE);
    const by = (field) => r.evidence.filter((e) => e.field === field);
    expect(by('website')).toEqual([expect.objectContaining({ value: 'https://acme.com.au', confidence: 'high', verified_at: '2026-10-05T04:00:00.000Z' })]);
    expect(by('address')).toEqual([expect.objectContaining({ value: '1 George Street, Sydney NSW 2000', confidence: 'high' })]);
    expect(by('city')[0]).toMatchObject({ value: 'Sydney', confidence: 'high' });
    expect(by('state')[0]).toMatchObject({ value: 'NSW' });
    expect(by('founded_year')).toEqual([expect.objectContaining({ value: 2019, confidence: 'high' })]);
    expect(by('founders').map((e) => [e.value, e.confidence])).toEqual([['Jane Doe', 'medium'], ['John Roe', 'medium']]);
    expect(by('description')[0]).toMatchObject({ value: 'Acme builds warehouse robots.', confidence: 'medium', verified_at: null });
    for (const e of r.evidence) {
      expect(e.source).toMatchObject({ retrieved_at: '2026-10-05T04:00:00.000Z' });
      expect(['company_website', 'company_document']).toContain(e.source.kind);
      if (e.confidence !== 'high') expect(e.verified_at).toBeNull();
      if (e.verified_at) expect(e.source.retrieved_at).not.toBeNull();
    }
  });

  it('files a privacy or terms page as a company document, and the rest as the company website', async () => {
    const { r } = await enrich(SITE);
    const kinds = new Set(r.evidence.map((e) => e.source.kind));
    expect(kinds).toEqual(new Set(['company_website']));
    // The address on the privacy page is the same fact as the structured one, kept once from the stronger reading.
    expect(r.evidence.filter((e) => e.field === 'address')).toHaveLength(1);
  });

  it('collects the registry numbers, legal names and other names the site gives', async () => {
    const { r } = await enrich(SITE);
    expect(r.external_ids).toEqual({ abn: '53004085616', acn: '004085616' });
    expect(r.legalNames).toEqual(['Acme Robotics Pty Ltd']);
    expect(r.aliases).toEqual(['Acme Labs']);
    expect(r.signals.phones).toBe(1);
  });

  it('respects the page limit', async () => {
    const { w } = await enrich(SITE, { maxPages: 2 });
    expect(w.pages()).toEqual(['https://acme.com.au/', 'https://acme.com.au/privacy-policy']);
  });

  it('records a refusal and returns what it has, instead of throwing: robots.txt, access control, a bad website', async () => {
    const closed = await enrich({ 'https://acme.com.au/robots.txt': { body: 'User-agent: *\nDisallow: /\n', headers: { 'content-type': 'text/plain' } }, ...SITE });
    expect(closed.r.evidence).toEqual([]);
    expect(closed.r.errors).toEqual([expect.objectContaining({ code: 'robots_disallow' })]);
    expect(closed.w.pages()).toEqual([]);

    const walled = await enrich({ 'https://acme.com.au/': { status: 403, body: 'no' } });
    expect(walled.r.errors).toEqual([expect.objectContaining({ code: 'access_controlled' })]);

    const linkedin = await enrich({}, { website: 'https://www.linkedin.com/company/acme' });
    expect(linkedin.r.errors).toEqual([expect.objectContaining({ code: 'bad_url' })]);
    expect(linkedin.w.calls).toEqual([]);
  });

  it('adopts nothing from a site that appears to belong to someone else, and says so', async () => {
    const other = '<html><head><title>Totally Different Co</title><meta property="og:site_name" content="Totally Different Co"></head><body><p>ABN 53 004 085 616</p></body></html>';
    const { r } = await enrich({ 'https://acme.com.au/': { body: other } });
    expect(r.evidence).toEqual([]);
    expect(r.external_ids).toEqual({ abn: null, acn: null });
    expect(r.warnings).toEqual([expect.stringMatching(/does not appear to be Acme Robotics: it calls itself Totally Different Co/)]);
  });

  it('keeps a refusal on a linked page without losing the homepage', async () => {
    const { r } = await enrich({ ...SITE, 'https://acme.com.au/privacy-policy': { status: 403, body: 'no' } });
    expect(r.evidence.some((e) => e.field === 'website')).toBe(true);
    expect(r.errors.map((e) => e.code)).toEqual(['access_controlled']);
  });
});
