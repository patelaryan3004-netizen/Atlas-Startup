// The Command Center's command line. See docs/admin.md.
//
//   npm run admin -- init --name <name>              make the first admin, and show their token once
//   npm run admin -- add-user --name <n> --role <viewer|reviewer|admin>
//   npm run admin -- users                            who can sign in, and as what
//   npm run admin -- revoke --name <name>             take someone's access away
//   npm run admin                                     start it (the same as `serve`)
//   npm run admin -- serve [--port 4010] [--data <dir>]
//
// It is a local tool. It writes the same JSON data files the discovery CLI does, so every change it makes
// is a change to the repository for you to commit; and Render keeps no disk, so it could not keep a change
// anyway. That is why it refuses to start on Render or in production, and listens on this machine only.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addUser, revokeUser, loadUsers, createAuthenticator, createLimiter, createSecurityLog } from '../src/admin/auth.js';
import { createAdminService } from '../src/admin/service.js';
import { createAdminApp } from '../src/admin/server.js';
import { ROLES } from '../src/admin/roles.js';
import { parseArgs } from './discovery.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_DIR = path.join(HERE, '..', 'src', 'data');
const DEFAULT_HOME = path.join(HERE, '..', '.admin');
export const HOST = '127.0.0.1';
export const DEFAULT_PORT = 4010;

// Why this must not run here, or null.
export function refusal(env = process.env) {
  if (env.RENDER) return 'this is a local tool: Render keeps no disk, so it could not keep a change, and it must not be reachable from the internet';
  if (env.NODE_ENV === 'production') return 'this is a local tool and does not run with NODE_ENV=production';
  return null;
}

// Starts the server and resolves with { server, url, close }.
export async function startServer({ dataDir = DEFAULT_DATA_DIR, home = DEFAULT_HOME, port = DEFAULT_PORT, env = process.env, now = Date.now, fetcherFactory, logger = console } = {}) {
  const why = refusal(env);
  if (why) throw new Error(why);
  const usersFile = path.join(home, 'users.json');
  const users = await loadUsers(usersFile);
  if (!users.length) throw new Error('nobody can sign in yet: run `npm run admin -- init --name <your name>` first');
  const service = createAdminService({ dir: dataDir, now, ...(fetcherFactory ? { fetcherFactory } : {}) });
  const app = createAdminApp({
    service, authenticator: createAuthenticator(users), limiter: createLimiter({ now }),
    securityLog: createSecurityLog(path.join(home, 'security.log'), { now }), logger,
  });
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(port, HOST, () => resolve(s));
    s.once('error', reject);
  });
  const url = `http://${HOST}:${server.address().port}`;
  return { server, url, service, close: () => new Promise((resolve) => { server.close(() => resolve()); server.closeAllConnections?.(); }) };
}

const need = (flags, name) => { if (typeof flags[name] !== 'string' || !flags[name].trim()) throw new Error(`--${name} is required`); return flags[name]; };

export async function main(argv, deps = {}) {
  const { out = (s) => console.log(s), env = process.env, home = typeof env.ADMIN_HOME === 'string' && env.ADMIN_HOME ? env.ADMIN_HOME : DEFAULT_HOME, now = Date.now } = deps;
  const { positional: [command = 'serve'], flags } = parseArgs(argv);
  const usersFile = path.join(home, 'users.json');
  const shown = (name, role, token) => out([
    `${name} (${role}) can now sign in with this token. It is shown once and is not stored; only its hash is.`, '', `  ${token}`, '',
    'Keep it somewhere private. If it is lost, revoke the user and make a new one.',
  ].join('\n'));

  switch (command) {
    case 'init': {
      if ((await loadUsers(usersFile)).length) throw new Error('there are already users: use add-user to add another');
      const { user, token } = await addUser(usersFile, { name: need(flags, 'name'), role: 'admin', now });
      shown(user.name, user.role, token);
      return 0;
    }
    case 'add-user': {
      const { user, token } = await addUser(usersFile, { name: need(flags, 'name'), role: need(flags, 'role'), now });
      shown(user.name, user.role, token);
      return 0;
    }
    case 'users': {
      const users = await loadUsers(usersFile);
      out(users.length ? users.map((u) => `${u.name.padEnd(24)} ${u.role.padEnd(9)} since ${u.created_at.slice(0, 10)}`).join('\n') : 'no users yet: run `npm run admin -- init --name <your name>`');
      return 0;
    }
    case 'revoke': { await revokeUser(usersFile, need(flags, 'name')); out(`${flags.name} can no longer sign in`); return 0; }
    case 'serve': {
      const port = flags.port === undefined ? DEFAULT_PORT : Number(flags.port);
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('--port must be a port number');
      const dataDir = typeof flags.data === 'string' ? path.resolve(flags.data) : DEFAULT_DATA_DIR;
      const { url } = await startServer({ dataDir, home, port, env, now });
      out([`Data Command Center: ${url}`, `data: ${dataDir}`, 'Open that address on this machine and sign in with your token. Ctrl+C stops it.', 'Every change it makes is to the data files: review and commit them like any other change.'].join('\n'));
      return new Promise(() => {}); // runs until it is stopped
    }
    default: throw new Error(`unknown command "${command}": init, add-user, users, revoke, serve (roles: ${ROLES.join(', ')})`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { if (code !== undefined) process.exitCode = code; }, (err) => { console.error(`error: ${err.message}`); process.exitCode = 1; });
}
