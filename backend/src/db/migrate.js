// Brings the database up to date: runs, in order, each file in backend/db/migrations/ that has not run yet (0001_name.sql, 0002_name.sql ...), once, and remembers it in
// schema_migrations. Safe to run twice and from two servers at once (a session-level advisory lock makes the second wait). A file is never run again and may never be changed
// after it ran (its checksum is kept): the fix for a mistake is a new file. Each file runs in its own transaction, so a failure leaves nothing half done.
//
// backend/db/planned/ is NOT run: it is the design of what comes next (docs/database.md).
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'db', 'migrations');
const LOCK_KEY = 7340211; // an arbitrary number that names "the migrations" for pg_advisory_lock
// A stable name for a migration file's text (line endings do not count: a Windows checkout turns LF into CRLF).
export const checksum = (text) => createHash('sha256').update(String(text).replaceAll('\r\n', '\n')).digest('hex');
const NAME = /^\d{4}_[a-z0-9_]+\.sql$/;

export async function migrate(db, { dir = MIGRATIONS_DIR, log = console } = {}) {
  const files = (await readdir(dir)).filter((f) => NAME.test(f)).sort();
  return db.withClient(async (client) => {
    await client.query('select pg_advisory_lock($1)', [LOCK_KEY]);
    try {
      await client.query('create table if not exists schema_migrations (name text primary key, checksum text not null, applied_at timestamptz not null default now())');
      const done = new Map((await client.query('select name, checksum from schema_migrations')).rows.map((r) => [r.name, r.checksum]));
      const applied = [];
      for (const file of files) {
        const sql = await readFile(path.join(dir, file), 'utf8');
        const sum = checksum(sql);
        if (done.has(file)) {
          if (done.get(file) !== sum) throw new Error(`Migration ${file} was changed after it ran. Leave it as it was and add a new migration instead.`);
          continue;
        }
        await client.query('begin');
        try {
          await client.query(sql);
          await client.query('insert into schema_migrations (name, checksum) values ($1, $2)', [file, sum]);
          await client.query('commit');
        } catch (err) {
          await client.query('rollback').catch(() => {});
          throw err;
        }
        applied.push(file);
      }
      if (applied.length) log.log?.(`[db] migrations applied: ${applied.join(', ')}`);
      return { applied };
    } finally {
      await client.query('select pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    }
  });
}
