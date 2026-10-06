// Authentication for the Command Center.
//
// A person signs in with a token: 32 random bytes, shown ONCE when it is made. Only its SHA-256 is stored
// (a hash is enough: the token is far too long to guess, so it needs no slow password hash). The users file
// lives in backend/.admin/, which git ignores, and holds names, roles and hashes: nothing that works as a
// password.
//
//   - comparison is constant-time and looks at every user, so how long it takes says nothing
//   - failed sign-ins are counted; after too many in a minute everything is refused for a minute
//   - what happens (sign-ins, failures, refusals) is written to a local security log, never a token
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, mkdir, appendFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { ROLES } from './roles.js';
import { BadRequestError } from './errors.js';

export const TOKEN_PREFIX = 'aus_';
export const generateToken = () => `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
export const hashToken = (token) => createHash('sha256').update(String(token)).digest('hex');

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,38}[A-Za-z0-9]$/;

export async function loadUsers(file) {
  let text;
  try { text = await readFile(file, 'utf8'); } catch (err) { if (err.code === 'ENOENT') return []; throw err; }
  const users = JSON.parse(text);
  for (const u of users) {
    if (!NAME_RE.test(u.name) || !ROLES.includes(u.role) || !/^[0-9a-f]{64}$/.test(u.token_sha256)) throw new Error(`the users file ${file} has an invalid entry for "${u?.name}"`);
  }
  return users;
}

async function saveUsers(file, users) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(users, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, file);
}

// Makes a user and a token. The token is returned once and is not stored.
export async function addUser(file, { name, role, now = Date.now }) {
  if (!NAME_RE.test(name ?? '')) throw new BadRequestError('a name is 2 to 40 letters, numbers, spaces, dots, dashes or underscores');
  if (!ROLES.includes(role)) throw new BadRequestError(`the role must be one of ${ROLES.join(', ')}`);
  const users = await loadUsers(file);
  if (users.some((u) => u.name.toLowerCase() === name.toLowerCase())) throw new BadRequestError(`there is already a user called ${name}`);
  const token = generateToken();
  const user = { name, role, token_sha256: hashToken(token), created_at: new Date(now()).toISOString() };
  await saveUsers(file, [...users, user]);
  return { user: { name, role }, token };
}

export async function revokeUser(file, name) {
  const users = await loadUsers(file);
  const left = users.filter((u) => u.name.toLowerCase() !== String(name).toLowerCase());
  if (left.length === users.length) throw new BadRequestError(`there is no user called ${name}`);
  await saveUsers(file, left);
}

export function createAuthenticator(users) {
  const rows = users.map((u) => ({ name: u.name, role: u.role, hash: Buffer.from(u.token_sha256, 'hex') }));
  return {
    count: rows.length,
    // The user the token belongs to, or null. Every user is compared, whatever the answer.
    authenticate(token) {
      if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
      const given = Buffer.from(hashToken(token), 'hex');
      let found = null;
      for (const row of rows) if (timingSafeEqual(given, row.hash) && !found) found = row;
      return found ? { name: found.name, role: found.role } : null;
    },
  };
}

// Refuses everything for lockMs after `max` failures within windowMs. Every request reaches the server from
// the same machine, so this counts the failures as a whole, not per address.
export function createLimiter({ max = 8, windowMs = 60000, lockMs = 60000, now = Date.now } = {}) {
  let failures = [];
  let lockedUntil = 0;
  return {
    // Milliseconds left of a lock, or 0.
    locked: () => Math.max(0, lockedUntil - now()),
    fail() {
      const t = now();
      failures = [...failures.filter((f) => t - f < windowMs), t];
      if (failures.length >= max) { lockedUntil = t + lockMs; failures = []; return true; }
      return false;
    },
    succeed() { failures = []; },
  };
}

// One JSON line per event, in a local file git does not track.
export function createSecurityLog(file, { now = Date.now } = {}) {
  return {
    async log(event, details = {}) {
      try {
        await mkdir(path.dirname(file), { recursive: true });
        await appendFile(file, `${JSON.stringify({ at: new Date(now()).toISOString(), event, ...details })}\n`, { mode: 0o600 });
      } catch { /* a log that cannot be written must not take the interface down */ }
    },
  };
}
