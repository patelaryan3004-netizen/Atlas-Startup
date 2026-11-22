// Brings an earlier founding-member list into Postgres: the file the owner saved from the admin read (GET /api/admin/network/founding: { results: [...] }), or a plain array of the same rows
// (the old founding_members.json). Safe to run twice: the email is the key, a person already there is not added again, and a row only changes the stored one when it is newer. A person's
// id, created_at and consented_at are never replaced by a later sign-up, and an earlier created_at from the file is kept.
//
// It returns counts, never the rows: nothing here prints an email address.
import { looksLikeEmail } from '../network/validate.js';

const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const list = (v, max) => [...new Set((Array.isArray(v) ? v : []).filter((x) => typeof x === 'string' && x.length <= 40).map((x) => x.trim()).filter(Boolean))].slice(0, max);
const when = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : null; };

// The rows of a file's parsed JSON, whichever of the two shapes it has.
export const rowsOf = (json) => (Array.isArray(json) ? json : Array.isArray(json?.results) ? json.results : []);

// One row, cleaned; null when it cannot be a registration (no usable email or name, or no date).
export function cleanRow(r) {
  if (!r || typeof r !== 'object') return null;
  const email = text(r.email, 254).toLowerCase();
  const name = text(r.name, 60);
  const created = when(r.created_at);
  if (!looksLikeEmail(email) || name.length < 2 || !created) return null;
  const link = text(r.link, 300);
  return {
    id: text(r.id, 40) || null, email, name, city: text(r.city, 60), intents: list(r.intents, 4), skills: list(r.skills, 8),
    building: text(r.building, 300), looking_for: text(r.looking_for, 300), link: /^https:\/\//i.test(link) ? link : '',
    created_at: created, updated_at: when(r.updated_at) ?? created, consented_at: when(r.consented_at) ?? created,
  };
}

// Reads `rows`, keeps the newest entry for each email, and (with apply: true) writes them. Without apply it only counts what would happen.
export async function importFounding(db, rows, { apply = false, makeId } = {}) {
  await db.ready();
  const byEmail = new Map();
  let invalid = 0;
  for (const raw of rows) {
    const row = cleanRow(raw);
    if (!row) { invalid += 1; continue; }
    const earlier = byEmail.get(row.email);
    if (!earlier) byEmail.set(row.email, row);
    else {
      const [newer, older] = row.updated_at >= earlier.updated_at ? [row, earlier] : [earlier, row];
      byEmail.set(row.email, { ...newer, id: older.id ?? newer.id, created_at: older.created_at < newer.created_at ? older.created_at : newer.created_at, consented_at: older.consented_at < newer.consented_at ? older.consented_at : newer.consented_at });
    }
  }
  const clean = [...byEmail.values()];
  const existing = new Map();
  if (clean.length) {
    const { rows: found } = await db.query('select email, updated_at from founding_members where email = any($1::text[])', [clean.map((r) => r.email)]);
    for (const f of found) existing.set(f.email, f.updated_at instanceof Date ? f.updated_at.toISOString() : f.updated_at);
  }
  const counts = { in_file: rows.length, invalid, duplicates_in_file: rows.length - invalid - clean.length, to_add: 0, to_update: 0, unchanged: 0, applied: apply };
  for (const row of clean) {
    const had = existing.get(row.email);
    if (had === undefined) counts.to_add += 1;
    else if (row.updated_at > had) counts.to_update += 1;
    else counts.unchanged += 1;
  }
  if (apply) {
    for (const row of clean) {
      await db.query(
        `insert into founding_members (id, email, name, city, intents, skills, building, looking_for, link, consented_at, created_at, updated_at)
         values ($1, $2, $3, $4, $5::text[], $6::text[], $7, $8, $9, $10::timestamptz, $11::timestamptz, $12::timestamptz)
         on conflict (email) do update set name = excluded.name, city = excluded.city, intents = excluded.intents, skills = excluded.skills, building = excluded.building,
           looking_for = excluded.looking_for, link = excluded.link, updated_at = excluded.updated_at,
           created_at = least(founding_members.created_at, excluded.created_at), consented_at = least(founding_members.consented_at, excluded.consented_at)
         where excluded.updated_at > founding_members.updated_at`,
        [row.id ?? makeId('f', Date.parse(row.created_at)), row.email, row.name, row.city, row.intents, row.skills, row.building, row.looking_for, row.link, row.consented_at, row.created_at, row.updated_at],
      );
    }
  }
  return counts;
}
