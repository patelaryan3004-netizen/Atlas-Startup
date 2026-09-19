const API_ROOT = import.meta.env.VITE_API_BASE || '';
const BASE = `${API_ROOT}/api`;
export const DIRECTORY_URL = `${API_ROOT}/directory`;

function toQuery(params) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v) qs.set(k, v);
  });
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export async function fetchStartups(filters = {}) {
  const res = await fetch(`${BASE}/startups${toQuery(filters)}`);
  if (!res.ok) throw new Error('Failed to fetch startups');
  return res.json();
}

export async function fetchMeta() {
  const res = await fetch(`${BASE}/startups/meta`);
  if (!res.ok) throw new Error('Failed to fetch filter metadata');
  return res.json();
}

export async function fetchNews(force = false) {
  const res = await fetch(`${BASE}/news${force ? '?refresh=1' : ''}`);
  if (!res.ok) throw new Error('Failed to fetch news');
  return res.json();
}

export async function submitStartup(data) {
  const res = await fetch(`${BASE}/submissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Failed to submit startup');
  return body;
}

export async function submitEdit(data) {
  const res = await fetch(`${BASE}/edits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Failed to submit edit');
  return body;
}

export async function submitFeedback(data) {
  const res = await fetch(`${BASE}/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Failed to submit feedback');
  return body;
}
