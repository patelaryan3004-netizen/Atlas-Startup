// The connection to Postgres (Neon's free plan, or any Postgres), for what must survive Render restarts and redeploys. The only thing that uses it today is the founding-member
// list (network/founding.js); docs/database.md says what comes next.
//
// It is off unless the machine says where the database is: DATABASE_URL in the environment (on Render: the service's Environment tab, never a file in git, never the frontend).
// Nothing in here ever prints, returns or logs that address: it holds the password. A problem is described in words ("DATABASE_URL must use TLS") and an error from the
// driver is reduced to its short code before it is logged.
//
//   * TLS is required for every host but the developer's own computer: the address must say sslmode=require (Neon's own strings do).
//   * The pooled address (Neon's "-pooler" host, PgBouncer in transaction mode) is refused: the migrations take a session-level advisory lock, which it does not support, and a
//     single always-on server with a handful of connections gains nothing from it. Use the direct address.
//   * Neon's free plan suspends the database after five idle minutes and wakes it on the next query (a few hundred milliseconds), dropping idle connections: so idle connections
//     are let go well before that, an idle-connection error is caught (an unhandled one would stop the server), and a query that fails because its connection was dropped is run once more.
import pg from 'pg';
import { migrate } from './migrate.js';

const LOCAL = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const TLS_MODES = new Set(['require', 'verify-ca', 'verify-full']);
const RETRY_CODES = new Set(['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ECONNREFUSED', '57P01', '57P02', '57P03', '08000', '08003', '08006']);

// Whether an address can be used, and if not, why in words. Never repeats the address.
export function checkDatabaseUrl(url) {
  let u;
  try { u = new URL(String(url)); } catch { return { ok: false, reason: 'DATABASE_URL is not a valid address (it should look like postgresql://user:password@host/database?sslmode=require).' }; }
  if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') return { ok: false, reason: 'DATABASE_URL must start with postgresql://.' };
  if (!u.hostname) return { ok: false, reason: 'DATABASE_URL has no host.' };
  if (!LOCAL.has(u.hostname) && !TLS_MODES.has(u.searchParams.get('sslmode') ?? '')) return { ok: false, reason: 'DATABASE_URL must use TLS: add ?sslmode=require to the end of it.' };
  if (u.hostname.includes('-pooler')) return { ok: false, reason: 'DATABASE_URL is the pooled address: use the direct one (in Neon\'s Connect dialog, turn Connection pooling off).' };
  return { ok: true, host: u.hostname };
}

const isDropped = (err) => RETRY_CODES.has(err?.code) || /Connection terminated|connection (was )?(closed|reset)/i.test(err?.message ?? '');

// Opens the database named by `url` (default: DATABASE_URL). Returns null when there is none. A connection is made on the first query, not here.
// Returns { problem } instead when an address is set but cannot be used, so the server can still run and say so (the list then stays on its file and says it is not durable).
export function openDatabase({ url = process.env.DATABASE_URL, max = 3, log = console, Pool = pg.Pool } = {}) {
  const address = String(url ?? '').trim();
  if (!address) return null;
  const check = checkDatabaseUrl(address);
  if (!check.ok) return { problem: check.reason };

  const pool = new Pool({
    connectionString: address,
    max,
    idleTimeoutMillis: 10000, // let idle connections go long before Neon suspends an idle database (five minutes)
    connectionTimeoutMillis: 10000,
    keepAlive: true,
    statement_timeout: 10000,
    application_name: 'still-early-api',
  });
  // An idle connection the database dropped is reported here; without a listener Node would stop the server. Only its short code is logged.
  pool.on('error', (err) => log.warn?.(`[db] an idle connection was dropped (${err?.code ?? 'error'}); the next query opens a new one`));

  let closing = null;
  const db = {
    kind: 'postgres',
    host: check.host,
    async query(text, params) {
      try { return await pool.query(text, params); } catch (err) {
        if (!isDropped(err)) throw err;
        return pool.query(text, params); // every query the site makes here can be run twice safely
      }
    },
    // One connection for several statements in a row (a transaction, a lock).
    async withClient(fn) {
      const client = await pool.connect();
      try { return await fn(client); } finally { client.release(); }
    },
    close: () => (closing ??= pool.end()), // safe to call twice
  };

  // The tables are made, or brought up to date, once per process, before the first query that needs them. A failure is not remembered: the next call tries again.
  let ready = null;
  db.ready = () => {
    ready ??= migrate(db, { log }).catch((err) => { ready = null; throw err; });
    return ready;
  };
  return db;
}

// A short, safe description of a driver error for a log line: its code, never its message (which can name the host).
export const errorCode = (err) => err?.code ?? err?.name ?? 'error';

