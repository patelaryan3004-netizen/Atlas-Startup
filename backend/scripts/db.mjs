// The owner's commands for the database (Neon's free Postgres; docs/database.md). Each reads DATABASE_URL from the environment or from backend/.env (a file git ignores: put it there with
// an editor, so the password is never typed into a command line or a shell history). Nothing here prints that address, the password or an email address.
//
//   npm run db:status                                   connects and says what is there (migrations applied, how many founding members): no addresses
//   npm run db:migrate                                  makes or updates the tables (the server also does this by itself when it starts)
//   npm run founding:import -- <file.json>              counts what importing an earlier list would do (a dry run)
//   npm run founding:import -- <file.json> --apply      imports it (safe to run twice: the same email is one person)
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../src/db/database.js';
import { importFounding, rowsOf } from '../src/db/foundingImport.js';
import { makeId } from '../src/network/validate.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// A minimal .env reader: KEY=VALUE lines, optional quotes, # comments. Only DATABASE_URL is looked for, and only when it is not already in the environment.
async function loadDatabaseUrl() {
  if (process.env.DATABASE_URL !== undefined) return process.env.DATABASE_URL; // set in the environment (even to nothing, as the tests do): the file is not read
  try {
    for (const line of (await readFile(path.join(here, '..', '.env'), 'utf8')).split(/\r?\n/)) {
      const m = /^\s*DATABASE_URL\s*=\s*(.*?)\s*$/.exec(line);
      if (m) return m[1].replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch (err) { if (err.code !== 'ENOENT') throw err; }
  return '';
}

const [command, ...args] = process.argv.slice(2);
const fail = (message) => { console.error(message); process.exit(1); };

const opened = openDatabase({ url: await loadDatabaseUrl() });
if (!opened) fail('DATABASE_URL is not set. Put it in backend/.env (one line: DATABASE_URL=...) or in the environment. See docs/database.md.');
if (opened.problem) fail(opened.problem);
const db = opened;

try {
  if (command === 'migrate') {
    const { applied } = await db.ready();
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Already up to date.');
  } else if (command === 'status') {
    const { rows: [v] } = await db.query('select version() as v, current_database() as d');
    console.log(`Connected to database "${v.d}" (${v.v.split(' ').slice(0, 2).join(' ')}), over TLS.`);
    const has = async (t) => (await db.query('select to_regclass($1) as r', [t])).rows[0].r !== null;
    if (await has('schema_migrations')) console.log('Migrations applied:', (await db.query('select name from schema_migrations order by name')).rows.map((r) => r.name).join(', ') || 'none');
    else console.log('No migrations applied yet: run npm run db:migrate (or start the server).');
    if (await has('founding_members')) console.log('Founding members:', (await db.query('select count(*)::int as n from founding_members')).rows[0].n);
  } else if (command === 'founding-import') {
    const file = args.find((a) => !a.startsWith('--'));
    if (!file) fail('Say which file: npm run founding:import -- path/to/founding-export.json [--apply]');
    const rows = rowsOf(JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''))); // Windows PowerShell saves a byte-order mark first
    const apply = args.includes('--apply');
    const counts = await importFounding(db, rows, { apply, makeId });
    console.log(apply ? 'Imported.' : 'Dry run (nothing written; add --apply to import).');
    console.table(counts);
  } else {
    fail('Commands: migrate | status | founding-import <file> [--apply]');
  }
} catch (err) {
  if (err instanceof SyntaxError) fail('That file is not valid JSON: save the admin export again.');
  if (err?.code === 'ENOENT') fail('That file was not found.');
  fail(`Failed (${err?.code ?? err?.name ?? 'error'}). Check that DATABASE_URL is right and the database is reachable.`);
} finally {
  await db.close();
}
