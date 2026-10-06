// Starts the CURRENT public app over a file of synthetic companies, for the scale benchmark and the browser sweep.
//   node scripts/scale/serve.js --file <startups.json> --port 4000
// It is a test tool: it is not imported by the public server, and the public server has no way to be pointed at a
// different file.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createApp } from '../../src/app.js';
import { createCatalog } from '../../src/catalog/catalog.js';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : fallback; };

// cache: false answers every request from scratch (nothing kept), which is how a benchmark measures the work behind a miss.
// maxAge: the seconds a browser may keep an answer without asking (the public server uses 60); 0 makes a browser
// ask every time, which a measurement wants when the file under the server is swapped between runs.
export async function serve({ file, port, cache = true, maxAge }) {
  const catalog = createCatalog({ file });
  const t0 = performance.now();
  await catalog.refresh(); // ready before it listens, so "startup" in a benchmark includes indexing
  const app = createApp({ catalog, cache: cache ? (maxAge === undefined ? undefined : { maxAge }) : { maxEntries: 0 } });
  const server = await new Promise((resolve) => { const s = app.listen(port, () => resolve(s)); });
  return { server, catalog, app, indexMs: Math.round(performance.now() - t0) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = arg('file');
  if (!file) { console.error('usage: node scripts/scale/serve.js --file <startups.json> [--port 4000]'); process.exit(2); }
  const port = Number(arg('port', process.env.BACKEND_PORT ?? 4000));
  const maxAge = arg('max-age');
  serve({ file: path.resolve(file), port, cache: !process.argv.includes('--no-cache'), maxAge: maxAge === undefined ? undefined : Number(maxAge) }).then(({ indexMs }) => console.log(`scale server on http://localhost:${port} (indexed in ${indexMs} ms)`));
}
