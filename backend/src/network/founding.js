// The founding-member list: what the site keeps while the members' side cannot be open, so that people who want to be part of it can say so honestly, without an account and without anything
// pretending to work. It is a waiting list and nothing more: no account is made, no one can post, and no introduction is made from it.
//
// It is kept in one small JSON file in the network folder (git ignores it) and read by the owner with the admin key. It holds an email address, so it is never part of the public data. Where the
// server's disk is erased on a restart (Render's free plan) the list can be lost too; the API says whether the folder is one that lasts (`durable`), and the page says so in words.
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { bad, cleanText, httpsUrl, looksLikeEmail, makeId, tooMany, oneOf } from './validate.js';
import { INTENT_IDS, SKILL_IDS } from './taxonomy.js';
import { createLimiter } from './auth.js';

const FILE = 'founding_members.json';
export const MAX_ROWS = 5000;

export function createFounding({ dir, durable = false, now = Date.now, perHour = 5 } = {}) {
  const target = path.join(dir, FILE);
  const limit = createLimiter({ max: perHour, windowMs: 3600000, now });
  let queue = Promise.resolve();

  const load = async () => { try { return JSON.parse(await readFile(target, 'utf8')); } catch (err) { if (err.code === 'ENOENT') return []; throw err; } };
  const save = async (rows) => {
    await mkdir(dir, { recursive: true });
    const tmp = `${target}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(rows)}\n`, { mode: 0o600 });
    await rename(tmp, target);
  };

  return {
    durable,
    // One registration. The same email again replaces the earlier one (people change their minds), so the list holds each person once.
    add(input, { ip = 'unknown' } = {}) {
      if (!input || typeof input !== 'object') throw bad('Send the registration as an object.');
      if (input.company_website) return Promise.resolve({ saved: true }); // a field only a script fills in: answer as if it worked, keep nothing
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
      const run = async () => {
        const rows = await load();
        const at = new Date(now()).toISOString();
        const i = rows.findIndex((r) => r.email === email);
        if (i === -1) {
          if (rows.length >= MAX_ROWS) throw tooMany('The list is full for now.');
          rows.push({ id: makeId('f', now()), ...row, created_at: at, updated_at: at });
        } else rows[i] = { ...rows[i], ...row, updated_at: at };
        await save(rows);
        return { saved: true };
      };
      const done = queue.then(run, run);
      queue = done.catch(() => {});
      return done;
    },
    // For the owner: every registration, oldest first.
    async list() { return load(); },
  };
}
