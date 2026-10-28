// Accounts: an email and a password, and a session token the browser keeps.
//
//   - passwords are kept as scrypt hashes (a slow hash, with a salt of its own); the password itself is never stored or logged
//   - a session token is 32 random bytes shown once; only its SHA-256 is stored, so a copy of the data cannot be used to sign in
//   - the token travels as an Authorization header, not a cookie: the site and its API are on different addresses, and a header cannot be attached
//     by another site's page
//   - comparing is constant-time, and a wrong email costs the same time as a wrong password
//
// There is NO email check yet (no mail service is connected): an account is its email and password, nothing more, and the site says so where it
// matters. That is also why a forgotten password cannot be reset by the site: see docs/network.md.
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { bad, cleanText, looksLikeEmail, makeId, tooMany } from './validate.js';

const scryptAsync = promisify(scrypt);
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;
export const SESSION_DAYS = 30;
export const SESSION_PREFIX = 'se_';
export const MIN_PASSWORD = 10;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [kind, n, r, p, salt, hash] = String(stored ?? '').split('$');
  if (kind !== 'scrypt' || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scryptAsync(password, Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

// Hashed once, so signing in to an email that does not exist takes as long as one that does.
let decoy;
const decoyHash = () => (decoy ??= hashPassword('not-a-real-password-just-a-decoy'));

export const generateToken = () => `${SESSION_PREFIX}${randomBytes(32).toString('base64url')}`;
export const hashToken = (token) => createHash('sha256').update(String(token)).digest('hex');
export const normaliseEmail = (email) => String(email ?? '').trim().toLowerCase();

// Counts events per key inside a window: `hit` says whether the key may go on, and counts the attempt.
export function createLimiter({ max, windowMs, now = Date.now }) {
  const seen = new Map();
  return {
    // Counts one attempt for `key`. Throws tooMany once the key is over its allowance.
    hit(key, message) {
      const t = now();
      const recent = (seen.get(key) ?? []).filter((at) => t - at < windowMs);
      if (recent.length >= max) { seen.set(key, recent); throw tooMany(message); }
      recent.push(t);
      seen.set(key, recent);
      if (seen.size > 5000) for (const [k, v] of seen) if (!v.some((at) => t - at < windowMs)) seen.delete(k);
    },
    // How many attempts `key` has used in the window, without counting one.
    used(key) { const t = now(); return (seen.get(key) ?? []).filter((at) => t - at < windowMs).length; },
    clear(key) { seen.delete(key); },
  };
}

export function createAuth({ store, now = Date.now, limits = {} }) {
  const signups = createLimiter({ max: limits.signups ?? 6, windowMs: 3600000, now });
  const attempts = createLimiter({ max: limits.logins ?? 8, windowMs: 900000, now });

  const sessionFor = async (token) => {
    if (typeof token !== 'string' || !token.startsWith(SESSION_PREFIX) || token.length > 200) return null;
    const hash = hashToken(token);
    const data = store.read();
    const session = data.sessions.find((s) => s.token_sha256 === hash);
    if (!session || Date.parse(session.expires_at) <= now()) return null;
    const member = data.members.find((m) => m.id === session.member_id);
    return member ? { session, member } : null;
  };

  async function startSession(draft, member) {
    const token = generateToken();
    const at = now();
    draft.sessions = draft.sessions.filter((s) => Date.parse(s.expires_at) > at); // expired ones are tidied away as new ones are made
    draft.sessions.push({
      id: makeId('s', at), member_id: member.id, token_sha256: hashToken(token), created_at: new Date(at).toISOString(),
      expires_at: new Date(at + SESSION_DAYS * 86400000).toISOString(),
    });
    return token;
  }

  return {
    sessionFor,

    async signUp({ name, email, password, listed = false, ip = 'unknown' }) {
      const cleanName = cleanText(name, { name: 'Your name', min: 2, max: 60, required: true });
      const address = normaliseEmail(email);
      if (!looksLikeEmail(address)) throw bad('Enter a valid email address.');
      if (typeof password !== 'string' || password.length < MIN_PASSWORD) throw bad(`Choose a password of at least ${MIN_PASSWORD} characters.`);
      if (password.length > 200) throw bad('That password is too long.');
      if (password.toLowerCase() === address || password.toLowerCase() === cleanName.toLowerCase()) throw bad('Choose a password that is not your name or email.');
      signups.hit(ip, 'Too many accounts were made from this connection. Try again in an hour.');
      const passwordHash = await hashPassword(password);
      return store.change(async (draft) => {
        if (draft.members.some((m) => m.email === address)) throw bad('There is already an account with that email. Sign in instead.');
        const at = new Date(now()).toISOString();
        const member = {
          id: makeId('m', now()), name: cleanName, email: address, password_hash: passwordHash, email_verified: false,
          role: '', city: '', intro: '', building: [], links: { website: '', professional_profile: '' }, open_to: [], listed: Boolean(listed),
          suspended: false, created_at: at, updated_at: at,
        };
        draft.members.push(member);
        const token = await startSession(draft, member);
        return { token, member };
      });
    },

    async signIn({ email, password, ip = 'unknown' }) {
      const address = normaliseEmail(email);
      const key = `${address}|${ip}`;
      attempts.hit(key, 'Too many sign-in attempts. Wait a few minutes and try again.');
      const member = store.read().members.find((m) => m.email === address);
      const ok = member ? await verifyPassword(String(password ?? ''), member.password_hash) : (await verifyPassword(String(password ?? ''), await decoyHash()), false);
      if (!ok) throw Object.assign(bad('That email and password do not match.'), { status: 401, code: 'bad_credentials' });
      attempts.clear(key);
      return store.change(async (draft) => ({ token: await startSession(draft, draft.members.find((m) => m.id === member.id)), member }));
    },

    async signOut(token) {
      const hash = hashToken(token);
      await store.change(async (draft) => { draft.sessions = draft.sessions.filter((s) => s.token_sha256 !== hash); });
    },

    // Is this the member's password? Counted like a sign-in, so it cannot be guessed at through a signed-in session either.
    async confirmPassword(memberId, password) {
      attempts.hit(`confirm|${memberId}`, 'Too many attempts. Wait a few minutes and try again.');
      const member = store.read().members.find((m) => m.id === memberId);
      if (!member || !(await verifyPassword(String(password ?? ''), member.password_hash))) throw Object.assign(bad('That password is not right.'), { status: 401, code: 'bad_credentials' });
      attempts.clear(`confirm|${memberId}`);
    },

    async changePassword(memberId, { current, next, keepToken = null }) {
      if (typeof next !== 'string' || next.length < MIN_PASSWORD) throw bad(`Choose a password of at least ${MIN_PASSWORD} characters.`);
      if (next.length > 200) throw bad('That password is too long.');
      const member = store.read().members.find((m) => m.id === memberId);
      attempts.hit(`pw|${memberId}`, 'Too many attempts. Wait a few minutes and try again.');
      if (!member || !(await verifyPassword(String(current ?? ''), member.password_hash))) throw Object.assign(bad('Your current password is not right.'), { status: 401, code: 'bad_credentials' });
      const hash = await hashPassword(next);
      await store.change(async (draft) => {
        const m = draft.members.find((x) => x.id === memberId);
        m.password_hash = hash;
        m.updated_at = new Date(now()).toISOString();
        const keep = keepToken ? hashToken(keepToken) : null;
        draft.sessions = draft.sessions.filter((s) => s.member_id !== memberId || s.token_sha256 === keep); // every other sign-in ends; this one stays
      });
      attempts.clear(`pw|${memberId}`);
    },
  };
}
