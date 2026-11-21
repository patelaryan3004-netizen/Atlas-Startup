// The community's member features (src/network): richer profiles, projects with "I'm interested", deterministic matching with reasons, introductions that need both people's consent, and the
// founding-member list that works while the community itself is closed.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import request from 'supertest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { createNetwork } from '../src/network/index.js';
import { matchPair, recommendMembers, recommendProjects, MIN_SCORE } from '../src/network/matching.js';
import { INTENTS, SKILLS, INTERESTS } from '../src/network/taxonomy.js';
import { fixture, removeTempDirs } from './helpers/catalog.js';

const NOW = Date.parse('2026-11-21T02:00:00Z');
const KEY = 'test-admin-key';
const made = [];
afterEach(async () => { await removeTempDirs(); while (made.length) await rm(made.pop(), { recursive: true, force: true }); });
let saved;
beforeEach(() => { saved = process.env.ADMIN_KEY; process.env.ADMIN_KEY = KEY; });
afterEach(() => { if (saved === undefined) delete process.env.ADMIN_KEY; else process.env.ADMIN_KEY = saved; });
const admin = { 'x-admin-key': KEY };

async function setup({ env, dir, clock = { now: NOW } } = {}) {
  const f = await fixture(3);
  const foundingDir = await mkdtemp(path.join(os.tmpdir(), 'au-founding-'));
  made.push(foundingDir);
  const network = createNetwork({ memory: !env && !dir, dir, now: () => clock.now, env, foundingDir, curatedEvents: [], curatedJobsRows: [], limits: { signups: 1000, logins: 50 } });
  return { app: createApp({ catalog: f.catalog, network }), network, foundingDir, clock };
}

let counter = 0;
async function member(app, name = 'Ada Example', over = {}) {
  counter += 1;
  const res = await request(app).post('/api/auth/signup').send({ name, email: `person${counter}@example.com`, password: 'a-long-enough-password', listed: true, ...over });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const email = `person${counter}@example.com`;
  return { token: res.body.token, id: res.body.member.id, email, auth: { Authorization: `Bearer ${res.body.token}` } };
}
// A new session for a member whose first one has run out (they last thirty days).
const relogin = async (app, who) => { const r = await request(app).post('/api/auth/signin').send({ email: who.email, password: 'a-long-enough-password' }); who.auth = { Authorization: `Bearer ${r.body.token}` }; };
const profile = (app, who, body) => request(app).patch('/api/account').set(who.auth).send(body);
const project = (over = {}) => ({
  name: 'Open tide data', summary: 'A shared dataset of coastal conditions for Australian marine startups to build on.', problem: 'Marine founders each rebuild the same data pipeline.',
  stage: 'prototype', skills_needed: ['engineering', 'data'], collaboration: ['contributor'], interests: ['Climate & Energy'], city: 'Melbourne', remote: true, ...over,
});

describe('what a member can say about themselves', () => {
  it('keeps skills, interests, what they are looking for, previous projects, links and a private contact, all from closed lists', async () => {
    const { app } = await setup();
    const ada = await member(app);
    const res = await profile(app, ada, {
      city: 'Melbourne', remote: true, skills: ['engineering', 'design'], interests: ['Fintech'], looking_for: ['cofounder', 'feedback'],
      past: [{ title: 'Ledgerly', url: 'https://example.org/ledgerly', note: 'Built the first version' }], contact: 'ada@example.org',
      links: { website: 'https://ada.example.org', professional_profile: 'https://www.linkedin.com/in/ada', github: 'https://github.com/ada', portfolio: 'https://ada.example.org/work' },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.member).toMatchObject({ skills: ['engineering', 'design'], interests: ['Fintech'], looking_for: ['cofounder', 'feedback'], remote: true, contact: 'ada@example.org' });
    expect(res.body.member.links).toMatchObject({ github: 'https://github.com/ada', portfolio: 'https://ada.example.org/work' });
    // what anyone sees: all of it but the contact and the email
    const pub = await request(app).get(`/api/members/${ada.id}`);
    expect(pub.body.member).toMatchObject({ skills: ['engineering', 'design'], looking_for: ['cofounder', 'feedback'], past: [{ title: 'Ledgerly' }] });
    expect(JSON.stringify(pub.body)).not.toMatch(/ada@example\.org|person\d+@example\.com/);
  });

  it('refuses what is not on the lists, too many of them, and a contact that is neither an email nor an https link', async () => {
    const { app } = await setup();
    const ada = await member(app);
    for (const body of [{ skills: ['wizardry'] }, { interests: ['Underwater basket weaving'] }, { looking_for: ['get rich'] }, { skills: SKILLS.map((s) => s.id).slice(0, 9) }, { looking_for: INTENTS.map((i) => i.id).slice(0, 5) },
      { contact: 'call me maybe' }, { contact: 'http://insecure.example.org' }, { remote: 'yes' }, { past: Array.from({ length: 6 }, (_, i) => ({ title: `P${i}` })) }]) {
      const res = await profile(app, ada, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect((await profile(app, ada, { contact: 'https://example.org/ada' })).status).toBe(200);
  });

  it('serves the lists a page picks from, with the status', async () => {
    const { app } = await setup();
    const res = await request(app).get('/api/network/status');
    expect(res.body.taxonomy.intents.map((i) => i.id)).toEqual(['build-with', 'cofounder', 'contribute', 'job', 'meet', 'feedback', 'talent', 'explore']);
    expect(res.body.taxonomy.skills).toHaveLength(SKILLS.length);
    expect(res.body.taxonomy.interests).toEqual(INTERESTS);
    expect(INTERESTS).toHaveLength(12);
    expect(res.body.founding).toEqual({ open: true, durable: false });
  });
});

describe('projects and "I\'m interested"', () => {
  it('shares a project with what it is, the problem, its stage, skills, kind of help and place; newest first; filtered', async () => {
    const { app, clock } = await setup();
    const ada = await member(app);
    const first = await request(app).post('/api/projects').set(ada.auth).send(project());
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.project).toMatchObject({ name: 'Open tide data', stage: 'prototype', skills_needed: ['engineering', 'data'], collaboration: ['contributor'], city: 'Melbourne', remote: true, open: true, mine: true, interested_count: 0, owner: { name: 'Ada Example' } });
    clock.now += 60000;
    await request(app).post('/api/projects').set(ada.auth).send(project({ name: 'Studio finder', summary: 'A directory of shared studio space for makers in Sydney.', stage: 'idea', skills_needed: ['design'], collaboration: ['cofounder'], city: 'Sydney', remote: false, interests: [] }));
    const list = await request(app).get('/api/projects');
    expect(list.body.results.map((p) => p.name)).toEqual(['Studio finder', 'Open tide data']);
    expect((await request(app).get('/api/projects?stage=idea')).body.results.map((p) => p.name)).toEqual(['Studio finder']);
    expect((await request(app).get('/api/projects?skill=data')).body.results.map((p) => p.name)).toEqual(['Open tide data']);
    expect((await request(app).get('/api/projects?collaboration=cofounder&city=Sydney')).body.results).toHaveLength(1);
    expect((await request(app).get('/api/projects?remote=yes')).body.results.map((p) => p.name)).toEqual(['Open tide data']);
    expect((await request(app).get('/api/projects?search=studio')).body.results).toHaveLength(1);
  });

  it('refuses a project with no place, no kind of help, a bad stage or a skill off the list, and a sixth open one', async () => {
    const { app } = await setup();
    const ada = await member(app);
    for (const body of [project({ city: '', remote: false }), project({ collaboration: [] }), project({ stage: 'unicorn' }), project({ skills_needed: ['wizardry'] }), project({ summary: 'too short' }), project({ name: 'ab' })]) {
      expect((await request(app).post('/api/projects').set(ada.auth).send(body)).status, JSON.stringify(body).slice(0, 60)).toBe(400);
    }
    for (let i = 0; i < 5; i += 1) expect((await request(app).post('/api/projects').set(ada.auth).send(project({ name: `Project ${i + 1} name` }))).status).toBe(201);
    const sixth = await request(app).post('/api/projects').set(ada.auth).send(project({ name: 'Project six' }));
    expect(sixth.status).toBe(400);
    expect(sixth.body.error).toMatch(/5 open projects/);
    expect((await request(app).post('/api/projects').send(project())).status).toBe(401);
  });

  it('records interest once per member, never on your own project, tells only the owner who, and shares no contact', async () => {
    const { app } = await setup();
    const ada = await member(app);
    const bo = await member(app, 'Bo Example');
    const cy = await member(app, 'Cy Example');
    await profile(app, bo, { contact: 'bo@example.org', city: 'Melbourne' });
    const created = await request(app).post('/api/projects').set(ada.auth).send(project());
    const id = created.body.project.id;
    expect((await request(app).put(`/api/projects/${id}/interest`).set(ada.auth)).status).toBe(400); // your own
    const on = await request(app).put(`/api/projects/${id}/interest`).set(bo.auth);
    expect(on.body).toEqual({ interested: true, interested_count: 1 });
    expect((await request(app).put(`/api/projects/${id}/interest`).set(bo.auth)).body.interested_count).toBe(1); // once
    await request(app).put(`/api/projects/${id}/interest`).set(cy.auth);
    const seenByBo = await request(app).get(`/api/projects/${id}`).set(bo.auth);
    expect(seenByBo.body.project).toMatchObject({ interested: true, interested_count: 2, mine: false });
    expect((await request(app).get(`/api/projects/${id}/interested`).set(bo.auth)).status).toBe(403);
    const who = await request(app).get(`/api/projects/${id}/interested`).set(ada.auth);
    expect(who.body.results.map((r) => r.member.name).sort()).toEqual(['Bo Example', 'Cy Example']);
    expect(JSON.stringify(who.body)).not.toMatch(/bo@example\.org|person\d+@example\.com|"contact"/);
    expect((await request(app).delete(`/api/projects/${id}/interest`).set(bo.auth)).body).toEqual({ interested: false, interested_count: 1 });
    expect((await request(app).put(`/api/projects/${id}/interest`)).status).toBe(401);
  });

  it('lets only its owner edit, close or delete it; a closed project takes no interest; a deleted one is gone', async () => {
    const { app } = await setup();
    const ada = await member(app);
    const bo = await member(app, 'Bo Example');
    const id = (await request(app).post('/api/projects').set(ada.auth).send(project())).body.project.id;
    expect((await request(app).patch(`/api/projects/${id}`).set(bo.auth).send({ name: 'Mine now' })).status).toBe(403);
    expect((await request(app).patch(`/api/projects/${id}`).set(ada.auth).send({ stage: 'building' })).body.project.stage).toBe('building');
    expect((await request(app).patch(`/api/projects/${id}`).set(ada.auth).send({ open: false })).body.project.open).toBe(false);
    expect((await request(app).put(`/api/projects/${id}/interest`).set(bo.auth)).status).toBe(404);
    expect((await request(app).get('/api/projects')).body.results).toHaveLength(0); // closed ones are not in the default list
    expect((await request(app).get('/api/projects?status=closed')).body.results).toHaveLength(1);
    expect((await request(app).delete(`/api/projects/${id}`).set(ada.auth)).status).toBe(204);
    expect((await request(app).get(`/api/projects/${id}`)).status).toBe(404);
  });

  it('can be reported like a post: three different people hide it, and a moderator decides', async () => {
    const { app } = await setup();
    const ada = await member(app);
    const id = (await request(app).post('/api/projects').set(ada.auth).send(project())).body.project.id;
    const others = [await member(app, 'Bo Example'), await member(app, 'Cy Example'), await member(app, 'Di Example')];
    expect((await request(app).post(`/api/projects/${id}/report`).set(ada.auth).send({ reason: 'spam' })).status).toBe(400); // not your own
    for (const o of others) expect((await request(app).post(`/api/projects/${id}/report`).set(o.auth).send({ reason: 'misleading', note: 'Not what it says' })).status).toBe(201);
    expect((await request(app).get(`/api/projects/${id}`)).status).toBe(404); // hidden until a moderator looks
    const reports = await request(app).get('/api/admin/network/reports').set(admin);
    expect(reports.body.results.find((r) => r.target_kind === 'project')).toMatchObject({ target_id: id, body: expect.stringContaining('Open tide data') });
    await request(app).post(`/api/admin/network/reports/project/${id}`).set(admin).send({ action: 'restore' });
    expect((await request(app).get(`/api/projects/${id}`)).status).toBe(200);
  });
});

describe('matching: deterministic, with the reason in words', () => {
  const m = (over) => ({ id: 'x', looking_for: [], skills: [], interests: [], open_to: [], city: '', remote: false, ...over });

  it('scores goals, skills, interests, place and ways of working, and says why in short sentences', () => {
    const a = m({ looking_for: ['cofounder'], skills: ['engineering'], interests: ['Fintech', 'AI & Data'], open_to: ['feedback'], city: 'Melbourne' });
    const b = m({ looking_for: ['cofounder'], skills: ['design', 'engineering'], interests: ['Fintech'], open_to: ['feedback', 'work'], city: 'Melbourne' });
    const r = matchPair(a, b);
    expect(r.reasons).toEqual([
      'You both want to find a co-founder.', 'They bring design, which you do not list.', 'You bring engineering, which they do not list.'.replace('You bring engineering, which they do not list.', 'You both care about Fintech.'), 'You are both in Melbourne.', 'You are both open to giving and getting feedback.',
    ].filter((x) => x));
    expect(r.score).toBe(3 + 2 + 2 + 2 + 1);
    expect(r.substance).toBe(true);
  });

  it('pairs complementary goals in a sentence of their own', () => {
    expect(matchPair(m({ looking_for: ['job'] }), m({ looking_for: ['talent'] })).reasons[0]).toBe('You want to find a startup job; they want to find talent for their team.');
    expect(matchPair(m({ looking_for: ['cofounder'] }), m({ looking_for: ['cofounder'] })).reasons[0]).toBe('You both want to find a co-founder.');
    expect(matchPair(m({ looking_for: ['talent'] }), m({ looking_for: ['talent'] })).reasons).toEqual([]); // two people both hiring do not fit each other
  });

  it('never matches on a shared city or interest alone, and needs a minimum score', () => {
    const r = matchPair(m({ city: 'Sydney', interests: ['Fintech', 'Education'], open_to: ['work', 'feedback'] }), m({ city: 'Sydney', interests: ['Fintech', 'Education'], open_to: ['work', 'feedback'] }));
    expect(r.score).toBeGreaterThanOrEqual(MIN_SCORE);
    expect(r.substance).toBe(false);
  });

  it('suggests only listed members, never yourself, a suspended member, or someone you already have an introduction with; best first, three reasons at most', async () => {
    const { app, network } = await setup();
    const ada = await member(app);
    await profile(app, ada, { looking_for: ['cofounder'], skills: ['engineering'], city: 'Melbourne', interests: ['Fintech'], contact: 'ada@example.org' });
    const people = [];
    for (const [name, over] of [['Strong Match', { looking_for: ['cofounder'], skills: ['design', 'product'], city: 'Melbourne', interests: ['Fintech'] }], ['Weak Match', { looking_for: ['cofounder'] }], ['No Match', { city: 'Perth' }], ['Hidden Member', { looking_for: ['cofounder'], skills: ['sales'] }]]) {
      const w = await member(app, name, { listed: name !== 'Hidden Member' });
      await profile(app, w, { ...over, contact: `${name.split(' ')[0].toLowerCase()}@example.org` });
      people.push(w);
    }
    const res = await request(app).get('/api/matches').set(ada.auth);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.people.map((r) => r.member.name)).toEqual(['Strong Match', 'Weak Match']);
    expect(res.body.people[0].why.length).toBeLessThanOrEqual(3);
    expect(res.body.people[0].why[0]).toBe('You both want to find a co-founder.');
    expect(JSON.stringify(res.body)).not.toMatch(/@example\.org/); // no contact in a suggestion
    // the same answer twice
    expect((await request(app).get('/api/matches').set(ada.auth)).body).toEqual(res.body);
    // once asked, no longer suggested
    await request(app).post('/api/introductions').set(ada.auth).send({ to: people[0].id, note: 'Hi, I would like to talk about building together.', why: res.body.people[0].why });
    expect((await request(app).get('/api/matches').set(ada.auth)).body.people.map((r) => r.member.name)).toEqual(['Weak Match']);
    // a suspended member is not suggested
    await network.open().then(({ store }) => store.change((d) => { d.members.find((x) => x.id === people[1].id).suspended = true; }));
    expect((await request(app).get('/api/matches').set(ada.auth)).body.people).toEqual([]);
    expect((await request(app).get('/api/matches')).status).toBe(401);
  });

  it('suggests projects that need what you bring or ask for what you want, and says why', async () => {
    const { app } = await setup();
    const ada = await member(app);
    const bo = await member(app, 'Bo Example');
    await profile(app, bo, { skills: ['engineering', 'data'], looking_for: ['contribute'], city: 'Melbourne', interests: ['Climate & Energy'] });
    const p = (await request(app).post('/api/projects').set(ada.auth).send(project())).body.project;
    await request(app).post('/api/projects').set(ada.auth).send(project({ name: 'Unrelated thing', skills_needed: ['legal'], collaboration: ['advisor'], interests: [], city: 'Perth', remote: false }));
    const res = await request(app).get('/api/matches').set(bo.auth);
    expect(res.body.projects.map((r) => r.project.id)).toEqual([p.id]);
    expect(res.body.projects[0].why).toEqual(['It needs engineering and data & analytics, which you bring.', 'It is looking for contributors, and you want to contribute to a startup.', 'It is in Climate & Energy, which you care about.']);
    // once you say you are interested it is no longer suggested
    await request(app).put(`/api/projects/${p.id}/interest`).set(bo.auth);
    expect((await request(app).get('/api/matches').set(bo.auth)).body.projects).toEqual([]);
  });
});

describe('introductions need both people\'s consent', () => {
  async function pair(app) {
    const ada = await member(app);
    const bo = await member(app, 'Bo Example');
    await profile(app, ada, { contact: 'ada@example.org' });
    await profile(app, bo, { contact: 'https://example.org/bo' });
    return { ada, bo };
  }
  const ask = (app, who, to, body = {}) => request(app).post('/api/introductions').set(who.auth).send({ to, note: 'Hello, I would like to talk about what you are building.', why: ['You both want to find a co-founder.'], ...body });

  it('needs your own contact first; shows the other person who is asking and why, and neither contact until both agree', async () => {
    const { app } = await setup();
    const ada = await member(app);
    const bo = await member(app, 'Bo Example');
    expect((await ask(app, ada, bo.id)).body.error).toMatch(/Add how people can reach you/);
    await profile(app, ada, { contact: 'ada@example.org' });
    const sent = await ask(app, ada, bo.id);
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
    expect(sent.body.introduction).toMatchObject({ direction: 'sent', status: 'requested', why: ['You both want to find a co-founder.'], member: { name: 'Bo Example' } });
    expect(sent.body.introduction.contact).toBeUndefined();
    const inbox = await request(app).get('/api/introductions').set(bo.auth);
    expect(inbox.body.waiting).toBe(1);
    expect(inbox.body.results[0]).toMatchObject({ direction: 'received', status: 'requested', member: { name: 'Ada Example' }, note: expect.stringContaining('Hello') });
    expect(JSON.stringify(inbox.body)).not.toMatch(/ada@example\.org|person\d+@example\.com/);
    // Bo has no contact set: cannot accept yet
    const early = await request(app).post(`/api/introductions/${sent.body.introduction.id}/accept`).set(bo.auth);
    expect(early.status).toBe(400);
    expect(early.body.error).toMatch(/before you accept/);
  });

  it('shows each the other\'s contact only after the person asked accepts; only they can answer; the asker can withdraw before', async () => {
    const { app } = await setup();
    const { ada, bo } = await pair(app);
    const id = (await ask(app, ada, bo.id)).body.introduction.id;
    expect((await request(app).post(`/api/introductions/${id}/accept`).set(ada.auth)).status).toBe(403); // not the one asked
    const accepted = await request(app).post(`/api/introductions/${id}/accept`).set(bo.auth);
    expect(accepted.body.introduction).toMatchObject({ status: 'accepted', direction: 'received', contact: 'ada@example.org' });
    const mine = await request(app).get('/api/introductions').set(ada.auth);
    expect(mine.body.results[0]).toMatchObject({ status: 'accepted', direction: 'sent', contact: 'https://example.org/bo' });
    expect((await request(app).post(`/api/introductions/${id}/decline`).set(bo.auth)).status).toBe(400); // already answered
    // a withdrawn one shows no contact
    const w = await setup();
    const p2 = await pair(w.app);
    const id2 = (await ask(w.app, p2.ada, p2.bo.id)).body.introduction.id;
    expect((await request(w.app).post(`/api/introductions/${id2}/withdraw`).set(p2.bo.auth)).status).toBe(403);
    expect((await request(w.app).post(`/api/introductions/${id2}/withdraw`).set(p2.ada.auth)).body.introduction.status).toBe('withdrawn');
    expect((await request(w.app).post(`/api/introductions/${id2}/accept`).set(p2.bo.auth)).status).toBe(400);
  });

  it('answers a decline with nothing shared, and no new request for thirty days; one live introduction per pair', async () => {
    const { app, clock } = await setup();
    const { ada, bo } = await pair(app);
    const id = (await ask(app, ada, bo.id)).body.introduction.id;
    expect((await ask(app, bo, ada.id)).status).toBe(400); // already one between you, whichever way
    const declined = await request(app).post(`/api/introductions/${id}/decline`).set(bo.auth);
    expect(declined.body.introduction.status).toBe('declined');
    expect(declined.body.introduction.contact).toBeUndefined();
    expect((await request(app).get('/api/introductions').set(ada.auth)).body.results[0].contact).toBeUndefined();
    const again = await ask(app, ada, bo.id);
    expect(again.status).toBe(400);
    expect(again.body.error).toMatch(/declined/);
    clock.now += 31 * 86400000;
    await relogin(app, ada);
    expect((await ask(app, ada, bo.id)).status).toBe(201);
  });

  it('asks only members who are listed, never yourself, and no more than eight at once; all of it needs an account', async () => {
    const { app } = await setup();
    const ada = await member(app);
    await profile(app, ada, { contact: 'ada@example.org' });
    const hidden = await member(app, 'Not Listed', { listed: false });
    expect((await ask(app, ada, hidden.id)).status).toBe(404);
    expect((await ask(app, ada, ada.id)).status).toBe(400);
    for (let i = 0; i < 8; i += 1) { const x = await member(app, `Person ${i}`); expect((await ask(app, ada, x.id)).status).toBe(201); }
    const ninth = await member(app, 'Person nine');
    const res = await ask(app, ada, ninth.id);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/8 requests waiting/);
    expect((await request(app).get('/api/introductions')).status).toBe(401);
    expect((await request(app).post('/api/introductions').send({ to: ninth.id, note: 'Hello there, friend.' })).status).toBe(401);
  });
});

describe('leaving', () => {
  it('takes a member\'s projects, the interest they gave and received, and every introduction with them, including the contact they shared', async () => {
    const { app, network } = await setup();
    const ada = await member(app);
    const bo = await member(app, 'Bo Example');
    await profile(app, ada, { contact: 'ada@example.org' });
    await profile(app, bo, { contact: 'bo@example.org' });
    const id = (await request(app).post('/api/projects').set(ada.auth).send(project())).body.project.id;
    await request(app).put(`/api/projects/${id}/interest`).set(bo.auth);
    const intro = (await request(app).post('/api/introductions').set(ada.auth).send({ to: bo.id, note: 'Hello, I would like to talk about this project.' })).body.introduction.id;
    await request(app).post(`/api/introductions/${intro}/accept`).set(bo.auth);
    const gone = await request(app).delete('/api/account').set(ada.auth).send({ password: 'a-long-enough-password' });
    expect(gone.status).toBe(204);
    const data = (await network.open()).store.read();
    expect(data.projects).toEqual([]);
    expect(data.interests).toEqual([]);
    expect(data.introductions).toEqual([]);
    expect((await request(app).get('/api/introductions').set(bo.auth)).body.results).toEqual([]);
    expect(JSON.stringify(data)).not.toMatch(/ada@example\.org/);
  });
});

describe('the founding-member list', () => {
  const entry = (over = {}) => ({ name: 'Ada Example', email: 'ada@example.org', city: 'Melbourne', intents: ['cofounder', 'feedback'], skills: ['engineering'], building: 'A ledger for sole traders', looking_for: 'A designer', link: 'https://example.org/ada', consent: true, ...over });

  it('takes a registration while the community is closed, with no account, and says where it is kept and whether that lasts', async () => {
    const { app, foundingDir } = await setup({ env: { RENDER: 'true' } });
    expect((await request(app).get('/api/network/status')).body).toMatchObject({ available: false, founding: { open: true, durable: false } });
    expect((await request(app).post('/api/auth/signup').send({ name: 'Ada', email: 'a@example.org', password: 'a-long-enough-password' })).status).toBe(503); // posting and accounts stay closed
    expect((await request(app).get('/api/projects')).status).toBe(503);
    const res = await request(app).post('/api/founding-members').send(entry());
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toEqual({ saved: true, durable: false });
    const file = JSON.parse(await readFile(path.join(foundingDir, 'founding_members.json'), 'utf8'));
    expect(file).toHaveLength(1);
    expect(file[0]).toMatchObject({ name: 'Ada Example', email: 'ada@example.org', intents: ['cofounder', 'feedback'], skills: ['engineering'] });
  });

  it('is a list the owner reads with the admin key, never public; the same email is one person; the list says it lasts only where the folder does', async () => {
    const { app } = await setup({ env: { RENDER: 'true' } });
    await request(app).post('/api/founding-members').send(entry());
    await request(app).post('/api/founding-members').send(entry({ name: 'Ada E.', city: 'Sydney' }));
    await request(app).post('/api/founding-members').send(entry({ email: 'bo@example.org', name: 'Bo Example' }));
    expect((await request(app).get('/api/admin/network/founding')).status).toBeGreaterThanOrEqual(401);
    const list = await request(app).get('/api/admin/network/founding').set(admin);
    expect(list.body).toMatchObject({ durable: false, count: 2 });
    expect(list.body.results.find((r) => r.email === 'ada@example.org')).toMatchObject({ name: 'Ada E.', city: 'Sydney' });
    expect(JSON.stringify(await request(app).get('/api/network/status').then((r) => r.body))).not.toMatch(/example\.org/);
    const { app: open } = await setup({ dir: await mkdtemp(path.join(os.tmpdir(), 'au-net-')) });
    expect((await request(open).post('/api/founding-members').send(entry())).body.durable).toBe(true);
  });

  it('lasts on a disk of its own while the community stays closed: FOUNDING_DATA_DIR is where the file is kept and makes the list durable, and the member side is still closed', async () => {
    const disk = await mkdtemp(path.join(os.tmpdir(), 'au-found-disk-'));
    made.push(disk);
    const f = await fixture(3);
    const network = createNetwork({ env: { RENDER: 'true', FOUNDING_DATA_DIR: disk }, curatedEvents: [], curatedJobsRows: [] });
    const app = createApp({ catalog: f.catalog, network });
    expect((await request(app).get('/api/network/status')).body).toMatchObject({ available: false, founding: { open: true, durable: true } });
    expect((await request(app).post('/api/auth/signup').send({ name: 'Ada', email: 'a@example.org', password: 'a-long-enough-password' })).status).toBe(503); // accounts stay closed
    const res = await request(app).post('/api/founding-members').send(entry());
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toEqual({ saved: true, durable: true });
    expect(JSON.parse(await readFile(path.join(disk, 'founding_members.json'), 'utf8'))).toHaveLength(1);
    expect((await request(app).get('/api/admin/network/founding').set(admin)).body).toMatchObject({ durable: true, count: 1 });
  });

  it('does nothing with a blank FOUNDING_DATA_DIR, and ignores it for an in-memory community: the list is then durable only where the community could be open', async () => {
    const blank = createNetwork({ env: { RENDER: 'true', FOUNDING_DATA_DIR: '  ' }, curatedEvents: [], curatedJobsRows: [] });
    expect(blank.founding.durable).toBe(false);
    const memory = createNetwork({ memory: true, env: { FOUNDING_DATA_DIR: '/var/data/founding' }, curatedEvents: [], curatedJobsRows: [] });
    expect(memory.founding.durable).toBe(false);
  });

  it('needs consent, a real email, a name and only listed intents and skills; a field only a script fills in is dropped; and slows one connection down', async () => {
    const { app, foundingDir } = await setup({ env: { RENDER: 'true' } });
    for (const body of [entry({ consent: false }), entry({ consent: undefined }), entry({ email: 'not an email' }), entry({ name: '' }), entry({ intents: ['world domination'] }), entry({ skills: ['wizardry'] }), entry({ link: 'http://insecure.example.org' })]) {
      expect((await request(app).post('/api/founding-members').send(body)).status, JSON.stringify(body).slice(0, 80)).toBe(400);
    }
    const bot = await request(app).post('/api/founding-members').send(entry({ company_website: 'https://spam.example' }));
    expect(bot.status).toBe(201);
    await expect(readFile(path.join(foundingDir, 'founding_members.json'), 'utf8')).rejects.toThrow(); // nothing kept
    for (let i = 0; i < 5; i += 1) expect((await request(app).post('/api/founding-members').send(entry({ email: `p${i}@example.org` }))).status).toBe(201);
    expect((await request(app).post('/api/founding-members').send(entry({ email: 'p9@example.org' }))).status).toBe(429);
  });
});
