// Introductions between members, with consent from both sides before anything private moves.
//
// One member asks to be introduced to another, with a short note and the reasons the match gave. The other sees who is asking and why, and accepts or declines. Only when they accept does either
// of them see the other's contact (the line each chose to share for introductions, in their profile). Both must have set one before the request is made or accepted, so no one's contact is shown
// without the person having said, ahead of time, how they want to be reached. The site sends no email and starts no conversation: it shows the two of them each other's contact, and that is all.
import { bad, cleanText, notFound, forbidden, makeId } from './validate.js';

export const MAX_PENDING_SENT = 8;
export const COOLDOWN_DAYS = 30; // after a decline, the same member cannot ask the same person again for this long
const DAY = 86400000;

const memberOf = (data, id) => data.members.find((m) => m.id === id);

// The record between two members that is still alive (asked, or accepted), either way round.
const alive = (data, a, b) => data.introductions.find((i) => ((i.from === a && i.to === b) || (i.from === b && i.to === a)) && ['requested', 'accepted'].includes(i.status));

export function requestIntroduction(draft, me, { to, note, why = [] }, now = Date.now()) {
  if (!me.contact) throw bad('Add how people can reach you (your contact for introductions) to your profile first. It is shown only to someone you both agree to meet.');
  const target = memberOf(draft, to);
  if (!target || target.suspended || !target.listed) throw notFound('That member is not here.');
  if (target.id === me.id) throw bad('You cannot ask to meet yourself.');
  if (alive(draft, me.id, target.id)) throw bad('You already have an introduction with this person.');
  const declined = draft.introductions.filter((i) => i.from === me.id && i.to === target.id && i.status === 'declined').sort((a, b) => b.decided_at.localeCompare(a.decided_at))[0];
  if (declined && now - Date.parse(declined.decided_at) < COOLDOWN_DAYS * DAY) throw bad('They declined, so you cannot ask again yet.');
  if (draft.introductions.filter((i) => i.from === me.id && i.status === 'requested').length >= MAX_PENDING_SENT) throw bad(`You have ${MAX_PENDING_SENT} requests waiting for an answer. Wait for some to be answered.`);
  const at = new Date(now).toISOString();
  const intro = {
    id: makeId('i', now), from: me.id, to: target.id, note: cleanText(note, { name: 'Your note', min: 10, max: 300, multiline: true, required: true }),
    why: (Array.isArray(why) ? why : []).filter((w) => typeof w === 'string').slice(0, 3).map((w) => w.slice(0, 160)), status: 'requested', created_at: at, decided_at: null,
  };
  draft.introductions.push(intro);
  return intro;
}

const find = (draft, id) => {
  const i = draft.introductions.find((x) => x.id === id);
  if (!i) throw notFound('That introduction is not here.');
  return i;
};

// The person asked answers. Accepting needs their own contact to be set, so that what is shared is shared both ways.
export function decideIntroduction(draft, me, id, accept, now = Date.now()) {
  const i = find(draft, id);
  if (i.to !== me.id) throw forbidden('Only the person who was asked can answer.');
  if (i.status !== 'requested') throw bad('That request has already been answered or withdrawn.');
  if (accept && !me.contact) throw bad('Add how people can reach you (your contact for introductions) to your profile before you accept. It is shown to the person you accept.');
  i.status = accept ? 'accepted' : 'declined';
  i.decided_at = new Date(now).toISOString();
  return i;
}

export function withdrawIntroduction(draft, me, id, now = Date.now()) {
  const i = find(draft, id);
  if (i.from !== me.id) throw forbidden('Only the person who asked can withdraw.');
  if (!['requested', 'accepted'].includes(i.status)) throw bad('That request is not open.');
  i.status = 'withdrawn';
  i.decided_at = new Date(now).toISOString();
  return i;
}

// A member's introductions, newest first: what they sent and what they received, each with the other person's public profile; the other's contact only when it was accepted.
export function introductionsFor(data, me, toPublic) {
  const rows = data.introductions.filter((i) => i.from === me.id || i.to === me.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  return rows.map((i) => {
    const sent = i.from === me.id;
    const other = memberOf(data, sent ? i.to : i.from);
    const row = {
      id: i.id, direction: sent ? 'sent' : 'received', status: i.status, note: i.note, why: i.why, created_at: i.created_at, decided_at: i.decided_at,
      member: other && !other.suspended ? toPublic(other) : null,
    };
    if (i.status === 'accepted' && other && !other.suspended) row.contact = other.contact || '';
    return row;
  });
}

// How many requests wait for this member's answer.
export const waitingFor = (data, me) => data.introductions.filter((i) => i.to === me.id && i.status === 'requested').length;
