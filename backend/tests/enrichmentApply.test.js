import { describe, it, expect } from 'vitest';
import { readSite } from '../src/discovery/enrich.js';
import { analyzeCompanySite, investorsIn, namesOf } from '../src/enrichment/analyze.js';
import { applyCompanyEnrichment, upsertSource } from '../src/enrichment/apply.js';
import { decide, FIELD_POLICY, atLeast } from '../src/enrichment/policy.js';
import { setField, isUnknown, confirmLocation, unconfirmLocation } from '../src/enrichment/fill.js';
import { foundersInText, extractFacts } from '../src/discovery/enrich.js';
import { migrateDataset, validateDataset } from '../src/models/dataset.js';
import { detectConflicts, findUnappliedEvidence } from '../src/models/evidence.js';
import { NOW, dataset, co, fetcherFor } from './helpers/discovery.js';

const T1 = '2026-10-05T04:00:00.000Z';
const T2 = '2026-10-06T04:00:00.000Z';

const LD = (extra = {}) => JSON.stringify({
  '@context': 'https://schema.org', '@type': 'Organization', name: 'Acme Robotics', legalName: 'Acme Robotics Pty Ltd', foundingDate: '2019-03-01',
  founder: [{ name: 'Jane Doe' }, { name: 'John Roe' }],
  address: { streetAddress: '1 George Street', addressLocality: 'Sydney', addressRegion: 'NSW', postalCode: '2000', addressCountry: 'AU' }, ...extra,
});
const posting = (over = {}) => JSON.stringify({
  '@context': 'https://schema.org', '@type': 'JobPosting', title: 'Senior Robotics Engineer', datePosted: '2026-09-20', employmentType: 'FULL_TIME',
  hiringOrganization: { name: 'Acme Robotics' }, jobLocation: { address: { addressLocality: 'Sydney', addressRegion: 'NSW' } },
  url: 'https://acme.com.au/careers/senior-robotics-engineer', ...over,
});
const HOME = `<html><head><title>Acme Robotics | Home</title><meta name="description" content="Acme builds warehouse robots for Australian logistics.">
  <meta property="og:site_name" content="Acme Robotics"><script type="application/ld+json">${LD()}</script></head>
  <body><a href="/careers">Careers</a><a href="/about">About us</a><a href="/privacy-policy">Privacy</a><p>Backed by Blackbird and Startmate.</p></body></html>`;
const CAREERS = `<html><head><title>Careers</title><script type="application/ld+json">${posting()}</script></head><body>Join us</body></html>`;
const ABOUT = '<html><head><title>About us</title></head><body><p>Acme was founded by Jane Doe and John Roe. We started in Sydney.</p></body></html>';
const SITE = { 'https://acme.com.au/': { body: HOME }, 'https://acme.com.au/careers': { body: CAREERS }, 'https://acme.com.au/about': { body: ABOUT } };

const base = () => dataset([
  co('Acme Robotics', { website: 'https://acme.com.au', blurb: '', city: 'Unknown', verified: false, lat: null, lng: null, hiring: false, stage: 'Seed' }),
  co('Beta Labs', { website: 'https://beta.example', blurb: 'A hand-written line.', founders: ['Jane Doe'], foundedYear: 2018, hiring: true, investors: ['Blackbird'] }),
  co('Gamma'),
]);
const KNOWN = ['Blackbird', 'Startmate', 'AirTree', 'Latitude', 'Latitude 37'];
const ACME = 'acme-robotics';

const read = async (routes = SITE, website = 'https://acme.com.au') => {
  const { fetcher } = fetcherFor(routes);
  return readSite(website, { fetcher, now: () => NOW, maxPages: 4, wanted: ['founders', 'hiring_status', 'jobs', 'address'] });
};
const analyse = async (routes = SITE, over = {}) => analyzeCompanySite(await read(routes), { names: ['Acme Robotics'], knownInvestors: KNOWN, website: 'https://acme.com.au', now: () => NOW, ...over });
const apply = (work, analysis, over = {}) => applyCompanyEnrichment(work, { companyId: ACME, analysis, at: T1, mode: 'suggest', ...over });
const migrated = (work) => migrateDataset(work);
const rowsFor = (work, field) => work.evidence.filter((e) => e.company_id === ACME && e.field === field);

describe('what a company site says that the directory cares about', () => {
  it('reads open roles from structured job postings, and says the company is hiring', async () => {
    const a = await analyse();
    expect(a.jobs).toEqual([expect.objectContaining({ title: 'Senior Robotics Engineer', location: 'Sydney, NSW', employment_type: 'FULL_TIME', posted_at: '2026-09-20', apply_url: 'https://acme.com.au/careers/senior-robotics-engineer' })]);
    const hiring = a.evidence.find((e) => e.field === 'hiring_status');
    expect(hiring).toMatchObject({ value: 'hiring', confidence: 'high', verified_at: NOW_ISO(), source: { url: 'https://acme.com.au/careers' } });
    expect(hiring.note).toMatch(/1 open role.*"Senior Robotics Engineer"/);
  });

  it('does not take a page that merely says "we are hiring" as evidence, nor a posting for another organisation', async () => {
    const plain = await analyse({ ...SITE, 'https://acme.com.au/careers': { body: '<html><head><title>Careers</title></head><body><h1>We are hiring!</h1><p>Come and join us.</p></body></html>' } });
    expect(plain.jobs).toEqual([]);
    expect(plain.evidence.find((e) => e.field === 'hiring_status')).toBeUndefined();
    const other = await analyse({ ...SITE, 'https://acme.com.au/careers': { body: `<html><head><title>Jobs</title><script type="application/ld+json">${posting({ hiringOrganization: { name: 'Zed Corporation' } })}</script></head><body></body></html>` } });
    expect(other.jobs).toEqual([]);
  });

  it('reads founders from a "founded by" sentence, as medium confidence with the words it read', async () => {
    const noStructuredFounders = { ...SITE, 'https://acme.com.au/': { body: HOME.replace(LD(), LD({ founder: undefined })) } };
    const founders = (await analyse(noStructuredFounders)).evidence.filter((e) => e.field === 'founders');
    expect(founders.map((e) => [e.value, e.confidence])).toEqual([['Jane Doe', 'medium'], ['John Roe', 'medium']]);
    expect(founders.find((e) => e.value === 'John Roe').note).toMatch(/founded by Jane Doe and John Roe/);
  });

  it('prefers structured founders when the page gives both, since it is the same claim', async () => {
    const founders = (await analyse()).evidence.filter((e) => e.field === 'founders');
    expect(founders).toHaveLength(2);
    expect(founders[0].note).toMatch(/structured data/);
  });

  it('reads a name as it is, without the honorific or the next sentence\'s first word, and not "created by"', () => {
    expect(foundersInText('Founded by Gopi Sara, Dr Vu Tran and Andrew Barnes One MRI is the first').map((f) => f.name)).toEqual(['Gopi Sara', 'Vu Tran', 'Andrew Barnes']);
    expect(foundersInText('Our platform was created by Circular Sourcing. Created by Wix.')).toEqual([]); // who made a page is not who founded a company
    expect(foundersInText('Co-founded by Prof. Jane Doe.').map((f) => f.name)).toEqual(['Jane Doe']);
    expect(foundersInText('Founded by Mary Jane Watson in 2014').map((f) => f.name)).toEqual(['Mary Jane Watson']); // a real three-part name stays
  });

  it('does not read "since 2019" as a founding year, but does read "founded" and "established"', () => {
    for (const [text, year] of [['Trusted by customers since 2019.', null], ['Hiring since 2021', null], ['Founded in 2021 in Melbourne.', 2021], ['Established 1998', 1998], ['Est. 2010', 2010]]) {
      expect(extractFacts(`<p>${text}</p>`).foundedYear, text).toBe(year);
    }
  });

  it('keeps what is not a person out of the founders', () => {
    expect(foundersInText('Founded by Jane Doe, CEO, and John Roe.').map((f) => f.name)).toEqual(['Jane Doe', 'John Roe']);
    expect(foundersInText('Started by two former engineers. Founded by Blackbird Ventures. Co-founded by Mary O\'Neil-Smith & Li Wei.').map((f) => f.name)).toEqual(["Mary O'Neil-Smith", 'Li Wei']);
    expect(foundersInText('Our product was created by the team.')).toEqual([]);
  });

  it('names an investor only when it is known and the page says it backs the company', () => {
    expect(investorsIn('Acme is backed by Blackbird and Startmate, and loves coffee.', KNOWN).map((h) => h.name)).toEqual(['Blackbird', 'Startmate']);
    expect(investorsIn('We love Blackbird coffee and Startmate sticky tape.', KNOWN)).toEqual([]);
    expect(investorsIn('Backed by Latitude 37 since 2026.', KNOWN).map((h) => h.name)).toEqual(['Latitude 37']); // not also "Latitude"
    expect(investorsIn(`Our investors include ${'x '.repeat(300)} AirTree.`, KNOWN)).toEqual([]); // too far from the words that say it
    expect(investorsIn('Backed by SomeNewFund.', KNOWN)).toEqual([]); // never a name we do not already know
  });

  it('confirms the website the record holds, so a stored path is not contradicted by the homepage', async () => {
    const a = await analyse(SITE, { website: 'https://acme.com.au/au' });
    expect(a.evidence.find((e) => e.field === 'website').value).toBe('https://acme.com.au/au');
  });

  it('records nothing from a site that is plainly someone else\'s, and says so', async () => {
    const a = await analyse({ 'https://acme.com.au/': { body: '<html><head><title>Totally Different Co</title><meta property="og:site_name" content="Totally Different Co"></head><body>Hello</body></html>' } });
    expect(a).toMatchObject({ mismatch: true, evidence: [] });
    expect(a.warnings[0]).toMatch(/does not appear to be Acme Robotics/);
  });

  it('takes nothing from a page that is not the site\'s own content: a bot gate, an error, a parked domain', async () => {
    for (const title of ['Unsupported client – Acme Robotics', 'Access denied', 'Attention Required! | Cloudflare', 'Just a moment...', 'Coming soon', 'This domain is for sale']) {
      const a = await analyse({ 'https://acme.com.au/': { body: `<html><head><title>${title}</title><meta property="og:site_name" content="Acme Robotics"></head><body>x</body></html>` } });
      expect(a, title).toMatchObject({ blocked: true, evidence: [] });
      expect(a.warnings[0], title).toMatch(/not its own content/);
    }
    const work = structuredClone(base());
    const gate = await analyse({ 'https://acme.com.au/': { body: '<html><head><title>Unsupported client – Acme</title></head><body>x</body></html>' } });
    expect(apply(work, gate)).toMatchObject({ outcome: 'blocked', evidence_added: 0 });
    expect(work.evidence).toEqual([]);
  });

  it('does not take a gate page\'s words as a description, even when the rest of the page is real', async () => {
    const a = await analyse({ 'https://acme.com.au/': { body: HOME.replace('Acme builds warehouse robots for Australian logistics.', 'Please enable JavaScript to view this site properly') } });
    expect(a.evidence.find((e) => e.field === 'description')).toBeUndefined();
    expect(a.blocked).toBeUndefined();
  });

  it('quotes the words that name an investor and stops at the end of the sentence, not at the menu', () => {
    const [hit] = investorsIn('Proudly backed by Y Combinator for this summer\'s batch! 🎉 🚀 Products Mission Clinics Pricing Sign In Book Live Demo', ['Y Combinator']);
    expect(hit).toEqual({ name: 'Y Combinator', sentence: 'backed by Y Combinator for this summer\'s batch' });
  });

  it('stamps every claim with when the page was read, and where', async () => {
    for (const e of (await analyse()).evidence) {
      expect(e.verified_at, `${e.field}`).toBe(NOW_ISO());
      expect(e.source).toMatchObject({ retrieved_at: NOW_ISO(), url: expect.stringMatching(/^https:\/\/acme\.com\.au\//) });
    }
  });

  it('knows every name a company is called by, for the identity check', () => {
    const ds = { identifiers: [{ company_id: 'hone', scheme: 'alias', value: 'HoneAg' }, { company_id: 'hone', scheme: 'abn', value: '1' }, { company_id: 'other', scheme: 'alias', value: 'Nope' }] };
    expect(namesOf({ id: 'hone', name: 'Hone (formerly Grazer)' }, ds.identifiers).sort()).toEqual(['Grazer', 'Hone', 'HoneAg']);
  });
});
function NOW_ISO() { return new Date(NOW).toISOString(); }

describe('applying a site\'s claims to a company', () => {
  it('in suggest mode records the evidence and changes no company, leaving everything for a person', async () => {
    const work = structuredClone(base());
    const before = structuredClone(work.companies);
    const s = apply(work, await analyse());
    expect(work.companies).toEqual(before);
    expect(s).toMatchObject({ outcome: 'read', applied: [] });
    expect(s.evidence_added).toBeGreaterThan(5);
    expect(s.suggested.map((x) => x.field).sort()).toEqual(['address', 'city', 'description', 'founded_year', 'founders', 'hiring_status', 'investors', 'state'].sort());
    expect(s.confirmed).toEqual([{ field: 'website', value: 'https://acme.com.au' }]);
    expect(validateDataset(migrated(work))).toEqual([]);
  });

  it('in fill mode fills only what the policy allows, from evidence that is good enough, into fields the record leaves unknown', async () => {
    const work = structuredClone(base());
    const s = apply(work, await analyse(), { mode: 'fill' });
    const acme = work.companies.find((c) => c.id === ACME);
    expect(s.applied.map((a) => a.field).sort()).toEqual(['description', 'founded_year', 'hiring_status']);
    expect(acme).toMatchObject({ blurb: 'Acme builds warehouse robots for Australian logistics.', foundedYear: 2019, hiring: true, hiring_status: 'hiring', updated_at: T1 });
    // A pin needs coordinates, and a sentence can name the wrong people: both stay as suggestions.
    expect(acme).toMatchObject({ verified: false, city: 'Unknown', lat: null, investors: [] });
    expect(acme.founders).toBeUndefined();
    expect(s.suggested.map((x) => x.field).sort()).toEqual(['address', 'city', 'founders', 'investors', 'state']);
    expect(s.changes).toEqual(expect.arrayContaining([{ field: 'foundedYear', from: null, to: 2019 }, { field: 'hiring', from: false, to: true }]));
    expect(validateDataset(migrated(work))).toEqual([]);
  });

  it('never overwrites a value the record holds: it flags the disagreement and leaves the record', async () => {
    const work = structuredClone(base());
    const beta = work.companies.find((c) => c.id === 'beta-labs');
    const betaSite = await analyzeCompanySite(await read({ 'https://beta.example/': { body: HOME.replace(/Acme Robotics/g, 'Beta Labs') } }, 'https://beta.example'), { names: ['Beta Labs'], knownInvestors: KNOWN, website: 'https://beta.example', now: () => NOW });
    const s = applyCompanyEnrichment(work, { companyId: 'beta-labs', analysis: betaSite, at: T1, mode: 'fill' });
    expect(beta).toMatchObject({ blurb: 'A hand-written line.', foundedYear: 2018, founders: ['Jane Doe'] });
    expect(s.conflicts).toEqual([expect.objectContaining({ field: 'founded_year', kind: 'stored_differs', stored: 2018 })]);
    expect(s.suggested.find((x) => x.field === 'founders')).toMatchObject({ value: ['John Roe'] }); // Jane Doe is already there
    expect(s.confirmed).toEqual(expect.arrayContaining([{ field: 'founders', value: 'Jane Doe' }, { field: 'investors', value: 'Blackbird' }]));
    expect(detectConflicts(migrated(work)).map((c) => c.field)).toEqual(['founded_year']);
  });

  it('leaves a field unknown when the sources disagree about it, even in fill mode', async () => {
    const work = structuredClone(base());
    const a = await analyse();
    apply(work, a); // the site says 2019
    const other = migrated(work);
    other.sources.push({ id: 'press', kind: 'press', url: 'https://news.example/acme', title: null, publisher: null, retrieved_at: T1, note: '' });
    other.companies.find((c) => c.id === ACME).source_ids.push('press');
    other.evidence.push({ id: 'acme-robotics.founded_year.press', company_id: ACME, field: 'founded_year', value: 2021, source_id: 'press', confidence: 'medium', verified_at: null, status: 'active', note: null });
    const s = applyCompanyEnrichment(other, { companyId: ACME, analysis: a, at: T2, mode: 'fill' });
    expect(other.companies.find((c) => c.id === ACME).foundedYear).toBeUndefined();
    expect(s.applied.map((x) => x.field)).not.toContain('founded_year');
    expect(s.conflicts.map((c) => c.field)).toContain('founded_year');
  });

  it('does not add again a claim a person turned down', async () => {
    const work = structuredClone(base());
    apply(work, await analyse());
    const row = rowsFor(work, 'city')[0];
    expect(row.value).toBe('Sydney');
    row.status = 'rejected';
    row.note = 'Sydney is an office, not the HQ.';
    work.evidence = work.evidence.filter((e) => e === row || e.field !== 'city');
    const s = apply(work, await analyse(), { at: T2 });
    expect(rowsFor(work, 'city').map((e) => e.status)).toEqual(['rejected']);
    expect(s.held).toEqual([expect.stringMatching(/city "Sydney" was turned down earlier \(rejected\)/)]);
  });

  it('checks again without repeating itself: a second read adds nothing, refreshes when each claim was last checked', async () => {
    const work = structuredClone(base());
    const first = apply(work, await analyse());
    const count = work.evidence.length;
    const secondRead = await analyze2(T2);
    const second = apply(work, secondRead, { at: T2 });
    expect(second.evidence_added).toBe(0);
    expect(second.evidence_refreshed).toBe(first.evidence_added);
    expect(work.evidence).toHaveLength(count);
    expect(rowsFor(work, 'website')[0].verified_at).toBe(T2);
    expect(work.sources.find((s) => s.url === 'https://acme.com.au/').retrieved_at).toBe(T2);
    expect(validateDataset(migrated(work))).toEqual([]);
  });

  it('records postings, keeps them open while they are listed, and closes one that has gone from a page that was read', async () => {
    const work = structuredClone(base());
    apply(work, await analyse());
    expect(work.jobs).toEqual([expect.objectContaining({ company_id: ACME, title: 'Senior Robotics Engineer', status: 'open', apply_url: 'https://acme.com.au/careers/senior-robotics-engineer' })]);
    expect(apply(work, await analyze2(T2), { at: T2 }).jobs).toEqual({ added: 0, updated: 1, closed: 0 });
    const gone = await analyze2(T2, { ...SITE, 'https://acme.com.au/careers': { body: '<html><head><title>Careers</title></head><body>No openings.</body></html>' } });
    expect(apply(work, gone, { at: T2 }).jobs).toEqual({ added: 0, updated: 0, closed: 1 });
    expect(work.jobs[0].status).toBe('closed');
    expect(validateDataset(migrated(work))).toEqual([]);
  });

  it('leaves a posting alone when its page was not read this time', async () => {
    const work = structuredClone(base());
    apply(work, await analyse());
    const noCareers = { 'https://acme.com.au/': { body: HOME.replace('<a href="/careers">Careers</a>', '') } };
    apply(work, await analyze2(T2, noCareers), { at: T2 });
    expect(work.jobs[0].status).toBe('open');
  });

  it('dates the company\'s own verification and scores how far its facts are now backed', async () => {
    const work = structuredClone(base());
    apply(work, await analyse(), { mode: 'fill' });
    const acme = migrated(work).companies.find((c) => c.id === ACME);
    expect(acme.last_verified_at).toBe(NOW_ISO());
    expect(acme.confidence_score).toBeGreaterThan(0.25);
    expect(acme.source_ids).toEqual(expect.arrayContaining(['acme-robotics-website', 'acme-robotics-careers'])); // one source per page that gave a claim
  });

  it('says a site that is not the company\'s was not used, and a site that could not be read was not either', async () => {
    const work = structuredClone(base());
    const wrong = await analyse({ 'https://acme.com.au/': { body: '<html><head><title>Totally Different Co</title><meta property="og:site_name" content="Totally Different Co"></head></html>' } });
    expect(apply(work, wrong)).toMatchObject({ outcome: 'mismatch', evidence_added: 0 });
    const down = await analyse({});
    expect(apply(work, down)).toMatchObject({ outcome: 'unreachable', evidence_added: 0 });
    expect(work.evidence).toEqual([]);
  });

  it('reuses a source row that already exists for a page, and keeps its hand-written note', () => {
    const work = structuredClone(base());
    work.sources.push({ id: 'acme-site', kind: 'company_website', url: 'https://www.acme.com.au/', title: 'Acme', publisher: null, retrieved_at: T1, note: 'Checked by hand.' });
    const id = upsertSource(work, ACME, { kind: 'company_website', url: 'https://acme.com.au', title: 'x', retrieved_at: T2 });
    expect(id).toBe('acme-site');
    expect(work.sources).toHaveLength(1);
    expect(work.sources[0]).toMatchObject({ retrieved_at: T2, note: 'Checked by hand.' });
  });

  it('turns suggestions into the evidence that has not been applied to a record yet', async () => {
    const work = structuredClone(base());
    apply(work, await analyse());
    const unapplied = findUnappliedEvidence(migrated(work)).filter((u) => u.company_id === ACME).map((u) => u.field);
    expect(unapplied).toEqual(expect.arrayContaining(['founded_year', 'founders', 'investors', 'address', 'state']));
  });
});

async function analyze2(at, routes = SITE) {
  const { fetcher } = fetcherFor(routes);
  const clock = () => Date.parse(at);
  const site = await readSite('https://acme.com.au', { fetcher, now: clock, maxPages: 4, wanted: ['founders', 'hiring_status', 'jobs', 'address'] });
  return analyzeCompanySite(site, { names: ['Acme Robotics'], knownInvestors: KNOWN, website: 'https://acme.com.au', now: clock });
}

describe('the policy', () => {
  it('fills only what is safe, and only in fill mode', () => {
    expect(decide('description', 'medium', 'fill')).toBe('fill');
    expect(decide('description', 'medium', 'suggest')).toBe('suggest');
    expect(decide('founded_year', 'medium', 'fill')).toBe('suggest'); // a sentence is not structured data
    expect(decide('founded_year', 'high', 'fill')).toBe('fill');
    expect(decide('hiring_status', 'high', 'fill')).toBe('fill');
    for (const f of ['founders', 'investors', 'address', 'city', 'state']) expect(decide(f, 'high', 'fill'), f).toBe('suggest');
    expect(decide('website', 'high', 'fill')).toBe('confirm');
    expect(decide('something_new', 'high', 'fill')).toBe('suggest');
    expect(atLeast('high', 'medium')).toBe(true);
    expect(atLeast('low', 'medium')).toBe(false);
    expect(Object.keys(FIELD_POLICY)).not.toEqual(expect.arrayContaining(['sector', 'stage']));
  });
});

describe('putting a value on a record', () => {
  it('says whether the record leaves a field unknown: the legacy hiring:false counts as unknown', () => {
    expect(isUnknown({ blurb: '' }, 'description')).toBe(true);
    expect(isUnknown({ blurb: 'Words.' }, 'description')).toBe(false);
    expect(isUnknown({ hiring: false, hiring_status: null }, 'hiring_status')).toBe(true);
    expect(isUnknown({ hiring: true, hiring_status: 'hiring' }, 'hiring_status')).toBe(false);
    expect(isUnknown({ foundedYear: 2020 }, 'founded_year')).toBe(false);
  });

  it('sets a field and says what changed, from and to', () => {
    const c = { blurb: '', hiring: false, hiring_status: null, founders: ['A B'], investors: [], sector: 'Unknown', sectorFull: 'Unknown' };
    expect(setField(c, 'description', 'Robots.')).toEqual([{ field: 'blurb', from: '', to: 'Robots.' }]);
    expect(setField(c, 'hiring_status', 'hiring')).toEqual([{ field: 'hiring', from: false, to: true }, { field: 'hiring_status', from: null, to: 'hiring' }]);
    expect(setField(c, 'founders', ['A B', 'C D'])).toEqual([{ field: 'founders', from: ['A B'], to: ['A B', 'C D'] }]);
    expect(setField(c, 'sector', 'Fintech')).toEqual([{ field: 'sector', from: 'Unknown', to: 'Fintech' }, { field: 'sectorFull', from: 'Unknown', to: 'Fintech' }]);
    expect(() => setField(c, 'confidence_score', 1)).toThrow(/not a field that can be applied/);
  });

  const AT = '2026-10-07T00:00:00.000Z';
  const blank = () => ({ name: 'Acme', city: 'Unknown', lat: null, lng: null, verified: false, verification_status: 'unverified', address: null, state: null });

  it('refuses a place it cannot support: outside Australia, a point with nothing to make it a pin, no state', () => {
    expect(() => confirmLocation(blank(), { city: 'San Francisco', lat: 37.77, lng: -122.41, state: 'NSW' })).toThrow(/not in Australia/);
    // Coordinates alone are not a pin: they need an address (exact) or a suburb (suburb-level).
    expect(() => confirmLocation(blank(), { city: 'Sydney', lat: -33.86, lng: 151.2 })).toThrow(/need an address .* or a suburb/);
    expect(() => confirmLocation(blank(), { city: 'Ballarat' })).toThrow(/say the state/);
    expect(() => confirmLocation(blank(), { city: 'Sydney', state: 'NSW', precision: 'EXACT', lat: -33.86, lng: 151.2 })).toThrow(/needs the address/);
    expect(() => confirmLocation(blank(), { city: 'Sydney', state: 'NSW', precision: 'EXACT', address: '1 George Street, Sydney NSW 2000' })).toThrow(/needs coordinates/);
    expect(() => confirmLocation(blank(), { city: 'Sydney', state: 'NSW', precision: 'SUBURB', lat: -33.86, lng: 151.2 })).toThrow(/needs the suburb/);
    expect(() => confirmLocation(blank(), { city: 'Sydney', state: 'NSW', precision: 'UNKNOWN' })).toThrow(/take the company off the map/);
    expect(() => confirmLocation(blank(), { city: 'Sydney', state: 'NSW', precision: 'ROUGHLY' })).toThrow(/precision must be one of/);
  });

  it('records an address and a point as EXACT, with where it came from', () => {
    const c = blank();
    const changes = confirmLocation(c, { city: 'Sydney', address: '110 Kippax Street, Surry Hills, Sydney NSW 2010', lat: -33.8848, lng: 151.2098 }, { at: AT });
    expect(c).toMatchObject({
      city: 'Sydney', state: 'NSW', country: 'Australia', verified: true, verification_status: 'location_verified', lat: -33.8848, lng: 151.2098,
      address: '110 Kippax Street, Surry Hills, Sydney NSW 2010', suburb: 'Surry Hills', postcode: '2010',
      location_precision: 'EXACT', location_source: 'manual', location_source_url: null, location_verified_at: AT, location_confidence: 'medium',
    });
    expect(changes.map((x) => x.field)).toEqual(['city', 'suburb', 'postcode', 'lat', 'lng', 'address', 'state', 'verified', 'location_precision', 'location_source', 'location_verified_at', 'location_confidence']);
  });

  it('is high confidence when the company\'s own page states the place and it was read', () => {
    const c = blank();
    confirmLocation(c, { city: 'Melbourne', address: 'Level 7, 15 William Street, Melbourne VIC 3000', lat: -37.8185, lng: 144.9606, source: 'company_website', sourceUrl: 'https://airwallex.com/au/privacy', verifiedAt: AT, geocodeAgrees: true });
    expect(c).toMatchObject({ location_precision: 'EXACT', location_source: 'company_website', location_source_url: 'https://airwallex.com/au/privacy', location_verified_at: AT, location_confidence: 'high' });
  });

  it('records a suburb and a point as SUBURB, and keeps the address it already had', () => {
    const c = { ...blank(), address: 'Surry Hills, Sydney NSW 2010' };
    confirmLocation(c, { city: 'Sydney', suburb: 'Surry Hills', lat: -33.884, lng: 151.21 }, { at: AT });
    expect(c).toMatchObject({ location_precision: 'SUBURB', suburb: 'Surry Hills', postcode: '2010', lat: -33.884, lng: 151.21, address: 'Surry Hills, Sydney NSW 2010', state: 'NSW' });
  });

  it('records a city alone as CITY with no coordinates: a city centre is not where a company is', () => {
    const c = blank();
    confirmLocation(c, { city: 'Sydney', state: 'NSW' }, { at: AT });
    expect(c).toMatchObject({ verified: true, verification_status: 'location_verified', city: 'Sydney', state: 'NSW', location_precision: 'CITY', lat: null, lng: null, suburb: null, postcode: null });
    // Coordinates given with an explicit CITY are not kept.
    const d = blank();
    confirmLocation(d, { city: 'Sydney', state: 'NSW', precision: 'CITY', lat: -33.8688, lng: 151.2093 }, { at: AT });
    expect(d).toMatchObject({ location_precision: 'CITY', lat: null, lng: null });
  });

  it('records only a state as STATE, with the city left unknown', () => {
    const c = blank();
    confirmLocation(c, { state: 'VIC', precision: 'STATE' }, { at: AT });
    expect(c).toMatchObject({ verified: true, city: 'Unknown', state: 'VIC', location_precision: 'STATE', lat: null, lng: null });
  });

  it('refuses a source that says where a person is, not where the company is', () => {
    const args = { city: 'Sydney', address: '1 George Street, Sydney NSW 2000', lat: -33.86, lng: 151.2 };
    expect(() => confirmLocation(blank(), { ...args, source: 'company_website', sourceUrl: 'https://www.linkedin.com/in/someone' })).toThrow(/says where a person is/);
    expect(() => confirmLocation(blank(), { ...args, source: 'founders_home' })).toThrow(/not a kind of location source/);
    expect(() => confirmLocation(blank(), { ...args, source: 'company_website', sourceUrl: 'ftp://example.test/x' })).toThrow(/http\(s\) link/);
  });

  it('takes a company off the map, keeping its address', () => {
    const c = { city: 'Sydney', lat: -33.8, lng: 151.2, state: 'NSW', country: 'Australia', verified: true, verification_status: 'location_verified', address: '1 George Street', location_precision: 'EXACT', location_source: 'manual', location_verified_at: AT, location_confidence: 'medium', suburb: 'Sydney', postcode: '2000' };
    const changes = unconfirmLocation(c);
    expect(c).toMatchObject({
      city: 'Unknown', lat: null, lng: null, state: null, country: null, verified: false, verification_status: 'unverified', address: '1 George Street',
      location_precision: 'UNKNOWN', location_source: null, location_verified_at: null, location_confidence: null, suburb: null, postcode: null,
    });
    expect(changes.map((x) => x.field).sort()).toEqual(['city', 'country', 'lat', 'lng', 'location_confidence', 'location_precision', 'location_source', 'location_verified_at', 'postcode', 'state', 'suburb', 'verified']);
  });
});
