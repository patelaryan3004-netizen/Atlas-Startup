// The members' side of the API: accounts, profiles, the feed, saved things, events, jobs, suggestions, and the moderators' queues.
//
//   Reading the feed, members, events and jobs needs no account. Writing needs one. Changing or deleting something needs to be the person who made it.
//   The moderators' routes need the admin key (x-admin-key, the same secret the other review queues use), checked in constant time and slowed down when wrong.
import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { ApiError, bad, unauthorized, forbidden, notFound, cleanText } from './validate.js';
import { createLimiter } from './auth.js';
import { privateMember, publicMember, profileChanges, listMembers } from './members.js';
import {
  listPosts, getThread, createPost, editPost, deletePost, createReply, editReply, deleteReply, setLike, createReport, openReports, moderate, FILTERS, TOPICS, TOPIC_LABELS, MAX_POST, MAX_REPLY,
} from './feed.js';
import { listSaved, setSaved, mergeSaved, SAVED_KINDS } from './saved.js';
import { upcomingEvents, filterEvents, eventFacets, toIcs, EVENT_TYPE_LABELS } from './events.js';
import { curatedJobs, filterJobs, jobFacets } from './jobs.js';
import { createSuggestion, pendingSuggestions, approveSuggestion, rejectSuggestion, withdrawListing } from './suggestions.js';
import { offsetParams, offsetInfo } from '../http/paging.js';
import { recordFor } from '../catalog/catalog.js';

const safeEqual = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };
const bearer = (req) => { const h = req.get('authorization') ?? ''; return h.startsWith('Bearer ') ? h.slice(7).trim() : null; };
const text = (v) => (v === undefined ? '' : String(v));
// A list of ids in a query (?ids=a,b,c): how a page asks for exactly the things a person saved. At most 60.
const idList = (v) => (v === undefined ? null : String(v).split(',').map((s) => s.trim()).filter(Boolean).slice(0, 60));

export function createNetworkRouter({ network, catalog, now = network.now }) {
  const router = Router();
  const wrap = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (err) { next(err); } };

  // The store, or the plain 503 when the community cannot be open.
  const ctx = async () => network.open();

  // Who is asking, if they sent a session. A bad or expired token is the same as none: reading still works.
  const identify = async (req) => {
    if (!network.available) return;
    const token = bearer(req);
    if (!token) return;
    const { auth } = await ctx();
    const found = await auth.sessionFor(token);
    if (found) { req.member = found.member; req.token = token; }
  };
  const optional = (req, res, next) => identify(req).then(() => next(), next);
  const required = (req, res, next) => identify(req).then(() => (req.member ? next() : next(unauthorized())), next);
  // Suspended members can read and sign out; they cannot make or change anything.
  const active = (req, res, next) => (req.member.suspended ? next(forbidden('This account has been suspended, so it cannot post or change things.')) : next());
  const write = [required, active];

  // ---------- status ----------

  router.get('/network/status', (req, res) => res.json({ available: network.available, reason: network.reason, topics: TOPICS.map((t) => ({ id: t, label: TOPIC_LABELS[t] })), filters: Object.keys(FILTERS), limits: { post: MAX_POST, reply: MAX_REPLY } }));

  // ---------- accounts ----------

  router.post('/auth/signup', wrap(async (req, res) => {
    const { auth } = await ctx();
    const { name, email, password, listed } = req.body ?? {};
    const { token, member: m } = await auth.signUp({ name, email, password, listed: listed === true, ip: req.ip });
    res.status(201).json({ token, member: privateMember(m) });
  }));

  router.post('/auth/signin', wrap(async (req, res) => {
    const { auth } = await ctx();
    const { token, member: m } = await auth.signIn({ email: req.body?.email, password: req.body?.password, ip: req.ip });
    res.json({ token, member: privateMember(m) });
  }));

  router.post('/auth/signout', required, wrap(async (req, res) => {
    const { auth } = await ctx();
    await auth.signOut(req.token);
    res.status(204).end();
  }));

  router.get('/account', required, (req, res) => res.json({ member: privateMember(req.member) }));

  router.patch('/account', ...write, wrap(async (req, res) => {
    const { store } = await ctx();
    const changes = profileChanges(req.body);
    const updated = await store.change((draft) => {
      const m = draft.members.find((x) => x.id === req.member.id);
      Object.assign(m, changes, { updated_at: new Date(now()).toISOString() });
      return m;
    });
    res.json({ member: privateMember(updated) });
  }));

  router.post('/account/password', required, wrap(async (req, res) => {
    const { auth } = await ctx();
    await auth.changePassword(req.member.id, { current: req.body?.current, next: req.body?.next, keepToken: req.token });
    res.status(204).end();
  }));

  // Leaving: the account and everything it made goes. (A report someone made about their words is closed: there is nothing left to look at.)
  router.delete('/account', required, wrap(async (req, res) => {
    const { auth, store } = await ctx();
    await auth.confirmPassword(req.member.id, req.body?.password); // asked for again, with the same slowing-down as a wrong sign-in
    await store.change((draft) => {
      const id = req.member.id;
      const mine = new Set(draft.posts.filter((p) => p.author_id === id).map((p) => p.id));
      draft.members = draft.members.filter((m) => m.id !== id);
      draft.sessions = draft.sessions.filter((s) => s.member_id !== id);
      draft.posts = draft.posts.filter((p) => p.author_id !== id);
      draft.replies = draft.replies.filter((r) => r.author_id !== id && !mine.has(r.post_id));
      draft.likes = draft.likes.filter((l) => l.member_id !== id && !mine.has(l.post_id));
      draft.saved = draft.saved.filter((s) => s.member_id !== id && !(s.kind === 'member' && s.key === id) && !(s.kind === 'post' && mine.has(s.key)));
      draft.reports = draft.reports.filter((r) => r.reporter_id !== id || r.status !== 'open').map((r) => (r.status === 'open' && mine.has(r.target_id) ? { ...r, status: 'closed', resolution: 'The author left.' } : r));
      draft.suggestions.forEach((s) => { if (s.member_id === id) s.member_id = null; });
    });
    res.status(204).end();
  }));

  // ---------- members ----------

  router.get('/members', optional, wrap(async (req, res) => {
    const { limit, offset } = offsetParams(req.query, { max: 50 });
    const { store } = await ctx();
    res.json(listMembers(store.read(), { search: text(req.query.search), city: text(req.query.city), openTo: text(req.query.open_to), limit, offset, ids: idList(req.query.ids) }));
  }));

  router.get('/members/:id', optional, wrap(async (req, res) => {
    const { store } = await ctx();
    const data = store.read();
    const m = data.members.find((x) => x.id === req.params.id);
    if (!m || (m.suspended && req.member?.id !== m.id)) throw notFound('That member is not here.');
    const posts = listPosts(data, { filter: 'all', limit: 10, viewerId: req.member?.id ?? null, authorId: m.id });
    res.json({ member: publicMember(m), posts: posts.results, saved: Boolean(req.member && data.saved.some((s) => s.member_id === req.member.id && s.kind === 'member' && s.key === m.id)) });
  }));

  // ---------- the feed ----------

  router.get('/feed', optional, wrap(async (req, res) => {
    const { store } = await ctx();
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
    res.json(listPosts(store.read(), { filter: text(req.query.filter) || 'all', before: text(req.query.before) || null, limit, viewerId: req.member?.id ?? null, ids: idList(req.query.ids) }));
  }));

  // How many posts and replies a member may make an hour: enough to talk, not enough to flood.
  const postsPerHour = createLimiter({ max: 12, windowMs: 3600000, now });
  const repliesPerHour = createLimiter({ max: 40, windowMs: 3600000, now });
  const reportsPerDay = createLimiter({ max: 30, windowMs: 86400000, now });

  router.post('/feed', ...write, wrap(async (req, res) => {
    const { store } = await ctx();
    postsPerHour.hit(req.member.id, 'You have posted a lot in the last hour. Take a break and come back to it.');
    const post = await store.change((draft) => createPost(draft, req.member, req.body ?? {}, now()));
    res.status(201).json({ post });
  }));

  router.get('/feed/:id', optional, wrap(async (req, res) => {
    const { store } = await ctx();
    res.json(getThread(store.read(), req.params.id, req.member?.id ?? null));
  }));

  router.patch('/feed/:id', ...write, wrap(async (req, res) => {
    const { store } = await ctx();
    res.json({ post: await store.change((draft) => editPost(draft, draft.members.find((m) => m.id === req.member.id), req.params.id, req.body ?? {}, now())) });
  }));

  router.delete('/feed/:id', ...write, wrap(async (req, res) => {
    const { store } = await ctx();
    await store.change((draft) => deletePost(draft, req.member, req.params.id));
    res.status(204).end();
  }));

  router.post('/feed/:id/replies', ...write, wrap(async (req, res) => {
    const { store } = await ctx();
    repliesPerHour.hit(req.member.id, 'You have replied a lot in the last hour. Take a break and come back to it.');
    res.status(201).json({ reply: await store.change((draft) => createReply(draft, req.member, req.params.id, req.body ?? {}, now())) });
  }));

  router.patch('/replies/:id', ...write, wrap(async (req, res) => {
    const { store } = await ctx();
    res.json({ reply: await store.change((draft) => editReply(draft, req.member, req.params.id, req.body ?? {}, now())) });
  }));

  router.delete('/replies/:id', ...write, wrap(async (req, res) => {
    const { store } = await ctx();
    await store.change((draft) => deleteReply(draft, req.member, req.params.id));
    res.status(204).end();
  }));

  router.put('/feed/:id/like', ...write, wrap(async (req, res) => {
    const { store } = await ctx();
    res.json({ like_count: await store.change((draft) => setLike(draft, req.member, req.params.id, true)), liked: true });
  }));
  router.delete('/feed/:id/like', ...write, wrap(async (req, res) => {
    const { store } = await ctx();
    res.json({ like_count: await store.change((draft) => setLike(draft, req.member, req.params.id, false)), liked: false });
  }));

  const report = (kind) => wrap(async (req, res) => {
    const { store } = await ctx();
    reportsPerDay.hit(req.member.id, 'You have sent a lot of reports today. A moderator will read them.');
    const out = await store.change((draft) => createReport(draft, req.member, kind, req.params.id, req.body ?? {}, now()));
    res.status(201).json(out);
  });
  router.post('/feed/:id/report', ...write, report('post'));
  router.post('/replies/:id/report', ...write, report('reply'));

  // ---------- saved ----------

  router.get('/account/saved', required, wrap(async (req, res) => {
    const { store } = await ctx();
    res.json({ saved: listSaved(store.read(), req.member.id), kinds: SAVED_KINDS });
  }));
  router.put('/account/saved', required, wrap(async (req, res) => {
    const { store } = await ctx();
    const { kind, key, saved } = req.body ?? {};
    if (typeof saved !== 'boolean') throw bad('Say whether it is saved: true or false.');
    await store.change((draft) => { try { setSaved(draft, req.member.id, kind, key, saved, now()); } catch (err) { if (!(err.status === 404 && !saved)) throw err; } });
    res.json({ kind, key, saved });
  }));
  router.post('/account/saved/merge', required, wrap(async (req, res) => {
    const { store } = await ctx();
    const added = await store.change((draft) => mergeSaved(draft, req.member.id, req.body?.items, now()));
    res.json({ added, saved: listSaved(store.read(), req.member.id) });
  }));

  // ---------- events and jobs (readable without the store: what is curated is in the repository) ----------

  const approved = async (kind) => {
    if (!network.available) return [];
    const { store } = await ctx();
    return store.read()[kind];
  };

  const allEvents = async () => upcomingEvents([...network.events(), ...(await approved('events'))], now());

  router.get('/events', wrap(async (req, res) => {
    const { limit, offset } = offsetParams(req.query, { max: 100, fallback: 50 });
    const all = await allEvents();
    const ids = idList(req.query.ids);
    const matched = filterEvents(ids ? all.filter((e) => ids.includes(e.id)) : all, { city: text(req.query.city), type: text(req.query.type), format: text(req.query.format), search: text(req.query.search) });
    const rows = matched.slice(offset, offset + limit);
    res.json({ total: all.length, count: matched.length, results: rows, facets: eventFacets(all), ...offsetInfo({ offset, limit, shown: rows.length, total: matched.length }) });
  }));

  router.get('/events/:id', wrap(async (req, res) => {
    const event = (await allEvents()).find((e) => e.id === req.params.id);
    if (!event) throw notFound('That event is not listed, or it is over.');
    res.json({ event });
  }));

  router.get('/events/:id/calendar.ics', wrap(async (req, res) => {
    const raw = [...network.events(), ...(await approved('events'))].find((e) => e.id === req.params.id);
    const event = raw && (await allEvents()).find((e) => e.id === raw.id) ? raw : null;
    if (!event) throw notFound('That event is not listed, or it is over.');
    res.set({ 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': `attachment; filename="${event.id}.ics"`, 'Cache-Control': 'no-store' });
    res.send(toIcs(event, { now: now() }));
  }));

  router.get('/jobs', wrap(async (req, res) => {
    const { limit, offset } = offsetParams(req.query, { max: 100, fallback: 24 });
    const snap = await catalog.snapshot();
    const cardOf = (id) => { const rec = recordFor(snap, id); return rec ? { name: rec.name, slug: rec.slug, city: rec.city ?? '', sector: rec.sector ?? '', stage: rec.stage ?? '', website: rec.website ?? '' } : null; };
    const includeClosed = req.query.include_closed === 'yes';
    const all = curatedJobs({ jobs: network.jobs(), cardOf, extra: (await approved('jobs')).filter((j) => includeClosed || j.status === 'open'), now: now(), includeClosed });
    const ids = idList(req.query.ids);
    const matched = filterJobs(ids ? all.filter((j) => ids.includes(j.id)) : all, Object.fromEntries(['search', 'city', 'sector', 'stage', 'type', 'level', 'remote', 'company', 'where'].map((k) => [k, text(req.query[k])])));
    const rows = matched.slice(offset, offset + limit);
    res.json({ total: all.length, count: matched.length, results: rows, facets: jobFacets(all), ...offsetInfo({ offset, limit, shown: rows.length, total: matched.length }) });
  }));

  // ---------- suggestions ----------

  const suggestionsPerDay = createLimiter({ max: 10, windowMs: 86400000, now });
  router.post('/suggestions', optional, wrap(async (req, res) => {
    const { store } = await ctx();
    suggestionsPerDay.hit(req.member?.id ?? req.ip, 'You have sent a lot of suggestions today. Thank you: a person reads each one.');
    const out = await store.change((draft) => createSuggestion(draft, { kind: req.body?.kind, fields: req.body?.fields, memberId: req.member?.id ?? null, email: req.body?.email }, now()));
    res.status(201).json(out);
  }));

  // ---------- moderators (the admin key) ----------

  const wrongKeys = createLimiter({ max: 10, windowMs: 600000, now });
  const admin = (req, res, next) => {
    try {
      const configured = process.env.ADMIN_KEY;
      const given = req.get('x-admin-key') ?? '';
      if (!configured) throw unauthorized('Moderation is not set up on this server.');
      wrongKeys.used(req.ip) >= 10 && wrongKeys.hit(req.ip); // locked out: throws
      if (!safeEqual(given, configured)) { wrongKeys.hit(req.ip, 'Too many wrong keys. Wait ten minutes.'); throw unauthorized('That is not the moderator key.'); }
      req.actor = 'admin';
      next();
    } catch (err) { next(err); }
  };

  router.get('/admin/network/summary', admin, wrap(async (req, res) => {
    const { store } = await ctx();
    const d = store.read();
    res.json({
      members: d.members.length, suspended: d.members.filter((m) => m.suspended).length, posts: d.posts.filter((p) => p.status === 'visible').length,
      open_reports: openReports(d).length, pending_suggestions: d.suggestions.filter((s) => s.status === 'pending').length, durable_dir: network.dir,
    });
  }));

  router.get('/admin/network/reports', admin, wrap(async (req, res) => { const { store } = await ctx(); res.json({ results: openReports(store.read()) }); }));
  router.post('/admin/network/reports/:kind/:id', admin, wrap(async (req, res) => {
    const { store } = await ctx();
    await store.change((draft) => moderate(draft, req.params.kind, req.params.id, text(req.body?.action), { actor: req.actor, note: req.body?.note }, now()));
    res.json({ done: true });
  }));

  router.get('/admin/network/suggestions', admin, wrap(async (req, res) => { const { store } = await ctx(); res.json({ results: pendingSuggestions(store.read()), zones: ['Australia/Sydney', 'Australia/Melbourne', 'Australia/Brisbane', 'Australia/Adelaide', 'Australia/Perth', 'Australia/Hobart', 'Australia/Darwin'], types: EVENT_TYPE_LABELS }); }));
  router.post('/admin/network/suggestions/:id/approve', admin, wrap(async (req, res) => {
    const { store } = await ctx();
    res.json(await store.change((draft) => approveSuggestion(draft, req.params.id, req.body?.completed ?? {}, { actor: req.actor }, now())));
  }));
  router.post('/admin/network/suggestions/:id/reject', admin, wrap(async (req, res) => {
    const { store } = await ctx();
    await store.change((draft) => rejectSuggestion(draft, req.params.id, { note: req.body?.note, actor: req.actor }, now()));
    res.json({ done: true });
  }));
  router.post('/admin/network/listings/:kind/:id/withdraw', admin, wrap(async (req, res) => {
    const { store } = await ctx();
    if (!['event', 'job'].includes(req.params.kind)) throw bad('kind must be event or job.');
    await store.change((draft) => withdrawListing(draft, req.params.kind, req.params.id, { actor: req.actor, note: req.body?.note }, now()));
    res.json({ done: true });
  }));

  router.get('/admin/network/members', admin, wrap(async (req, res) => {
    const { store } = await ctx();
    const q = text(req.query.search).trim().toLowerCase();
    const rows = store.read().members.filter((m) => !q || `${m.name} ${m.email}`.toLowerCase().includes(q)).slice(0, 100)
      .map((m) => ({ id: m.id, name: m.name, email: m.email, role: m.role, city: m.city, listed: m.listed, suspended: m.suspended, created_at: m.created_at }));
    res.json({ results: rows });
  }));
  router.post('/admin/network/members/:id', admin, wrap(async (req, res) => {
    const { store } = await ctx();
    if (typeof req.body?.suspended !== 'boolean') throw bad('Say whether the account is suspended: true or false.');
    await store.change((draft) => {
      const m = draft.members.find((x) => x.id === req.params.id);
      if (!m) throw notFound('That member is not here.');
      m.suspended = req.body.suspended;
      if (m.suspended) draft.sessions = draft.sessions.filter((s) => s.member_id !== m.id);
      draft.audit.push({ at: new Date(now()).toISOString(), actor: req.actor, action: m.suspended ? 'member.suspend' : 'member.unsuspend', target: m.id, note: cleanText(req.body?.note, { name: 'Note', max: 300 }) });
    });
    res.json({ done: true });
  }));

  // ---------- errors ----------

  // eslint-disable-next-line no-unused-vars
  router.use((err, req, res, next) => {
    if (err instanceof ApiError) return res.status(err.status).json({ error: err.message, code: err.code });
    if (err?.code === 'network_unavailable') return res.status(503).json({ error: err.message, code: 'network_unavailable' });
    return next(err);
  });

  return router;
}
