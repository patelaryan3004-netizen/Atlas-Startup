// What one complete read of an employer's board does to the roles we hold for that employer. No network, no files: rows in, rows changed, counts out, so it can be tested
// to the letter.
//
// Keys. A role is the same role when (company, provider, external id) match; failing that, when its canonical application address matches (a role we held from the slower careers-page
// reader, or the same role under a new id). A legacy row found that way is adopted: it keeps its id (so a saved role stays saved), gains the provider and external id, and keeps
// its first read as the day it was first seen.
//
// Three dates, never mixed up:
//   posted_at          what the EMPLOYER says; null when it does not say. Never filled from a check.
//   first_seen_at      the first complete read that listed it.
//   last_confirmed_at  the last complete read that listed it (retrieved_at is the same date, as the rest of the system has always read it).
// A role is "new" because its employer posted it, or because it was first seen after the last time the board was read: never because it was just checked.
//
// A role that is not in a COMPLETE read is hidden (absent_reads 1); not in the next complete read either, archived (2). One that is listed again is open again, whichever it was.
// This is only ever called with a complete read: a failed or partial read never gets here (adapters.js throws), so it can neither close a role nor move a date.
import { slugify, uniqueSlug } from '../models/company.js';
import { canonicalUrl } from './canonical.js';
import { workPlaces } from './locations.js';

export const LIFECYCLES = ['open', 'hidden', 'archived', 'closed'];
// The second absence that archives a role must be a separate read, not the same glitch seen twice: at least this long after the read that hid it. (The sync reads each board about
// hourly, so this never delays an ordinary archive; it stops two reads a minute apart, a forced run or a retry, from archiving what one bad answer hid.)
export const ARCHIVE_GAP_MS = 30 * 60000;

const isoOf = (now) => new Date(now).toISOString();
const keyOf = (v) => (v == null ? null : String(v));

// The row a posting becomes.
function fromPosting(p, source, at, id) {
  return {
    id, company_id: source.company_id, title: p.title, location: p.labels.join(' / ') || null, employment_type: p.employment ?? null,
    remote: /\bremote\b/i.test(`${p.labels.join(' ')} ${p.workplaceType ?? ''}`) ? true : null, posted_at: p.posted_at ?? null, apply_url: p.apply_url, status: 'open',
    source_id: source.id, retrieved_at: at,
    provider: source.provider, external_id: p.external_id, canonical_url: p.canonical_url, first_seen_at: at, last_confirmed_at: at, absent_reads: 0, status_changed_at: at,
    locations: p.labels, workplace_type: p.workplaceType ?? null, team: p.team ?? null,
  };
}

// What the employer says now replaces what we held (the employer is the authority on its own role); what it does not say stays unsaid, except a posted date it once gave.
function refresh(row, p, source, at) {
  const reopened = row.status !== 'open';
  const firstSeen = row.first_seen_at ?? row.retrieved_at ?? at; // a legacy row's first read is the earliest day we have for it
  Object.assign(row, {
    title: p.title, location: p.labels.join(' / ') || null, employment_type: p.employment ?? null,
    remote: /\bremote\b/i.test(`${p.labels.join(' ')} ${p.workplaceType ?? ''}`) ? true : null, apply_url: p.apply_url,
    source_id: source.id, retrieved_at: at, provider: source.provider, external_id: p.external_id, canonical_url: p.canonical_url,
    last_confirmed_at: at, absent_reads: 0, locations: p.labels, workplace_type: p.workplaceType ?? null, team: p.team ?? null,
  });
  if (p.posted_at) row.posted_at = p.posted_at;
  row.first_seen_at = firstSeen;
  if (reopened) { row.status = 'open'; row.status_changed_at = at; }
  return reopened;
}

export const jobId = (rows, source, externalId) => uniqueSlug(slugify(`${source.company_id}-${source.provider}-${externalId}`).slice(0, 90), new Set(rows.map((r) => r.id)));

// Apply one complete read. `read` is { postings, seen:Set<external id>, skipped }. Returns the counts. `absence: false` is for a read that is not the whole board (one event): it
// upserts what it names and declares nothing else absent.
export function applyRead(rows, source, read, { now = Date.now(), absence = true } = {}) {
  const at = isoOf(now);
  const stats = { listed: read.seen.size, usable: read.postings.length, added: 0, updated: 0, reopened: 0, adopted: 0, hidden: 0, archived: 0, duplicates: 0, out_of_scope: 0, skipped: read.skipped?.length ?? 0 };
  const mine = rows.filter((r) => r.company_id === source.company_id);
  const byExternal = new Map(mine.filter((r) => r.provider === source.provider && r.external_id != null).map((r) => [keyOf(r.external_id), r]));
  const byUrl = new Map();
  for (const r of mine) { const u = r.canonical_url ?? canonicalUrl(r.apply_url); if (u && (!byUrl.has(u) || r.provider)) byUrl.set(u, r); }
  const touched = new Set();
  const urlsSeen = new Set();

  for (const p of read.postings) {
    if (urlsSeen.has(p.canonical_url)) { stats.duplicates += 1; continue; } // another id for an address already read in this feed
    urlsSeen.add(p.canonical_url);
    const where = workPlaces(p.labels, { workplaceType: p.workplaceType });
    let row = byExternal.get(keyOf(p.external_id));
    let adopted = false;
    if (!row) {
      row = byUrl.get(p.canonical_url) ?? null;
      adopted = Boolean(row);
    }
    if (!row) {
      // A role at no Australian place, and not remote from Australia, is not for this board, and a role we do not hold is not stored.
      if (!where.au && !where.remoteAu) { stats.out_of_scope += 1; continue; }
      const created = fromPosting(p, source, at, jobId(rows, source, p.external_id));
      rows.push(created);
      byExternal.set(keyOf(p.external_id), created);
      touched.add(created.id);
      stats.added += 1;
      continue;
    }
    if (touched.has(row.id)) { stats.duplicates += 1; continue; }
    const reopened = refresh(row, p, source, at);
    touched.add(row.id);
    if (adopted) stats.adopted += 1;
    if (reopened) stats.reopened += 1; else stats.updated += 1;
  }

  // What this source held and this read did not list.
  if (!absence) return stats;
  const listedUrls = new Set(read.postings.map((p) => p.canonical_url));
  for (const row of mine) {
    if (touched.has(row.id)) continue;
    const ours = row.source_id === source.id || (row.provider === source.provider && row.external_id != null);
    if (!ours) continue;
    if (row.external_id != null && read.seen.has(keyOf(row.external_id))) continue; // still listed, though not usable (its link is not the employer's): not absent
    const url = row.canonical_url ?? canonicalUrl(row.apply_url);
    if (url && listedUrls.has(url)) continue;
    if (row.status === 'open') { Object.assign(row, { status: 'hidden', absent_reads: 1, status_changed_at: at }); stats.hidden += 1; }
    else if (row.status === 'hidden' && now - Date.parse(row.status_changed_at ?? row.retrieved_at ?? at) >= ARCHIVE_GAP_MS) { Object.assign(row, { status: 'archived', absent_reads: 2, status_changed_at: at }); stats.archived += 1; }
  }
  return stats;
}

// An authorised, signed webhook from an employer (not offered by anyone yet) says one posting was published or closed. It goes through the same rows and the same rules: a posting
// is upserted as a read of one, and a closure is explicit. Reconciling reads continue to run, so a missed event is repaired by the next one.
export function applyEvent(rows, source, event, { now = Date.now() } = {}) {
  const at = isoOf(now);
  if (event.type === 'closed') {
    const row = rows.find((r) => r.company_id === source.company_id && r.provider === source.provider && keyOf(r.external_id) === keyOf(event.external_id));
    if (!row || row.status === 'closed') return { closed: 0 };
    Object.assign(row, { status: 'closed', status_changed_at: at });
    return { closed: 1 };
  }
  const read = { postings: [event.posting], seen: new Set([keyOf(event.posting.external_id)]), skipped: [] };
  return applyRead(rows, { ...source }, read, { now, absence: false }); // only this one posting is known: nothing else is declared absent
}
