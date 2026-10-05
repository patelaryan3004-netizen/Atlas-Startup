import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseFeed, extractCompany, roundOf, createRssSource } from '../src/discovery/sources/rss.js';
import { submissionToLead, createSubmissionsSource } from '../src/discovery/sources/submissions.js';
import { parseCsv, recordToLead, createStructuredFeedSource } from '../src/discovery/sources/structuredFeed.js';
import { validateLicense, loadSources, LICENSE_BASES } from '../src/discovery/sources/index.js';
import { buildSourceConfig } from '../src/discovery/config.js';
import { createFetcher } from '../src/discovery/http.js';

const NOW = Date.parse('2026-10-05T04:00:00.000Z');
const ctxOf = (extra = {}) => ({ now: () => NOW, knownInvestors: ['Blackbird', 'AirTree', 'Startmate', 'Y Combinator'], ...extra });

// Real Startup Daily funding items (headline, excerpt) and what a careful reader finds in each.
const REAL = [
  ['SQC among 6 startups sharing $12.3 million in quantum grants', 'SQC grabs $3.6m as 6 quantum startups split $12.3m for AI energy forecasts, clocks and biosensors.', null],
  ['Cheque-in: 3 startups pocket $18.75 million to start October', 'Three Aussie startups bank $18.75m for cancer nukes, AI infrastructure scans and greener concrete.', null],
  ['Melbourne Uni concrete recycling spinout cements $750,000 pre-Seed', 'R2Crete turns landfill concrete into low-carbon building material with a $750k pre-seed and pilot plant underway.', 'R2Crete'],
  ['Eastend Ventures nails $30 million debut fund to back SA, WA and Queensland startups', 'Eastend’s $30m fund bets on startups outside Sydney and Melbourne looking to exit before unicorn hype.', 'Eastend Ventures'],
  ['Asset analysis platform Trendspek banks $6 million to keep critical infrastructure upright', 'Trendspek grabs $6M to turn drones, 3D records and AI into infrastructure’s anti-collapse layer.', 'Trendspek'],
  ['Cheque-in: 7 startups raised $274.7 million this week', 'Heidi, Amber and five Aussie startups banked $274.7m to chase AI health, clean energy and space dominance.', null],
  ['Medical edtech Medcast diagnoses $5.4 million for clinical AI platform', 'Medcast grabs $5.4m to make MedLuma the trusted AI copilot for Aussie GPs.', 'Medcast'],
  ['Proptech play RentBetter moves in on $5 million', 'RentBetter bags $5m to help landlords ditch pricey agents with AI-powered self-management.', 'RentBetter'],
  ['7 startups share $15.6 million in the latest round of government-backed dementia research grants', 'Seven Aussie dementia startups split $15.6m in non-dilutive cash, from AI detection to gene editing.', null],
  ['Dementia biotech Kinoxis raises $6.75 million with a $2.5m grant as cherry on top', 'Kinoxis pockets $9.25m to push dementia agitation drugs through trials, with results due in 2027.', 'Kinoxis'],
  ['AI amateur sport analysis startup raises $3.5 million pre-Seed', '', null],
  ['The Laundry Lady launches new digital app as it gears up for UK launch', '', null],
  ['Firmus sets $11 share price for $7.1 billion ASX float', '', null],
];

describe('reading a feed', () => {
  const RSS = `<?xml version="1.0"?><rss><channel>
    <item><title><![CDATA[Foo raises $5m &#8211; seed]]></title><link>https://news.example/foo</link><guid isPermaLink="false">g-1</guid>
      <pubDate>Mon, 05 Oct 2026 01:00:00 +0000</pubDate><description><![CDATA[<p>Foo grabs $5m to do <b>things</b>.</p>]]></description></item>
    <item><title>No link here</title></item>
    <item><title>Bar &amp; Baz close $2m</title><link>https://news.example/bar</link></item>
  </channel></rss>`;

  it('reads RSS items, decoding entities and CDATA, and skips an item without a title or link', () => {
    const items = parseFeed(RSS);
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      title: 'Foo raises $5m – seed', link: 'https://news.example/foo', guid: 'g-1',
      published: '2026-10-05T01:00:00.000Z', excerpt: 'Foo grabs $5m to do things .',
    });
    expect(items[1]).toMatchObject({ title: 'Bar & Baz close $2m', guid: 'https://news.example/bar', published: null });
  });

  it('reads Atom entries too', () => {
    const atom = '<feed><entry><title>Qux lands $3m</title><link rel="alternate" href="https://news.example/qux"/><id>tag:q</id><updated>2026-10-04T00:00:00Z</updated><summary>Qux lands $3m.</summary></entry></feed>';
    expect(parseFeed(atom)).toEqual([{ title: 'Qux lands $3m', link: 'https://news.example/qux', guid: 'tag:q', published: '2026-10-04T00:00:00.000Z', excerpt: 'Qux lands $3m.' }]);
  });

  it('returns nothing for text that is not a feed', () => {
    expect(parseFeed('<html><body>hello</body></html>')).toEqual([]);
  });
});

describe('finding the company in a funding story', () => {
  it.each(REAL)('%s', (title, excerpt, expected) => {
    expect(extractCompany({ title, excerpt })?.name ?? null).toBe(expected);
  });

  it('prefers the excerpt, and notes when the headline agrees', () => {
    expect(extractCompany({ title: REAL[9][0], excerpt: REAL[9][1] })).toMatchObject({ name: 'Kinoxis', pattern: 'excerpt', agreed: true });
    expect(extractCompany({ title: REAL[6][0], excerpt: REAL[6][1] })).toMatchObject({ name: 'Medcast', pattern: 'excerpt', agreed: false });
    expect(extractCompany({ title: REAL[3][0], excerpt: REAL[3][1] })).toMatchObject({ name: 'Eastend Ventures', pattern: 'headline' });
    expect(extractCompany({ title: REAL[2][0], excerpt: REAL[2][1] })).toMatchObject({ name: 'R2Crete', pattern: 'excerpt-round' });
  });

  it('reads $6M and $6m alike', () => {
    expect(extractCompany({ title: 'x', excerpt: 'Trendspek grabs $6M to turn drones into things.' })?.name).toBe('Trendspek');
    expect(extractCompany({ title: 'x', excerpt: 'Trendspek grabs A$6 million to turn drones into things.' })?.name).toBe('Trendspek');
  });

  it('strips location and descriptor prefixes from a headline', () => {
    expect(extractCompany({ title: 'Sydney-based Foodly raises $4 million seed round', excerpt: '' })?.name).toBe('Foodly');
    expect(extractCompany({ title: 'Aussie climate startup Greenwell secures $12m', excerpt: '' })?.name).toBe('Greenwell');
    expect(extractCompany({ title: 'Brisbane fintech Moneyfox lands $7 million Series A', excerpt: '' })?.name).toBe('Moneyfox');
  });

  it('never invents a name from a headline that has none, or from a list', () => {
    for (const title of ['Australian startup raises $5m', 'A Sydney-based AI company secures $10 million', 'Foo and Bar raise $5m', 'Foo, Bar and Baz raise $5m',
      'How Foo raised $5m in a down market', 'Why Foo wins $5m', 'What the $5m raise means for startups']) {
      expect(extractCompany({ title, excerpt: '' }), title).toBeNull();
    }
  });

  it('reads the round, normalised to the vocabulary the dataset uses', () => {
    expect(roundOf('a $750k pre-seed')).toBe('Pre-seed');
    expect(roundOf('Pre-Seed round')).toBe('Pre-seed');
    expect(roundOf('a seed round')).toBe('Seed');
    expect(roundOf('Series B led by')).toBe('Series B');
    expect(roundOf('Series c+ funding')).toBe('Series C+');
    expect(roundOf('no round here')).toBeNull();
  });

  it('records a city hint and only the investors it already knows', () => {
    const r = extractCompany({ title: 'Melbourne-based Foodly raises $4 million seed round led by Blackbird', excerpt: 'Foodly bags $4m from Blackbird, Acme Capital and friends.' }, { knownInvestors: ['Blackbird', 'AirTree'] });
    expect(r).toMatchObject({ name: 'Foodly', round: 'Seed', city: 'Melbourne', investors: ['Blackbird'] });
  });
});

describe('the RSS source', () => {
  const feed = `<rss><channel>
    <item><title>Dementia biotech Kinoxis raises $6.75 million with a $2.5m grant</title><link>https://sd.example/kinoxis</link><guid>g-k</guid><pubDate>Fri, 02 Oct 2026 00:00:00 GMT</pubDate><description>Kinoxis pockets $9.25m to push drugs through trials. Backed by Blackbird.</description></item>
    <item><title>Cheque-in: 3 startups pocket $18.75 million</title><link>https://sd.example/cheque</link><pubDate>Fri, 02 Oct 2026 00:00:00 GMT</pubDate><description>Three Aussie startups bank $18.75m.</description></item>
    <item><title>Oldco raises $1m seed</title><link>https://sd.example/old</link><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate><description>Oldco raises $1m.</description></item>
  </channel></rss>`;
  const fetcherFor = (body, type = 'application/rss+xml; charset=UTF-8') => {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
      return new Response(body, { status: 200, headers: { 'content-type': type } });
    };
    return { calls, fetcher: createFetcher({ fetchImpl, resolveHost: async () => ['93.184.216.34'], sleep: async () => {} }) };
  };
  const source = () => createRssSource({ id: 'rss.test', publisher: 'Startup Daily', feed_url: 'https://sd.example/topic/funding/feed/', license: { basis: 'public_feed' } });

  it('turns a funding story into a lead with the publisher credited and the claims at medium confidence', async () => {
    const { fetcher } = fetcherFor(feed);
    const leads = await source().discover(ctxOf({ fetcher }));
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({
      key: 'g-k', name: 'Kinoxis', url: 'https://sd.example/kinoxis', publisher: 'Startup Daily',
      observed_at: '2026-10-02T00:00:00.000Z', retrieved_at: '2026-10-05T04:00:00.000Z', extraction: { method: 'excerpt', agreed: true },
    });
    expect(leads[0].evidence).toEqual([expect.objectContaining({ field: 'investors', value: 'Blackbird', confidence: 'medium' })]);
    expect(leads[0].title).toMatch(/Kinoxis raises/);
  });

  it('skips roundups and stories older than the cut-off', async () => {
    const { fetcher } = fetcherFor(feed);
    const names = (await source().discover(ctxOf({ fetcher }))).map((l) => l.name);
    expect(names).toEqual(['Kinoxis']);
  });

  it('fetches only the feed itself, never the articles it links to', async () => {
    const { fetcher, calls } = fetcherFor(feed);
    await source().discover(ctxOf({ fetcher }));
    expect(calls.filter((u) => !u.endsWith('/robots.txt'))).toEqual(['https://sd.example/topic/funding/feed/']);
  });

  it('refuses a page that is not a feed, as happened with a guessed category URL', async () => {
    const { fetcher } = fetcherFor('<html><body>a page</body></html>', 'text/html; charset=UTF-8');
    await expect(source().discover(ctxOf({ fetcher }))).rejects.toMatchObject({ code: 'unsupported_content' });
  });

  it('complains when a feed has no items', async () => {
    const { fetcher } = fetcherFor('<rss><channel></channel></rss>');
    await expect(source().discover(ctxOf({ fetcher }))).rejects.toThrow(/did not contain any feed items/);
  });

  it('needs a feed URL', () => {
    expect(() => createRssSource({ id: 'x', license: { basis: 'public_feed' } })).toThrow(/feed_url is required/);
  });
});

describe('submissions', () => {
  const row = { id: 's-1', name: '  Zorbly   Pty Ltd ', description: 'Payments for pets.', website: 'zorbly.com.au', stage: 'seed', email: 'founder@secret.example', hiringUrl: 'https://zorbly.com.au/jobs', status: 'pending', submittedAt: '2026-10-04T01:00:00.000Z' };
  const retrievedAt = '2026-10-05T04:00:00.000Z';

  it('turns a submission into a lead whose claims are low confidence', () => {
    const lead = submissionToLead(row, { retrievedAt });
    expect(lead).toMatchObject({ key: 's-1', name: 'Zorbly Pty Ltd', website: 'https://zorbly.com.au', description: 'Payments for pets.', observed_at: '2026-10-04T01:00:00.000Z' });
    expect(lead.evidence.map((e) => [e.field, e.value, e.confidence])).toEqual([
      ['description', 'Payments for pets.', 'low'], ['website', 'https://zorbly.com.au', 'low'], ['stage', 'Seed', 'low'],
    ]);
  });

  it("never lets the submitter's email, or any field not on the allow-list, into a lead", () => {
    const lead = submissionToLead(row, { retrievedAt });
    const text = JSON.stringify(lead);
    expect(text).not.toContain('founder@secret.example');
    expect(text).not.toContain('secret');
    expect(text).not.toContain('/jobs');
    expect(lead).not.toHaveProperty('email');
    expect(lead).not.toHaveProperty('hiringUrl');
  });

  it('ignores a "website" that cannot be a company site, and a stage it does not recognise', () => {
    const lead = submissionToLead({ ...row, website: 'https://www.linkedin.com/company/zorbly', stage: 'whenever' }, { retrievedAt });
    expect(lead.website).toBeNull();
    expect(lead.evidence.map((e) => e.field)).toEqual(['description']);
  });

  it('skips a submission with no name', () => {
    expect(submissionToLead({ id: 'x', name: '   ' }, { retrievedAt })).toBeNull();
  });

  it('reads a local copy, only the pending ones, and an absent file as empty', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'subs-'));
    try {
      const file = path.join(dir, 'submissions.json');
      await writeFile(file, JSON.stringify([row, { ...row, id: 's-2', name: 'Done Co', status: 'processed' }]));
      const leads = await createSubmissionsSource({ id: 'submissions', file, license: { basis: 'user_submission' } }).discover(ctxOf());
      expect(leads.map((l) => l.name)).toEqual(['Zorbly Pty Ltd']);
      const none = await createSubmissionsSource({ id: 'submissions', file: path.join(dir, 'missing.json'), license: { basis: 'user_submission' } }).discover(ctxOf());
      expect(none).toEqual([]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("reads the deployed queue with the project's own admin key from the environment", async () => {
    const seen = [];
    const fetchImpl = async (url, init) => { seen.push({ url, headers: init.headers }); return new Response(JSON.stringify({ count: 1, results: [row] }), { status: 200 }); };
    const source = createSubmissionsSource({ id: 'submissions', url: 'https://api.example/api/submissions', license: { basis: 'user_submission' } }, { ADMIN_KEY: 'k-123' });
    expect((await source.discover(ctxOf({ fetchImpl }))).map((l) => l.name)).toEqual(['Zorbly Pty Ltd']);
    expect(seen).toEqual([{ url: 'https://api.example/api/submissions', headers: { 'x-admin-key': 'k-123', accept: 'application/json' } }]);
  });

  it('says what to set when the key is missing, and reports a failed request', async () => {
    const withUrl = (env) => createSubmissionsSource({ id: 's', url: 'https://api.example/api/submissions', license: { basis: 'user_submission' } }, env);
    await expect(withUrl({}).discover(ctxOf({ fetchImpl: async () => new Response('') }))).rejects.toThrow(/set ADMIN_KEY/);
    await expect(withUrl({ ADMIN_KEY: 'k' }).discover(ctxOf({ fetchImpl: async () => new Response('no', { status: 401 }) }))).rejects.toThrow(/HTTP 401/);
  });
});

describe('structured feeds', () => {
  it('reads CSV: quotes, doubled quotes, commas and line breaks in fields, a BOM and CRLF', () => {
    const csv = '﻿name,summary,city\r\n"Acme, Inc","She said ""hi""",Sydney\r\n"Multi\nline",x,Perth\r\n\r\n';
    expect(parseCsv(csv)).toEqual([
      { name: 'Acme, Inc', summary: 'She said "hi"', city: 'Sydney' },
      { name: 'Multi\nline', summary: 'x', city: 'Perth' },
    ]);
    expect(parseCsv('')).toEqual([]);
  });

  const config = {
    id: 'open.test', adapter: 'structured-feed', kind: 'open_dataset', region: 'AU', publisher: 'Example Org',
    license: { basis: 'open_data', attestation: 'CC BY 3.0 AU', terms_url: 'https://example.org/licence' },
    source: { file: 'unused', format: 'json', records_path: 'data.items' },
    field_map: { key: 'id', name: 'company_name', website: 'url', description: 'summary', city: 'city', state: 'state', founders: { column: 'founders', split: ';' }, abn: 'abn', acn: 'acn', observed_at: 'updated' },
  };
  const record = { id: 'r-1', company_name: 'Acme  Robotics', url: 'http://www.acme.com.au/about', summary: 'Robots.', city: 'Sydney', state: 'NSW', founders: 'Jane Doe; John Roe', abn: '53 004 085 616', acn: '123456789', updated: '2026-09-30' };

  it('maps a record onto a lead: clean website, founders split, registry numbers validated', () => {
    const lead = recordToLead(record, config, { retrievedAt: '2026-10-05T04:00:00.000Z' });
    expect(lead).toMatchObject({
      key: 'r-1', name: 'Acme Robotics', website: 'https://acme.com.au', city: 'Sydney', state: 'NSW', founders: ['Jane Doe', 'John Roe'],
      external_ids: { abn: '53004085616', acn: null }, observed_at: '2026-09-30T00:00:00.000Z', publisher: 'Example Org',
    });
    expect(lead.evidence.map((e) => e.field)).toEqual(['website', 'description', 'city', 'founders', 'founders']);
    expect(lead.evidence.every((e) => e.confidence === 'medium')).toBe(true);
  });

  it('drops a LinkedIn link given as the website and skips a record with no name', () => {
    expect(recordToLead({ ...record, url: 'https://www.linkedin.com/company/acme' }, config, { retrievedAt: 'x' }).website).toBeNull();
    expect(recordToLead({ ...record, company_name: '' }, config, { retrievedAt: 'x' })).toBeNull();
  });

  it('reads a local JSON file at a path and a CSV file', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'feed-'));
    try {
      const jsonFile = path.join(dir, 'data.json');
      await writeFile(jsonFile, JSON.stringify({ data: { items: [record, { ...record, id: 'r-2', company_name: 'Beta Co' }] } }));
      const json = createStructuredFeedSource({ ...config, source: { file: jsonFile, format: 'json', records_path: 'data.items' } });
      expect((await json.discover(ctxOf())).map((l) => l.name)).toEqual(['Acme Robotics', 'Beta Co']);
      const csvFile = path.join(dir, 'data.csv');
      await writeFile(csvFile, 'id,company_name,url\r\nc-1,Gamma Co,gamma.com.au\r\n');
      const csv = createStructuredFeedSource({ ...config, source: { file: csvFile, format: 'csv' }, field_map: { key: 'id', name: 'company_name', website: 'url' } });
      expect((await csv.discover(ctxOf())).map((l) => [l.name, l.website])).toEqual([['Gamma Co', 'https://gamma.com.au']]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("sends a licensed API's key from the environment, and complains if it is not set", async () => {
    const calls = [];
    const fetcher = { get: async (url, options) => { calls.push({ url, options }); return { text: JSON.stringify([record]) }; } };
    const licensed = { ...config, kind: 'licensed_dataset', license: { basis: 'licensed_api', attestation: 'Data licence #42', terms_url: 'https://example.org/terms' }, headers_env: { 'x-api-key': 'EXAMPLE_KEY' }, source: { url: 'https://api.example.org/companies', format: 'json' } };
    const leads = await createStructuredFeedSource(licensed, { EXAMPLE_KEY: 'secret-key' }).discover(ctxOf({ fetcher }));
    expect(leads).toHaveLength(1);
    expect(calls[0].options.headers).toEqual({ 'x-api-key': 'secret-key' });
    await expect(createStructuredFeedSource(licensed, {}).discover(ctxOf({ fetcher }))).rejects.toThrow(/set EXAMPLE_KEY/);
    expect(JSON.stringify(leads)).not.toContain('secret-key');
  });

  it('rejects a config that cannot work', () => {
    expect(() => createStructuredFeedSource({ ...config, kind: 'press' })).toThrow(/kind must be/);
    expect(() => createStructuredFeedSource({ ...config, source: { format: 'json' } })).toThrow(/source.url or source.file/);
    expect(() => createStructuredFeedSource({ ...config, source: { file: 'x', format: 'xml' } })).toThrow(/format must be json or csv/);
    expect(() => createStructuredFeedSource({ ...config, field_map: {} })).toThrow(/field_map.name/);
    expect(() => createStructuredFeedSource({ ...config, headers_env: { 'x-api-key': 'K' } })).toThrow(/only for a licensed_api/);
  });

  it('complains when the data is not a list of records', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'feed-'));
    try {
      const file = path.join(dir, 'x.json');
      await writeFile(file, JSON.stringify({ nope: true }));
      await expect(createStructuredFeedSource({ ...config, source: { file, format: 'json' } }).discover(ctxOf())).rejects.toThrow(/expected a list of records/);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

describe('the source registry', () => {
  it('requires every source to say why we may use it', () => {
    expect(validateLicense({ basis: 'public_feed' })).toEqual([]);
    expect(validateLicense({ basis: 'user_submission' })).toEqual([]);
    expect(validateLicense(undefined)[0]).toMatch(/license.basis must be one of/);
    expect(validateLicense({ basis: 'we_just_took_it' })[0]).toMatch(/license.basis must be one of/);
    for (const basis of ['open_data', 'licensed_api', 'permitted_page']) {
      expect(LICENSE_BASES[basis].needsAttestation).toBe(true);
      expect(validateLicense({ basis })).toHaveLength(2);
      expect(validateLicense({ basis, attestation: 'We hold licence 42', terms_url: 'https://example.org/terms' })).toEqual([]);
    }
    expect(validateLicense({ basis: 'public_feed', terms_url: 'not a url' })[0]).toMatch(/http\(s\)/);
  });

  const good = { id: 'rss.a', adapter: 'rss', feed_url: 'https://a.example/feed/', license: { basis: 'public_feed' } };

  it('loads valid sources and reports the rest as skipped, with the reason', () => {
    const { sources, skipped } = loadSources([
      good,
      { ...good, id: 'rss.off', enabled: false },
      { ...good, id: 'rss.nolicense', license: undefined },
      { ...good, id: 'sf.unlicensed', adapter: 'structured-feed', license: { basis: 'licensed_api' } },
      { ...good, id: 'mystery', adapter: 'crystal-ball' },
      { id: 'rss.nofeed', adapter: 'rss', license: { basis: 'public_feed' } },
    ]);
    expect(sources.map((s) => s.id)).toEqual(['rss.a']);
    expect(Object.fromEntries(skipped.map((s) => [s.id, s.reason]))).toEqual({
      'rss.off': 'disabled',
      'rss.nolicense': expect.stringMatching(/^no valid licence/),
      'sf.unlicensed': expect.stringMatching(/^no valid licence: .*attestation is required/),
      mystery: 'unknown adapter "crystal-ball"',
      'rss.nofeed': expect.stringMatching(/feed_url is required/),
    });
  });

  it('never runs a source whose licence is missing, even one that would otherwise work', () => {
    const { sources } = loadSources([{ ...good, license: { basis: 'open_data' } }]);
    expect(sources).toEqual([]);
  });

  it('can run just the sources asked for', () => {
    const { sources } = loadSources([good, { ...good, id: 'rss.b' }], { only: ['rss.b'] });
    expect(sources.map((s) => s.id)).toEqual(['rss.b']);
  });

  it('ships a default configuration that is all valid, needs no credential, and reads neither LinkedIn nor a proprietary database', () => {
    const configs = buildSourceConfig({});
    const { sources, skipped } = loadSources(configs, { env: {} });
    expect(skipped).toEqual([]);
    expect(sources.map((s) => s.id)).toEqual(['rss.startupdaily-funding', 'submissions']);
    for (const c of configs) expect(JSON.stringify(c)).not.toMatch(/linkedin|crunchbase|pitchbook|dealroom|cbinsights/i);
    expect(buildSourceConfig({ DISCOVERY_SUBMISSIONS_URL: 'https://api.example/api/submissions' })[1].url).toBe('https://api.example/api/submissions');
  });
});
