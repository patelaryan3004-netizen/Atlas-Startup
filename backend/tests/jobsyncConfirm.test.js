// A venture firm's job board names a company's job board; the EMPLOYER confirms it, or it stays in review.
import { describe, it, expect, afterEach } from 'vitest';
import { createFetcher } from '../src/discovery/http.js';
import { confirmOne, confirmReviewBoards, confirmFromFile, identity } from '../src/jobsync/confirm.js';
import { tick } from '../src/scheduler/scheduler.js';
import request from 'supertest';
import { createNetwork } from '../src/network/index.js';
import { createApp } from '../src/app.js';
import { fixture } from './helpers/catalog.js';
import { makeDataDir, readDataDir, removeMadeDirs } from './helpers/store.js';
import { dataset, co, NOW, ISO, scriptedWeb } from './helpers/scheduler.js';

afterEach(removeMadeDirs);

const json = (body, status = 200) => ({ status, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const html = (body) => ({ status: 200, body, headers: { 'content-type': 'text/html' } });
const PUBLIC = async () => ['93.184.216.34'];
const LEVER_FEED = 'https://api.lever.co/v0/postings/acme?mode=json&limit=50&skip=0';
const leverJob = (n) => ({ id: `id-${n}`, text: `Role ${n}`, hostedUrl: `https://jobs.lever.co/acme/id-${n}`, createdAt: Date.parse('2026-08-04T00:00:00Z'), workplaceType: 'hybrid', categories: { location: 'Sydney, NSW, Australia', commitment: 'Full-time', team: 'Eng' } });
const acme = { id: 'acme-robotics', name: 'Acme Robotics', website: 'https://acme.com.au' };
const review = (over = {}) => ({ id: 'acme-robotics-lever-review', company_id: 'acme-robotics', provider: 'lever', token: 'acme', board_url: 'https://jobs.lever.co/acme', status: 'review', basis: 'named by a venture board', note: '', added_at: ISO, sighted: [{ firm: 'blackbird', url: 'https://jobs.lever.co/acme/id-1?lever-source=getro', title: 'Role 1' }], ...over });
const make = (routes) => { const w = scriptedWeb(routes); return { w, fetcher: createFetcher({ fetchImpl: w.fetchImpl, resolveHost: PUBLIC, sleep: async () => {}, now: () => NOW }) }; };

describe('confirming a named board through the employer', () => {
  it('approves it when the employer\'s own feed lists the job the venture board showed and the board is the company\'s', async () => {
    const { fetcher } = make({ [LEVER_FEED]: json([leverJob(1), leverJob(2)]) });
    const r = await confirmOne(review(), acme, { fetcher, now: () => NOW });
    expect(r).toMatchObject({ ok: true, firm: 'blackbird' });
    expect(r.hit).toMatchObject({ external_id: 'id-1', apply_url: 'https://jobs.lever.co/acme/id-1' });
    expect(r.why).toMatch(/is the company's name/);
  });

  it('keeps it in review, with the reason, when the employer does not list that job (it may have closed)', async () => {
    const { fetcher } = make({ [LEVER_FEED]: json([leverJob(2)]) });
    const r = await confirmOne(review(), acme, { fetcher, now: () => NOW });
    expect(r.ok).toBe(false);
    expect(r.note).toMatch(/does not list the job the venture board showed \("Role 1"\)/);
  });

  it('keeps it in review when the feed does not answer, and when the provider is one the sync does not read', async () => {
    const down = make({ [LEVER_FEED]: { status: 404, body: 'no', headers: { 'content-type': 'text/plain' } } });
    expect((await confirmOne(review(), acme, { fetcher: down.fetcher, now: () => NOW })).note).toMatch(/did not answer \(gone\)/);
    expect((await confirmOne(review({ provider: 'smartrecruiters' }), acme, { fetcher: down.fetcher, now: () => NOW })).note).toMatch(/not read by the sync/);
  });

  it('does not take a board for the company\'s when its name is somebody else\'s, even if it lists the job', async () => {
    const { fetcher } = make({ 'https://api.lever.co/v0/postings/zzz?mode=json&limit=50&skip=0': json([{ ...leverJob(1), hostedUrl: 'https://jobs.lever.co/zzz/id-1' }]), 'https://acme.com.au/': html('<p>Acme</p>') });
    const r = await confirmOne(review({ token: 'zzz', sighted: [{ firm: 'blackbird', url: 'https://jobs.lever.co/zzz/id-1', title: 'Role 1' }] }), acme, { fetcher, now: () => NOW });
    expect(r.ok).toBe(false);
    expect(r.note).toMatch(/lists the job, but the board's name "zzz" is not the company's name and not its website's/);
  });

  it('knows a company that has moved to a new name and domain: its website answers from the host the board is named for', async () => {
    const w = scriptedWeb({ 'https://safetyculture.com/': { status: 301, body: '', headers: { location: 'https://mitti.com/', 'content-type': 'text/html' } }, 'https://mitti.com/': html('<p>Mitti</p>') });
    const fetcher = createFetcher({ fetchImpl: w.fetchImpl, resolveHost: PUBLIC, sleep: async () => {}, now: () => NOW });
    expect(await identity({ id: 'safetyculture', name: 'SafetyCulture', website: 'https://safetyculture.com' }, 'mitti', { fetcher, now: () => NOW })).toMatchObject({ ok: true, why: expect.stringMatching(/company's own website \(mitti\.com\)/) });
    expect((await identity({ id: 'safetyculture', name: 'SafetyCulture', website: 'https://safetyculture.com' }, 'other', { fetcher, now: () => NOW })).ok).toBe(false);
    expect((await identity(acme, 'ab', { fetcher, now: () => NOW })).ok).toBe(false); // too short to say whose it is
  });

  it('writes the approval and the first read in one step: a sources row, an approved catalogue row that says how it was confirmed, the roles, the board\'s state; asks again only after a week', async () => {
    const dir = await makeDataDir(dataset([co('Acme Robotics', { website: 'https://acme.com.au' })], { job_sources: [review()] }));
    const { w, fetcher } = make({ [LEVER_FEED]: json([leverJob(1), leverJob(2)]) });
    const stats = await confirmReviewBoards({ dir, fetcher, now: () => NOW });
    expect(stats).toMatchObject({ due: 1, checked: 1, approved: [{ id: 'acme-robotics-lever-jobs', roles_added: 2 }] });
    const ds = await readDataDir(dir);
    expect(ds.sources.find((s) => s.id === 'acme-robotics-lever-jobs')).toMatchObject({ kind: 'aggregator', url: 'https://jobs.lever.co/acme' });
    expect(ds.job_sources).toEqual([expect.objectContaining({ id: 'acme-robotics-lever-jobs', status: 'approved', basis: expect.stringMatching(/Confirmed through the employer on 2026-10-05: blackbird's job board showed "Role 1"/) })]);
    expect(ds.jobs.filter((j) => j.status === 'open').map((j) => j.apply_url).sort()).toEqual(['https://jobs.lever.co/acme/id-1', 'https://jobs.lever.co/acme/id-2']); // the employer's own links
    expect(ds.job_sync_state).toEqual([expect.objectContaining({ source_id: 'acme-robotics-lever-jobs', last_success_at: ISO })]);
    const calls = w.calls.length;
    expect((await confirmReviewBoards({ dir, fetcher, now: () => NOW })).due).toBe(0); // no review row is left
    expect(w.calls.length).toBe(calls);
  });

  it('leaves a board in review with the date and reason, and does not ask again for a week', async () => {
    const dir = await makeDataDir(dataset([co('Acme Robotics', { website: 'https://acme.com.au' })], { job_sources: [review()] }));
    const { w, fetcher } = make({ [LEVER_FEED]: json([leverJob(2)]) });
    await confirmReviewBoards({ dir, fetcher, now: () => NOW });
    const row = (await readDataDir(dir)).job_sources[0];
    expect(row).toMatchObject({ status: 'review', checked_at: ISO, note: expect.stringMatching(/^2026-10-05: The employer's own feed/) });
    const calls = w.calls.length;
    await confirmReviewBoards({ dir, fetcher, now: () => NOW + 3 * 86400000 });
    expect(w.calls.length).toBe(calls);
    await confirmReviewBoards({ dir, fetcher, now: () => NOW + 8 * 86400000 });
    expect(w.calls.length).toBeGreaterThan(calls);
  });
});

describe('from a venture firm\'s board, through the employer, to the hiring desk', () => {
  it('names the company on a Getro board, confirms the job in the employer\'s own feed, and publishes it with the employer\'s link: in one refresh', async () => {
    const dir = await makeDataDir(dataset([co('Acme Robotics', { website: 'https://acme.com.au', city: 'Sydney' })]));
    const board = { props: { pageProps: { network: { slug: 'blackbird' }, initialState: { jobs: { total: 1, found: [{ organization: { name: 'Acme Robotics' }, title: 'Role 1', locations: ['Sydney, NSW, Australia'], url: 'https://jobs.lever.co/acme/id-1', workMode: 'hybrid' }] } } } } };
    const getro = html(`<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(board)}</script></body></html>`);
    const w = scriptedWeb((u) => {
      if (u === 'https://blackbird.vc/') return html('<a href="https://jobs.blackbird.vc/jobs">Startup Jobs</a>');
      if (u === 'https://jobs.blackbird.vc/jobs') return getro;
      if (u === LEVER_FEED) return json([leverJob(1), leverJob(2)]);
      return undefined;
    });
    const fetcher = createFetcher({ fetchImpl: w.fetchImpl, resolveHost: PUBLIC, sleep: async () => {}, now: () => NOW });
    const result = await tick({ dir, now: () => NOW, fetcher, sources: [], by: 'tester', jobs: ['jobsync'], trigger: 'ci', limits: { slot: '2026-10-05 AM' } });
    expect(['ok', 'partial']).toContain(result.status);
    const ds = await readDataDir(dir);
    expect(ds.job_vc_boards.find((r) => r.id === 'blackbird')).toMatchObject({ platform: 'getro', access: 'public_sample' });
    expect(ds.job_sources).toEqual([expect.objectContaining({ id: 'acme-robotics-lever-jobs', status: 'approved' })]); // the review row became an approved board
    expect(ds.jobs.filter((j) => j.status === 'open').map((j) => [j.external_id, j.apply_url])).toEqual([['id-1', 'https://jobs.lever.co/acme/id-1'], ['id-2', 'https://jobs.lever.co/acme/id-2']]);
    expect(ds.job_health.at(-1)).toMatchObject({ boards_ok: 1, new_roles: 2, open_roles: 2 });
    expect(result.runs.find((x) => x.job === 'jobsync').summary).toMatch(/1 venture-named board\(s\) confirmed through the employer/);
  });
});

describe('a venture firm\'s own vacancies', () => {
  const RIPPLING = 'https://api.rippling.com/platform/api/ats/v1/board/investible/jobs';
  const firmRoutes = (jobs) => scriptedWeb((u) => {
    if (u === 'https://investible.com/') return html('<a href="/team/">Careers</a>');
    if (u === 'https://investible.com/team/') return html('<a href="https://ats.rippling.com/investible/jobs/u-1">Apply now</a><a href="https://ats.rippling.com/portfoliocorp/jobs/z-9">A portfolio company is hiring</a>');
    if (u === RIPPLING) return json(jobs);
    return undefined;
  });
  const jobs = [
    { uuid: 'u-1', name: 'General Counsel (part-time)', department: { label: 'Legal' }, url: 'https://ats.rippling.com/investible/jobs/u-1', workLocation: { label: 'Melbourne, Australia' } },
    { uuid: 'u-2', name: 'Associate', department: { label: 'Investing' }, url: 'https://ats.rippling.com/investible/jobs/u-2', workLocation: { label: 'Singapore, Singapore' } },
  ];

  it('reads the firm\'s own board when its own careers page links to it and the board is named for the firm, publishes the Australian role with the firm as the employer, and leaves a portfolio company\'s board alone', async () => {
    const dir = await makeDataDir(dataset([co('Acme Robotics', { website: 'https://acme.com.au' })], { investors: [{ id: 'investible', name: 'Investible', slug: 'investible', website: 'https://www.investible.com/' }] }));
    const w = firmRoutes(jobs);
    const fetcher = createFetcher({ fetchImpl: w.fetchImpl, resolveHost: PUBLIC, sleep: async () => {}, now: () => NOW });
    const result = await tick({ dir, now: () => NOW, fetcher, sources: [], by: 'tester', jobs: ['jobsync'], trigger: 'ci', limits: { slot: '2026-10-05 AM' } });
    expect(['ok', 'partial']).toContain(result.status);
    const ds = await readDataDir(dir);
    expect(ds.job_sources.map((s) => [s.id, s.company_id, s.status])).toEqual([['vc-investible-rippling-jobs', 'vc-investible', 'approved']]);
    expect(ds.sources.find((s) => s.id === 'vc-investible-rippling-jobs')).toMatchObject({ kind: 'investor_website', url: 'https://ats.rippling.com/investible/jobs' });
    expect(ds.jobs.map((j) => [j.company_id, j.title, j.status])).toEqual([['vc-investible', 'General Counsel (part-time)', 'open']]); // the Singapore role is not in Australia; the portfolio board is not the firm's
    expect(ds.job_vc_boards.find((r) => r.id === 'investible').own_vacancies).toMatch(/links to its own Rippling board \(investible\) lists 2 roles: read as Investible's own vacancies.*1 other board/);
    expect(w.calls).not.toContain('https://api.rippling.com/platform/api/ats/v1/board/portfoliocorp/jobs');
    expect(ds.job_health.at(-1)).toMatchObject({ open_roles: 1, new_roles: 1 });
  });

  it('shows it on the desk as the firm\'s: its own page, the investor directory in why it is listed, the employer\'s own apply link', async () => {
    const f = await fixture(3);
    const rows = [{ id: 'vc-investible-rippling-u-1', company_id: 'vc-investible', title: 'General Counsel (part-time)', location: 'Melbourne, Australia', locations: ['Melbourne, Australia'], employment_type: null, remote: null, posted_at: null, apply_url: 'https://ats.rippling.com/investible/jobs/u-1', status: 'open', source_id: 'vc-investible-rippling-jobs', retrieved_at: new Date(NOW).toISOString(), provider: 'rippling', external_id: 'u-1', canonical_url: 'https://ats.rippling.com/investible/jobs/u-1', first_seen_at: new Date(NOW).toISOString(), last_confirmed_at: new Date(NOW).toISOString(), absent_reads: 0 }];
    const board = async (verification_status) => {
      const network = createNetwork({ memory: true, now: () => NOW, curatedEvents: [], curatedJobsRows: rows, curatedJobSync: { sources: [], state: [] }, curatedInvestors: [{ id: 'investible', name: 'Investible', slug: 'investible', website: 'https://www.investible.com/', headquarters_city: 'Melbourne', verification_status }], limits: { signups: 1000, logins: 8 } });
      return (await request(createApp({ catalog: f.catalog, network })).get('/api/jobs/board').expect(200)).body;
    };
    const published = await board('published');
    expect(published.roles).toEqual([expect.objectContaining({ title: 'General Counsel (part-time)', apply_url: 'https://ats.rippling.com/investible/jobs/u-1', provider_name: 'Rippling', company: expect.objectContaining({ name: 'Investible', slug: 'investible', kind: 'investor', sector: 'Venture capital' }), why_listed: expect.stringMatching(/Investible is in the Still Early investor directory\./) })]);
    // A firm a person has not published has no page: it is named, never linked, and not said to be in the directory.
    const candidate = await board('candidate');
    expect(candidate.roles[0].company).toMatchObject({ name: 'Investible', slug: null, kind: 'investor' });
    expect(candidate.roles[0].why_listed).toBe('Listed on Investible\'s own careers page on Rippling, last read 2026-10-05.');
    expect(candidate.roles[0].apply_url).toBe('https://ats.rippling.com/investible/jobs/u-1');
  });
});

describe('a board read in a browser from a careers page that draws its jobs by script', () => {
  const WORKABLE = 'https://apply.workable.com/api/v1/widget/accounts/157387';
  const wjob = (code) => ({ shortcode: code, title: `Role ${code}`, url: `https://apply.workable.com/j/${code}`, city: 'Sydney', state: 'NSW', country: 'Australia', published_on: '2026-09-01', employment_type: 'Full-time', department: 'Sales' });
  const entry = (over = {}) => ({ company_id: 'acme-robotics', provider: 'workable', token: '157387', page: 'https://acme.com.au/careers', how: 'Read in a browser on 2026-11-20: the page draws its list by script.', evidence: 'jobs', shown: ['https://apply.workable.com/j/AAA111'], ...over });
  const setup = async (routes) => {
    const dir = await makeDataDir(dataset([co('Acme Robotics', { website: 'https://acme.com.au' })]));
    const w = scriptedWeb(routes);
    return { dir, w, fetcher: createFetcher({ fetchImpl: w.fetchImpl, resolveHost: PUBLIC, sleep: async () => {}, now: () => NOW }) };
  };

  it('approves it when the jobs the page shows are the ones the board\'s own feed lists, writes the sources row that says how, and reads the board', async () => {
    const { dir, fetcher } = await setup({ [WORKABLE]: json({ jobs: [wjob('AAA111'), wjob('BBB222')] }) });
    const r = await confirmFromFile({ dir, entries: [entry()], fetcher, now: () => NOW });
    expect(r).toEqual([expect.objectContaining({ ok: true, listed: 2, roles_added: 2 })]);
    const ds = await readDataDir(dir);
    expect(ds.sources.find((s) => s.id === 'acme-robotics-workable-jobs')).toMatchObject({ kind: 'company_website', note: expect.stringMatching(/Read in a browser on 2026-11-20.*Careers page: https:\/\/acme\.com\.au\/careers/) });
    expect(ds.job_sources).toEqual([expect.objectContaining({ id: 'acme-robotics-workable-jobs', token: '157387', status: 'approved', basis: expect.stringMatching(/read in a browser \(its jobs are the ones this board lists\)/) })]);
    expect(ds.jobs.map((j) => j.apply_url).sort()).toEqual(['https://apply.workable.com/j/AAA111', 'https://apply.workable.com/j/BBB222']);
  });

  it('keeps a board out when the feed lists none of the jobs the page shows, when it does not answer, and when the company or provider is not ours', async () => {
    const { dir, fetcher } = await setup({ [WORKABLE]: json({ jobs: [wjob('ZZZ999')] }), 'https://apply.workable.com/api/v1/widget/accounts/404': { status: 404, body: 'x', headers: { 'content-type': 'text/plain' } } });
    const r = await confirmFromFile({ dir, entries: [entry(), entry({ token: '404' }), entry({ company_id: 'nobody' }), entry({ provider: 'smartrecruiters', token: 'x' })], fetcher, now: () => NOW });
    expect(r.map((x) => [x.ok, x.note])).toEqual([[false, expect.stringMatching(/does not list any job the careers page shows/)], [false, expect.stringMatching(/did not answer \(gone\)/)], [false, 'the company is not in the directory'], [false, expect.stringMatching(/not read by the sync/)]]);
    expect((await readDataDir(dir)).job_sources).toEqual([]);
  });

  it('needs no shown job when the page links to the board\'s own address, and does nothing for a board already approved', async () => {
    const { dir, fetcher } = await setup({ [WORKABLE]: json({ jobs: [wjob('AAA111')] }) });
    const e = entry({ evidence: 'link', shown: undefined });
    expect((await confirmFromFile({ dir, entries: [e], fetcher, now: () => NOW }))[0]).toMatchObject({ ok: true });
    expect((await confirmFromFile({ dir, entries: [e], fetcher, now: () => NOW }))[0]).toMatchObject({ ok: true, already: true });
    expect(await confirmFromFile({ dir, entries: [e], fetcher, now: () => NOW, write: false })).toHaveLength(1);
  });
});

describe('Rippling\'s embed address names the board too', () => {
  it('reads the board from an embed link, a language-prefixed link and a plain link, and takes none of them for the embed word', async () => {
    const { boardOf } = await import('../src/jobsync/sources.js');
    expect(boardOf('https://ats.rippling.com/embed/phocas/jobs?s=https%3A%2F%2Fwww.phocassoftware.com%2Fcareers')).toEqual({ provider: 'rippling', token: 'phocas' });
    expect(boardOf('https://ats.rippling.com/en-GB/totalsynergycareers/jobs')).toEqual({ provider: 'rippling', token: 'totalsynergycareers' });
    expect(boardOf('https://ats.rippling.com/willow/jobs')).toEqual({ provider: 'rippling', token: 'willow' });
    const { detectExtra } = await import('../src/jobsync/discover.js');
    expect(detectExtra([{ finalUrl: 'https://phocas.com/careers', careers: true, html: '<iframe src="https://ats.rippling.com/embed/phocas/jobs"></iframe>' }]).map((b) => b.token)).toEqual(['phocas']);
  });
});
