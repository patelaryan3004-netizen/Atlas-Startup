import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import app from '../src/app.js';
import { findContacts } from '../src/models/contact.js';

// The data is public in the repository and the API serves a company's sources. A page's phone number or email address, quoted into a title, a note or a working file, is not a fact about where
// a company is and can belong to a person. Text from a page is cleaned where it enters (src/models/contact.js); this is the net under that.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.join(HERE, '..');
const DATA = path.join(BACKEND, 'src', 'data');
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const show = (file, found) => `${path.relative(BACKEND, file)}: ${found.slice(0, 3).map((f) => `${f.kind} ${f.text}`).join('; ')}`;

// The audit trail is append-only, so four entries of 13 Oct 2026 that quote a company's published contact details (a role mailbox or a business line, from its own page) stay as they were written (the hashes below).
// No other row may have any, and nothing written from now on can: makeAuditRow cleans a summary, a reason and a free-text change.
const HISTORICAL = {
  'aud-20261013132433993-1': 'e0a753182117ff5a0c0046feb33d7185fe83f33baf57cf1d8d773c50312cecee',
  'aud-20261013132438211-1': '0944ad1d17f5d51438f98cc801649030b56515b71e5f0afcaa08ff6b17cbf925',
  'aud-20261013132439620-1': '1d7fe074c44c45ab383174963f440eab16256921a762002ef6037756fae4c6e3',
  'aud-20261013132441220-1': 'd83065e67f84970f1c609f0b25b19fffeefdfb605603d384c8d43edc0c763808'
};

describe('no contact details in what is public', () => {
  it('the data files hold none (the audit trail and the owner\'s own seed excepted)', () => {
    const files = readdirSync(DATA).filter((f) => f.endsWith('.json') && !['audit_trail.json', 'people_seed.json', 'geocode_cache.json'].includes(f));
    expect(files.length).toBeGreaterThan(10);
    const bad = files.map((f) => [f, findContacts(readFileSync(path.join(DATA, f), 'utf8'))]).filter(([, found]) => found.length).map(([f, found]) => show(path.join(DATA, f), found));
    expect(bad).toEqual([]);
  });

  it('the audit trail has them only in the four historical entries, and those are unchanged', () => {
    const trail = JSON.parse(readFileSync(path.join(DATA, 'audit_trail.json'), 'utf8'));
    const rows = Array.isArray(trail) ? trail : trail.audit_trail;
    const ids = rows.filter((r) => findContacts(JSON.stringify(r)).length).map((r) => r.id);
    expect(ids).toEqual(Object.keys(HISTORICAL));
    // as written, never edited: the row's hash is what it was when this test was made (so that no copy of those contact details has to be kept in a test)
    for (const [id, hash] of Object.entries(HISTORICAL)) expect(createHash('sha256').update(JSON.stringify(rows.find((r) => r.id === id))).digest('hex'), id).toBe(hash);
  });

  it('the city pack\'s working files hold none: the text is kept as a sanitised excerpt', () => {
    const files = ['sydney-pack', 'melbourne-pack', 'perth-pack', 'citypack'].map((d) => path.join(BACKEND, 'scripts', d)).filter(existsSync).flatMap(walk).filter((f) => f.endsWith('.json') && !f.includes(`${path.sep}input${path.sep}`));
    expect(files.length).toBeGreaterThan(10);
    const bad = files.map((f) => [f, findContacts(readFileSync(f, 'utf8'))]).filter(([, found]) => found.length).map(([f, found]) => show(f, found));
    expect(bad).toEqual([]);
  });

  it('no company the API serves carries one: not in a source title, a note, a description or a name', async () => {
    const list = JSON.parse(readFileSync(path.join(DATA, 'startups.json'), 'utf8'));
    const bad = [];
    for (let i = 0; i < list.length; i += 40) {
      const batch = list.slice(i, i + 40);
      const answers = await Promise.all(batch.map((c) => request(app).get(`/api/startups/${c.slug ?? c.id}`)));
      answers.forEach((res, k) => { const found = findContacts(res.text); if (found.length) bad.push(`${batch[k].id}: ${found.slice(0, 2).map((f) => f.text).join('; ')}`); });
    }
    expect(bad).toEqual([]);
  }, 120000);
});
