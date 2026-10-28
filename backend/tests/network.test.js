import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createNetwork } from '../src/network/index.js';
import { fixture, removeTempDirs } from './helpers/catalog.js';
import { zonedToUtcMs, eventProblems, upcomingEvents, toIcs } from '../src/network/events.js';
import { employmentOf, levelOf, isGenericListing, regionOf } from '../src/network/jobs.js';

afterEach(removeTempDirs);

const NOW = Date.parse('2026-10-28T02:00:00Z'); // 28 Oct 2026, 1pm in Sydney
const KEY = 'test-admin-key';
let saved;
beforeEach(() => { saved = process.env.ADMIN_KEY; process.env.ADMIN_KEY = KEY; });
afterEach(() => { if (saved === undefined) delete process.env.ADMIN_KEY; else process.env.ADMIN_KEY = saved; });

const event = (over = {}) => ({
  id: 'founders-night-melbourne', name: 'Founders Night Melbourne', organiser: 'An Example Collective', type: 'founder_meetup', format: 'in_person', city: 'Melbourne', venue: 'The Example Hall',
  timezone: 'Australia/Melbourne', starts: '2026-11-12T18:00', ends: '2026-11-12T21:00', cost: { status: 'free' }, audience: 'Founders at any stage', why_selected: 'Run by a collective of Melbourne founders; open to all founders.',
  registration_url: 'https://example.org/founders-night', source_url: 'https://example.org/founders-night', source_checked_at: '2026-10-27', status: 'published', ...over,
});

async function setup({ events = [event()], jobsRows, env } = {}) {
  const f = await fixture(3);
  const [a, b] = f.rows;
  const job = (over) => ({ id: 'j-1', company_id: a.id, title: 'Senior Software Engineer', location: 'Sydney, NSW', employment_type: 'Full-Time', remote: null, posted_at: null, apply_url: 'https://job-boards.greenhouse.io/cobalt/jobs/1', status: 'open', retrieved_at: '2026-10-27T01:00:00Z', ...over });
  const rows = jobsRows ?? [
    job({}), job({ id: 'j-2', title: 'Account Executive', remote: true, location: 'Remote, Australia', employment_type: 'service_account' }), job({ id: 'j-3', title: 'Graduate Analyst', company_id: b.id, employment_type: 'Intern' }),
    job({ id: 'j-4', title: 'Closed Role', status: 'closed' }), job({ id: 'j-5', title: 'Role at a company we do not hold', company_id: 'nobody' }),
    job({ id: 'j-6', title: 'Old Reading', retrieved_at: '2026-10-01T01:00:00Z' }),
    job({ id: 'j-7', title: 'Cobalt Careers' }), job({ id: 'j-8', title: 'Join our Talent Community' }), job({ id: 'j-9', title: 'Product Designer', location: 'London, England, United Kingdom' }),
  ];
  const network = createNetwork({ memory: !env, now: () => NOW, curatedEvents: events, curatedJobsRows: rows, env, limits: { signups: 1000, logins: 8 } });
  const app = createApp({ catalog: f.catalog, network });
  return { app, network, f, companies: [a, b] };
}

let counter = 0;
async function member(app, name = 'Ada Example', over = {}) {
  counter += 1;
  const res = await request(app).post('/api/auth/signup').send({ name, email: `person${counter}@example.com`, password: 'a-long-enough-password', ...over });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { token: res.body.token, id: res.body.member.id, auth: { Authorization: `Bearer ${res.body.token}` } };
}
const post = (app, who, body = { topic: 'idea', body: 'What if every founder had a mentor in the same city?' }) => request(app).post('/api/feed').set(who.auth).send(body);
const admin = { 'x-admin-key': KEY };

describe('whether the members\' side is open', () => {
  it('is open on a developer\'s computer and in a test, and says so', async () => {
    const { app } = await setup();
    const res = await request(app).get('/api/network/status');
    expect(res.body).toMatchObject({ available: true, reason: null });
    expect(res.body.filters).toEqual(['all', 'ideas', 'building', 'questions']);
  });

  it('is NOT open on Render with no durable disk: it says so, takes no posts and no accounts, and the curated events still show', async () => {
    const { app } = await setup({ env: { RENDER: 'true' }, events: [event()] });
    const status = await request(app).get('/api/network/status');
    expect(status.body.available).toBe(false);
    expect(status.body.reason).toMatch(/disk that survives restarts/);
    for (const [method, url] of [['get', '/api/feed'], ['post', '/api/auth/signup'], ['get', '/api/members']]) {
      const res = await request(app)[method](url).send({});
      expect(res.status, url).toBe(503);
      expect(res.body.code).toBe('network_unavailable');
    }
    const events = await request(app).get('/api/events');
    expect(events.status).toBe(200);
    expect(events.body.results).toHaveLength(1);
    expect((await request(app).get('/api/jobs')).status).toBe(200);
  });

  it('is open on Render once a disk is named, and can be shut by hand', async () => {
    const { network: open } = await setup({ env: { RENDER: 'true', NETWORK_DATA_DIR: '/var/data/network' } });
    expect(open.available).toBe(true);
    const { network: shut } = await setup({ env: { NETWORK_ENABLED: '0' } });
    expect(shut.available).toBe(false);
    expect(shut.reason).toMatch(/closed by the site owner/);
  });
});

describe('accounts', () => {
  it('signs up with a name, an email and a password, and returns a session and the member (never the hash)', async () => {
    const { app } = await setup();
    const res = await request(app).post('/api/auth/signup').send({ name: 'Ada Example', email: 'Ada@Example.com', password: 'a-long-enough-password' });
    expect(res.status).toBe(201);
    expect(res.body.token).toMatch(/^se_/);
    expect(res.body.member).toMatchObject({ name: 'Ada Example', email: 'ada@example.com', initials: 'AE', listed: false, email_verified: false });
    expect(JSON.stringify(res.body)).not.toMatch(/password|scrypt/i);
    const me = await request(app).get('/api/account').set('Authorization', `Bearer ${res.body.token}`);
    expect(me.body.member.id).toBe(res.body.member.id);
  });

  it('refuses a short password, a bad email, a name that is too short, and an email already used', async () => {
    const { app } = await setup();
    const base = { name: 'Ada Example', email: 'ada@example.com', password: 'a-long-enough-password' };
    expect((await request(app).post('/api/auth/signup').send({ ...base, password: 'short' })).body.error).toMatch(/at least 10/);
    expect((await request(app).post('/api/auth/signup').send({ ...base, email: 'nope' })).body.error).toMatch(/valid email/);
    expect((await request(app).post('/api/auth/signup').send({ ...base, name: 'A' })).status).toBe(400);
    expect((await request(app).post('/api/auth/signup').send({ ...base, password: 'ada@example.com' })).status).toBe(400);
    expect((await request(app).post('/api/auth/signup').send(base)).status).toBe(201);
    const again = await request(app).post('/api/auth/signup').send({ ...base, name: 'Someone Else' });
    expect(again.status).toBe(400);
    expect(again.body.error).toMatch(/already an account/);
  });

  it('signs in with the right password, refuses the wrong one the same way for a stranger, and ends a session on sign-out', async () => {
    const { app } = await setup();
    await request(app).post('/api/auth/signup').send({ name: 'Ada Example', email: 'ada@example.com', password: 'a-long-enough-password' });
    const ok = await request(app).post('/api/auth/signin').send({ email: 'ADA@example.com', password: 'a-long-enough-password' });
    expect(ok.status).toBe(200);
    const wrong = await request(app).post('/api/auth/signin').send({ email: 'ada@example.com', password: 'not the password' });
    const stranger = await request(app).post('/api/auth/signin').send({ email: 'nobody@example.com', password: 'not the password' });
    expect([wrong.status, stranger.status]).toEqual([401, 401]);
    expect(wrong.body.error).toBe(stranger.body.error);
    const auth = { Authorization: `Bearer ${ok.body.token}` };
    expect((await request(app).post('/api/auth/signout').set(auth)).status).toBe(204);
    expect((await request(app).get('/api/account').set(auth)).status).toBe(401);
  });

  it('slows down guessing: after 8 wrong passwords for one email it refuses even the right one for a while', async () => {
    const { app } = await setup();
    await request(app).post('/api/auth/signup').send({ name: 'Ada Example', email: 'ada@example.com', password: 'a-long-enough-password' });
    for (let i = 0; i < 8; i += 1) await request(app).post('/api/auth/signin').send({ email: 'ada@example.com', password: `wrong-${i}` });
    const locked = await request(app).post('/api/auth/signin').send({ email: 'ada@example.com', password: 'a-long-enough-password' });
    expect(locked.status).toBe(429);
  });

  it('ignores a made-up, a malformed and an expired session', async () => {
    const { app } = await setup();
    expect((await request(app).get('/api/account').set('Authorization', 'Bearer se_notarealtoken')).status).toBe(401);
    expect((await request(app).get('/api/account').set('Authorization', 'Basic abc')).status).toBe(401);
    expect((await request(app).get('/api/account')).status).toBe(401);
    expect((await request(app).get('/api/feed').set('Authorization', 'Bearer se_notarealtoken')).status).toBe(200); // reading needs no account
  });

  it('changes a password only for someone who knows the current one, and ends every other session', async () => {
    const { app } = await setup();
    const a = await member(app);
    const other = (await request(app).post('/api/auth/signin').send({ email: 'person' + counter + '@example.com', password: 'a-long-enough-password' })).body.token;
    expect((await request(app).post('/api/account/password').set(a.auth).send({ current: 'wrong', next: 'another-long-password' })).status).toBe(401);
    expect((await request(app).post('/api/account/password').set(a.auth).send({ current: 'a-long-enough-password', next: 'short' })).status).toBe(400);
    expect((await request(app).post('/api/account/password').set(a.auth).send({ current: 'a-long-enough-password', next: 'another-long-password' })).status).toBe(204);
    expect((await request(app).get('/api/account').set(a.auth)).status).toBe(200); // this one stays
    expect((await request(app).get('/api/account').set({ Authorization: `Bearer ${other}` })).status).toBe(401);
  });
});

describe('profiles', () => {
  it('saves what a member writes about themselves, checked, and shows it publicly without their email', async () => {
    const { app } = await setup();
    const a = await member(app);
    const res = await request(app).patch('/api/account').set(a.auth).send({
      role: 'Founder, building a thing', city: 'Melbourne', intro: 'I make small tools.', open_to: ['collaborators', 'feedback'],
      building: [{ title: 'Tool', url: 'tool.example.com', note: 'An early version' }], links: { website: 'https://ada.example.com', professional_profile: '' },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.member.building[0].url).toBe('https://tool.example.com/');
    const pub = await request(app).get(`/api/members/${a.id}`);
    expect(pub.body.member).toMatchObject({ role: 'Founder, building a thing', city: 'Melbourne', open_to: ['collaborators', 'feedback'] });
    expect(JSON.stringify(pub.body)).not.toMatch(/@example\.com/);
  });

  it('refuses a link that is not https, too many projects, an unknown "open to" and text that is too long', async () => {
    const { app } = await setup();
    const a = await member(app);
    const patch = (body) => request(app).patch('/api/account').set(a.auth).send(body);
    expect((await patch({ links: { website: 'http://ada.example.com' } })).status).toBe(400);
    expect((await patch({ links: { website: 'javascript:alert(1)' } })).status).toBe(400);
    expect((await patch({ building: Array.from({ length: 6 }, (_, i) => ({ title: `P${i}` })) })).status).toBe(400);
    expect((await patch({ open_to: ['everything'] })).status).toBe(400);
    expect((await patch({ intro: 'x'.repeat(301) })).status).toBe(400);
    expect((await patch({ name: '' })).status).toBe(400);
    expect((await patch({ listed: 'yes' })).status).toBe(400);
  });

  it('lists in Discover only members who chose to be listed, and a search finds them by what they wrote', async () => {
    const { app } = await setup();
    const a = await member(app, 'Ada Example');
    const b = await member(app, 'Ben Sample');
    await request(app).patch('/api/account').set(a.auth).send({ listed: true, city: 'Melbourne', intro: 'Climate hardware.' });
    const listed = await request(app).get('/api/members');
    expect(listed.body.results.map((m) => m.name)).toEqual(['Ada Example']);
    expect((await request(app).get('/api/members?search=climate')).body.total).toBe(1);
    expect((await request(app).get('/api/members?search=zzz')).body.total).toBe(0);
    expect((await request(app).get('/api/members?city=Sydney')).body.total).toBe(0);
    expect(b.id).toBeTruthy();
  });

  it('leaves: deleting an account takes the member, their posts, replies, likes and saved things with it', async () => {
    const { app } = await setup();
    const a = await member(app, 'Ada Example');
    const b = await member(app, 'Ben Sample');
    const p = (await post(app, a)).body.post;
    await request(app).post(`/api/feed/${p.id}/replies`).set(b.auth).send({ body: 'Interesting.' });
    await request(app).put(`/api/feed/${p.id}/like`).set(b.auth);
    await request(app).put('/api/account/saved').set(b.auth).send({ kind: 'post', key: p.id, saved: true });
    expect((await request(app).delete('/api/account').set(a.auth).send({ password: 'wrong' })).status).toBe(401);
    expect((await request(app).delete('/api/account').set(a.auth).send({ password: 'a-long-enough-password' })).status).toBe(204);
    expect((await request(app).get('/api/feed')).body.results).toHaveLength(0);
    expect((await request(app).get(`/api/members/${a.id}`)).status).toBe(404);
    expect((await request(app).get('/api/account/saved').set(b.auth)).body.saved.post).toEqual([]);
    expect((await request(app).get('/api/account').set(a.auth)).status).toBe(401);
  });
});

describe('the feed', () => {
  it('needs an account to post, and a topic, and words of a sensible length', async () => {
    const { app } = await setup();
    expect((await request(app).post('/api/feed').send({ topic: 'idea', body: 'hello' })).status).toBe(401);
    const a = await member(app);
    expect((await post(app, a, { topic: 'gossip', body: 'hello' })).status).toBe(400);
    expect((await post(app, a, { topic: 'idea', body: '   ' })).status).toBe(400);
    expect((await post(app, a, { topic: 'idea', body: 'x'.repeat(601) })).status).toBe(400);
    expect((await post(app, a, { topic: 'idea', body: 'a b https://x.example c https://y.example d https://z.example' })).body.error).toMatch(/at most 2 links/);
    const ok = await post(app, a, { topic: 'win', body: 'Shipped the first version today.' });
    expect(ok.status).toBe(201);
    expect(ok.body.post).toMatchObject({ topic: 'win', topic_label: 'Small win', mine: true, like_count: 0, reply_count: 0, author: { name: 'Ada Example', initials: 'AE' } });
  });

  it('filters by Ideas, Building (which holds building, feedback and wins) and Questions, newest first, and pages', async () => {
    const { app } = await setup();
    const a = await member(app);
    for (const [topic, body] of [['idea', 'Idea one'], ['question', 'Question one'], ['building', 'Building one'], ['feedback', 'Feedback one'], ['win', 'Win one'], ['idea', 'Idea two']]) {
      await post(app, a, { topic, body });
    }
    const names = async (q) => (await request(app).get(`/api/feed${q}`)).body.results.map((p) => p.body);
    expect(await names('')).toEqual(['Idea two', 'Win one', 'Feedback one', 'Building one', 'Question one', 'Idea one']);
    expect(await names('?filter=ideas')).toEqual(['Idea two', 'Idea one']);
    expect(await names('?filter=building')).toEqual(['Win one', 'Feedback one', 'Building one']);
    expect(await names('?filter=questions')).toEqual(['Question one']);
    expect((await request(app).get('/api/feed?filter=other')).status).toBe(400);
    const first = (await request(app).get('/api/feed?limit=2')).body;
    expect(first.hasMore).toBe(true);
    const second = (await request(app).get(`/api/feed?limit=2&before=${first.next}`)).body;
    expect(second.results.map((p) => p.body)).toEqual(['Feedback one', 'Building one']);
    expect((await request(app).get('/api/feed?before=p_nope')).status).toBe(400);
  });

  it('lets only the author edit or delete a post, marks it edited, and a deleted post leaves no words behind', async () => {
    const { app, network } = await setup();
    const a = await member(app, 'Ada Example');
    const b = await member(app, 'Ben Sample');
    const p = (await post(app, a)).body.post;
    expect((await request(app).patch(`/api/feed/${p.id}`).set(b.auth).send({ body: 'hijacked' })).status).toBe(403);
    expect((await request(app).delete(`/api/feed/${p.id}`).set(b.auth)).status).toBe(403);
    const edited = await request(app).patch(`/api/feed/${p.id}`).set(a.auth).send({ body: 'A better version of the idea.', topic: 'feedback' });
    expect(edited.body.post).toMatchObject({ body: 'A better version of the idea.', topic: 'feedback' });
    expect(edited.body.post.edited_at).toBeTruthy();
    expect((await request(app).delete(`/api/feed/${p.id}`).set(a.auth)).status).toBe(204);
    expect((await request(app).get(`/api/feed/${p.id}`)).status).toBe(404);
    expect((await request(app).get('/api/feed')).body.results).toHaveLength(0);
    const { store } = await network.open();
    expect(store.read().posts.find((x) => x.id === p.id)).toMatchObject({ status: 'deleted', body: '' });
  });

  it('has replies, which their author can edit and delete and others cannot, and counts them', async () => {
    const { app } = await setup();
    const a = await member(app, 'Ada Example');
    const b = await member(app, 'Ben Sample');
    const p = (await post(app, a)).body.post;
    const r = await request(app).post(`/api/feed/${p.id}/replies`).set(b.auth).send({ body: 'Have you tried asking founders directly?' });
    expect(r.status).toBe(201);
    expect((await request(app).post(`/api/feed/${p.id}/replies`).send({ body: 'anon' })).status).toBe(401);
    expect((await request(app).post(`/api/feed/${p.id}/replies`).set(b.auth).send({ body: 'x'.repeat(401) })).status).toBe(400);
    expect((await request(app).patch(`/api/replies/${r.body.reply.id}`).set(a.auth).send({ body: 'nope' })).status).toBe(403);
    expect((await request(app).patch(`/api/replies/${r.body.reply.id}`).set(b.auth).send({ body: 'Have you asked founders?' })).body.reply.edited_at).toBeTruthy();
    const thread = await request(app).get(`/api/feed/${p.id}`).set(a.auth);
    expect(thread.body.replies).toHaveLength(1);
    expect(thread.body.post.reply_count).toBe(1);
    expect((await request(app).get('/api/feed').set(a.auth)).body.results[0].reply_count).toBe(1);
    expect((await request(app).delete(`/api/replies/${r.body.reply.id}`).set(a.auth)).status).toBe(403);
    expect((await request(app).delete(`/api/replies/${r.body.reply.id}`).set(b.auth)).status).toBe(204);
    expect((await request(app).get(`/api/feed/${p.id}`)).body.replies).toHaveLength(0);
  });

  it('likes and bookmarks once each, however many times it is asked, and each person sees their own', async () => {
    const { app } = await setup();
    const a = await member(app, 'Ada Example');
    const b = await member(app, 'Ben Sample');
    const p = (await post(app, a)).body.post;
    expect((await request(app).put(`/api/feed/${p.id}/like`).set(b.auth)).body.like_count).toBe(1);
    expect((await request(app).put(`/api/feed/${p.id}/like`).set(b.auth)).body.like_count).toBe(1);
    expect((await request(app).put(`/api/feed/${p.id}/like`).set(a.auth)).body.like_count).toBe(2);
    expect((await request(app).delete(`/api/feed/${p.id}/like`).set(a.auth)).body.like_count).toBe(1);
    await request(app).put('/api/account/saved').set(b.auth).send({ kind: 'post', key: p.id, saved: true });
    const seenByB = (await request(app).get('/api/feed').set(b.auth)).body.results[0];
    const seenByA = (await request(app).get('/api/feed').set(a.auth)).body.results[0];
    const seenByAnon = (await request(app).get('/api/feed')).body.results[0];
    expect([seenByB.liked, seenByB.bookmarked, seenByA.liked, seenByA.bookmarked, seenByAnon.liked]).toEqual([true, true, false, false, false]);
    expect(seenByAnon.like_count).toBe(1);
    expect((await request(app).put(`/api/feed/${p.id}/like`)).status).toBe(401);
  });

  it('slows posting down: 12 posts an hour', async () => {
    const { app } = await setup();
    const a = await member(app);
    for (let i = 0; i < 12; i += 1) expect((await post(app, a, { topic: 'idea', body: `Post ${i}` })).status).toBe(201);
    expect((await post(app, a, { topic: 'idea', body: 'One too many' })).status).toBe(429);
  });
});

describe('reports and moderation', () => {
  it('lets a member report someone else\'s post once, with a reason, and not their own', async () => {
    const { app } = await setup();
    const a = await member(app, 'Ada Example');
    const b = await member(app, 'Ben Sample');
    const p = (await post(app, a)).body.post;
    expect((await request(app).post(`/api/feed/${p.id}/report`).send({ reason: 'spam' })).status).toBe(401);
    expect((await request(app).post(`/api/feed/${p.id}/report`).set(a.auth).send({ reason: 'spam' })).status).toBe(400);
    expect((await request(app).post(`/api/feed/${p.id}/report`).set(b.auth).send({ reason: 'boring' })).status).toBe(400);
    expect((await request(app).post(`/api/feed/${p.id}/report`).set(b.auth).send({ reason: 'spam', note: 'Looks like an advert.' })).status).toBe(201);
    const again = await request(app).post(`/api/feed/${p.id}/report`).set(b.auth).send({ reason: 'spam' });
    expect(again.body.already).toBe(true);
    const queue = await request(app).get('/api/admin/network/reports').set(admin);
    expect(queue.body.results).toHaveLength(1);
    expect(queue.body.results[0]).toMatchObject({ target_kind: 'post', body: p.body, author: { name: 'Ada Example' } });
    expect(queue.body.results[0].reports).toHaveLength(1);
  });

  it('hides a post from everyone else once three people have reported it, but keeps it for its author with the notice, until a moderator decides', async () => {
    const { app } = await setup();
    const a = await member(app, 'Ada Example');
    const p = (await post(app, a)).body.post;
    for (const name of ['Ben', 'Cal', 'Dee']) {
      const who = await member(app, `${name} Reporter`);
      await request(app).post(`/api/feed/${p.id}/report`).set(who.auth).send({ reason: 'abuse' });
    }
    expect((await request(app).get('/api/feed')).body.results).toHaveLength(0);
    const mine = (await request(app).get('/api/feed').set(a.auth)).body.results;
    expect(mine).toHaveLength(1);
    expect(mine[0].status).toBe('hidden');
    expect((await request(app).patch(`/api/feed/${p.id}`).set(a.auth).send({ body: 'sneaky edit' })).status).toBe(403);
    // the moderator reads it and lets it stand
    await request(app).post(`/api/admin/network/reports/post/${p.id}`).set(admin).send({ action: 'dismiss', note: 'Fine.' });
    expect((await request(app).get('/api/feed')).body.results).toHaveLength(1);
    expect((await request(app).get('/api/admin/network/reports').set(admin)).body.results).toHaveLength(0);
  });

  it('lets a moderator hide, remove, or remove and suspend, and a suspended member cannot post or sign in again', async () => {
    const { app, network } = await setup();
    const a = await member(app, 'Ada Example');
    const b = await member(app, 'Ben Sample');
    const p1 = (await post(app, a, { topic: 'idea', body: 'Buy my thing now' })).body.post;
    await request(app).post(`/api/feed/${p1.id}/report`).set(b.auth).send({ reason: 'spam' });
    expect((await request(app).post(`/api/admin/network/reports/post/${p1.id}`).set(admin).send({ action: 'bogus' })).status).toBe(400);
    await request(app).post(`/api/admin/network/reports/post/${p1.id}`).set(admin).send({ action: 'hide' });
    expect((await request(app).get('/api/feed')).body.results).toHaveLength(0);
    expect((await request(app).get('/api/admin/network/reports').set(admin)).body.results).toHaveLength(1); // still waiting for a decision
    await request(app).post(`/api/admin/network/reports/post/${p1.id}`).set(admin).send({ action: 'suspend_author', note: 'Spam.' });
    const { store } = await network.open();
    expect(store.read().posts.find((x) => x.id === p1.id)).toMatchObject({ status: 'removed', body: '' });
    expect(store.read().members.find((m) => m.id === a.id).suspended).toBe(true);
    expect((await request(app).get('/api/account').set(a.auth)).status).toBe(401); // its sessions ended
    expect((await request(app).post('/api/auth/signin').send({ email: store.read().members.find((m) => m.id === a.id).email, password: 'a-long-enough-password' })).status).toBe(200);
    const again = await request(app).post('/api/auth/signin').send({ email: store.read().members.find((m) => m.id === a.id).email, password: 'a-long-enough-password' });
    expect((await post(app, { auth: { Authorization: `Bearer ${again.body.token}` } })).status).toBe(403);
    expect(store.read().audit.map((x) => x.action)).toEqual(['feed.hide', 'feed.suspend_author']);
    // a moderator can lift a suspension
    await request(app).post(`/api/admin/network/members/${a.id}`).set(admin).send({ suspended: false });
    expect((await post(app, { auth: { Authorization: `Bearer ${again.body.token}` } })).status).toBe(201);
  });

  it('keeps the moderators\' routes behind the admin key, in constant time and slowed down when it is wrong', async () => {
    const { app } = await setup();
    const url = '/api/admin/network/reports';
    expect((await request(app).get(url)).status).toBe(401);
    expect((await request(app).get(url).set('x-admin-key', 'nope')).status).toBe(401);
    expect((await request(app).get(url).set(admin)).status).toBe(200);
    delete process.env.ADMIN_KEY;
    expect((await request(app).get(url).set(admin)).status).toBe(401); // no key configured: closed, not open
    process.env.ADMIN_KEY = KEY;
    for (let i = 0; i < 12; i += 1) await request(app).get(url).set('x-admin-key', `wrong-${i}`);
    expect((await request(app).get(url).set(admin)).status).toBe(429);
  });
});

describe('saved things', () => {
  it('saves, lists and un-saves, per member, and the same thing twice is one', async () => {
    const { app } = await setup();
    const a = await member(app, 'Ada Example');
    const b = await member(app, 'Ben Sample');
    const put = (who, body) => request(app).put('/api/account/saved').set(who.auth).send(body);
    expect((await put(a, { kind: 'startup', key: 'Cobalt Labs', saved: true })).status).toBe(200);
    await put(a, { kind: 'startup', key: 'Cobalt Labs', saved: true });
    await put(a, { kind: 'investor', key: 'airtree', saved: true });
    await put(a, { kind: 'event', key: 'founders-night-melbourne', saved: true });
    const mine = (await request(app).get('/api/account/saved').set(a.auth)).body.saved;
    expect(mine).toMatchObject({ startup: ['Cobalt Labs'], investor: ['airtree'], event: ['founders-night-melbourne'], job: [], post: [], member: [] });
    expect((await request(app).get('/api/account/saved').set(b.auth)).body.saved.startup).toEqual([]);
    await put(a, { kind: 'startup', key: 'Cobalt Labs', saved: false });
    expect((await put(a, { kind: 'startup', key: 'Cobalt Labs', saved: false })).status).toBe(200); // un-saving what is not saved is fine
    expect((await request(app).get('/api/account/saved').set(a.auth)).body.saved.startup).toEqual([]);
    expect((await put(a, { kind: 'banana', key: 'x', saved: true })).status).toBe(400);
    expect((await put(a, { kind: 'startup', key: '', saved: true })).status).toBe(400);
    expect((await request(app).get('/api/account/saved')).status).toBe(401);
  });

  it('merges what was saved on a device before signing in, adding and never removing', async () => {
    const { app } = await setup();
    const a = await member(app);
    await request(app).put('/api/account/saved').set(a.auth).send({ kind: 'investor', key: 'airtree', saved: true });
    const merged = await request(app).post('/api/account/saved/merge').set(a.auth).send({ items: [{ kind: 'investor', key: 'airtree' }, { kind: 'investor', key: 'blackbird' }, { kind: 'startup', key: 'Cobalt Labs' }, { kind: 'nonsense', key: 'x' }, { kind: 'startup' }] });
    expect(merged.body.added).toBe(2);
    expect(merged.body.saved.investor.sort()).toEqual(['airtree', 'blackbird']);
    expect(merged.body.saved.startup).toEqual(['Cobalt Labs']);
  });
});

describe('events', () => {
  const dateOnly = event({ id: 'summit-sydney', name: 'Example Summit', type: 'conference', city: 'Sydney', timezone: 'Australia/Sydney', starts: '2026-11-20', ends: '2026-11-21', cost: { status: 'unconfirmed' }, venue: '' });
  const past = event({ id: 'old-night', name: 'Old Night', starts: '2026-10-01T18:00', ends: '2026-10-01T21:00' });
  const online = event({ id: 'online-workshop', name: 'Pitch Workshop', type: 'workshop', format: 'online', city: '', venue: '', online_url: 'https://example.org/join', timezone: 'Australia/Sydney', starts: '2026-12-02T12:00', ends: '2026-12-02T13:00', cost: { status: 'paid', note: 'See the organiser\'s page for the price.' } });

  it('lists upcoming events soonest first, with the time zone, and hides the ones that are over', async () => {
    const { app } = await setup({ events: [online, past, dateOnly, event()] });
    const res = await request(app).get('/api/events');
    expect(res.body.results.map((e) => e.id)).toEqual(['founders-night-melbourne', 'summit-sydney', 'online-workshop']);
    expect(res.body.results[0]).toMatchObject({ timezone: 'Australia/Melbourne', time_confirmed: true, starts_at: '2026-11-12T07:00:00.000Z', type_label: 'Founder gathering', cost: { status: 'free' } });
    expect(res.body.results[1]).toMatchObject({ time_confirmed: false, starts: '2026-11-20' });
    expect((await request(app).get('/api/events/old-night')).status).toBe(404);
  });

  it('filters by city, type and format and says what is on offer', async () => {
    const { app } = await setup({ events: [online, dateOnly, event()] });
    expect((await request(app).get('/api/events?city=Melbourne')).body.results.map((e) => e.id)).toEqual(['founders-night-melbourne']);
    expect((await request(app).get('/api/events?type=conference')).body.results.map((e) => e.id)).toEqual(['summit-sydney']);
    expect((await request(app).get('/api/events?format=online')).body.results.map((e) => e.id)).toEqual(['online-workshop']);
    expect((await request(app).get('/api/events?search=pitch')).body.count).toBe(1);
    const facets = (await request(app).get('/api/events')).body.facets;
    expect(facets.cities.map((c) => c.value).sort()).toEqual(['Melbourne', 'Sydney']);
    expect(facets.types.map((t) => t.label)).toContain('Conference');
  });

  it('never shows an event with a record problem: a missing source, a made-up zone, no registration page', async () => {
    const broken = [event({ id: 'no-source', source_url: '' }), event({ id: 'bad-zone', timezone: 'Mars/Olympus' }), event({ id: 'no-register', registration_url: 'http://example.org' }), event({ id: 'no-why', why_selected: '' })];
    const { app } = await setup({ events: [...broken, event()] });
    expect((await request(app).get('/api/events')).body.results.map((e) => e.id)).toEqual(['founders-night-melbourne']);
    expect(eventProblems(broken[1]).join()).toMatch(/timezone/);
    expect(eventProblems(event())).toEqual([]);
  });

  it('works out moments in the event\'s own zone, across daylight saving', () => {
    expect(new Date(zonedToUtcMs('2026-11-12T18:00', 'Australia/Melbourne')).toISOString()).toBe('2026-11-12T07:00:00.000Z'); // summer time, UTC+11
    expect(new Date(zonedToUtcMs('2026-07-01T09:00', 'Australia/Sydney')).toISOString()).toBe('2026-06-30T23:00:00.000Z'); // winter, UTC+10
    expect(new Date(zonedToUtcMs('2026-11-12T09:00', 'Australia/Perth')).toISOString()).toBe('2026-11-12T01:00:00.000Z'); // no daylight saving, UTC+8
  });

  it('keeps an event listed until it is over, and an event with no end time until three hours after it starts', () => {
    const e = event({ ends: undefined, starts: '2026-10-28T10:00', timezone: 'Australia/Sydney' }); // 10am Sydney = 23:00Z the day before
    expect(upcomingEvents([e], Date.parse('2026-10-27T23:00:00Z') + 2 * 3600000)).toHaveLength(1);
    expect(upcomingEvents([e], Date.parse('2026-10-27T23:00:00Z') + 4 * 3600000)).toHaveLength(0);
    const day = event({ id: 'day', starts: '2026-10-28', ends: undefined, timezone: 'Australia/Sydney' });
    expect(upcomingEvents([day], Date.parse('2026-10-28T12:00:00Z'))).toHaveLength(1); // 11pm Sydney: still the day
    expect(upcomingEvents([day], Date.parse('2026-10-28T14:00:00Z'))).toHaveLength(0);
  });

  it('gives a calendar file with a reminder, in UTC, and an all-day entry for a day with no time', async () => {
    const { app } = await setup({ events: [dateOnly, event()] });
    const timed = await request(app).get('/api/events/founders-night-melbourne/calendar.ics');
    expect(timed.status).toBe(200);
    expect(timed.headers['content-type']).toMatch(/text\/calendar/);
    expect(timed.text).toContain('BEGIN:VCALENDAR');
    expect(timed.text).toContain('DTSTART:20261112T070000Z');
    expect(timed.text).toContain('DTEND:20261112T100000Z');
    expect(timed.text).toContain('SUMMARY:Founders Night Melbourne');
    expect(timed.text).toContain('LOCATION:The Example Hall\\, Melbourne');
    expect(timed.text).toContain('TRIGGER:-P1D');
    expect(timed.text).toContain('URL:https://example.org/founders-night');
    const all = await request(app).get('/api/events/summit-sydney/calendar.ics');
    expect(all.text).toContain('DTSTART;VALUE=DATE:20261120');
    expect(all.text).toContain('DTEND;VALUE=DATE:20261122');
    expect((await request(app).get('/api/events/nope/calendar.ics')).status).toBe(404);
    expect(toIcs(event(), { now: NOW }).split('\r\n').every((l) => l.length <= 75)).toBe(true);
  });
});

describe('jobs', () => {
  it('lists open roles at companies in the directory, each with the employer\'s own link, why it is listed and when it was read; closed and unknown-company roles are out', async () => {
    const { app } = await setup();
    const res = await request(app).get('/api/jobs');
    const titles = res.body.results.map((j) => j.title);
    expect(titles).toEqual(expect.arrayContaining(['Senior Software Engineer', 'Account Executive', 'Graduate Analyst']));
    expect(titles).not.toContain('Closed Role');
    expect(titles).not.toContain('Role at a company we do not hold');
    const senior = res.body.results.find((j) => j.id === 'j-1');
    expect(senior).toMatchObject({
      level: 'senior', employment_type: 'full_time', remote: null, salary: null, apply_url: 'https://job-boards.greenhouse.io/cobalt/jobs/1', stale: false, days_since_checked: 1,
      company: { name: expect.any(String), slug: expect.any(String) },
    });
    expect(senior.why_listed).toMatch(/own careers page on Greenhouse, last read 2026-10-27/);
    expect(res.body.facets.remote).toBe(1);
  });

  it('marks a reading older than the site\'s 14-day window as stale rather than hiding or hiding it', async () => {
    const { app } = await setup();
    const old = (await request(app).get('/api/jobs')).body.results.find((j) => j.id === 'j-6');
    expect(old).toMatchObject({ stale: true, days_since_checked: 27 });
  });

  it('shows closed roles only when asked, marked closed', async () => {
    const { app } = await setup();
    const res = await request(app).get('/api/jobs?include_closed=yes');
    expect(res.body.results.find((j) => j.id === 'j-4')).toMatchObject({ status: 'closed' });
  });

  it('filters by words, remote, type and level, and pages', async () => {
    const { app } = await setup();
    const ids = async (q) => (await request(app).get(`/api/jobs${q}`)).body.results.map((j) => j.id).sort();
    expect(await ids('?search=analyst')).toEqual(['j-3']);
    expect(await ids('?remote=yes')).toEqual(['j-2']);
    expect(await ids('?type=internship')).toEqual(['j-3']);
    expect(await ids('?level=senior')).toEqual(['j-1']);
    expect(await ids('?level=graduate')).toEqual(['j-3']);
    const page = (await request(app).get('/api/jobs?limit=2')).body;
    expect(page.results).toHaveLength(2);
    expect(page.hasMore).toBe(true);
  });

  it('leaves out a row that is a page and not a role (a talent community, "Other careers in the US", "Acme Careers"), and says where a role is', async () => {
    const { app } = await setup();
    const titles = (await request(app).get('/api/jobs')).body.results.map((j) => j.title);
    expect(titles).not.toContain('Cobalt Careers');
    expect(titles).not.toContain('Join our Talent Community');
    expect(titles).toContain('Product Designer');
    expect(['Acme Careers', 'Other Careers in APAC', 'Future Job Openings with Emesent', 'Join our Talent Community', 'General Application'].map(isGenericListing)).toEqual(Array(5).fill(true));
    expect(['Careers Advisor', 'Senior Software Engineer', 'Customer Success Manager'].map(isGenericListing)).toEqual([false, false, false]);
    expect([regionOf('Sydney, NSW, Australia'), regionOf('Melbourne, VIC'), regionOf('Remote, Australia'), regionOf('Chicago, IL, United States'), regionOf('London, England, United Kingdom'), regionOf('Remote'), regionOf('')]).toEqual(['au', 'au', 'au', 'other', 'other', null, null]);
    expect(regionOf('Canberra, ACT, Australia; Cebu, Central Visayas, Philippines')).toBe('au');
    const au = (await request(app).get('/api/jobs?where=au')).body;
    expect(au.results.map((j) => j.id)).not.toContain('j-9');
    expect((await request(app).get('/api/jobs?where=other')).body.results.map((j) => j.id)).toEqual(['j-9']);
    expect(au.facets.regions).toEqual({ au: expect.any(Number), other: 1 });
  });

  it('reads the listing\'s own words into a few kinds, and says nothing where they say nothing', () => {
    expect(['Full-Time', 'Full Time Permanent', 'FULL_TIME', 'Full-time'].map(employmentOf)).toEqual(Array(4).fill('full_time'));
    expect([employmentOf('Fixed Term Contract'), employmentOf('Intern'), employmentOf('Part time'), employmentOf('Contract')]).toEqual(['fixed_term', 'internship', 'part_time', 'contract']);
    expect([employmentOf('service_account'), employmentOf('Any job type'), employmentOf(null)]).toEqual([null, null, null]);
    expect([levelOf('Senior Software Engineer'), levelOf('Head of Growth'), levelOf('Graduate Analyst'), levelOf('Software Engineer'), levelOf('Marketing Intern')]).toEqual(['senior', 'head', 'graduate', null, 'intern']);
    expect([levelOf('Enterprise Account Manager'), levelOf('Staff Accountant'), levelOf('Associate Director'), levelOf('Engineering Lead')]).toEqual([null, null, 'head', 'lead']);
  });
});

describe('suggestions', () => {
  const suggestEvent = { kind: 'event', fields: { name: 'Climate Founders Night', organiser: 'An Example Group', type: 'founder_meetup', format: 'in_person', city: 'Brisbane', starts: '2026-12-03T18:00', registration_url: 'https://example.org/climate' }, email: 'tipster@example.com' };
  const suggestJob = { kind: 'job', fields: { title: 'Founding Engineer', company: 'Example Startup', location: 'Perth', apply_url: 'https://example.org/jobs/1', note: 'They are hiring.' } };

  it('takes a suggestion from anyone, checked, and shows nothing until a person has reviewed it', async () => {
    const { app } = await setup({ events: [] });
    expect((await request(app).post('/api/suggestions').send(suggestEvent)).status).toBe(201);
    expect((await request(app).post('/api/suggestions').send(suggestJob)).status).toBe(201);
    expect((await request(app).post('/api/suggestions').send({ kind: 'job', fields: { title: 'x' } })).status).toBe(400);
    expect((await request(app).post('/api/suggestions').send({ kind: 'event', fields: { ...suggestEvent.fields, starts: 'next Tuesday' } })).status).toBe(400);
    expect((await request(app).post('/api/suggestions').send({ kind: 'event', fields: { ...suggestEvent.fields, registration_url: 'http://example.org' } })).status).toBe(400);
    expect((await request(app).post('/api/suggestions').send({ ...suggestEvent, email: 'not-an-email' })).status).toBe(400);
    expect((await request(app).post('/api/suggestions').send({ kind: 'book', fields: {} })).status).toBe(400);
    expect((await request(app).get('/api/events')).body.results).toHaveLength(0);
    expect((await request(app).get('/api/jobs')).body.results.some((j) => j.title === 'Founding Engineer')).toBe(false);
    expect((await request(app).get('/api/admin/network/suggestions')).status).toBe(401);
    const queue = await request(app).get('/api/admin/network/suggestions').set(admin);
    expect(queue.body.results.map((s) => s.kind)).toEqual(['event', 'job']);
    expect(queue.body.results[0].contact_email).toBe('tipster@example.com');
  });

  it('approves an event only once the reviewer has supplied what the page needs, and then it is listed', async () => {
    const { app } = await setup({ events: [] });
    const id = (await request(app).post('/api/suggestions').send(suggestEvent)).body.id;
    const approve = (completed) => request(app).post(`/api/admin/network/suggestions/${id}/approve`).set(admin).send({ completed });
    const missing = await approve({});
    expect(missing.status).toBe(400);
    expect(missing.body.error).toMatch(/timezone/);
    expect((await approve({ timezone: 'Europe/London', audience: 'Climate founders', why_selected: 'Run by an example group.', source_checked_at: '2026-10-28' })).body.error).toMatch(/Australian event/);
    const ok = await approve({ timezone: 'Australia/Brisbane', audience: 'Climate founders', why_selected: 'Run by an example group; open to all climate founders.', source_checked_at: '2026-10-28', cost: { status: 'free' } });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const listed = (await request(app).get('/api/events')).body.results;
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ name: 'Climate Founders Night', city: 'Brisbane', origin: 'suggestion', source_checked_at: '2026-10-28', time_confirmed: true });
    expect((await request(app).post(`/api/admin/network/suggestions/${id}/approve`).set(admin).send({ completed: {} })).status).toBe(404); // already dealt with
    expect((await request(app).get('/api/admin/network/suggestions').set(admin)).body.results).toHaveLength(0);
    await request(app).post(`/api/admin/network/listings/event/${listed[0].id}/withdraw`).set(admin).send({ note: 'Cancelled.' });
    expect((await request(app).get('/api/events')).body.results[0].status).toBe('cancelled');
  });

  it('approves a job with the day it was checked and why it is listed, and shows it among the roles; rejecting says why and lists nothing', async () => {
    const { app } = await setup();
    const id = (await request(app).post('/api/suggestions').send(suggestJob)).body.id;
    expect((await request(app).post(`/api/admin/network/suggestions/${id}/approve`).set(admin).send({ completed: {} })).status).toBe(400);
    const ok = await request(app).post(`/api/admin/network/suggestions/${id}/approve`).set(admin).send({ completed: { retrieved_at: '2026-10-28', why: 'Listed on the company\'s own careers page, read on 28 October.' } });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const job = (await request(app).get('/api/jobs?search=founding')).body.results[0];
    expect(job).toMatchObject({ title: 'Founding Engineer', company: { name: 'Example Startup', slug: null }, source_kind: 'suggestion', stale: false });
    const other = (await request(app).post('/api/suggestions').send({ ...suggestJob, fields: { ...suggestJob.fields, title: 'Spam Role' } })).body.id;
    expect((await request(app).post(`/api/admin/network/suggestions/${other}/reject`).set(admin).send({ note: 'Not a real page.' })).status).toBe(200);
    expect((await request(app).get('/api/jobs?search=spam')).body.results).toHaveLength(0);
  });
});
