import { describe, it, expect, afterEach } from 'vitest';
import { detectBoards, fetchBoard, readBoards, PROVIDERS } from '../src/enrichment/boards.js';
import { readSite } from '../src/discovery/enrich.js';
import { analyzeCompanySite } from '../src/enrichment/analyze.js';
import { applyCompanyEnrichment } from '../src/enrichment/apply.js';
import { runQueue } from '../src/enrichment/worker.js';
import { transact } from '../src/models/store.js';
import { seedFromAudit } from '../src/models/enrichmentQueue.js';
import { auditDataset } from '../src/models/audit.js';
import { migrateDataset, validateDataset } from '../src/models/dataset.js';
import { createFetcher } from '../src/discovery/http.js';
import { NOW, dataset, co } from './helpers/discovery.js';
import { makeDataDir, readDataDir, removeMadeDirs } from './helpers/store.js';

afterEach(removeMadeDirs);
const json = (v) => ({ body: JSON.stringify(v), headers: { 'content-type': 'application/json' } });
const html = (body, title = 'Acme') => ({ body: `<html><head><title>${title}</title><meta property="og:site_name" content="Acme Robotics"></head><body>${body}</body></html>`, headers: { 'content-type': 'text/html' } });
function web(routes) {
  const calls = [];
  const fetchImpl = async (u) => {
    calls.push(u);
    const hit = routes[u];
    if (hit instanceof Error) throw hit;
    return hit ? new Response(hit.body ?? '', { status: hit.status ?? 200, headers: hit.headers }) : new Response('nope', { status: 404, headers: { 'content-type': 'text/html' } });
  };
  return { calls, fetcher: createFetcher({ fetchImpl, resolveHost: async () => ['93.184.216.34'], sleep: async () => {}, now: () => NOW }) };
}
const page = (path, h) => ({ finalUrl: `https://acme.com.au${path}`, html: h });
const ids = (pages) => detectBoards(pages).map((b) => `${b.provider.id}:${b.token}`);

describe('which job board a company\'s own pages point at', () => {
  it('finds each provider\'s board from a link on the careers page, the way its embeds and links spell it', () => {
    expect(ids([page('/careers', '<a href="https://jobs.lever.co/acme-robotics">Open roles</a>')])).toEqual(['lever:acme-robotics']);
    expect(ids([page('/careers', '<script src="https://boards.greenhouse.io/embed/job_board/js?for=acmerobotics"></script>')])).toEqual(['greenhouse:acmerobotics']);
    expect(ids([page('/jobs', '<iframe src="https://boards.greenhouse.io/embed/job_board?for=acme"></iframe>')])).toEqual(['greenhouse:acme']);
    expect(ids([page('/careers', '<a href="https://job-boards.greenhouse.io/acme">x</a>')])).toEqual(['greenhouse:acme']);
    expect(ids([page('/careers', '<a href="https://jobs.ashbyhq.com/Acme.Robotics">x</a>')])).toEqual(['ashby:Acme.Robotics']);
    expect(ids([page('/careers', '<a href="https://apply.workable.com/acme/">x</a>')])).toEqual(['workable:acme']);
    expect(ids([page('/careers', '<a href="https://acme.recruitee.com/">x</a>')])).toEqual(['recruitee:acme']);
    expect(ids([page('/careers', '<a href="https://careers.smartrecruiters.com/AcmeRobotics">x</a>')])).toEqual(['smartrecruiters:AcmeRobotics']);
  });

  it('takes a link from the homepage only when it is a careers link, not any link to a job board', () => {
    expect(ids([page('/', '<a href="https://jobs.lever.co/acme">Careers</a>')])).toEqual(['lever:acme']);
    expect(ids([page('/', '<a href="https://jobs.lever.co/some-partner">Our portfolio company is hiring</a> <a href="https://jobs.lever.co/another">Blog post</a>')])).toEqual([]);
    expect(ids([page('/about', '<p>See https://jobs.lever.co/acme</p>')])).toEqual([]); // plain text on another page is not a link to the board
  });

  it('takes at most two boards, each once, and not a word that is no board name', () => {
    const many = ['a1', 'a2', 'a3'].map((t) => `<a href="https://jobs.lever.co/${t}">x</a>`).join('') + '<a href="https://jobs.lever.co/a1">again</a>';
    expect(ids([page('/careers', many)])).toEqual(['lever:a1', 'lever:a2']);
    expect(ids([page('/careers', '<a href="https://boards.greenhouse.io/embed">x</a> <a href="https://www.recruitee.com/">y</a> <a href="https://careers.recruitee.com/">z</a>')])).toEqual([]);
  });
});

describe('reading a board\'s feed', () => {
  const board = (id, token) => ({ provider: PROVIDERS.find((p) => p.id === id), token });
  const read = async (id, token, routes) => fetchBoard(board(id, token), { fetcher: web(routes).fetcher, now: () => NOW });

  it('reads Greenhouse: the title, place and apply link', async () => {
    const r = await read('greenhouse', 'acme', { 'https://boards-api.greenhouse.io/v1/boards/acme/jobs': json({ jobs: [{ title: 'Robotics Engineer', location: { name: 'Sydney, Australia' }, absolute_url: 'https://boards.greenhouse.io/acme/jobs/1', updated_at: '2026-10-01T00:00:00Z' }, { title: 'Remote Designer', location: { name: 'Remote - APAC' }, absolute_url: 'https://boards.greenhouse.io/acme/jobs/2' }] }) });
    expect(r).toMatchObject({ provider: 'greenhouse', page_url: 'https://boards.greenhouse.io/acme', retrieved_at: new Date(NOW).toISOString() });
    expect(r.jobs).toEqual([
      { title: 'Robotics Engineer', location: 'Sydney, Australia', employment_type: null, remote: null, posted_at: null, apply_url: 'https://boards.greenhouse.io/acme/jobs/1' },
      { title: 'Remote Designer', location: 'Remote - APAC', employment_type: null, remote: true, posted_at: null, apply_url: 'https://boards.greenhouse.io/acme/jobs/2' },
    ]);
  });

  it('reads Lever, with the date it was created', async () => {
    const r = await read('lever', 'acme', { 'https://api.lever.co/v0/postings/acme?mode=json': json([{ text: 'Account Executive', hostedUrl: 'https://jobs.lever.co/acme/1', createdAt: Date.parse('2026-09-20T00:00:00Z'), categories: { location: 'Melbourne', commitment: 'Full-time' }, workplaceType: 'hybrid' }]) });
    expect(r.jobs).toEqual([{ title: 'Account Executive', location: 'Melbourne', employment_type: 'Full-time', remote: null, posted_at: '2026-09-20', apply_url: 'https://jobs.lever.co/acme/1' }]);
  });

  it('reads Ashby, leaving out a posting that is not listed', async () => {
    const r = await read('ashby', 'acme', { 'https://api.ashbyhq.com/posting-api/job-board/acme': json({ jobs: [{ title: 'Staff Engineer', location: 'Brisbane', employmentType: 'FullTime', isRemote: true, publishedAt: '2026-09-01T00:00:00Z', jobUrl: 'https://jobs.ashbyhq.com/acme/1' }, { title: 'Hidden', isListed: false }] }) });
    expect(r.jobs).toEqual([{ title: 'Staff Engineer', location: 'Brisbane', employment_type: 'FullTime', remote: true, posted_at: '2026-09-01', apply_url: 'https://jobs.ashbyhq.com/acme/1' }]);
  });

  it('reads Workable, Recruitee and SmartRecruiters', async () => {
    const w = await read('workable', 'acme', { 'https://apply.workable.com/api/v1/widget/accounts/acme': json({ jobs: [{ title: 'Support', city: 'Perth', state: 'WA', country: 'Australia', employment_type: 'Full-time', telecommuting: false, published_on: '2026-09-02', url: 'https://apply.workable.com/acme/j/1/' }] }) });
    expect(w.jobs[0]).toMatchObject({ title: 'Support', location: 'Perth, WA, Australia', posted_at: '2026-09-02', apply_url: 'https://apply.workable.com/acme/j/1/' });
    const r = await read('recruitee', 'acme', { 'https://acme.recruitee.com/api/offers/': json({ offers: [{ title: 'Data Analyst', location: 'Sydney', status: 'published', careers_url: 'https://acme.recruitee.com/o/data-analyst' }, { title: 'Closed', status: 'archived' }] }) });
    expect(r.jobs.map((j) => j.title)).toEqual(['Data Analyst']);
    const s = await read('smartrecruiters', 'AcmeRobotics', { 'https://api.smartrecruiters.com/v1/companies/AcmeRobotics/postings': json({ content: [{ id: '123', name: 'Sales', location: { city: 'Sydney', region: 'NSW', country: 'au' }, releasedDate: '2026-09-03T00:00:00Z' }] }) });
    expect(s.jobs[0]).toMatchObject({ title: 'Sales', location: 'Sydney, NSW, au', apply_url: 'https://jobs.smartrecruiters.com/AcmeRobotics/123' });
  });

  it('keeps at most 30 postings, and skips one with no title', async () => {
    const jobs = [...Array.from({ length: 40 }, (_, i) => ({ text: `Role ${i}`, hostedUrl: `https://jobs.lever.co/acme/${i}` })), { hostedUrl: 'https://jobs.lever.co/acme/x' }];
    const r = await read('lever', 'acme', { 'https://api.lever.co/v0/postings/acme?mode=json': json(jobs) });
    expect(r.jobs).toHaveLength(30);
  });

  it('reports a feed that is gone, refused or not JSON, instead of throwing', async () => {
    expect((await read('lever', 'nope', {})).error).toMatchObject({ code: 'http_error', url: 'https://api.lever.co/v0/postings/nope?mode=json' });
    expect((await read('lever', 'acme', { 'https://api.lever.co/v0/postings/acme?mode=json': { status: 403, body: 'no', headers: { 'content-type': 'application/json' } } })).error.code).toBe('access_controlled');
    expect((await read('lever', 'acme', { 'https://api.lever.co/v0/postings/acme?mode=json': { body: '<html>', headers: { 'content-type': 'application/json' } } })).error.code).toBe('bad_feed');
  });

  it('obeys robots.txt on the feed\'s own host, like every other read', async () => {
    const { fetcher, calls } = web({ 'https://api.lever.co/robots.txt': { body: 'User-agent: *\nDisallow: /\n', headers: { 'content-type': 'text/plain' } } });
    const r = await fetchBoard(board('lever', 'acme'), { fetcher, now: () => NOW });
    expect(r.error.code).toBe('robots_disallow');
    expect(calls).toEqual(['https://api.lever.co/robots.txt']);
  });
});

describe('open roles as evidence about a company', () => {
  const ROUTES = {
    'https://acme.com.au/': html('<a href="/careers">Careers</a><a href="/about">About</a>', 'Acme Robotics | Home'),
    'https://acme.com.au/careers': html('<p>Join us</p><a href="https://jobs.lever.co/acme-robotics">See roles</a>', 'Careers'),
    'https://api.lever.co/v0/postings/acme-robotics?mode=json': json([{ text: 'Robotics Engineer', hostedUrl: 'https://jobs.lever.co/acme-robotics/1', createdAt: Date.parse('2026-09-20T00:00:00Z'), categories: { location: 'Sydney', commitment: 'Full-time' } }]),
  };
  const base = () => dataset([co('Acme Robotics', { website: 'https://acme.com.au', hiring: false })]);
  async function analyse(routes = ROUTES) {
    const { fetcher } = web(routes);
    const site = await readSite('https://acme.com.au', { fetcher, now: () => NOW, maxPages: 4, wanted: ['hiring_status', 'jobs'] });
    const { boards, errors } = await readBoards(site, { fetcher, now: () => NOW });
    return analyzeCompanySite({ ...site, boards, board_errors: errors }, { names: ['Acme Robotics'], knownInvestors: [], website: 'https://acme.com.au', now: () => NOW });
  }

  it('says the company is hiring, from the board its careers page links to, and records the roles', async () => {
    const a = await analyse();
    expect(a.jobs).toEqual([expect.objectContaining({ title: 'Robotics Engineer', location: 'Sydney', employment_type: 'Full-time', posted_at: '2026-09-20', apply_url: 'https://jobs.lever.co/acme-robotics/1' })]);
    const hiring = a.evidence.find((e) => e.field === 'hiring_status');
    expect(hiring).toMatchObject({ value: 'hiring', confidence: 'high', verified_at: new Date(NOW).toISOString(), source: { url: 'https://jobs.lever.co/acme-robotics', title: 'Lever job board', kind: 'company_website' } });
    expect(hiring.note).toMatch(/1 open role on the company's Lever job board, which its careers page links to, such as "Robotics Engineer"/);
    expect(a.pages.map((p) => p.url)).toContain('https://jobs.lever.co/acme-robotics');
  });

  it('is stored with a source that reads as what it is, and the roles close when they leave the board', async () => {
    const work = structuredClone(base());
    const T = new Date(NOW).toISOString();
    const first = applyCompanyEnrichment(work, { companyId: 'acme-robotics', analysis: await analyse(), at: T, mode: 'fill' });
    expect(first).toMatchObject({ jobs: { added: 1, updated: 0, closed: 0 }, applied: [{ field: 'hiring_status', value: 'hiring' }] });
    expect(work.companies[0]).toMatchObject({ hiring: true, hiring_status: 'hiring' });
    expect(work.sources.find((s) => s.url === 'https://jobs.lever.co/acme-robotics')).toMatchObject({ id: 'acme-robotics-lever-jobs', kind: 'company_website' });
    expect(validateDataset(migrateDataset(work))).toEqual([]);
    const empty = await analyse({ ...ROUTES, 'https://api.lever.co/v0/postings/acme-robotics?mode=json': json([]) });
    expect(applyCompanyEnrichment(work, { companyId: 'acme-robotics', analysis: empty, at: T, mode: 'fill' }).jobs).toEqual({ added: 0, updated: 0, closed: 1 });
    expect(work.jobs[0].status).toBe('closed');
  });

  it('notes a board it could not read, and records nothing from it', async () => {
    const a = await analyse({ ...ROUTES, 'https://api.lever.co/v0/postings/acme-robotics?mode=json': { status: 403, body: 'no', headers: { 'content-type': 'application/json' } } });
    expect(a.jobs).toEqual([]);
    expect(a.evidence.find((e) => e.field === 'hiring_status')).toBeUndefined();
    expect(a.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'access_controlled', url: 'https://api.lever.co/v0/postings/acme-robotics?mode=json' })]));
  });

  it('is read by the worker only when the task wants hiring or jobs', async () => {
    const run = async (wanted) => {
      const dir = await makeDataDir(base());
      const now = () => NOW;
      await transact(dir, (work, { at }) => { seedFromAudit(work, auditDataset(work, { asOf: '2026-10-05' }), { at, by: 'aryan' }); work.enrichment_queue[0].wanted = wanted; }, { now });
      const { fetcher, calls } = web(ROUTES);
      await runQueue({ dir, fetcher, now, concurrency: 1, mode: 'fill' });
      return { calls, ds: await readDataDir(dir) };
    };
    const wanted = await run(['hiring_status', 'jobs']);
    expect(wanted.calls).toContain('https://api.lever.co/v0/postings/acme-robotics?mode=json');
    expect(wanted.ds.jobs).toHaveLength(1);
    expect(wanted.ds.companies[0]).toMatchObject({ hiring: true, hiring_status: 'hiring' });
    const unwanted = await run(['description']);
    expect(unwanted.calls).not.toContain('https://api.lever.co/v0/postings/acme-robotics?mode=json');
    expect(unwanted.ds.jobs).toEqual([]);
  });
});
