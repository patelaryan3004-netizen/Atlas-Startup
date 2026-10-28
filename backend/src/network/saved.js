// What a signed-in member has saved: startups, investors, jobs, events, posts and other members. Kept with the account, so it is the same on every
// device. (A visitor who is not signed in saves in their own browser instead, and the page says so; signing in brings those along: see `merge`.)
import { bad, notFound, oneOf, cleanText } from './validate.js';

export const SAVED_KINDS = ['startup', 'investor', 'job', 'event', 'post', 'member'];
export const MAX_SAVED = 500;

const keyOf = (key) => {
  const text = cleanText(key, { name: 'Key', min: 1, max: 160, required: true });
  return text;
};

export function listSaved(data, memberId) {
  const out = Object.fromEntries(SAVED_KINDS.map((k) => [k, []]));
  for (const s of data.saved.filter((x) => x.member_id === memberId).sort((a, b) => b.at.localeCompare(a.at))) out[s.kind].push(s.key);
  return out;
}

export function setSaved(draft, memberId, kind, key, on, now = Date.now()) {
  oneOf(kind, SAVED_KINDS, 'Kind');
  const k = keyOf(key);
  const has = draft.saved.some((s) => s.member_id === memberId && s.kind === kind && s.key === k);
  if (on && !has) {
    if (draft.saved.filter((s) => s.member_id === memberId).length >= MAX_SAVED) throw bad(`You can save up to ${MAX_SAVED} things.`);
    draft.saved.push({ member_id: memberId, kind, key: k, at: new Date(now).toISOString() });
  }
  if (!on) {
    if (!has) throw notFound('That was not saved.');
    draft.saved = draft.saved.filter((s) => !(s.member_id === memberId && s.kind === kind && s.key === k));
  }
}

// What a visitor saved in their browser before signing in: added to the account, never taking anything away, and never past the limit.
export function mergeSaved(draft, memberId, items, now = Date.now()) {
  if (!Array.isArray(items) || items.length > MAX_SAVED) throw bad(`Send a list of at most ${MAX_SAVED} items.`);
  let added = 0;
  for (const item of items) {
    if (!item || !SAVED_KINDS.includes(item.kind) || typeof item.key !== 'string' || !item.key.trim() || item.key.length > 160) continue;
    const has = draft.saved.some((s) => s.member_id === memberId && s.kind === item.kind && s.key === item.key.trim());
    if (has || draft.saved.filter((s) => s.member_id === memberId).length >= MAX_SAVED) continue;
    draft.saved.push({ member_id: memberId, kind: item.kind, key: item.key.trim(), at: new Date(now - added).toISOString() });
    added += 1;
  }
  return added;
}
