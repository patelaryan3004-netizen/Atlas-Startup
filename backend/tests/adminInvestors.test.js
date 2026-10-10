import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAdminApp } from '../src/admin/server.js';
import { createAdminService } from '../src/admin/service.js';
import { addUser, loadUsers, createAuthenticator, createLimiter, createSecurityLog } from '../src/admin/auth.js';
import { ForbiddenError, BadRequestError, NotFoundError } from '../src/admin/errors.js';
import { PERMISSIONS } from '../src/admin/roles.js';
import { co, world, backed, bare, source, investment, record, person, role, ISO } from './helpers/investors.js';
import { makeDataDir, readDataDir, removeMadeDirs } from './helpers/store.js';

const homes = [];
afterEach(async () => { await removeMadeDirs(); await Promise.all(homes.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });

const viewer = { name: 'Sam', role: 'viewer' };
const reviewer = { name: 'Riley', role: 'reviewer' };
const admin = { name: 'Aryan', role: 'admin' };
const AT = Date.parse('2026-10-08T03:00:00.000Z');
const PAGE = { url: 'https://oif.example/about', kind: 'investor_website', quote: 'We back software founders at seed.' };

// A directory with an investor at each point of the road: a candidate, one needing review, one verified, one published,
// one inactive, one rejected, and two that are the same firm.
function directory() {
  return world({
    companies: [co('Acme', { investors: ['Verified Co'] }), co('Beta', { investors: ['Verified Co', 'Published Co'] }), co('Cee')],
    orgs: [
      bare('cand', { name: 'Candidate Co' }),
      { org: bare('review', { name: 'Review Co', verification_status: 'needs_review' }) },
      backed('verified', { name: 'Verified Co' }),
      backed('published', { name: 'Published Co', verification_status: 'published' }),
      backed('old', { name: 'Old Fund', verification_status: 'inactive', active_status: 'inactive' }, [['active_status', 'inactive']]),
      { org: bare('rejected', { name: 'Rejected Co', verification_status: 'rejected' }) },
      backed('twin-a', { name: 'Twin Capital' }),
      backed('twin-b', { name: 'Twin Capital etc.' }),
      backed('ready', { name: 'Ready Co', verification_status: 'candidate', last_verified_at: null }),
      { ...backed('disputed', { name: 'Disputed Co' }), records: [...backed('disputed', { name: 'Disputed Co' }).records, { ...record('disputed', 'headquarters_city', 'Melbourne', 'press'), id: 'disputed.hq.press', confidence: 'medium' }] },
    ],
    extra: {
      sources: [source('portfolio'), source('press', 'press')],
      investments: [investment('published', 'beta', 'portfolio')],
      investor_people: [
        person('jo', { name: 'Jo Candidate', current_organisation_id: 'published', current_title: 'Partner' }),
        person('ann', { name: 'Ann Verified', verification_status: 'verified', last_verified_at: ISO }),
        person('bob', { name: 'Bob Published', verification_status: 'published', last_verified_at: ISO }),
      ],
      investor_people_organisations: [role('jo', 'published', 'portfolio')],
    },
  });
}

async function build(ds = directory()) {
  const dir = await makeDataDir(ds);
  const service = createAdminService({ dir, now: () => AT });
  return { dir, service };
}
const trail = async (dir) => (await readDataDir(dir)).audit_trail;
const byId = (ds, id) => ds.investors.find((o) => o.id === id);

describe('reading the investors in the Command Center', () => {
  it('lists what is waiting for a person by default, worst first, and counts each status', async () => {
    const { service } = await build();
    const r = await service.investors(viewer);
    expect(r.results.map((x) => x.id).sort()).toEqual(['cand', 'ready', 'review']);
    expect(r.results[0].id).toBe('review'); // needs_review is the worst problem
    expect(r.counts).toMatchObject({ open: 3, candidate: 2, needs_review: 1, verified: 4, published: 1, inactive: 1, rejected: 1, all: 10 });
    expect(r.summary).toMatchObject({ total: 10, public: 2 });
  });

  it('lists by status, by one kind of problem, and by a word in the name or website', async () => {
    const { service } = await build();
    expect((await service.investors(viewer, { status: 'published' })).results.map((x) => x.id)).toEqual(['published']);
    expect((await service.investors(viewer, { status: 'all' })).results).toHaveLength(10);
    expect((await service.investors(viewer, { status: 'all', issue: 'compound_name' })).results.map((x) => x.id)).toEqual(['twin-b']);
    expect((await service.investors(viewer, { status: 'all', q: 'twin' })).results.map((x) => x.id).sort()).toEqual(['twin-a', 'twin-b']);
    await expect(service.investors(viewer, { issue: 'bogus' })).rejects.toThrow(BadRequestError);
  });

  it('gives each row what the page needs: place, type, portfolio counts, problems and the actions its status allows', async () => {
    const { service } = await build();
    const rows = Object.fromEntries((await service.investors(viewer, { status: 'all' })).results.map((r) => [r.id, r]));
    expect(rows.verified).toMatchObject({ status: 'verified', type: 'venture_capital', type_label: 'Venture Capital', location: 'Sydney, NSW', portfolio: { verified: 0, unverified: 0, unsourced: 2 }, actions: ['edit', 'publish', 'flag', 'inactive', 'reject', 'merge'] });
    expect(rows.published).toMatchObject({ actions: ['edit', 'unpublish', 'inactive', 'merge'], portfolio: { verified: 1, unverified: 0, unsourced: 0 } });
    expect(rows.rejected.actions).toEqual(['reopen']);
    expect(rows.cand.actions).toEqual(['edit', 'approve', 'flag', 'reject', 'merge']);
    expect(rows['twin-b'].issues.map((i) => i.code)).toEqual(expect.arrayContaining(['compound_name', 'possible_duplicate_firm']));
  });

  it('shows one investor in full: every claim with its page, the investments, and the companies that name it with no page', async () => {
    const { service } = await build();
    const d = await service.investor(viewer, 'verified');
    expect(d).toMatchObject({ id: 'verified', name: 'Verified Co', status: 'verified', website: 'https://verified.example/' });
    expect(d.records.find((r) => r.field === 'website')).toMatchObject({ value: 'https://verified.example/', status: 'active', confidence: 'high', source: expect.objectContaining({ kind: 'investor_website' }) });
    expect(d.unsourced_companies.map((c) => c.name).sort()).toEqual(['Acme', 'Beta']);
    const p = await service.investor(viewer, 'published');
    expect(p.investments).toEqual([expect.objectContaining({ company: 'Beta', status: 'verified', source: expect.objectContaining({ id: 'portfolio' }) })]);
    await expect(service.investor(viewer, 'nobody')).rejects.toThrow(NotFoundError);
    await expect(service.investor(viewer, 'Not An Id')).rejects.toThrow(BadRequestError);
  });

  it('puts the investors on the overview', async () => {
    const { service } = await build();
    const o = await service.overview(viewer);
    expect(o.investors).toMatchObject({ total: 10, public: 2, by_status: { published: 1, inactive: 1 }, duplicates: { firms: expect.any(Number) } });
    expect(o.investors.issues.find((i) => i.code === 'new_candidate')).toMatchObject({ count: 2, label: 'New candidate' });
  });
});

describe('who may do what to an investor', () => {
  it('lets a viewer only look', async () => {
    const { service } = await build();
    await expect(service.investorApprove(viewer, 'cand')).rejects.toThrow(ForbiddenError);
    await expect(service.investorEdit(viewer, 'cand', { patch: {} })).rejects.toThrow(ForbiddenError);
  });

  it('lets a reviewer check an investor and record an investment, but not change what is public', async () => {
    const { service } = await build();
    for (const call of [
      () => service.investorPublish(reviewer, 'verified'), () => service.investorUnpublish(reviewer, 'published'), () => service.investorMerge(reviewer, 'twin-b', { into: 'twin-a' }),
      () => service.investorInactive(reviewer, 'published', {}), () => service.investorResolve(reviewer, {}), () => service.personPublish(reviewer, 'x'),
    ]) await expect(call()).rejects.toThrow(ForbiddenError);
    expect(PERMISSIONS['investor.publish']).toBe('admin');
    expect(PERMISSIONS['investor.approve']).toBe('reviewer');
    expect(PERMISSIONS['investment.add']).toBe('reviewer');
  });
});

describe('every investor permission is checked in the service itself', () => {
  // [permission, how to ask for it as a given person]: one entry per action the investor layer has. A refusal must come before
  // anything is read or written, and the lowest role that holds the permission must be able to do it.
  const table = (s) => [
    ['investor.approve', (a) => s.investorApprove(a, 'ready')],
    ['investor.reject', (a) => s.investorReject(a, 'cand', { reason: 'Not a startup investor.' })],
    ['investor.reopen', (a) => s.investorReopen(a, 'rejected')],
    ['investor.flag', (a) => s.investorFlag(a, 'cand', { reason: 'Is it a fund?' })],
    ['investor.edit', (a) => s.investorEdit(a, 'verified', { patch: { stages: ['Seed'] }, source: PAGE })],
    ['investor.merge', (a) => s.investorMerge(a, 'twin-b', { into: 'twin-a' })],
    ['investor.publish', (a) => s.investorPublish(a, 'verified')],
    ['investor.unpublish', (a) => s.investorUnpublish(a, 'published')],
    ['investor.inactive', (a) => s.investorInactive(a, 'published', { reason: 'It closed.', source: { url: 'https://published.example/news', quote: 'The fund has closed.' } })],
    ['investor.resolve', (a) => s.investorResolve(a, { subject_id: 'disputed', field: 'headquarters_city', value: 'Melbourne', reason: 'The press piece is newer.' })],
    ['investment.add', (a) => s.investmentAdd(a, { investor_id: 'verified', company_id: 'cee', source: { url: 'https://verified.example/portfolio', quote: 'Cee' } })],
    ['investment.reject', (a) => s.investmentReject(a, 'published-beta', { reason: 'The wrong Beta.' })],
    ['person.approve', (a) => s.personApprove(a, 'jo')],
    ['person.reject', (a) => s.personReject(a, 'jo', { reason: 'Not an investor.' })],
    ['person.publish', (a) => s.personPublish(a, 'ann')],
    ['person.unpublish', (a) => s.personUnpublish(a, 'bob')],
  ];

  it('refuses every action to a person without the role for it, changing nothing, and allows it to one with the role', async () => {
    for (const [permission] of table({})) {
      const { dir, service } = await build();
      const t = table(service).find(([p]) => p === permission)[1];
      const before = await readDataDir(dir);
      const lowest = PERMISSIONS[permission];
      for (const who of lowest === 'admin' ? [viewer, reviewer] : [viewer]) {
        await expect(Promise.resolve().then(() => t(who)), `${permission} as ${who.role}`).rejects.toBeInstanceOf(ForbiddenError);
      }
      expect(await readDataDir(dir), `${permission}: a refusal must change nothing`).toEqual(before);
      await expect(t(lowest === 'admin' ? admin : reviewer), `${permission} as ${lowest}`).resolves.toBeTruthy();
    }
  }, 60000);

  it('has a case here for every investor permission, so a new action cannot be added without being checked', () => {
    const covered = new Set(table({}).map(([p]) => p));
    const needed = Object.keys(PERMISSIONS).filter((p) => /^(investor|investment|person)\./.test(p));
    expect(needed.filter((p) => !covered.has(p))).toEqual([]);
  });
});

describe('moving an investor along', () => {
  it('flags a candidate for review, rejects one with a reason, and reopens it, each with its audit row', async () => {
    const { dir, service } = await build();
    await service.investorFlag(reviewer, 'cand', { reason: 'Is it a fund or a bank?' });
    expect(byId(await readDataDir(dir), 'cand').verification_status).toBe('needs_review');
    await service.investorReject(reviewer, 'cand', { reason: 'A bank, not a startup investor.' });
    expect(byId(await readDataDir(dir), 'cand').verification_status).toBe('rejected');
    await service.investorReopen(reviewer, 'cand');
    expect(byId(await readDataDir(dir), 'cand').verification_status).toBe('needs_review');
    const rows = (await trail(dir)).filter((r) => r.target.id === 'cand');
    expect(rows.map((r) => r.action)).toEqual(['investor.note', 'investor.reject', 'investor.reopen']);
    expect(rows[1]).toMatchObject({ actor: 'Riley', role: 'reviewer', via: 'admin-ui', reason: 'A bank, not a startup investor.', changes: [{ field: 'verification_status', from: 'needs_review', to: 'rejected' }] });
  });

  it('needs a reason to reject, and says so', async () => {
    const { service } = await build();
    await expect(service.investorReject(reviewer, 'cand', {})).rejects.toThrow(BadRequestError);
  });

  it('approves only what has its pages, and says what is missing; nothing is written or recorded when it refuses', async () => {
    const { dir, service } = await build();
    await expect(service.investorApprove(reviewer, 'cand')).rejects.toThrow(/cannot be approved yet: it does not say its website/);
    expect(byId(await readDataDir(dir), 'cand').verification_status).toBe('candidate');
    expect(await trail(dir)).toEqual([]);
  });

  it('publishes a verified investor, and takes it down again, and only an admin may', async () => {
    const { dir, service } = await build();
    const r = await service.investorPublish(admin, 'verified');
    expect(r).toMatchObject({ id: 'verified', status: 'published' });
    expect(byId(await readDataDir(dir), 'verified').verification_status).toBe('published');
    await service.investorUnpublish(admin, 'verified', { reason: 'Its website changed.' });
    expect(byId(await readDataDir(dir), 'verified').verification_status).toBe('verified');
    const rows = (await trail(dir)).map((x) => x.action);
    expect(rows).toEqual(['investor.publish', 'investor.unpublish']);
  });

  it('refuses to publish what is not verified', async () => {
    const { service } = await build();
    await expect(service.investorPublish(admin, 'cand')).rejects.toThrow(/only a verified record is published/);
  });
});

describe('editing an investor from the page', () => {
  it('records each claim with the page that states it and what it says, and the audit row carries what moved', async () => {
    const { dir, service } = await build();
    const r = await service.investorEdit(reviewer, 'verified', { patch: { stages: ['Seed'], lead_or_follow: 'lead' }, source: PAGE, reason: 'From their about page.' });
    expect(r).toMatchObject({ id: 'verified', changed: ['stages', 'lead_or_follow'] });
    const ds = await readDataDir(dir);
    expect(byId(ds, 'verified')).toMatchObject({ stages: ['Seed'], lead_or_follow: 'lead' });
    expect(ds.verification_records.filter((x) => x.subject_id === 'verified' && ['stages', 'lead_or_follow'].includes(x.field))).toHaveLength(2);
    const row = (await trail(dir)).at(-1);
    expect(row).toMatchObject({ action: 'investor.edit', reason: 'From their about page.', changes: expect.arrayContaining([{ field: 'stages', from: [], to: ['Seed'] }]) });
  });

  it('refuses a claim without its page, and a patch that changes nothing', async () => {
    const { dir, service } = await build();
    await expect(service.investorEdit(reviewer, 'verified', { patch: { stages: ['Seed'] } })).rejects.toThrow(/name the page that states it/);
    await expect(service.investorEdit(reviewer, 'verified', { patch: { stages: [] } })).rejects.toThrow(/nothing changed/);
    await expect(service.investorEdit(reviewer, 'verified', { patch: { stages: ['Seed'] }, source: { url: 'not a url', quote: 'long enough quote' } })).rejects.toThrow(BadRequestError);
    await expect(service.investorEdit(reviewer, 'verified', { patch: { stages: ['Seed'] }, source: { ...PAGE, kind: 'hearsay' } })).rejects.toThrow(/the kind of page must be one of/);
    await expect(service.investorEdit(reviewer, 'verified', { patch: 'stages' })).rejects.toThrow(/patch must be an object/);
    expect(byId(await readDataDir(dir), 'verified').stages).toEqual([]);
  });

  it('records the page for a value the record already holds, which changes nothing on the record and is still written to the audit trail', async () => {
    const { dir, service } = await build();
    const r = await service.investorEdit(reviewer, 'cand', { patch: { name: 'Candidate Co' }, source: PAGE, reason: 'Their home page names them.' });
    expect(r).toMatchObject({ id: 'cand', changed: ['name'], recorded: ['name'] });
    const ds = await readDataDir(dir);
    expect(byId(ds, 'cand').name).toBe('Candidate Co');
    expect(ds.verification_records.find((x) => x.subject_id === 'cand' && x.field === 'name')).toMatchObject({ value: 'Candidate Co', status: 'active', note: PAGE.quote });
    expect((await trail(dir)).at(-1)).toMatchObject({ action: 'investor.edit', summary: expect.stringMatching(/Recorded the page that states Candidate Co's name/), changes: [] });
    // saying it again, now that a page backs it, is nothing to do
    await expect(service.investorEdit(reviewer, 'cand', { patch: { name: 'Candidate Co' }, source: PAGE })).rejects.toThrow(/nothing changed/);
  });
});

describe('the other things an admin does', () => {
  it('marks a published investor inactive with the page that says so', async () => {
    const { dir, service } = await build();
    await expect(service.investorInactive(admin, 'published', { reason: 'It closed.' })).rejects.toThrow(/name the page that says it has stopped investing/);
    const r = await service.investorInactive(admin, 'published', { reason: 'Its site says so.', source: { url: 'https://published.example/news', quote: 'The fund has made its final investment.' } });
    expect(r).toMatchObject({ status: 'inactive', active_status: 'inactive' });
    expect(byId(await readDataDir(dir), 'published')).toMatchObject({ verification_status: 'inactive', active_status: 'inactive' });
  });

  it('merges two records that are one firm, and tells the audit trail what moved', async () => {
    const { dir, service } = await build();
    const r = await service.investorMerge(admin, 'twin-b', { into: 'twin-a', reason: 'The same firm.' });
    expect(r).toMatchObject({ id: 'twin-b', into: 'twin-a' });
    const ds = await readDataDir(dir);
    expect(ds.investors.map((o) => o.id)).not.toContain('twin-b');
    expect(byId(ds, 'twin-a').aliases).toEqual(['Twin Capital etc.']);
    expect((await trail(dir)).at(-1)).toMatchObject({ action: 'investor.merge', reason: 'The same firm.', summary: expect.stringMatching(/Merged Twin Capital etc\. into Twin Capital/) });
    await expect(service.investorMerge(admin, 'twin-a', { into: 'twin-a' })).rejects.toThrow(/into itself/);
    await expect(service.investorMerge(admin, 'twin-a', { into: 'Bad Id' })).rejects.toThrow(BadRequestError);
  });

  it('settles a disagreement between two sources', async () => {
    const b = backed('disputed');
    const press = source('disputed-press', 'press');
    const ds = world({ companies: [co('Acme')], orgs: [{ ...b, records: [...b.records, { ...record('disputed', 'headquarters_city', 'Melbourne', press.id), id: 'disputed.hq.press', confidence: 'medium' }] }], extra: { sources: [press] } });
    const { dir, service } = await build(ds);
    await expect(service.investorResolve(admin, { subject_id: 'disputed', field: 'headquarters_city', value: 'Melbourne', reason: '' })).rejects.toThrow(/say why/);
    const r = await service.investorResolve(admin, { subject_id: 'disputed', field: 'headquarters_city', value: 'Melbourne', reason: 'The press piece is newer.' });
    expect(r).toMatchObject({ id: 'disputed', winner: 'Melbourne', turned_down: 1 });
    expect(byId(await readDataDir(dir), 'disputed').headquarters_city).toBe('Melbourne');
    expect((await service.investor(viewer, 'disputed')).conflicts).toEqual([]);
  });

  it('records that an investor backed a company with its page, and turns one down', async () => {
    const { dir, service } = await build();
    const r = await service.investmentAdd(reviewer, { investor_id: 'verified', company_id: 'acme', round: 'Seed', source: { url: 'https://verified.example/portfolio', quote: 'Acme' }, reason: 'On their portfolio page.' });
    expect(r.id).toBe('verified-acme-seed');
    const ds = await readDataDir(dir);
    expect(ds.investments.find((i) => i.id === r.id)).toMatchObject({ verification_status: 'verified', round: 'Seed', note: 'Acme' });
    await expect(service.investmentAdd(reviewer, { investor_id: 'verified', company_id: 'acme', round: 'Seed', source: { url: 'https://verified.example/portfolio', quote: 'Acme' } })).rejects.toThrow(/already has an investment/);
    await expect(service.investmentAdd(reviewer, { investor_id: 'verified', company_id: 'cee' })).rejects.toThrow(/every investment has a source/);
    await service.investmentReject(reviewer, r.id, { reason: 'Wrong company: it is another Acme.' });
    expect((await readDataDir(dir)).investments.find((i) => i.id === r.id).verification_status).toBe('rejected');
    expect((await trail(dir)).map((x) => x.action)).toEqual(['investment.add', 'investment.reject']);
  });
});

describe('through the server', () => {
  async function boot() {
    const built = await build();
    const home = await mkdtemp(path.join(os.tmpdir(), 'admin-inv-'));
    homes.push(home);
    const file = path.join(home, 'users.json');
    const tokens = {};
    for (const [name, role] of [['Sam', 'viewer'], ['Riley', 'reviewer'], ['Aryan', 'admin']]) tokens[role] = (await addUser(file, { name, role })).token;
    const app = createAdminApp({ service: built.service, authenticator: createAuthenticator(await loadUsers(file)), limiter: createLimiter(), securityLog: createSecurityLog(path.join(home, 'security.log')), logger: { error() {} } });
    return { ...built, app, tokens };
  }
  const as = (t) => ({ Authorization: `Bearer ${t}` });
  const JSON_HEADERS = { 'Content-Type': 'application/json' };

  it('needs a sign-in to read, and answers a viewer', async () => {
    const { app, tokens } = await boot();
    expect((await request(app).get('/api/investors')).status).toBe(401);
    const res = await request(app).get('/api/investors?status=all').set(as(tokens.viewer));
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(10);
    expect((await request(app).get('/api/investors/verified').set(as(tokens.viewer))).body.name).toBe('Verified Co');
    expect((await request(app).get('/api/investors/nobody').set(as(tokens.viewer))).status).toBe(404);
    expect((await request(app).get('/api/investors?issue=bogus').set(as(tokens.viewer))).status).toBe(400);
  });

  it('runs an action as the person who signed in, refuses one their role does not allow, and 404s an action that does not exist', async () => {
    const f = await boot();
    const post = (p, t, body = {}) => request(f.app).post(p).set(as(t)).set(JSON_HEADERS).send(body);
    expect((await post('/api/investors/verified/publish', f.tokens.reviewer)).status).toBe(403);
    const ok = await post('/api/investors/verified/publish', f.tokens.admin);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ id: 'verified', status: 'published' });
    expect((await trail(f.dir)).at(-1)).toMatchObject({ action: 'investor.publish', actor: 'Aryan', role: 'admin' });
    expect((await post('/api/investors/verified/explode', f.tokens.admin)).status).toBe(404);
    expect((await post('/api/investors/resolve', f.tokens.admin, { subject_id: 'verified', field: 'website', value: 'x', reason: 'because' })).status).toBe(400);
    expect((await post('/api/investments', f.tokens.reviewer, { investor_id: 'verified', company_id: 'cee', source: { url: 'https://verified.example/p', quote: 'Cee' } })).status).toBe(200);
    expect((await post('/api/investor-people/ghost/approve', f.tokens.reviewer)).status).toBe(400);
  });
});