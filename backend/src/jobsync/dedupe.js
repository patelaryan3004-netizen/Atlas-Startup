// One role, shown once. Two stored rows are the same role when they are at the same company, have the same title, are worked at the same place, and came from DIFFERENT boards (a company
// with a global board and an Australian one; a role the slower careers-page reader held and a feed lists under another address). Two rows from the SAME board are never merged: an employer
// that posts "Account Executive" three times in Sydney has three openings, and that is its word.
//
// The role that stays is the better supported one: a role the employer gave a posted date for, then the one seen first. The others are `hidden` with `duplicate_of` set. The sync does not
// reopen a role that carries `duplicate_of` (engine.js). When the role it duplicates is no longer open, the mark is removed and the next read of its own board decides what it is.
//
// A venture firm's board is never a second copy: its sample is not stored as roles (vc.js), so there is nothing to merge it with.
import { workPlaces } from './locations.js';

const norm = (s) => String(s ?? '').toLowerCase().replace(/&/g, 'and').replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

// Where a role is worked, as a comparable key: the Australian cities it names, else the place words.
function placeKey(job) {
  const labels = Array.isArray(job.locations) && job.locations.length ? job.locations : [job.location].filter(Boolean);
  const w = workPlaces(labels, { workplaceType: job.workplace_type });
  if (w.cities.length) return [...w.cities].sort().join('+');
  return norm(labels.join(' ')) || 'none';
}

export const duplicateKey = (job) => `${job.company_id}|${norm(job.title)}|${placeKey(job)}`;
const sourceOf = (j) => j.source_id ?? j.provider ?? 'unknown';

// The better supported of two roles: has an employer's posted date, then seen first, then id (so the choice never flips between runs).
const rank = (j) => [j.posted_at ? 0 : 1, Date.parse(j.first_seen_at ?? j.retrieved_at ?? '') || Number.MAX_SAFE_INTEGER, j.id];
const byRank = (a, b) => { const x = rank(a); const y = rank(b); for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1; return 0; };

// Mutates `rows`. Returns { removed (newly hidden this call), released, hidden (all that are hidden as duplicates now), groups }.
export function dedupeRoles(rows, { now = Date.now } = {}) {
  const at = new Date(now).toISOString();
  const byId = new Map(rows.map((r) => [r.id, r]));
  const stats = { removed: 0, released: 0, hidden: 0, groups: 0 };

  for (const j of rows) {
    if (!j.duplicate_of) continue;
    const original = byId.get(j.duplicate_of);
    if (!original || original.status !== 'open') { delete j.duplicate_of; j.status_changed_at = at; stats.released += 1; }
  }

  const groups = new Map();
  for (const j of rows) {
    if (j.status !== 'open' || j.duplicate_of) continue;
    const k = duplicateKey(j);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(j);
  }
  for (const members of groups.values()) {
    if (new Set(members.map(sourceOf)).size < 2) continue;
    const [winner, ...rest] = [...members].sort(byRank);
    stats.groups += 1;
    for (const m of rest) {
      if (sourceOf(m) === sourceOf(winner)) continue; // the same board's own repeat
      m.status = 'hidden';
      m.status_changed_at = at;
      m.duplicate_of = winner.id;
      stats.removed += 1;
    }
  }
  stats.hidden = rows.filter((j) => j.duplicate_of && j.status === 'hidden').length;
  return stats;
}
