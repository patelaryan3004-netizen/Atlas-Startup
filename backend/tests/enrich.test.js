import { describe, it, expect } from 'vitest';
import { extractFacts, pageMatchesName, enrichFromWebsite, legalNamesIn, looksLikeName } from '../src/discovery/enrich.js';
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

  it('keeps a dotted suite number whole instead of cutting it to a number the page did not give', () => {
    expect(extractFacts('<p>Level 1 Suite 1.103/477 Pitt St, Haymarket NSW 2000, Australia.</p>').addresses)
      .toEqual([{ text: '1.103/477 Pitt St, Haymarket NSW 2000', city: 'Haymarket', state: 'NSW', source: 'text' }]);
    expect(extractFacts('<p>Level 12, 92 Pitt Street, Sydney NSW 2000</p>').addresses[0].text).toBe('92 Pitt Street, Sydney NSW 2000');
    expect(extractFacts('<p>Suite 4/10 George St, Sydney NSW 2000</p>').addresses[0].text).toBe('4/10 George St, Sydney NSW 2000');
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

  it('takes the head of the homepage title as a possible name, but not an inner page\'s', () => {
    expect(extractFacts('<title>Trendspek – Asset analysis</title>').titleName).toBe('Trendspek');
    expect(extractFacts('<title>Trendspek | Home</title>').titleName).toBe('Trendspek');
    expect(extractFacts('<title>Privacy | Trendspek</title>', { home: false }).titleName).toBeNull();
    // What the page states about itself is kept apart from the title.
    expect(extractFacts('<title>Trendspek | Home</title>').names).toEqual([]);
  });
});

describe('legal names in running text, as real pages write them', () => {
  it('stops at the label words that come before an entity in a contact block', () => {
    // Trendspek's privacy policy: a person, a role, then the entity.
    expect(legalNamesIn('Mitch Deam Privacy Officer Trendspek Operations Pty Ltd Address: Level 1 Suite 1.103/477 Pitt St, Haymarket NSW 2000 Email: compliance@trendspek.com'))
      .toEqual(['Trendspek Operations Pty Ltd']);
    expect(legalNamesIn('Attention: Privacy Officer Medcast Pty Ltd Level 12, 92 Pitt Street, Sydney NSW 2000')).toEqual(['Medcast Pty Ltd']);
  });

  it('finds two entities named in one sentence, keeping the legal form as written', () => {
    expect(legalNamesIn('Who is Medcast? Medcast Pty Limited ACN 166 955 433 and Critical Care Education Services Pty Ltd ABN 34 623 420 468 (Medcast, we, us, our)'))
      .toEqual(['Medcast Pty Limited', 'Critical Care Education Services Pty Ltd']);
  });

  it('finds an entity named in a footer sentence', () => {
    expect(legalNamesIn('Copyright © RentBetter is a Property Technology Group Pty Ltd company | ABN 29610194771')).toEqual(['Property Technology Group Pty Ltd']);
    expect(legalNamesIn('Fastlane is operated by Possibility Studios Pty Ltd.')).toEqual(['Possibility Studios Pty Ltd']);
  });

  it('normalises punctuation in the legal form but not the wording', () => {
    expect(legalNamesIn('Acme Robotics Pty. Ltd. is based in Sydney')).toEqual(['Acme Robotics Pty Ltd']);
    expect(legalNamesIn('Acme Robotics Pty Limited is based in Sydney')).toEqual(['Acme Robotics Pty Limited']);
    expect(legalNamesIn('No company here, just Pty Ltd on its own')).toEqual([]);
  });

  it('tells a name from a tagline', () => {
    for (const name of ['Trendspek', 'Acme Robotics', '6clicks', 'Who Gives a Crap']) expect(looksLikeName(name), name).toBe(true);
    for (const tagline of ['Quality, online, social learning for Health Professionals', 'Find a Tenant & Manage Your Rental Property', 'robots for warehouses', '', null]) {
      expect(looksLikeName(tagline), String(tagline)).toBe(false);
    }
  });

  it('reads an ABN and an ACN that belong to two entities on the same page', () => {
    const f = extractFacts('<p>Medcast Pty Limited ACN 166 955 433 and Critical Care Education Services Pty Ltd ABN 34 623 420 468</p>');
    expect(f.acns).toEqual(['166955433']);
    expect(f.abns).toEqual(['34623420468']);
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

  it('does not take a tagline for the page\'s name: with nothing else it falls back to the domain, as with no title', () => {
    const tagline = 'Quality, online, social learning for Health Professionals';
    expect(pageMatchesName(['Medcast'], { names: [], titleName: tagline, legalNames: [] }, 'medcast.com.au')).toBe(true);
    expect(pageMatchesName(['Medcast'], { names: [], titleName: tagline, legalNames: [] }, 'unrelated.example')).toBe(false);
    // A title that is a name counts as the page naming itself, so a matching domain cannot outvote it.
    expect(pageMatchesName(['Medcast'], { names: [], titleName: 'Totally Different Co', legalNames: [] }, 'medcast.com.au')).toBe(false);
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

  it('does not mistake a homepage tagline for the company\'s name, or an inner page for its description', async () => {
    const home = `<html><head><title>Quality, online, social learning for Health Professionals</title>
      <meta name="description" content="Improving healthcare through education in Australia and around the world"></head>
      <body><a href="/privacy-policy">Privacy</a><p>Copyright © Medcast</p></body></html>`;
    const privacy = `<html><head><title>Privacy Policy</title><meta name="description" content="Medcast Privacy Policy and how we handle your personal information in full"></head>
      <body><p>Who is Medcast? Medcast Pty Limited ACN 166 955 433 and Critical Care Education Services Pty Ltd ABN 34 623 420 468.
      Attention: Privacy Officer Medcast Pty Ltd Level 12, 92 Pitt Street, Sydney NSW 2000</p></body></html>`;
    const { r } = await enrich({ 'https://medcast.com.au/': { body: home }, 'https://medcast.com.au/privacy-policy': { body: privacy } }, { website: 'https://medcast.com.au', candidateNames: ['Medcast'] });
    // The page's ABN and ACN belong to two entities, so they are recorded but the pair is flagged.
    expect(r.warnings).toEqual([expect.stringMatching(/ABN 34623420468 and ACN 166955433, which do not belong to one company.*two legal entities/)]);
    expect(r.aliases).toEqual([]); // the tagline is not an alias
    expect(r.legalNames).toEqual(['Medcast Pty Limited', 'Critical Care Education Services Pty Ltd', 'Medcast Pty Ltd']);
    expect(r.external_ids).toEqual({ abn: '34623420468', acn: '166955433' });
    const descriptions = r.evidence.filter((e) => e.field === 'description').map((e) => e.value);
    expect(descriptions).toEqual(['Improving healthcare through education in Australia and around the world']);
    expect(r.evidence.find((e) => e.field === 'city')).toMatchObject({ value: 'Sydney' });
  });

  it('does not flag an ABN and ACN that belong together, or a page that gives only one of them', async () => {
    expect((await enrich(SITE)).r.warnings).toEqual([]); // 53 004 085 616 ends with 004 085 616
    const only = (body) => enrich({ 'https://acme.com.au/': { body: `<html><head><title>Acme</title></head><body><p>${body}</p></body></html>` } }, { candidateNames: ['Acme'] }).then(({ r }) => r.warnings);
    expect(await only('Acme Pty Ltd ABN 53 004 085 616')).toEqual([]);
    expect(await only('Acme Pty Ltd ACN 004 085 616')).toEqual([]);
  });

  it('does not record a one-word placeholder as the description, but does record a short real one', async () => {
    const site = (description) => ({ 'https://acme.com.au/': { body: `<html><head><title>Acme</title><meta name="description" content="${description}"></head><body><p>Acme</p></body></html>` } });
    const descriptions = async (description) => (await enrich(site(description), { candidateNames: ['Acme'] })).r.evidence.filter((e) => e.field === 'description').map((e) => e.value);
    expect(await descriptions('Home')).toEqual([]);
    expect(await descriptions('Welcome')).toEqual([]);
    expect(await descriptions('Acme makes things.')).toEqual(['Acme makes things.']);
  });

  it('records a suburb in the address but not as the city, so the city filter is not fragmented', async () => {
    const privacy = '<html><head><title>Privacy</title></head><body><p>Trendspek Operations Pty Ltd, Level 1 Suite 1.103/477 Pitt St, Haymarket NSW 2000, Australia.</p></body></html>';
    const home = '<html><head><title>Trendspek | Home</title></head><body><a href="/policies/privacy-policy">Privacy Policy</a></body></html>';
    const { r } = await enrich({ 'https://trendspek.com/': { body: home }, 'https://trendspek.com/policies/privacy-policy': { body: privacy } }, { website: 'https://trendspek.com', candidateNames: ['Trendspek'] });
    const by = (field) => r.evidence.filter((e) => e.field === field).map((e) => e.value);
    expect(by('address')).toEqual(['1.103/477 Pitt St, Haymarket NSW 2000']); // the suite as the page gives it, not "103/477"
    expect(by('state')).toEqual(['NSW']);
    expect(by('city')).toEqual([]);
    expect(r.legalNames).toEqual(['Trendspek Operations Pty Ltd']);
  });

  it('keeps a refusal on a linked page without losing the homepage', async () => {
    const { r } = await enrich({ ...SITE, 'https://acme.com.au/privacy-policy': { status: 403, body: 'no' } });
    expect(r.evidence.some((e) => e.field === 'website')).toBe(true);
    expect(r.errors.map((e) => e.code)).toEqual(['access_controlled']);
  });
});
