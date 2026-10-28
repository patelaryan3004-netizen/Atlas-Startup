// Who is signed in, for every part of the page: one small store, so the header, the feed and a save button always agree.
//
//   status  'out' (no session), 'loading' (a session is being checked) or 'in'
//   member  the signed-in member (their own view, with their email), or null
//   open    whether the members' side of the site is open at all (null until the server has said): it is not where the server has no disk that
//           survives a restart, and the pages then say so instead of taking sign-ups they could not keep
import { useSyncExternalStore } from 'react';
import { fetchMe, fetchNetworkStatus, getToken, setToken, signIn as signInRequest, signUp as signUpRequest, signOutRequest, ApiError } from './networkApi.js';

let state = { status: getToken() ? 'loading' : 'out', member: null, open: null, reason: '' };
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());
const set = (next) => { state = { ...state, ...next }; emit(); };

let started = false;
function start() {
  if (started) return;
  started = true;
  if (getToken()) {
    fetchMe().then(({ member }) => set({ status: 'in', member }), (err) => {
      if (err instanceof ApiError && err.status === 401) { setToken(null); set({ status: 'out', member: null }); }
      else set({ status: 'out' }); // the server could not be reached: signed out for now, the token is kept for next time
    });
  }
}

// Whether the members' side is open, asked once and only when a page needs the answer.
let askedStatus = false;
export function ensureStatus() {
  if (askedStatus) return;
  askedStatus = true;
  if (typeof fetch !== 'function') return;
  fetchNetworkStatus().then((s) => set({ open: Boolean(s.available), reason: s.reason ?? '' }), () => { askedStatus = false; });
}

export const getSession = () => state;
export const subscribeSession = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

export async function signIn(fields) {
  const { token, member } = await signInRequest(fields);
  setToken(token);
  set({ status: 'in', member });
  return member;
}

export async function signUp(fields) {
  const { token, member } = await signUpRequest(fields);
  setToken(token);
  set({ status: 'in', member });
  return member;
}

export async function signOut() {
  try { await signOutRequest(); } catch (e) { /* the session ends here either way */ }
  setToken(null);
  set({ status: 'out', member: null });
}

// A change to the signed-in member's own record (a saved profile).
export const setMember = (member) => set({ member });

export function useSession() {
  start();
  return useSyncExternalStore(subscribeSession, getSession, getSession);
}

// For a test: back to a clean start.
export function resetSession() {
  started = false;
  askedStatus = false;
  state = { status: getToken() ? 'loading' : 'out', member: null, open: null, reason: '' };
  emit();
}
