// Makes the snapshot the site serves beside its own files: frontend/public/data/snapshot.json.
//
//   npm run snapshot         (from backend/; then commit the file and deploy the site)
//
// It asks the real API (the app in this process, over the real data files, with the server's own 14-day "hiring now" window) the questions the
// first views of the busiest pages ask (frontend/src/snapshotRequests.js, run through the site's own api.js), and keeps each answer under the
// request that was made. The site draws that file at once and asks the API in the background (frontend/src/snapshot.js), so its first screen
// does not wait on the API server, which is asleep on a free plan until someone wakes it.
//
// The file holds only what the public API already serves. People and the firms are never asked for (and the server here has them off).
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

delete process.env.SHOW_PEOPLE; // the same as the live server: no people, no firms
const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '../../frontend/public/data/snapshot.json');
const PRERENDER_OUT = path.resolve(here, '../../frontend/prerender-data.json'); // read by the build only (frontend/scripts/prerender.mjs): not served
const SNAPSHOT_VERSION = 1; // frontend/src/snapshot.js

const { default: app } = await import('../src/app.js');
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

// api.js asks fetch for '/api/...' (there is no API address in Node): answer it from this process, and keep the answer.
const answers = {};
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const res = await realFetch(`${base}${url}`);
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  const body = await res.json();
  answers[url] = body;
  return { ok: true, status: res.status, json: async () => body };
};

try {
  const { FIRST_VIEWS, PRERENDER_VIEWS } = await import(pathToFileURL(path.resolve(here, '../../frontend/src/snapshotRequests.js')).href);
  await new Promise((resolve) => setTimeout(resolve, 1500)); // the catalogs load as the app starts
  for (const ask of FIRST_VIEWS) await ask();
  const first = { ...answers };
  const summary = first['/api/startups/summary'];
  if (!summary || !(summary.count > 0)) throw new Error('The summary has no companies: the data did not load, so no snapshot is written.');
  const generatedAt = new Date().toISOString();
  const snapshot = { version: SNAPSHOT_VERSION, generatedAt, answers: first };
  const text = JSON.stringify(snapshot);
  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, text, 'utf8');
  console.log(`Wrote ${path.relative(process.cwd(), OUT)}: ${Object.keys(first).length} answers, ${(text.length / 1024).toFixed(1)} KB, ${summary.count} companies (${summary.hiring} hiring now).`);
  for (const [key, body] of Object.entries(first)) console.log(`  ${(JSON.stringify(body).length / 1024).toFixed(1).padStart(6)} KB  ${key}`);
  // The extra answers the static pages are made from (not part of the snapshot the site serves).
  for (const key of Object.keys(answers)) if (key in first) delete answers[key];
  for (const ask of PRERENDER_VIEWS) await ask();
  await writeFile(PRERENDER_OUT, JSON.stringify({ version: SNAPSHOT_VERSION, generatedAt, answers }), 'utf8');
  console.log(`Wrote ${path.relative(process.cwd(), PRERENDER_OUT)}: ${Object.keys(answers).length} answers (build only).`);
} finally {
  globalThis.fetch = realFetch;
  server.close();
}
process.exit(0);
