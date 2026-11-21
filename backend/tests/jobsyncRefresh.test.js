// The twice-a-day refresh: the three readers added for Ashby and Recruitee, the stated-only pay and experience, finding every company's board from its own website, the venture
// firms' boards, one role shown once, the schedule, the health record, and the whole flow from an employer's feed to the page's answer.
import { describe, it, expect, afterEach } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { createFetcher } from '../src/discovery/http.js';
import { jobSyncFetcher } from '../src/jobsync/fetcher.js';
import { readSource, salaryOf, SyncError } from '../src/jobsync/adapters.js';
import { SUPPORTED, UNSUPPORTED_REASONS } from '../src/jobsync/providers.js';
import { discoverCompany, applyDiscovery, dueForDiscovery, rotationBucket, blockOf, BLOCK_MS } from '../src/jobsync/discover.js';
import { runDiscovery } from '../src/jobsync/discoverRun.js';
import { classifyBoard, checkFirm, applySample, boardCandidates, VC_FIRMS } from '../src/jobsync/vc.js';
import { NETWORKS } from '../src/jobsync/network.js';
import { SOURCES as PORTFOLIOS } from '../src/discovery/portfolioSources.js';
import { dedupeRoles } from '../src/jobsync/dedupe.js';
import { applyRead } from '../src/jobsync/engine.js';
import { decide, slotAt, melbourne } from '../src/jobsync/slot.js';
import { tick } from '../src/scheduler/scheduler.js';
import { buildBoard } from '../src/network/board.js';
import { createNetwork } from '../src/network/index.js';
import { createApp } from '../src/app.js';
import { fixture } from './helpers/catalog.js';
import { makeDataDir, readDataDir, removeMadeDirs } from './helpers/store.js';
import { dataset, co, NOW, ISO, scriptedWeb } from './helpers/scheduler.js';

afterEach(removeMadeDirs);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const json = (body, status = 200) => ({ status, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const html = (body) => ({ status: 200, body, headers: { 'content-type': 'text/html' } });
const text = (body, status = 200) => ({ status, body, headers: { 'content-type': 'text/plain' } });
const PUBLIC = async () => ['93.184.216.34'];
const make = (routes, over = {}) => {
  const w = scriptedWeb(routes);
  return { w, fetcher: createFetcher({ fetchImpl: w.fetchImpl, resolveHost: PUBLIC, sleep: async () => {}, now: () => NOW, ...over }) };
};
const makeJob = (routes, over = {}) => {
  const w = scriptedWeb(routes);
  return { w, fetcher: jobSyncFetcher({ fetchImpl: w.fetchImpl, resolveHost: PUBLIC, sleep: async () => {}, now: () => NOW, ...over }) };
};

// ---------- Ashby ----------

const ASHBY = 'https://api.ashbyhq.com/posting-api/job-board/acme?includeCompensation=true';
const ashbyJob = (id, over = {}) => ({
  id, title: `Role ${id}`, department: 'Engineering', team: 'Platform', employmentType: 'FullTime', location: 'AU - Melbourne',
  secondaryLocations: [{ location: 'AU - Sydney', address: { postalAddress: { addressRegion: 'New South Wales', addressCountry: 'Australia', addressLocality: 'Sydney' } } }],
  publishedAt: '2026-09-08T04:01:58.847+00:00', isListed: true, isRemote: true, workplaceType: 'Hybrid',
  address: { postalAddress: { addressRegion: 'Victoria', addressCountry: 'Australia', addressLocality: 'Melbourne' } },
  jobUrl: `https://jobs.ashbyhq.com/acme/${id}`, applyUrl: `https://jobs.ashbyhq.com/acme/${id}/application`,
  compensation: { compensationTierSummary: '$120K – $160K', summaryComponents: [{ compensationType: 'Salary', interval: '1 YEAR', currencyCode: 'AUD', minValue: 120000, maxValue: 160000 }] },
  ...over,
});

describe('reading an Ashby board', () => {
  const source = { id: 'acme-ashby-jobs', company_id: 'acme', provider: 'ashby', token: 'acme' };

  it('reads the whole list: the employer\'s places, how it is worked, the kind of job, the team, its own posted date, and the pay it states', async () => {
    const { fetcher } = makeJob({ [ASHBY]: json({ jobs: [ashbyJob('a1'), ashbyJob('a2', { isListed: false }), ashbyJob('a3', { compensation: undefined, location: 'Remote', secondaryLocations: [] })] }) });
    const r = await readSource(source, { fetcher, now: NOW, companyWebsite: 'https://acme.com.au' });
    expect(r.complete).toBe(true);
    expect([...r.seen]).toEqual(['a1', 'a3']); // an unlisted job is not on the board
    expect(r.postings[0]).toMatchObject({
      external_id: 'a1', title: 'Role a1', apply_url: 'https://jobs.ashbyhq.com/acme/a1', labels: ['AU - Melbourne', 'AU - Sydney'], workplaceType: 'Hybrid',
      employment: 'Full-time', team: 'Platform', posted_at: '2026-09-08T04:01:58.847Z', salary: { min: 120000, max: 160000, currency: 'AUD', period: 'year', text: '$120K – $160K' },
    });
    // "Remote" says no place; the postal address, in Australia, is the employer's statement of where.
    expect(r.postings[1].labels).toEqual(['Remote', 'Melbourne, Victoria, Australia']);
    expect(r.postings[1].salary).toBeNull(); // stated or null: never worked out
  });

  it('reads Ashby\'s API although its robots.txt answers 401 (no rules), and only because that one host is named', async () => {
    const routes = { 'https://api.ashbyhq.com/robots.txt': text('Unauthorized', 401), [ASHBY]: json({ jobs: [ashbyJob('a1')] }) };
    const strict = make(routes);
    await expect(readSource(source, { fetcher: strict.fetcher, now: NOW, retries: 0 })).rejects.toMatchObject({ name: 'SyncError', code: 'network' });
    const sync = makeJob(routes);
    expect((await readSource(source, { fetcher: sync.fetcher, now: NOW })).postings).toHaveLength(1);
  });

  it('never reads a board whose robots.txt says no, whatever the host list says (SmartRecruiters\' API says Disallow: / to every robot)', async () => {
    const { fetcher } = makeJob({ 'https://api.ashbyhq.com/robots.txt': text('User-agent: *\nDisallow: /', 200), [ASHBY]: json({ jobs: [ashbyJob('a1')] }) });
    await expect(readSource(source, { fetcher, now: NOW, retries: 0 })).rejects.toMatchObject({ name: 'SyncError', code: 'refused' });
    expect(SUPPORTED).not.toContain('smartrecruiters');
    expect(UNSUPPORTED_REASONS.smartrecruiters).toMatch(/Disallow/);
  });

  it('fails, never returns a short list, when the feed is not a list of jobs', async () => {
    const { fetcher } = makeJob({ 'https://api.ashbyhq.com/robots.txt': text('x', 401), [ASHBY]: json({ jobs: 'nope' }) });
    await expect(readSource(source, { fetcher, now: NOW, retries: 0 })).rejects.toMatchObject({ code: 'malformed' });
  });
});

// ---------- Recruitee ----------

describe('reading a Recruitee board', () => {
  const source = { id: 'acme-recruitee-jobs', company_id: 'acme', provider: 'recruitee', token: 'acme' };
  const offer = (id, over = {}) => ({
    id, slug: `designer-${id}`, title: `Designer ${id}`, status: 'published', location: 'Sydney, NSW, Australia', city: 'Sydney', country: 'Australia', remote: false, hybrid: true, on_site: false,
    employment_type_code: 'fulltime', experience_code: 'mid_level', department: 'Design', careers_url: `https://acme.recruitee.com/o/designer-${id}`, published_at: '2026-10-01 00:00:00 UTC',
    salary: { min: 90000, max: 110000, currency: 'AUD', period: 'year' }, ...over,
  });
  it('reads published offers only, with the experience and the pay the listing states', async () => {
    const { fetcher } = make({ 'https://acme.recruitee.com/api/offers/': json({ offers: [offer(1), offer(2, { status: 'draft' }), offer(3, { salary: undefined, experience_code: null })] }) });
    const r = await readSource(source, { fetcher, now: NOW });
    expect([...r.seen]).toEqual(['1', '3']);
    expect(r.postings[0]).toMatchObject({ title: 'Designer 1', apply_url: 'https://acme.recruitee.com/o/designer-1', labels: ['Sydney, NSW, Australia'], workplaceType: 'hybrid', employment: 'Full-time', team: 'Design', experience: 'mid level', salary: { min: 90000, max: 110000, currency: 'AUD', period: 'year' }, posted_at: '2026-10-01T00:00:00.000Z' });
    expect(r.postings[1]).toMatchObject({ salary: null, experience: null });
  });
});

describe('a pay range, as the employer states it', () => {
  it('keeps what is stated and nothing else', () => {
    expect(salaryOf({})).toBeNull();
    expect(salaryOf({ min: 0, max: null })).toBeNull();
    expect(salaryOf({ min: 160000, max: 120000, currency: 'AUD' })).toBeNull(); // a range the wrong way round is not usable
    expect(salaryOf({ text: '$120K – $160K' })).toEqual({ min: null, max: null, currency: null, period: null, text: '$120K – $160K' });
    expect(salaryOf({ min: '90,000', max: 110000, currency: 'aud', period: 'per-year-salary' })).toEqual({ min: 90000, max: 110000, currency: 'AUD', period: 'year', text: null });
    expect(salaryOf({ min: 50, currency: 'not-a-currency', period: '1 HOUR' })).toMatchObject({ min: 50, currency: null, period: 'hour' });
  });
});

describe('the refresh makes no call to a language model', () => {
  it('names no model provider anywhere in the sync\'s code', async () => {
    const dir = path.join(HERE, '..', 'src', 'jobsync');
    const files = (await readdir(dir)).filter((f) => f.endsWith('.js'));
    for (const f of files) expect(await readFile(path.join(dir, f), 'utf8'), f).not.toMatch(/anthropic|openai|chatgpt|api\.claude|generativelanguage|gpt-\d/i);
    expect(await readFile(path.join(HERE, '..', 'package.json'), 'utf8')).not.toMatch(/anthropic|openai/i);
  });
});

// ---------- finding every company's board from its own website ----------

const LEVER_FEED = 'https://api.lever.co/v0/postings/acme?mode=json&limit=50&skip=0';
const leverJob = (n) => ({ id: `id-${n}`, text: `Role ${n}`, hostedUrl: `https://jobs.lever.co/acme/id-${n}`, createdAt: Date.parse('2026-08-04T00:00:00Z'), workplaceType: 'hybrid', categories: { location: 'Sydney, NSW, Australia', commitment: 'Full-time', team: 'Eng' } });
const acme = { id: 'acme-robotics', name: 'Acme Robotics', website: 'https://acme.com.au' };
const HOME = '<html><head><title>Acme Robotics</title></head><body><a href="/careers">Careers</a><a href="/about">About</a></body></html>';

describe('finding a company\'s job board from its own website', () => {
  it('approves a board the company\'s own careers page links to, after its feed answers with a whole list, and asks for nothing else', async () => {
    const { w, fetcher } = make({
      'https://acme.com.au/': html(HOME), 'https://acme.com.au/careers': html('<a href="https://jobs.lever.co/acme">Open roles</a>'), [LEVER_FEED]: json([leverJob(1)]),
    });
    const r = await discoverCompany(acme, { fetcher, now: () => NOW });
    expect(r).toMatchObject({ outcome: 'board', review: false, careers_url: 'https://acme.com.au/careers' });
    expect(r.verified).toEqual([expect.objectContaining({ provider: 'lever', token: 'acme', listed: 1, evidence_url: 'https://acme.com.au/careers', url: 'https://jobs.lever.co/acme' })]);
    // Nothing guessed: every page asked for is one the company's pages linked to, or the feed of the board they link to.
    expect(w.pages()).toEqual(['https://acme.com.au/', 'https://acme.com.au/careers', 'https://acme.com.au/about', LEVER_FEED].filter((u) => w.pages().includes(u)));
    expect(w.pages().every((u) => ['https://acme.com.au/', 'https://acme.com.au/careers', 'https://acme.com.au/about', LEVER_FEED].includes(u))).toBe(true);
  });

  it('follows the careers link one more step to a jobs page, and to one job page, because an apply button is often the only place a board is named', async () => {
    const { fetcher } = make({
      'https://acme.com.au/': html(HOME), 'https://acme.com.au/careers': html('<a href="/careers/jobs">See jobs</a><a href="/careers/designer-1">Designer</a>'),
      'https://acme.com.au/careers/jobs': html('<p>Loading</p>'), 'https://acme.com.au/careers/designer-1': html('<a href="https://job-boards.greenhouse.io/acme/jobs/1">Apply</a>'),
      'https://boards-api.greenhouse.io/v1/boards/acme/jobs': json({ jobs: [], meta: { total: 0 } }),
    });
    const r = await discoverCompany(acme, { fetcher, now: () => NOW });
    expect(r).toMatchObject({ outcome: 'board' });
    expect(r.verified[0]).toMatchObject({ provider: 'greenhouse', token: 'acme' });
  });

  it('records a company that has a careers page and no link to a board we recognise, for review', async () => {
    const { fetcher } = make({ 'https://acme.com.au/': html(HOME), 'https://acme.com.au/careers': html('<p>We hire great people. Email us.</p>') });
    const r = await discoverCompany(acme, { fetcher, now: () => NOW });
    expect(r).toMatchObject({ outcome: 'careers_page_only', review: true, careers_url: 'https://acme.com.au/careers', boards: [] });
    expect(r.verified).toEqual([]);
  });

  it('records a company on a provider the sync does not read, by name: SmartRecruiters (robots says no) and Workday (no GET feed)', async () => {
    const sr = make({ 'https://acme.com.au/': html(HOME), 'https://acme.com.au/careers': html('<a href="https://jobs.smartrecruiters.com/AcmeRobotics">Jobs</a>') });
    const a = await discoverCompany(acme, { fetcher: sr.fetcher, now: () => NOW });
    expect(a).toMatchObject({ outcome: 'unsupported_provider', review: true });
    expect(a.boards[0]).toMatchObject({ provider: 'smartrecruiters', token: 'AcmeRobotics', supported: false });
    expect(a.boards[0].reason).toMatch(/Disallow/);
    expect(sr.w.calls.some((u) => /api\.smartrecruiters\.com\/v1/.test(u))).toBe(false); // never asked

    const bamboo = make({ 'https://acme.com.au/': html(HOME), 'https://acme.com.au/careers': html('<a href="https://acme.wd3.myworkdayjobs.com/Careers">Jobs</a>') });
    const b = await discoverCompany(acme, { fetcher: bamboo.fetcher, now: () => NOW });
    expect(b).toMatchObject({ outcome: 'unsupported_provider', review: true });
    expect(b.boards[0]).toMatchObject({ provider: 'workday', supported: false });
  });

  it('says a board that is linked but would not answer is for review, and never approves it', async () => {
    const { fetcher } = make({ 'https://acme.com.au/': html(HOME), 'https://acme.com.au/careers': html('<a href="https://jobs.lever.co/acme">Jobs</a>'), [LEVER_FEED]: { status: 404, body: 'no', headers: { 'content-type': 'text/plain' } } });
    const r = await discoverCompany(acme, { fetcher, now: () => NOW });
    expect(r).toMatchObject({ outcome: 'board_unreadable', review: true });
    expect(r.verified).toEqual([]);
  });

  it('says a company with no website, no careers page, or a website that will not answer, plainly', async () => {
    const none = await discoverCompany({ id: 'x', name: 'X' }, { fetcher: make({}).fetcher, now: () => NOW });
    expect(none).toMatchObject({ outcome: 'no_website', review: false });
    const bare = make({ 'https://acme.com.au/': html('<p>Hello</p>') });
    expect(await discoverCompany(acme, { fetcher: bare.fetcher, now: () => NOW })).toMatchObject({ outcome: 'no_careers_found', review: true });
    const down = make({ 'https://acme.com.au/': new Error('boom') });
    expect(await discoverCompany(acme, { fetcher: down.fetcher, now: () => NOW })).toMatchObject({ outcome: 'unreadable', review: true });
  });

  it('writes a sources row (the page that links to the board is what approves it), the catalogue row and a ledger row for every company, then leaves it alone until it is due again', async () => {
    const dir = await makeDataDir(dataset([co('Acme Robotics', { website: 'https://acme.com.au' }), co('Bare Co', { website: 'https://bare.example' }), co('No Site')]));
    const { w, fetcher } = make({
      'https://acme.com.au/': html(HOME), 'https://acme.com.au/careers': html('<a href="https://jobs.lever.co/acme">Open roles</a>'), [LEVER_FEED]: json([leverJob(1)]),
      'https://bare.example/': html('<p>hi</p>'),
    });
    const stats = await runDiscovery({ dir, fetcher, now: () => NOW, limit: 10, concurrency: 1 });
    expect(stats).toMatchObject({ read: 3, boards: 1, outcomes: { board: 1, no_careers_found: 1, no_website: 1 } });
    const ds = await readDataDir(dir);
    expect(ds.sources.find((s) => s.id === 'acme-robotics-lever-jobs')).toMatchObject({ kind: 'company_website', url: 'https://jobs.lever.co/acme' });
    expect(ds.job_sources).toEqual([expect.objectContaining({ id: 'acme-robotics-lever-jobs', company_id: 'acme-robotics', provider: 'lever', token: 'acme', status: 'approved' })]);
    expect(ds.job_coverage.map((r) => [r.company_id, r.outcome, r.review])).toEqual([['acme-robotics', 'board', false], ['bare-co', 'no_careers_found', true], ['no-site', 'no_website', false]]);
    expect(ds.job_coverage[0].source_ids).toEqual(['acme-robotics-lever-jobs']);
    const before = w.calls.length;
    const again = await runDiscovery({ dir, fetcher, now: () => NOW, limit: 10, concurrency: 1 });
    expect(again.read).toBe(0);
    expect(w.calls.length).toBe(before); // nothing is due: no request
  });

  it('keeps a company covered by the board approved earlier when its website cannot be read this time', async () => {
    const dir = await makeDataDir(dataset([co('Acme Robotics', { website: 'https://acme.com.au' })], {
      sources: [{ id: 'acme-robotics-lever-jobs', kind: 'company_website', url: 'https://jobs.lever.co/acme', title: 'Lever job board', publisher: 'acme.com.au', retrieved_at: ISO, note: 'x' }],
      job_sources: [{ id: 'acme-robotics-lever-jobs', company_id: 'acme-robotics', provider: 'lever', token: 'acme', board_url: 'https://jobs.lever.co/acme', status: 'approved', basis: 'linked', note: '', added_at: ISO }],
    }));
    const { fetcher } = make({ 'https://acme.com.au/': new Error('down') });
    await runDiscovery({ dir, fetcher, now: () => NOW, limit: 10, concurrency: 1 });
    const row = (await readDataDir(dir)).job_coverage[0];
    expect(row).toMatchObject({ outcome: 'board', review: false, source_ids: ['acme-robotics-lever-jobs'] });
    expect(row.note).toMatch(/approved from the company's own page earlier/);
  });
});

// ---------- the venture firms' boards ----------

const getroPage = (jobs, { total = jobs.length, slug = 'acme' } = {}) => html(`<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { network: { slug }, initialState: { jobs: { found: jobs, total } } } } })}</script></body></html>`);
const getroJob = (org, title, locations, url) => ({ organization: { name: org }, title, locations, url, workMode: 'hybrid' });
const firm = { id: 'acme-vc', name: 'Acme Ventures', investor_id: null, site: 'https://acmevc.example/' };

describe('the venture firms\' job boards', () => {
  it('finds the board the firm\'s own site links to, ignores the platform\'s marketing link, and says what the page serves: a sample', async () => {
    const { fetcher } = make({
      'https://acmevc.example/': html('<a href="https://www.getro.com/vc">Powered by Getro</a><a href="https://acme.getro.com/jobs?_gl=abc">Portfolio jobs</a>'),
      'https://acme.getro.com/jobs?_gl=abc': getroPage([getroJob('Zeller', 'Account Executive', ['Sydney, NSW, Australia'], 'https://jobs.lever.co/Zeller/abc')], { total: 340 }),
      'https://acme.getro.com/jobs': getroPage([getroJob('Zeller', 'Account Executive', ['Sydney, NSW, Australia'], 'https://jobs.lever.co/Zeller/abc')], { total: 340 }),
    });
    const { row, sample } = await checkFirm(firm, { fetcher, now: () => NOW });
    expect(row).toMatchObject({ id: 'acme-vc', platform: 'getro', access: 'public_sample', board_url: 'https://acme.getro.com/jobs' });
    expect(row.note).toMatch(/newest 1 of 340/);
    expect(row.note).toMatch(/not read/);
    expect(sample).toHaveLength(1);
  });

  it('says plainly when a board is not readable: Consider draws its list by script, Work at a Startup sends every apply through its sign-in, and a firm may have no board at all', async () => {
    const consider = make({ 'https://acmevc.example/': html('<a href="https://jobs.acmevc.example/jobs">Jobs</a>'), 'https://jobs.acmevc.example/jobs': html('<div id="app"></div><a href="https://product.consider.com/x">Powered by Consider</a>') });
    expect((await checkFirm(firm, { fetcher: consider.fetcher, now: () => NOW })).row).toMatchObject({ platform: 'consider', access: 'no_public_feed' });
    const yc = make({ 'https://ycombinator.com/': html('<a href="https://www.ycombinator.com/jobs">Startup Jobs</a>'), 'https://www.ycombinator.com/jobs': html('<p>jobs</p>') });
    expect((await checkFirm({ ...firm, id: 'y-combinator', site: 'https://www.ycombinator.com/' }, { fetcher: yc.fetcher, now: () => NOW })).row).toMatchObject({ platform: 'workatastartup', access: 'login_required' });
    const none = make({ 'https://acmevc.example/': html('<p>We invest.</p>') });
    expect((await checkFirm(firm, { fetcher: none.fetcher, now: () => NOW })).row).toMatchObject({ platform: 'none', access: 'no_board' });
  });

  it('uses a board the firm\'s site does not link to only if the board\'s own data names the firm, and says so', async () => {
    const startmate = VC_FIRMS.find((f) => f.id === 'startmate');
    const ok = make({ 'https://startmate.com/': html('<p>Startmate</p>'), 'https://startmate.getro.com/jobs': getroPage([], { total: 0, slug: 'startmate' }) });
    const r = (await checkFirm(startmate, { fetcher: ok.fetcher, now: () => NOW })).row;
    expect(r).toMatchObject({ access: 'public_sample', board_url: 'https://startmate.getro.com/jobs' });
    expect(r.note).toMatch(/Not linked from Startmate's own site/);
    const other = make({ 'https://startmate.com/': html('<p>Startmate</p>'), 'https://startmate.getro.com/jobs': getroPage([], { total: 0, slug: 'someone-else' }) });
    expect((await checkFirm(startmate, { fetcher: other.fetcher, now: () => NOW })).row).toMatchObject({ access: 'no_board', board_url: null });
  });

  it('names a firm\'s own vacancies by provider when it has them on a board we do not read, and does not take its portfolio\'s boards for its own', async () => {
    const { fetcher } = make({
      'https://acmevc.example/': html('<a href="/careers">Careers</a><a href="https://acme.getro.com/jobs">Portfolio jobs</a>'),
      'https://acmevc.example/careers': html('<a href="https://acmevc.wd3.myworkdayjobs.com/Careers">Apply now</a>'),
      'https://acme.getro.com/jobs': getroPage([getroJob('Zeller', 'AE', ['Sydney, NSW, Australia'], 'https://jobs.lever.co/zeller/1')]),
    });
    const { row } = await checkFirm(firm, { fetcher, now: () => NOW });
    expect(row.own_vacancies).toMatch(/acmevc\.wd3\.myworkdayjobs\.com/);
    expect(row.own_vacancies).not.toMatch(/lever/i);
  });

  it('picks the jobs/careers subdomain and a platform host, and nothing that is a person, a social network or a page about the firm', () => {
    const pages = [{ finalUrl: 'https://acmevc.example/', html: '<a href="https://www.linkedin.com/jobs/view/1">LinkedIn job</a><a href="/team">Team</a><a href="/careers-at-acme">Careers at Acme</a><a href="https://jobs.acmevc.example/jobs">Startup jobs</a><a href="https://oif.getro.com/jobs">jobs</a>' }];
    expect(boardCandidates(pages, 'acmevc.example').map((c) => c.url)).toEqual(['https://oif.getro.com/jobs', 'https://jobs.acmevc.example/jobs']);
  });

  it('reads the board\'s page for what it can tell us and never stores a role from it: a company we hold with a board we lack is queued for review, an unknown Australian company is a lead, the rest is ignored', () => {
    const work = {
      companies: [{ id: 'zeller', name: 'Zeller' }, { id: 'twin-a', name: 'Twin' }, { id: 'twin-b', name: 'Twin' }, { id: 'bellroy', name: 'Bellroy' }],
      job_sources: [{ id: 'bellroy-greenhouse-jobs', company_id: 'bellroy', provider: 'greenhouse', token: 'bellroy', status: 'approved' }],
      job_leads: [], jobs: [],
    };
    const sample = [
      { firm: 'acme-vc', org: 'Zeller', title: 'AE', url: 'https://jobs.lever.co/Zeller/abc', locations: ['Sydney, NSW, Australia'], work_mode: null, at: ISO },
      { firm: 'acme-vc', org: 'Bellroy', title: 'Designer', url: 'https://job-boards.greenhouse.io/bellroy/jobs/1', locations: ['Melbourne, VIC, Australia'], work_mode: null, at: ISO },
      { firm: 'acme-vc', org: 'Newco', title: 'Engineer', url: 'https://jobs.ashbyhq.com/newco/1', locations: ['Perth, WA, Australia'], work_mode: null, at: ISO },
      { firm: 'acme-vc', org: 'Faraway', title: 'Engineer', url: 'https://jobs.ashbyhq.com/faraway/1', locations: ['Austin, TX, USA'], work_mode: null, at: ISO },
      { firm: 'acme-vc', org: 'Twin', title: 'Engineer', url: 'https://jobs.lever.co/twin/1', locations: ['Sydney, NSW, Australia'], work_mode: null, at: ISO },
    ];
    const { stats, reviews } = applySample(work, firm, sample, { at: ISO, keptReview: [] });
    expect(stats).toMatchObject({ sighted: 5, known: 2, review_boards: 1, leads: 2, ignored: 1 });
    expect(reviews).toEqual([expect.objectContaining({ company_id: 'zeller', provider: 'lever', token: 'Zeller', reason: expect.stringMatching(/Not yet confirmed from Zeller's own careers page or through its own feed, so it is not read/) })]);
    // "Twin" is two companies in the directory: it matches neither, so it is an unknown name with an Australian place.
    expect(work.job_leads.map((l) => [l.name, l.status, l.seen_on[0].firm])).toEqual([['Newco', 'needs_review', 'acme-vc'], ['Twin', 'needs_review', 'acme-vc']]);
    expect(work.jobs).toEqual([]);
  });
});

// ---------- one role, shown once ----------

const role = (id, source, over = {}) => ({
  id, company_id: 'acme', title: 'Account Executive', location: 'Sydney, NSW, Australia', locations: ['Sydney, NSW, Australia'], status: 'open', source_id: source, provider: source.split('-')[1],
  external_id: id, canonical_url: `https://x.example/${id}`, apply_url: `https://x.example/${id}`, retrieved_at: ISO, first_seen_at: ISO, last_confirmed_at: ISO, posted_at: null, ...over,
});

describe('the same role on two boards', () => {
  it('is shown once: the better supported copy stays, the other is hidden with a pointer, and the same board\'s own repeats are untouched', () => {
    const rows = [
      role('g1', 'acme-greenhouse-jobs', { posted_at: '2026-10-01T00:00:00.000Z' }), role('l1', 'acme-lever-jobs'),
      role('g2', 'acme-greenhouse-jobs'), // the same board lists it twice: two openings, the employer's word
      role('m1', 'acme-lever-jobs', { title: 'Account Executive', locations: ['Melbourne, VIC, Australia'], location: 'Melbourne, VIC, Australia' }), // another city: another role
    ];
    const r = dedupeRoles(rows, { now: NOW });
    expect(r).toMatchObject({ removed: 1, hidden: 1 });
    const byId = Object.fromEntries(rows.map((x) => [x.id, x]));
    expect(byId.l1).toMatchObject({ status: 'hidden', duplicate_of: 'g1' });
    expect(['g1', 'g2', 'm1'].map((id) => byId[id].status)).toEqual(['open', 'open', 'open']);
    expect(dedupeRoles(rows, { now: NOW + 1 })).toMatchObject({ removed: 0, hidden: 1 }); // stable: running it again changes nothing
  });

  it('is not reopened by the board that still lists it, and is released when the role it duplicates is gone', () => {
    const rows = [role('g1', 'acme-greenhouse-jobs', { posted_at: '2026-10-01T00:00:00.000Z' }), role('l1', 'acme-lever-jobs')];
    dedupeRoles(rows, { now: NOW });
    const source = { id: 'acme-lever-jobs', company_id: 'acme', provider: 'lever' };
    const posting = { external_id: 'l1', title: 'Account Executive', apply_url: 'https://x.example/l1', canonical_url: 'https://x.example/l1', labels: ['Sydney, NSW, Australia'], workplaceType: null, employment: null, team: null, posted_at: null };
    const stats = applyRead(rows, source, { postings: [posting], seen: new Set(['l1']), skipped: [], pages: 1 }, { now: NOW + 3600000 });
    expect(stats.reopened).toBe(0);
    expect(rows.find((x) => x.id === 'l1')).toMatchObject({ status: 'hidden', duplicate_of: 'g1' });
    rows[0].status = 'archived'; // the employer took the first one down
    expect(dedupeRoles(rows, { now: NOW + 7200000 })).toMatchObject({ released: 1, hidden: 0 });
    applyRead(rows, source, { postings: [posting], seen: new Set(['l1']), skipped: [], pages: 1 }, { now: NOW + 7300000 });
    expect(rows.find((x) => x.id === 'l1')).toMatchObject({ status: 'open' });
    expect(rows.find((x) => x.id === 'l1').duplicate_of).toBeUndefined();
  });
});

// ---------- the schedule ----------

describe('the slot a refresh answers, by the clock in Melbourne', () => {
  it('reads Melbourne\'s wall clock, daylight saving included', () => {
    expect(melbourne(Date.parse('2026-11-19T21:00:00Z'))).toEqual({ date: '2026-11-20', hour: 8, minute: 0 }); // AEDT, UTC+11
    expect(melbourne(Date.parse('2026-07-14T22:00:00Z'))).toEqual({ date: '2026-07-15', hour: 8, minute: 0 }); // AEST, UTC+10
    expect(slotAt(Date.parse('2026-11-19T21:30:00Z'))).toMatchObject({ id: '2026-11-20 AM' });
    expect(slotAt(Date.parse('2026-11-19T09:00:00Z'))).toMatchObject({ id: '2026-11-19 PM' });
    expect(slotAt(Date.parse('2026-11-19T03:00:00Z'))).toBeNull(); // 2:00 pm
  });

  it('runs a firing that falls in a slot\'s window, once, and not again for the same slot', () => {
    const t = Date.parse('2026-11-19T21:00:00Z');
    expect(decide({ now: t })).toMatchObject({ run: true, slot: '2026-11-20 AM' });
    expect(decide({ now: t + 3600000, done: ['2026-11-20 AM'] })).toMatchObject({ run: false, slot: '2026-11-20 AM' }); // the 22:00 UTC firing, 9:00 in summer
    expect(decide({ now: t + 3600000, done: [] })).toMatchObject({ run: true, slot: '2026-11-20 AM' }); // a delayed or retried one still answers its slot
    expect(decide({ now: Date.parse('2026-11-19T03:00:00Z') })).toMatchObject({ run: false, slot: null });
    expect(decide({ now: Date.parse('2026-11-19T03:00:00Z'), force: true })).toMatchObject({ run: true });
  });

  it('gives exactly two slots a day from four firings at UTC times, in summer, in winter, and across both daylight-saving changes', () => {
    // The workflow fires at 21:00, 22:00, 09:00 and 10:00 UTC every day.
    const firings = [];
    const start = Date.parse('2026-03-30T00:00:00Z');
    for (let d = 0; d < 400; d += 1) for (const h of [9, 10, 21, 22]) firings.push(start + d * 86400000 + h * 3600000);
    const done = [];
    const perDay = {};
    for (const when of firings.sort((a, b) => a - b)) {
      const v = decide({ now: when, done });
      if (v.run) { done.push(v.slot); const day = v.slot.slice(0, 10); perDay[day] = (perDay[day] ?? 0) + 1; }
    }
    const counts = Object.values(perDay);
    expect(counts.length).toBeGreaterThan(395);
    expect(new Set(counts.slice(1, -1))).toEqual(new Set([2])); // every full day: exactly two
    // 8:10 am and 8:10 pm, to the hour, in both halves of the year.
    expect(done).toContain('2026-07-15 AM');
    expect(done).toContain('2027-01-10 PM');
  });
});

// ---------- the whole refresh, and the whole flow ----------

const ZELLER_GH = 'https://boards-api.greenhouse.io/v1/boards/zeller/jobs';
const ghJob = (id, title, location = 'Melbourne, Victoria, Australia') => ({ id, title, absolute_url: `https://job-boards.greenhouse.io/zeller/jobs/${id}`, location: { name: location }, first_published: '2026-09-01T00:00:00-04:00' });

async function refreshSetup() {
  const sources = [{ id: 'zeller-greenhouse-jobs', kind: 'company_website', url: 'https://boards.greenhouse.io/zeller', title: 'Greenhouse job board', publisher: 'myzeller.com', retrieved_at: ISO, note: '' }];
  const catalogue = [{ id: 'zeller-greenhouse-jobs', company_id: 'zeller', provider: 'greenhouse', token: 'zeller', board_url: 'https://boards.greenhouse.io/zeller', status: 'approved', basis: 'linked from its careers page', note: '', added_at: ISO }];
  const dir = await makeDataDir(dataset([
    co('Zeller', { website: 'https://www.myzeller.com', city: 'Melbourne', investors: ['Blackbird', 'AirTree'], stage: 'Series C' }),
    co('Acme Robotics', { website: 'https://acme.com.au', city: 'Sydney' }),
  ], { sources, job_sources: catalogue }));
  const state = { greenhouse: json({ jobs: [ghJob(1, 'Account Executive'), ghJob(2, 'Designer', 'Sydney, NSW, Australia')], meta: { total: 2 } }), lever: json([leverJob(1)]) };
  const w = scriptedWeb((u) => {
    if (u === ZELLER_GH) return state.greenhouse;
    if (u === 'https://acme.com.au/') return html(HOME);
    if (u === 'https://acme.com.au/careers') return html('<a href="https://jobs.lever.co/acme">Open roles</a>');
    if (u === LEVER_FEED) return state.lever;
    return undefined;
  });
  const clock = { now: NOW };
  const now = () => clock.now;
  const fetcher = () => createFetcher({ fetchImpl: w.fetchImpl, resolveHost: PUBLIC, sleep: async () => {}, now });
  return { dir, state, w, clock, now, run: (over = {}) => tick({ dir, now, fetcher: fetcher(), sources: [], by: 'tester', jobs: ['jobsync'], trigger: 'ci', limits: { slot: '2026-11-20 AM' }, ...over }) };
}

describe('a whole refresh', () => {
  it('finds a company\'s board from its own website and reads it in the same refresh, reads the approved one, checks the venture firms, and writes one health row', async () => {
    const t = await refreshSetup();
    const result = await t.run();
    expect(['ok', 'partial']).toContain(result.status);
    const ds = await readDataDir(t.dir);
    // Acme's board was found from its careers page and read in this same refresh; Zeller's was already approved.
    expect(ds.job_sources.map((s) => [s.id, s.status])).toEqual([['acme-robotics-lever-jobs', 'approved'], ['zeller-greenhouse-jobs', 'approved']]);
    expect(ds.jobs.filter((j) => j.status === 'open').map((j) => [j.company_id, j.external_id]).sort()).toEqual([['acme-robotics', 'id-1'], ['zeller', '1'], ['zeller', '2']]);
    // Every directory company has a ledger row; the venture firms were all looked at (none of them is reachable in this scripted web, and that is said, not hidden).
    expect(ds.job_coverage.map((r) => r.company_id).sort()).toEqual(['acme-robotics', 'zeller']);
    expect(ds.job_vc_boards).toHaveLength(VC_FIRMS.length + NETWORKS.length + PORTFOLIOS.length); // the portfolio pages have a row each (read weekly), which the public board leaves out
    expect(ds.job_vc_boards.every((r) => r.access === 'unread' && r.note)).toBe(true);
    expect(ds.job_health).toHaveLength(1);
    expect(ds.job_health[0]).toMatchObject({ slot: '2026-11-20 AM', trigger: 'ci', companies_with_sources: 2, boards_ok: 2, boards_failed: 0, open_roles: 3, new_roles: 3, closed_roles: 0, duplicates_removed: 0, last_success_at: new Date(NOW).toISOString() });
    expect(result.runs.find((x) => x.job === 'jobsync').summary).toMatch(/1 board\(s\) read whole; 2 role\(s\) new.*2 company website\(s\) looked at, 1 new job board\(s\) found/);
    // And it answers the slot question: that slot is done.
    expect(decide({ now: NOW, done: ds.job_health.map((h) => h.slot) })).toMatchObject({ run: false });
  });

  it('closes nothing when a board fails: the roles stay, the failure is counted, and the next refresh recovers', async () => {
    const t = await refreshSetup();
    await t.run();
    t.clock.now += 12 * 3600000;
    t.state.greenhouse = { status: 500, body: 'down', headers: { 'content-type': 'text/plain' } };
    await t.run({ limits: { slot: '2026-11-20 PM' } });
    let ds = await readDataDir(t.dir);
    expect(ds.jobs.filter((j) => j.company_id === 'zeller').map((j) => j.status)).toEqual(['open', 'open']);
    expect(ds.job_health.at(-1)).toMatchObject({ slot: '2026-11-20 PM', boards_failed: 1, closed_roles: 0, open_roles: 3 });
    expect(ds.job_sync_state.find((r) => r.source_id === 'zeller-greenhouse-jobs')).toMatchObject({ consecutive_failures: 1, last_error: expect.objectContaining({ code: 'server' }) });
    t.clock.now += 12 * 3600000;
    t.state.greenhouse = json({ jobs: [ghJob(1, 'Account Executive')], meta: { total: 1 } });
    await t.run({ limits: { slot: '2026-11-21 AM' } });
    ds = await readDataDir(t.dir);
    expect(ds.job_sync_state.find((r) => r.source_id === 'zeller-greenhouse-jobs')).toMatchObject({ consecutive_failures: 0, last_error: null });
    expect(ds.jobs.find((j) => j.id.includes('zeller') && j.external_id === '2').status).toBe('hidden'); // gone from a whole read: hidden, never deleted
    expect(ds.job_health.at(-1)).toMatchObject({ boards_failed: 0, closed_roles: 1 });
  });

  it('runs once for a slot: two refreshes in the same hour make no second round of requests', async () => {
    const t = await refreshSetup();
    await t.run();
    const calls = t.w.calls.length;
    const again = await t.run();
    expect(again.runs.find((x) => x.job === 'jobsync')).toMatchObject({ status: expect.stringMatching(/idle|ok/) });
    const feedCalls = t.w.calls.filter((u) => u === ZELLER_GH || u === LEVER_FEED).length;
    expect(feedCalls).toBe(2); // each board once
    expect(t.w.calls.length - calls).toBeLessThanOrEqual(1); // at most the robots.txt cache misses; no board, company or venture board is asked again
  });
});

describe('from an employer\'s feed to the page\'s answer to the official application link', () => {
  it('stores the role, serves it on /api/jobs/board with the employer\'s own apply link, its place, the company\'s stage and backers, and says how the desk is kept current', async () => {
    const t = await refreshSetup();
    await t.run();
    const ds = await readDataDir(t.dir);
    const f = await fixture(3);
    const zeller = f.rows[0];
    const rows = ds.jobs.filter((j) => j.company_id === 'zeller').map((j) => ({ ...j, company_id: zeller.id }));
    const network = createNetwork({ memory: true, now: () => NOW, curatedEvents: [], curatedJobsRows: rows, curatedJobSync: { sources: ds.job_sources, state: ds.job_sync_state, coverage: ds.job_coverage, vc: ds.job_vc_boards, health: ds.job_health, leads: ds.job_leads }, limits: { signups: 1000, logins: 8 } });
    const server = createApp({ catalog: f.catalog, network });
    const res = await request(server).get('/api/jobs/board').expect(200);
    const ae = res.body.roles.find((r) => r.title === 'Account Executive');
    expect(ae).toMatchObject({ apply_url: 'https://job-boards.greenhouse.io/zeller/jobs/1', provider_name: 'Greenhouse', region: 'au', posted_at: '2026-09-01T04:00:00.000Z', status: 'open', confirmation: 'confirmed' });
    expect(ae.work.cities).toEqual(['Melbourne']);
    expect(res.body.roles.find((r) => r.title === 'Designer').work.cities).toEqual(['Sydney']);
    expect(res.body.sync).toMatchObject({ interval_minutes: 720, schedule: expect.stringMatching(/8:10 am and 8:10 pm Melbourne/), last_refresh: expect.objectContaining({ slot: '2026-11-20 AM', boards_ok: 2 }) });
    expect(res.body.sync.directory).toMatchObject({ looked_at: 2, with_board: 2, for_review: 0 });
    expect(res.body.sync.vc_boards).toHaveLength(VC_FIRMS.length + NETWORKS.length);
  });

  it('carries what the feed states and the directory knows, and nothing it does not: pay, stated experience, stage, backers', async () => {
    const cards = { acme: { name: 'Acme', slug: 'acme', city: 'Sydney', sector: 'SaaS', stage: 'Series A', website: 'https://acme.com.au', logo: '/logos/acme.png', investors: ['Blackbird', 'Square Peg'] }, bare: { name: 'Bare', slug: 'bare', city: '', sector: '', stage: '', website: '' } };
    const jobs = [
      { ...role('a', 'acme-ashby-jobs'), company_id: 'acme', salary: { min: 120000, max: 160000, currency: 'AUD', period: 'year', text: '$120K – $160K' }, experience_level: 'Mid-Senior Level', workplace_type: 'Hybrid' },
      { ...role('b', 'bare-ashby-jobs'), company_id: 'bare', external_id: 'b', canonical_url: 'https://x.example/b', apply_url: 'https://x.example/b' },
    ];
    const board = buildBoard({ jobs, cardOf: (id) => cards[id] ?? null, now: NOW + 3600000 });
    const a = board.roles.find((r) => r.id === 'a');
    expect(a).toMatchObject({ salary: { min: 120000, max: 160000, currency: 'AUD', period: 'year' }, experience_level: 'Mid-Senior Level', vc_firms: ['Blackbird', 'Square Peg'], company: { stage: 'Series A', logo: '/logos/acme.png', sector: 'SaaS' } });
    const b = board.roles.find((r) => r.id === 'b');
    expect(b).toMatchObject({ salary: null, experience_level: null, vc_firms: [] });
  });
});

// ---------- more providers: Breezy, Pinpoint, BambooHR, Teamtailor, Rippling ----------

describe('reading the other public feeds', () => {
  const src = (provider, token = 'acme') => ({ id: `acme-${provider}-jobs`, company_id: 'acme', provider, token });
  const read = (provider, routes, token) => readSource(src(provider, token), { fetcher: make(routes).fetcher, now: NOW, companyWebsite: 'https://acme.com.au' });

  it('reads a Breezy board: where it is, how it is worked, the kind of job, its own posted date', async () => {
    const r = await read('breezy', { 'https://acme.breezy.hr/json': json([
      { id: 'b1', name: 'Customer Success Manager', url: 'https://acme.breezy.hr/p/b1-customer-success-manager', published_date: '2026-09-18T17:32:19.570Z', type: { id: 'fullTime', name: 'Full-Time' }, department: 'Success', location: { city: 'Sydney', state: { name: 'New South Wales' }, country: { name: 'Australia' }, is_remote: false } },
      { id: 'b2', name: 'Engineer', url: 'https://acme.breezy.hr/p/b2-engineer', published_date: '2026-09-19T00:00:00Z', location: { city: 'Denver', state: { name: 'Colorado' }, country: { name: 'United States' }, is_remote: true, remote_details: { value: 'remote', label: 'Fully remote' } } },
    ]) });
    expect([...r.seen]).toEqual(['b1', 'b2']);
    expect(r.postings[0]).toMatchObject({ title: 'Customer Success Manager', labels: ['Sydney, New South Wales, Australia'], employment: 'Full-time', team: 'Success', posted_at: '2026-09-18T17:32:19.570Z', apply_url: 'https://acme.breezy.hr/p/b1-customer-success-manager' });
    expect(r.postings[1]).toMatchObject({ workplaceType: 'remote', labels: ['Denver, Colorado, United States'] });
  });

  it('reads a Pinpoint board, with the pay only when the employer makes it visible, and no posted date (it states none)', async () => {
    const posting = (id, over = {}) => ({ id, title: `Role ${id}`, url: `https://acme.pinpointhq.com/en/postings/${id}`, workplace_type: 'hybrid', employment_type_text: 'Permanent - Full Time', location: { city: 'Sydney', name: 'Sydney', province: 'NSW' }, job: { department: { name: 'Production' } }, compensation_visible: false, ...over });
    const r = await read('pinpoint', { 'https://acme.pinpointhq.com/postings.json': json({ data: [posting('p1'), posting('p2', { compensation_visible: true, compensation_minimum: 90000, compensation_maximum: 110000, compensation_currency: 'AUD', compensation_frequency: 'year' })] }) });
    expect(r.postings[0]).toMatchObject({ labels: ['Sydney, NSW'], workplaceType: 'hybrid', employment: 'Permanent - Full Time', team: 'Production', posted_at: null, salary: null });
    expect(r.postings[1].salary).toMatchObject({ min: 90000, max: 110000, currency: 'AUD', period: 'year' });
  });

  it('does not read a Pinpoint board whose own robots.txt says no: each company decides, and it is refused for that one', async () => {
    const { fetcher } = make({ 'https://acme.pinpointhq.com/robots.txt': text('User-agent: *\nDisallow: /postings.json', 200), 'https://acme.pinpointhq.com/postings.json': json({ data: [] }) });
    await expect(readSource(src('pinpoint'), { fetcher, now: NOW, retries: 0 })).rejects.toMatchObject({ name: 'SyncError', code: 'refused' });
  });

  it('reads a BambooHR board, fails rather than return a short list, and builds the apply link on the company\'s own board', async () => {
    const opening = (id, over = {}) => ({ id, jobOpeningName: `Role ${id}`, departmentLabel: 'Engineering', employmentStatusLabel: 'Full-Time', location: { city: 'Sydney', state: 'New South Wales' }, atsLocation: { country: null }, isRemote: null, locationType: '2', ...over });
    const r = await read('bamboohr', { 'https://acme.bamboohr.com/careers/list': json({ meta: { totalCount: 2 }, result: [opening('1'), opening('2', { locationType: '1' })] }) });
    expect(r.postings.map((p) => [p.external_id, p.apply_url, p.workplaceType, p.employment])).toEqual([['1', 'https://acme.bamboohr.com/careers/1', 'hybrid', 'Full-time'], ['2', 'https://acme.bamboohr.com/careers/2', 'remote', 'Full-time']]);
    expect(r.postings[0].labels).toEqual(['Sydney, New South Wales']);
    await expect(read('bamboohr', { 'https://acme.bamboohr.com/careers/list': json({ meta: { totalCount: 3 }, result: [opening('1')] }) })).rejects.toMatchObject({ code: 'incomplete' });
  });

  it('reads a Teamtailor RSS feed: title, link, posted date, places, how it is worked, the department', async () => {
    const rss = '<?xml version="1.0"?><rss version="2.0" xmlns:tt="https://teamtailor.com/locations"><channel><title>Acme</title><item><title>Customer &amp; Success Manager</title><description><![CDATA[<p>x</p>]]></description><pubDate>Mon, 10 Nov 2025 18:39:41 +1100</pubDate><link>https://acme.teamtailor.com/jobs/1-csm</link><remoteStatus>hybrid</remoteStatus><guid>g-1</guid><tt:locations><tt:location><tt:name>Melbourne Head Office</tt:name><tt:city>Melbourne</tt:city><tt:country>Australia</tt:country></tt:location></tt:locations><tt:department>Customer Success</tt:department></item></channel></rss>';
    const xml = (body) => ({ status: 200, body, headers: { 'content-type': 'application/rss+xml' } });
    const r = await read('teamtailor', { 'https://acme.teamtailor.com/jobs.rss': xml(rss) });
    expect(r.postings).toEqual([expect.objectContaining({ external_id: 'g-1', title: 'Customer & Success Manager', apply_url: 'https://acme.teamtailor.com/jobs/1-csm', labels: ['Melbourne, Australia'], workplaceType: 'hybrid', team: 'Customer Success', posted_at: '2025-11-10T07:39:41.000Z' })]);
    const empty = await read('teamtailor', { 'https://acme.teamtailor.com/jobs.rss': xml('<?xml version="1.0"?><rss version="2.0"><channel><title>Acme</title></channel></rss>') });
    expect(empty.postings).toEqual([]); // an empty board is a whole read: the sync's own empty-board rule decides what to believe
    await expect(read('teamtailor', { 'https://acme.teamtailor.com/jobs.rss': xml('<html>no</html>') })).rejects.toMatchObject({ code: 'malformed' });
  });

  it('reads a Rippling board from its public API', async () => {
    const r = await read('rippling', { 'https://api.rippling.com/platform/api/ats/v1/board/acme/jobs': json([{ uuid: 'u-1', name: 'Principal Engineer', department: { label: 'Engineering' }, url: 'https://ats.rippling.com/acme/jobs/u-1', workLocation: { label: 'Sydney, Australia' } }, { uuid: 'u-2', name: 'Designer', department: { label: 'Design' }, url: 'https://ats.rippling.com/acme/jobs/u-2', workLocation: { label: 'Remote (Seattle, Washington, US)' } }]) });
    expect(r.postings.map((p) => [p.title, p.labels, p.workplaceType, p.team])).toEqual([['Principal Engineer', ['Sydney, Australia'], null, 'Engineering'], ['Designer', ['Remote (Seattle, Washington, US)'], 'remote', 'Design']]);
  });
});

describe('finding a board on one of those providers from the company\'s own page', () => {
  it('finds a BambooHR board, ignores the vendor\'s own marketing link, and approves it only after the feed answers', async () => {
    const { w, fetcher } = make({
      'https://acme.com.au/': html(HOME), 'https://acme.com.au/careers': html('<a href="https://acme.bamboohr.com/careers">Open roles</a><a href="https://www.bamboohr.com/">Powered by BambooHR</a>'),
      'https://acme.bamboohr.com/careers/list': json({ meta: { totalCount: 1 }, result: [{ id: '7', jobOpeningName: 'Engineer', departmentLabel: 'Eng', employmentStatusLabel: 'Full-Time', location: { city: 'Sydney', state: 'New South Wales' }, locationType: '0' }] }),
    });
    const r = await discoverCompany(acme, { fetcher, now: () => NOW });
    expect(r).toMatchObject({ outcome: 'board', review: false });
    expect(r.verified).toEqual([expect.objectContaining({ provider: 'bamboohr', token: 'acme', listed: 1 })]);
    expect(r.boards.some((b) => b.supported === false)).toBe(false);
    expect(w.pages().some((u) => u.includes('www.bamboohr.com'))).toBe(false);
  });

  it('finds a Rippling board by the path its link names, skipping the language prefix, and a Teamtailor board by its subdomain, never the app\'s dashboard link', async () => {
    const rip = make({ 'https://acme.com.au/': html(HOME), 'https://acme.com.au/careers': html('<a href="https://ats.rippling.com/en-GB/acmecareers/jobs">Jobs</a>'), 'https://api.rippling.com/platform/api/ats/v1/board/acmecareers/jobs': json([]) });
    expect((await discoverCompany(acme, { fetcher: rip.fetcher, now: () => NOW })).verified[0]).toMatchObject({ provider: 'rippling', token: 'acmecareers' });
    const tt = make({ 'https://acme.com.au/': html(HOME), 'https://acme.com.au/careers': html('<a href="https://app.teamtailor.com/companies/x@au/dashboard">Jobs</a><a href="https://acme-123.teamtailor.com/jobs">Jobs</a>'), 'https://acme-123.teamtailor.com/jobs.rss': { status: 200, body: '<rss version="2.0"><channel><title>A</title></channel></rss>', headers: { 'content-type': 'application/rss+xml' } } });
    const r = await discoverCompany(acme, { fetcher: tt.fetcher, now: () => NOW });
    expect(r.verified.map((v) => v.token)).toEqual(['acme-123']);
  });
});

// ---------- the weekly look at companies without a feed ----------

describe('a company without a feed is looked at once a week, by rotation, and a company with one is not looked at again', () => {
  const companies = Array.from({ length: 200 }, (_, i) => ({ id: `co-${i}`, name: `Co ${i}`, website: `https://co${i}.example` }));
  const looked = (ids, at = '2026-10-01T00:00:00.000Z') => ids.map((id) => ({ company_id: id, checked_at: at, outcome: 'no_careers_found', review: true, boards: [], source_ids: [] }));
  const open = () => false;
  const T0 = Date.parse('2026-11-03T00:00:00Z');
  // The first instant at or after T0 that is in this company's own half-day block.
  const inBlock = (id) => T0 + ((rotationBucket(id) - (blockOf(T0) % 14) + 14) % 14) * BLOCK_MS;

  it('takes every such company exactly once in the fourteen half-day blocks of a week, whatever day it starts', () => {
    const ds = { companies, job_coverage: looked(companies.map((c) => c.id)), job_sources: [], job_sync_state: [] };
    const times = new Map();
    for (let b = 0; b < 14; b += 1) for (const c of dueForDiscovery(ds, { now: T0 + b * BLOCK_MS, limit: 1000, isInactive: open }).planned) times.set(c.id, (times.get(c.id) ?? 0) + 1);
    expect(times.size).toBe(200);
    expect([...times.values()].every((n) => n === 1)).toBe(true);
    // a block's share is a fraction of the week, so a refresh's requests are a fraction of the week's
    expect(dueForDiscovery(ds, { now: T0, limit: 1000, isInactive: open }).due).toBeLessThan(40);
  });

  it('looks at a company never looked at at once, never again at one with a working board, and again at one whose board has failed three times', () => {
    const ds = {
      companies: [{ id: 'new' }, { id: 'boarded' }, { id: 'broken' }, { id: 'closed' }],
      job_coverage: looked(['boarded', 'broken', 'closed']),
      job_sources: [{ id: 'boarded-lever-jobs', company_id: 'boarded', provider: 'lever', status: 'approved' }, { id: 'broken-lever-jobs', company_id: 'broken', provider: 'lever', status: 'approved' }],
      job_sync_state: [{ source_id: 'boarded-lever-jobs', consecutive_failures: 0 }, { source_id: 'broken-lever-jobs', consecutive_failures: 3 }],
    };
    const planned = (now) => dueForDiscovery(ds, { now, limit: 10, isInactive: (c) => c.id === 'closed' }).planned.map((c) => c.id);
    expect(planned(inBlock('boarded'))).toContain('new');
    expect(planned(inBlock('boarded'))).not.toContain('boarded');
    expect(planned(inBlock('broken'))).toContain('broken');
    expect(planned(inBlock('closed'))).not.toContain('closed');
  });

  it('asks nothing of a company looked at in the last six hours, even in its own block', () => {
    const now = inBlock('x');
    const ds = (at) => ({ companies: [{ id: 'x' }], job_coverage: looked(['x'], new Date(at).toISOString()), job_sources: [], job_sync_state: [] });
    expect(dueForDiscovery(ds(now - 3600000), { now, limit: 5, isInactive: open }).due).toBe(0);
    expect(dueForDiscovery(ds(now - 7 * 86400000), { now, limit: 5, isInactive: open }).due).toBe(1);
  });
});
