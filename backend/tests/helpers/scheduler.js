// Scaffolding for the scheduler tests: finished queue tasks as the worker leaves them, a clock, and a scripted web.
import { dataset, co, NOW, ISO, auPage, page } from './discovery.js';

export { dataset, co, NOW, ISO, auPage, page };
export const DAY = 86400000;
export const at = (ms) => new Date(ms).toISOString();
export const days = (n, from = NOW) => from + n * DAY;

// A task row, as the queue stores one. Defaults to a finished, successful read of everything.
export function task(id, { n = 1, ...over } = {}) {
  const status = over.status ?? 'done';
  const open = status === 'queued' || status === 'running';
  return {
    id: `enq-${id}-${n}`, kind: 'company', target_id: id, status, priority: 200, reason: 'refresh',
    wanted: ['hiring_status', 'jobs', 'address', 'city', 'state', 'founders', 'investors', 'description', 'founded_year'],
    max_pages: null, created_at: ISO, created_by: 'scheduler', not_before: null, attempts: status === 'failed' ? 3 : 0,
    started_at: status === 'queued' ? null : ISO, finished_at: open ? null : ISO, lease_until: null, last_error: null, result: null, ...over,
  };
}

// What the worker's brief() leaves in a finished task's result.
export const read = (over = {}) => ({
  outcome: 'read', pages: 3, evidence_added: 0, evidence_refreshed: 0, added_fields: [], refreshed_fields: [], confirmed_fields: [], status_signals: [],
  applied: [], suggested: [], conflicts: [], held: [], jobs: { added: 0, updated: 0, closed: 0 }, warnings: [], refused: [], ...over,
});

// A scripted web: URL -> { status, headers, body } or an Error. Counts the calls.
export function scriptedWeb(routes = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const hit = typeof routes === 'function' ? routes(url) : routes[url];
    if (hit instanceof Error) throw hit;
    if (!hit) return new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } });
    return new Response(hit.body ?? '', { status: hit.status ?? 200, headers: hit.headers ?? { 'content-type': 'text/html' } });
  };
  return { calls, pages: () => calls.filter((u) => !u.endsWith('/robots.txt')), fetchImpl };
}
