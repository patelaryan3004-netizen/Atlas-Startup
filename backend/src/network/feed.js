// The community feed: short posts, replies, likes, and the reports people make about them.
//
// One feed. A post has a topic, and the page filters by four groups of them:
//   Ideas      idea
//   Building   building, feedback, win
//   Questions  question
// A post, a reply and a like belong to a member; only the member can edit or delete what they wrote; a moderator (the admin key) can hide or remove
// it. A deleted post keeps no words: its body is emptied, so nothing is held for someone who asked for it to go.
import { bad, cleanText, forbidden, linkCount, makeId, notFound, oneOf } from './validate.js';
import { initialsOf } from './validate.js';

export const TOPICS = ['idea', 'question', 'building', 'feedback', 'win'];
export const TOPIC_LABELS = { idea: 'Idea', question: 'Question', building: 'Building', feedback: 'Feedback', win: 'Small win' };
export const FILTERS = { all: TOPICS, ideas: ['idea'], building: ['building', 'feedback', 'win'], questions: ['question'] };
export const MAX_POST = 600;
export const MAX_REPLY = 400;
export const MAX_LINKS = 2;
export const REPORT_REASONS = ['spam', 'abuse', 'misleading', 'off_topic', 'other'];
export const AUTO_HIDE_AT = 3; // distinct people reporting the same thing hides it until a moderator looks

const authorOf = (data, id) => {
  const m = data.members.find((x) => x.id === id);
  return m ? { id: m.id, name: m.name, initials: initialsOf(m.name), role: m.role, city: m.city } : { id: null, name: 'Former member', initials: '', role: '', city: '' };
};

// Hidden things are shown only to the person who wrote them (with a notice); deleted and removed ones to nobody.
const shownTo = (item, viewerId) => item.status === 'visible' || (item.status === 'hidden' && viewerId && item.author_id === viewerId);

function checkWords(body, max, name) {
  const text = cleanText(body, { name, min: 1, max, multiline: true, required: true });
  if (linkCount(text) > MAX_LINKS) throw bad(`${name} can hold at most ${MAX_LINKS} links.`);
  return text;
}

function present(data, post, viewerId, replyCount) {
  return {
    id: post.id, topic: post.topic, topic_label: TOPIC_LABELS[post.topic], body: post.body, created_at: post.created_at, edited_at: post.edited_at,
    status: post.status, author: authorOf(data, post.author_id), mine: Boolean(viewerId && post.author_id === viewerId),
    like_count: data.likes.filter((l) => l.post_id === post.id).length,
    liked: Boolean(viewerId && data.likes.some((l) => l.post_id === post.id && l.member_id === viewerId)),
    bookmarked: Boolean(viewerId && data.saved.some((s) => s.member_id === viewerId && s.kind === 'post' && s.key === post.id)),
    reply_count: replyCount ?? data.replies.filter((r) => r.post_id === post.id && r.status === 'visible').length,
  };
}

const presentReply = (data, reply, viewerId) => ({
  id: reply.id, post_id: reply.post_id, body: reply.body, created_at: reply.created_at, edited_at: reply.edited_at, status: reply.status,
  author: authorOf(data, reply.author_id), mine: Boolean(viewerId && reply.author_id === viewerId),
});

// The feed, newest first, a page at a time. `before` is the id of the last post seen (an id sorts by when it was made).
export function listPosts(data, { filter = 'all', before = null, limit = 20, viewerId = null, authorId = null, ids = null } = {}) {
  const topics = FILTERS[filter];
  if (!topics) throw bad(`filter must be one of: ${Object.keys(FILTERS).join(', ')}.`);
  const counts = new Map();
  for (const r of data.replies) if (r.status === 'visible') counts.set(r.post_id, (counts.get(r.post_id) ?? 0) + 1);
  const rows = data.posts
    .filter((p) => topics.includes(p.topic) && shownTo(p, viewerId) && (!authorId || p.author_id === authorId) && (!ids || ids.includes(p.id)))
    .sort((a, b) => b.id.localeCompare(a.id));
  const start = before ? rows.findIndex((p) => p.id === before) + 1 : 0;
  if (before && start === 0) throw bad('That page of the feed is no longer there. Start again from the top.');
  const page = rows.slice(start, start + limit);
  return {
    results: page.map((p) => present(data, p, viewerId, counts.get(p.id) ?? 0)),
    hasMore: start + page.length < rows.length,
    next: start + page.length < rows.length ? page[page.length - 1].id : null,
    total: rows.length,
  };
}

export function getThread(data, id, viewerId = null) {
  const post = data.posts.find((p) => p.id === id);
  if (!post || !shownTo(post, viewerId)) throw notFound('That post is not there.');
  const replies = data.replies.filter((r) => r.post_id === id && shownTo(r, viewerId)).sort((a, b) => a.id.localeCompare(b.id));
  return { post: present(data, post, viewerId), replies: replies.map((r) => presentReply(data, r, viewerId)) };
}

export function createPost(draft, member, { topic, body }, now = Date.now()) {
  const post = {
    id: makeId('p', now), author_id: member.id, topic: oneOf(topic, TOPICS, 'Topic'), body: checkWords(body, MAX_POST, 'Your post'),
    created_at: new Date(now).toISOString(), edited_at: null, status: 'visible',
  };
  draft.posts.push(post);
  return present(draft, post, member.id);
}

function ownPost(draft, member, id) {
  const post = draft.posts.find((p) => p.id === id);
  if (!post || post.status === 'deleted' || post.status === 'removed') throw notFound('That post is not there.');
  if (post.author_id !== member.id) throw forbidden('You can only change your own posts.');
  return post;
}

export function editPost(draft, member, id, { topic, body }, now = Date.now()) {
  const post = ownPost(draft, member, id);
  if (post.status === 'hidden') throw forbidden('A moderator is looking at this post, so it cannot be changed.');
  if (topic !== undefined) post.topic = oneOf(topic, TOPICS, 'Topic');
  if (body !== undefined) post.body = checkWords(body, MAX_POST, 'Your post');
  post.edited_at = new Date(now).toISOString();
  return present(draft, post, member.id);
}

export function deletePost(draft, member, id) {
  const post = ownPost(draft, member, id);
  post.status = 'deleted';
  post.body = '';
  draft.likes = draft.likes.filter((l) => l.post_id !== id);
  draft.saved = draft.saved.filter((s) => !(s.kind === 'post' && s.key === id));
  for (const r of draft.replies.filter((x) => x.post_id === id)) { r.status = 'deleted'; r.body = ''; }
  dismissReportsFor(draft, 'post', id, 'The author deleted it.');
}

export function createReply(draft, member, postId, { body }, now = Date.now()) {
  const post = draft.posts.find((p) => p.id === postId);
  if (!post || post.status !== 'visible') throw notFound('That post is not there.');
  const reply = { id: makeId('r', now), post_id: postId, author_id: member.id, body: checkWords(body, MAX_REPLY, 'Your reply'), created_at: new Date(now).toISOString(), edited_at: null, status: 'visible' };
  draft.replies.push(reply);
  return presentReply(draft, reply, member.id);
}

function ownReply(draft, member, id) {
  const reply = draft.replies.find((r) => r.id === id);
  if (!reply || reply.status === 'deleted' || reply.status === 'removed') throw notFound('That reply is not there.');
  if (reply.author_id !== member.id) throw forbidden('You can only change your own replies.');
  return reply;
}

export function editReply(draft, member, id, { body }, now = Date.now()) {
  const reply = ownReply(draft, member, id);
  if (reply.status === 'hidden') throw forbidden('A moderator is looking at this reply, so it cannot be changed.');
  reply.body = checkWords(body, MAX_REPLY, 'Your reply');
  reply.edited_at = new Date(now).toISOString();
  return presentReply(draft, reply, member.id);
}

export function deleteReply(draft, member, id) {
  const reply = ownReply(draft, member, id);
  reply.status = 'deleted';
  reply.body = '';
  dismissReportsFor(draft, 'reply', id, 'The author deleted it.');
}

export function setLike(draft, member, postId, liked) {
  const post = draft.posts.find((p) => p.id === postId);
  if (!post || post.status !== 'visible') throw notFound('That post is not there.');
  const has = draft.likes.some((l) => l.post_id === postId && l.member_id === member.id);
  if (liked && !has) draft.likes.push({ post_id: postId, member_id: member.id, at: new Date().toISOString() });
  if (!liked && has) draft.likes = draft.likes.filter((l) => !(l.post_id === postId && l.member_id === member.id));
  return draft.likes.filter((l) => l.post_id === postId).length;
}

// ---------- reports and moderation ----------

const targetOf = (draft, kind, id) => (kind === 'post' ? draft.posts : draft.replies).find((x) => x.id === id);

function dismissReportsFor(draft, kind, id, resolution) {
  for (const r of draft.reports) if (r.target_kind === kind && r.target_id === id && r.status === 'open') { r.status = 'closed'; r.resolution = resolution; r.resolved_at = new Date().toISOString(); }
}

// Someone reports a post or a reply. One person reports a thing once. Enough different people hide it until a moderator has looked.
export function createReport(draft, member, kind, id, { reason, note }, now = Date.now()) {
  if (!['post', 'reply'].includes(kind)) throw bad('Only posts and replies can be reported.');
  const target = targetOf(draft, kind, id);
  if (!target || !['visible', 'hidden'].includes(target.status)) throw notFound('That is not there.');
  if (target.author_id === member.id) throw bad('You cannot report your own words. You can delete them instead.');
  const clean = { reason: oneOf(reason, REPORT_REASONS, 'Reason'), note: cleanText(note, { name: 'Note', max: 300, multiline: true }) };
  if (draft.reports.some((r) => r.target_kind === kind && r.target_id === id && r.reporter_id === member.id && r.status === 'open')) return { reported: true, already: true };
  draft.reports.push({
    id: makeId('rep', now), target_kind: kind, target_id: id, reporter_id: member.id, ...clean, status: 'open', resolution: null,
    created_at: new Date(now).toISOString(), resolved_at: null,
  });
  const distinct = new Set(draft.reports.filter((r) => r.target_kind === kind && r.target_id === id && r.status === 'open').map((r) => r.reporter_id)).size;
  if (distinct >= AUTO_HIDE_AT && target.status === 'visible') { target.status = 'hidden'; target.hidden_reason = 'reports'; }
  return { reported: true, already: false };
}

// The open reports, one row for each thing reported, with what was said and who said it, for a moderator.
export function openReports(data) {
  const groups = new Map();
  for (const r of data.reports.filter((x) => x.status === 'open')) {
    const key = `${r.target_kind}:${r.target_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const rows = [];
  for (const [key, reports] of groups) {
    const [kind, id] = key.split(':');
    const target = (kind === 'post' ? data.posts : data.replies).find((x) => x.id === id);
    if (!target) continue;
    const author = data.members.find((m) => m.id === target.author_id);
    rows.push({
      target_kind: kind, target_id: id, status: target.status, body: target.body, created_at: target.created_at, post_id: target.post_id ?? target.id,
      author: author ? { id: author.id, name: author.name, suspended: author.suspended } : null,
      reports: reports.map((r) => ({ id: r.id, reason: r.reason, note: r.note, created_at: r.created_at })),
      first_reported_at: reports.map((r) => r.created_at).sort()[0],
    });
  }
  return rows.sort((a, b) => a.first_reported_at.localeCompare(b.first_reported_at));
}

export const ACTIONS = ['dismiss', 'hide', 'restore', 'remove', 'suspend_author'];

// What a moderator decides about one thing that was reported. Every open report on it is closed with the decision, and it is written to the audit trail.
export function moderate(draft, kind, id, action, { actor = 'admin', note = '' } = {}, now = Date.now()) {
  oneOf(action, ACTIONS, 'Action');
  const target = targetOf(draft, kind, id);
  if (!target) throw notFound('That is not there.');
  const at = new Date(now).toISOString();
  if (action === 'dismiss' || action === 'restore') {
    if (target.status === 'hidden') { target.status = 'visible'; delete target.hidden_reason; }
  } else if (action === 'hide') {
    if (target.status === 'visible') target.status = 'hidden';
  } else if (action === 'remove' || action === 'suspend_author') {
    target.status = 'removed';
    target.body = '';
    if (kind === 'post') for (const r of draft.replies.filter((x) => x.post_id === id && x.status !== 'deleted')) { r.status = 'removed'; r.body = ''; }
    if (action === 'suspend_author') {
      const author = draft.members.find((m) => m.id === target.author_id);
      if (author) { author.suspended = true; draft.sessions = draft.sessions.filter((s) => s.member_id !== author.id); }
    }
  }
  const closing = action === 'hide' ? null : action;
  for (const r of draft.reports) {
    if (r.target_kind === kind && r.target_id === id && r.status === 'open' && closing) { r.status = 'closed'; r.resolution = closing; r.resolved_at = at; }
  }
  draft.audit.push({ at, actor, action: `feed.${action}`, target: `${kind}:${id}`, note: cleanText(note, { name: 'Note', max: 300 }) });
}
