// The members' side of the API (backend/src/network): accounts, the feed, profiles, saved things, events, jobs, suggestions and the moderators' queues.
// The session is a token the browser keeps and sends as an Authorization header: the site and its API are on different addresses, so a cookie would not
// travel, and a header cannot be attached by another site's page.
import { BASE } from './apiUrls.js';

const TOKEN_KEY = 'stillEarlySession';
export const getToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; } };
export const setToken = (token) => {
  try { if (token) localStorage.setItem(TOKEN_KEY, token); else localStorage.removeItem(TOKEN_KEY); } catch (e) { /* a browser that will not keep it: the session lasts the visit */ }
};

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function call(path, { method = 'GET', body, token = getToken(), adminKey, signal } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (adminKey) headers['x-admin-key'] = adminKey;
  let res;
  try {
    res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiError('Could not reach the server. Check your connection and try again.', 0, 'offline');
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || 'Something went wrong. Try again.', res.status, data.code);
  return data;
}

const query = (params = {}) => {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== '' && value !== false) qs.set(key, Array.isArray(value) ? value.join(',') : String(value));
  const text = qs.toString();
  return text ? `?${text}` : '';
};
const enc = encodeURIComponent;

// ---------- status and accounts ----------
export const fetchNetworkStatus = (opts) => call('/network/status', opts);
export const signUp = (fields) => call('/auth/signup', { method: 'POST', body: fields, token: null });
export const signIn = (fields) => call('/auth/signin', { method: 'POST', body: fields, token: null });
export const signOutRequest = () => call('/auth/signout', { method: 'POST' });
export const fetchMe = (opts) => call('/account', opts);
export const updateProfile = (changes) => call('/account', { method: 'PATCH', body: changes });
export const changePassword = (current, next) => call('/account/password', { method: 'POST', body: { current, next } });
export const deleteAccount = (password) => call('/account', { method: 'DELETE', body: { password } });

// ---------- members ----------
export const fetchMembers = (params, opts) => call(`/members${query(params)}`, opts);
export const fetchMember = (id, opts) => call(`/members/${enc(id)}`, opts);

// ---------- the feed ----------
export const fetchFeed = (params, opts) => call(`/feed${query(params)}`, opts);
export const fetchThread = (id, opts) => call(`/feed/${enc(id)}`, opts);
export const createPost = (fields) => call('/feed', { method: 'POST', body: fields });
export const editPost = (id, fields) => call(`/feed/${enc(id)}`, { method: 'PATCH', body: fields });
export const deletePost = (id) => call(`/feed/${enc(id)}`, { method: 'DELETE' });
export const createReply = (postId, body) => call(`/feed/${enc(postId)}/replies`, { method: 'POST', body: { body } });
export const editReply = (id, body) => call(`/replies/${enc(id)}`, { method: 'PATCH', body: { body } });
export const deleteReply = (id) => call(`/replies/${enc(id)}`, { method: 'DELETE' });
export const setLike = (postId, liked) => call(`/feed/${enc(postId)}/like`, { method: liked ? 'PUT' : 'DELETE' });
export const reportItem = (kind, id, fields) => call(`/${kind === 'reply' ? 'replies' : 'feed'}/${enc(id)}/report`, { method: 'POST', body: fields });

// ---------- saved ----------
export const fetchSaved = () => call('/account/saved');
export const setSaved = (kind, key, saved) => call('/account/saved', { method: 'PUT', body: { kind, key, saved } });
export const mergeSaved = (items) => call('/account/saved/merge', { method: 'POST', body: { items } });

// ---------- opportunities ----------
export const fetchEvents = (params, opts) => call(`/events${query(params)}`, opts);
export const fetchJobs = (params, opts) => call(`/jobs${query(params)}`, opts);
export const calendarUrl = (id) => `${BASE}/events/${enc(id)}/calendar.ics`;
export const submitSuggestion = (kind, fields, email) => call('/suggestions', { method: 'POST', body: { kind, fields, email } });

// ---------- moderators (the admin key is typed in and kept in memory only) ----------
export const adminSummary = (adminKey) => call('/admin/network/summary', { adminKey, token: null });
export const adminReports = (adminKey) => call('/admin/network/reports', { adminKey, token: null });
export const adminDecideReport = (adminKey, kind, id, action, note) => call(`/admin/network/reports/${enc(kind)}/${enc(id)}`, { method: 'POST', body: { action, note }, adminKey, token: null });
export const adminSuggestions = (adminKey) => call('/admin/network/suggestions', { adminKey, token: null });
export const adminApprove = (adminKey, id, completed) => call(`/admin/network/suggestions/${enc(id)}/approve`, { method: 'POST', body: { completed }, adminKey, token: null });
export const adminReject = (adminKey, id, note) => call(`/admin/network/suggestions/${enc(id)}/reject`, { method: 'POST', body: { note }, adminKey, token: null });
export const adminMembers = (adminKey, search) => call(`/admin/network/members${query({ search })}`, { adminKey, token: null });
export const adminSuspend = (adminKey, id, suspended, note) => call(`/admin/network/members/${enc(id)}`, { method: 'POST', body: { suspended, note }, adminKey, token: null });
