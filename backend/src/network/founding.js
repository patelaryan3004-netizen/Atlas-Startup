// The founding-member list: what the site keeps while the members' side cannot be open, so that people who want to be part of it can say so honestly, without an account and without anything
// pretending to work. It is a waiting list and nothing more: no account is made, no one can post, and no introduction is made from it.
//
// It is kept in Postgres (db/migrations/0001_founding_members.sql) when DATABASE_URL is set: that survives Render restarts and redeploys, so `durable` is true. With no database it is one small JSON
// file in the network folder (git ignores it), which is fine on a developer's computer and is lost where the disk is erased on a restart (Render's free plan): `durable` is then false, and the page says
// so in words. Either way it is read by the owner with the admin key, it holds an email address, so it is never part of the public data, and the same email twice is one person.
//
// If a database is set up and cannot be reached the list does NOT fall back to the file (a sign-up would be "saved" somewhere a restart erases): it says it cannot take sign-ups right now (503).
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { ApiError, bad, cleanText, httpsUrl, looksLikeEmail, makeId, tooMany, oneOf } from './validate.js';
import { INTENT_IDS, SKILL_IDS } from './taxonomy.js';
import { createLimiter } from './auth.js';
import { errorCode } from '../db/database.js';

const FILE = 'founding_members.json';
export const MAX_ROWS = 5000;

// ---------- where the list is kept ----------

// One JSON file, changed one change at a time.
function fileStore(dir) {
  const target = path.join(dir, FILE);
  let queue = Promise.resolve();
  const load = async () => { try { return JSON.parse(await readFile(target, 'utf8')); } catch (err) { if (err.code === 'ENOENT') return []; throw err; } };
  const save = async (rows) => {
    await mkdir(dir, { recursive: true });
    const tmp = `${target}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(rows)}\n`, { mode: 0o600 });
    await rename(tmp, target);
  };
  return {
    kind: 'file',
    upsert(row, { id, at }) {
      const run = async () => {
        const rows = await load();
        const i = rows.findIndex((r) => r.email === row.email);
        if (i === -1) {
          if (rows.length >= MAX_ROWS) throw tooMany('The list is full for now.');
          rows.push({ id, ...row, created_at: at, updated_at: at });
        } else rows[i] = { ...rows[i], ...row, updated_at: at };
        await save(rows);
      };
      const done = queue.then(run, run);
      queue = done.catch(() => {});
      return done;
    },
    list: load,
  };
}

const COLUMNS = 'id, email, name, city, intents, skills, building, looking_for, link, consented_at, created_at, updated_at';
const iso = (v) => (v instanceof Date ? v.toISOString() : v);

// A table in Postgres. A repeat of the same email changes the earlier row (the unique email decides it, not a read followed by a write, so two at once cannot make two rows) and leaves
// its id, created_at and consented_at as they were. A new person is added only while there is room.
function postgresStore(db) {
  return {
    kind: 'postgres',
    async upsert(row, { id, at }) {
      await db.ready();
      const res = await db.query(
        `insert into founding_members (id, email, name, city, intents, skills, building, looking_for, link, consented_at, created_at, updated_at)
         select $1, $2, $3, $4, $5::text[], $6::text[], $7, $8, $9, $10::timestamptz, $10::timestamptz, $10::timestamptz
          where exists (select 1 from founding_members where email = $2) or (select count(*) from founding_members) < $11
         on conflict (email) do update set name = excluded.name, city = excluded.city, intents = excluded.intents, skills = excluded.skills,
           building = excluded.building, looking_for = excluded.looking_for, link = excluded.link, updated_at = excluded.updated_at
         returning id`,
        [id, row.email, row.name, row.city, row.intents, row.skills, row.building, row.looking_for, row.link, at, MAX_ROWS],
      );
      if (res.rows.length === 0) throw tooMany('The list is full for now.');
    },
    async list() {
      await db.ready();
      const { rows } = await db.query(`select ${COLUMNS} from founding_members order by created_at, id`);
      return rows.map((r) => ({ ...r, consented_at: iso(r.consented_at), created_at: iso(r.created_at), updated_at: iso(r.updated_at) }));
    },
  };
}

// An error from the database becomes "not right now" (and is logged by its short code only): what the driver says can name the host.
function unavailable(err, log, what) {
  log.error?.(`[founding] ${what} failed (${errorCode(err)})`);
  return new ApiError(503, 'The founding list cannot take sign-ups right now. Please try again in a little while.', 'founding_unavailable');
}

export function createFounding({ dir, db = null, durable = false, now = Date.now, perHour = 5, log = console } = {}) {
  const store = db ? postgresStore(db) : fileStore(dir);
  const limit = createLimiter({ max: perHour, windowMs: 3600000, now });

  return {
    durable: db ? true : durable,
    store: store.kind,
    // One registration. The same email again replaces the earlier one (people change their minds), so the list holds each person once.
    async add(input, { ip = 'unknown' } = {}) {
      if (!input || typeof input !== 'object') throw bad('Send the registration as an object.');
      if (input.company_website) return { saved: true }; // a field only a script fills in: answer as if it worked, keep nothing
      if (input.consent !== true) throw bad('Please tick the box to say we may keep these details to invite you.');
      const email = cleanText(input.email, { name: 'Email', max: 254, required: true }).toLowerCase();
      if (!looksLikeEmail(email)) throw bad('Enter a valid email address.');
      const row = {
        name: cleanText(input.name, { name: 'Your name', min: 2, max: 60, required: true }), email,
        city: cleanText(input.city, { name: 'City', max: 60 }),
        intents: [...new Set((Array.isArray(input.intents) ? input.intents : []).map((v) => oneOf(v, INTENT_IDS, 'What you would like to do')))].slice(0, 4),
        skills: [...new Set((Array.isArray(input.skills) ? input.skills : []).map((v) => oneOf(v, SKILL_IDS, 'Skills')))].slice(0, 8),
        building: cleanText(input.building, { name: 'What you are building', max: 300, multiline: true }),
        looking_for: cleanText(input.looking_for, { name: 'What you are looking for', max: 300, multiline: true }),
        link: httpsUrl(input.link, { name: 'Link' }),
      };
      limit.hit(ip, 'Too many sign-ups from this connection. Try again in an hour.');
      const at = new Date(now()).toISOString();
      try {
        await store.upsert(row, { id: makeId('f', now()), at });
      } catch (err) {
        if (err.status) throw err; // a rule of the site (the list is full), not a fault
        throw unavailable(err, log, 'saving a registration');
      }
      return { saved: true };
    },
    // For the owner: every registration, oldest first.
    async list() {
      try { return await store.list(); } catch (err) { throw unavailable(err, log, 'reading the list'); }
    },
  };
}
