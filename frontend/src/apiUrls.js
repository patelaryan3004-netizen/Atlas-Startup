// The addresses the API is asked at. In one place so that api.js (which asks) and peek.js (which reads the snapshot's copy of an answer without
// asking) build exactly the same address for the same question.

// (`import.meta.env` is Vite's; the script that makes the snapshot (backend/scripts/snapshot.mjs) runs api.js in Node, where it is not there.)
export const API_ROOT = (import.meta.env && import.meta.env.VITE_API_BASE) || '';
export const BASE = `${API_ROOT}/api`;

// Empty values are left out; a list (the tracked names) is repeated as name=a&name=b.
export function toQuery(params) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (Array.isArray(v)) v.forEach((x) => qs.append(k, x));
    else if (v) qs.set(k, v);
  });
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export const startupPageUrl = (filters = {}, { limit = 20, offset = 0, sort = 'name', facets } = {}) => (
  `${BASE}/startups${toQuery({ ...filters, limit: String(limit), offset: String(offset), sort, view: 'card', facets })}`
);
export const markersUrl = (filters = {}) => `${BASE}/startups/markers${toQuery(filters)}`;
export const summaryUrl = (filters = {}) => `${BASE}/startups/summary${toQuery(filters)}`;
export const metaUrl = () => `${BASE}/startups/meta`;
export function countsUrl(filterSets) {
  const params = new URLSearchParams();
  for (const filters of filterSets) {
    const own = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value) own.set(key, value);
    params.append('f', own.toString());
  }
  return `${BASE}/startups/counts?${params}`;
}
