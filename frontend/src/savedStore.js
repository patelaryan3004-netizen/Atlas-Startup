// What a visitor has saved: startups, investors, jobs, events, posts and members.
//
//   Signed out: startups, investors, jobs and events are kept in THIS browser (the page says so), as they always were. Posts and members cannot be
//   saved without an account: there is nowhere but an account to keep them.
//   Signed in: everything is kept with the account, the same on every device. On signing in, what this browser had saved is added to the account
//   (never taking anything away), and from then on the account is what the save buttons read and write.
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { fetchSaved, mergeSaved, setSaved } from './networkApi.js';
import { getSession, subscribeSession, useSession } from './session.js';
import { openAuth } from './authUi.js';

export const KINDS = ['startup', 'investor', 'job', 'event', 'post', 'member'];
// Where each kind is kept in this browser (startups and investors keep the keys they always had). Posts and members have none.
const LOCAL_KEYS = { startup: 'auStartupTracked', investor: 'auStartupSavedInvestors', job: 'stillEarlySavedJobs', event: 'stillEarlySavedEvents' };
export const needsAccount = (kind) => !LOCAL_KEYS[kind];

export function readLocal(kind) {
  const key = LOCAL_KEYS[kind];
  if (!key) return [];
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(raw) ? [...new Set(raw.filter((s) => typeof s === 'string' && s))] : [];
  } catch (e) { return []; }
}
function writeLocal(kind, items) {
  const key = LOCAL_KEYS[kind];
  if (!key) return;
  try { localStorage.setItem(key, JSON.stringify(items)); } catch (e) { /* a private window: it saves for the visit */ }
}

// ---------- the account's copy ----------
const empty = () => Object.fromEntries(KINDS.map((k) => [k, []]));
let server = null; // { memberId, items, ready }
let version = 0;
const listeners = new Set();
const emit = () => { version += 1; listeners.forEach((fn) => fn()); };
const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

async function adopt(memberId) {
  server = { memberId, items: empty(), ready: false };
  emit();
  try {
    const items = Object.keys(LOCAL_KEYS).flatMap((kind) => readLocal(kind).map((key) => ({ kind, key })));
    if (items.length) await mergeSaved(items);
    const { saved } = await fetchSaved();
    if (server?.memberId === memberId) server = { memberId, items: { ...empty(), ...saved }, ready: true };
  } catch (e) {
    if (server?.memberId === memberId) server = { memberId, items: empty(), ready: false, failed: true };
  }
  emit();
}

subscribeSession(() => {
  const s = getSession();
  if (s.status === 'in' && s.member && server?.memberId !== s.member.id) adopt(s.member.id);
  else if (s.status === 'out' && server) { server = null; emit(); }
});

// The account's saved items of a kind, once they have arrived (null until then).
export const accountItems = (kind) => (server?.ready ? server.items[kind] : null);

// ---------- the hook ----------
// Saved things of one kind: `items` (the keys), `has`, `toggle`, and where they are kept ('account' or 'device').
export function useSavedKind(kind) {
  const { member } = useSession();
  useSyncExternalStore(subscribe, () => version, () => version);
  const [local, setLocal] = useState(() => readLocal(kind));
  const inAccount = Boolean(member);
  const items = inAccount ? (server?.ready ? server.items[kind] : local) : local;

  const toggle = useCallback((key) => {
    const now = getSession();
    if (now.member) {
      if (!server) return;
      const had = server.items[kind].includes(key);
      server = { ...server, items: { ...server.items, [kind]: had ? server.items[kind].filter((k) => k !== key) : [key, ...server.items[kind]] } };
      emit();
      // The change did not reach the account: ask the account what it has, so the button shows the truth.
      setSaved(kind, key, !had).catch(() => fetchSaved().then(({ saved }) => { if (server) { server = { ...server, items: { ...empty(), ...saved } }; emit(); } }, () => {}));
      return;
    }
    if (needsAccount(kind)) { openAuth({ mode: 'signup', reason: kind === 'post' ? 'bookmark posts' : 'save people' }); return; }
    setLocal((was) => { const next = was.includes(key) ? was.filter((k) => k !== key) : [...was, key]; writeLocal(kind, next); return next; });
  }, [kind]);

  const has = useCallback((key) => items.includes(key), [items]);
  return { items, has, toggle, where: inAccount ? 'account' : 'device', canSave: inAccount || !needsAccount(kind) };
}

// How many things are saved in all, for the number beside "Saved" in the account menu.
export function useSavedCount() {
  const { member } = useSession();
  const seen = useSyncExternalStore(subscribe, () => version, () => version);
  return useMemo(() => {
    if (member && server?.ready) return KINDS.reduce((n, k) => n + server.items[k].length, 0);
    return Object.keys(LOCAL_KEYS).reduce((n, k) => n + readLocal(k).length, 0);
  }, [member, seen]);
}

// For a test: forget the account's copy.
export function resetSaved() { server = null; emit(); }
