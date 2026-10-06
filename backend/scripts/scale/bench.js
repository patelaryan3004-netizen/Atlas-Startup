// HTTP benchmark of the public API at each dataset size. STAGING DATA ONLY: it generates synthetic companies
// (fixtures.js) into a temporary folder and starts its own server on them; it never touches backend/src/data.
//
//   node scripts/scale/bench.js --arch current  [--sizes 213,500,1000,2500,5000,10000] [--out results.json]
//   node scripts/scale/bench.js --arch baseline --baseline <a checkout of the old code>
//
// `baseline` runs the code in another checkout (a git worktree of the commit before the scale work), with the
// fixture copied over that checkout's own startups.json, so "before" is measured on the code that was really
// there. Both architectures answer the same legacy requests; `current` also answers the new ones.
//
// The client and the server share one machine, so absolute numbers are indicative; compare sizes and
// architectures with each other, run to run on the same machine.
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import zlib from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { mkdir, copyFile, readFile, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { writeFixture, SIZES } from './fixtures.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(HERE, '..', '..');
const TMP = path.join(os.tmpdir(), 'au-scale');
const exists = (p) => access(p).then(() => true, () => false);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const agent = new http.Agent({ keepAlive: true, maxSockets: 128 });
function get(port, pathname, { gzip = false, keep = false, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const req = http.get({ host: '127.0.0.1', port, path: pathname, agent, headers: { 'accept-encoding': gzip ? 'gzip' : 'identity', ...headers } }, (res) => {
      const chunks = [];
      let bytes = 0;
      const ttfb = performance.now() - t0;
      res.on('data', (c) => { bytes += c.length; if (keep) chunks.push(c); });
      res.on('end', () => resolve({ status: res.statusCode, bytes, ms: performance.now() - t0, ttfb, headers: res.headers, body: keep ? Buffer.concat(chunks) : null }));
      res.on('error', reject);
    });
    req.on('error', reject);
  });
}

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
function stats(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const r = (x) => Math.round(x * 100) / 100;
  return { n: s.length, mean: r(s.reduce((n, x) => n + x, 0) / s.length), p50: r(pct(s, 50)), p95: r(pct(s, 95)), p99: r(pct(s, 99)), max: r(s.at(-1)) };
}

function rssMb(pid) {
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command', `(Get-Process -Id ${pid}).WorkingSet64`], { encoding: 'utf8' });
    return Math.round(Number(out.trim()) / 1048576);
  } catch { return null; }
}

async function startServer({ arch, size, port, baseline, noCache = false }) {
  const dir = path.join(TMP, 'fixtures', String(size));
  const file = path.join(dir, 'startups.json');
  if (!(await exists(file))) await writeFixture(size, dir);
  let cwd = BACKEND;
  let args = ['scripts/scale/serve.js', '--file', file, '--port', String(port), ...(noCache ? ['--no-cache'] : [])];
  if (arch === 'baseline') {
    cwd = path.join(baseline, 'backend');
    args = ['src/server.js'];
    await copyFile(file, path.join(cwd, 'src', 'data', 'startups.json')); // the checkout's own copy: it is a throwaway
  }
  const t0 = performance.now();
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, BACKEND_PORT: String(port), NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 800; i += 1) {
    if (child.exitCode != null) throw new Error(`server exited: ${log}`);
    try { if ((await get(port, '/api/health')).status === 200) break; } catch { /* not up yet */ }
    await sleep(25);
  }
  return { child, file, startMs: Math.round(performance.now() - t0), stop: () => new Promise((resolve) => { child.once('exit', resolve); child.kill(); setTimeout(resolve, 3000); }) };
}

// What to ask for. `legacy` ones are answered by both architectures.
function scenarios(rows) {
  const mid = rows[Math.floor(rows.length / 2)];
  const person = (rows.find((r) => r.founders?.length) ?? {}).founders?.[0] ?? 'Ava Smith';
  const q = encodeURIComponent;
  return [
    { name: 'list all (legacy)', path: '/api/startups', legacy: true },
    { name: 'search a name (legacy)', path: '/api/startups?search=cobalt', legacy: true },
    { name: 'sector+city filter (legacy)', path: '/api/startups?sector=Fintech&city=Sydney', legacy: true },
    { name: 'hiring now (legacy)', path: '/api/startups?hiring=yes', legacy: true },
    { name: 'filter options (meta)', path: '/api/startups/meta', legacy: true },
    { name: 'directory page', path: '/directory', legacy: true },
    { name: 'list page 1 (48 cards)', path: '/api/startups?limit=48&offset=0&sort=name&view=card' },
    { name: 'list page, filtered', path: '/api/startups?limit=48&offset=0&sector=Fintech&city=Sydney&view=card' },
    { name: 'map markers (all)', path: '/api/startups/markers' },
    { name: 'map markers (hiring)', path: '/api/startups/markers?hiring=yes' },
    { name: 'company profile', path: `/api/startups/${mid.slug}` },
    { name: 'search suggestions', path: '/api/search?q=cob' },
    { name: 'summary counts', path: '/api/startups/summary' },
    { name: 'hiring page + facets', path: '/api/startups?hiring=yes&limit=24&facets=sector,city,stage&view=card' },
    { name: 'person', path: `/api/people/${q(person)}` },
    { name: 'directory page 2', path: '/directory?page=2' },
  ];
}

// A browser asks for gzip, so latency and throughput are measured that way (the client does not inflate it, which a
// browser does off the main thread); the uncompressed size is reported beside the size on the wire.
async function measure(port, scenario, { seq, duration, concurrency, light = false }) {
  const probe = await get(port, scenario.path, { keep: true });
  if (probe.status !== 200) return { skipped: `HTTP ${probe.status}` };
  const gz = await get(port, scenario.path, { gzip: true });
  const conditional = probe.headers.etag ? (await get(port, scenario.path, { headers: { 'if-none-match': probe.headers.etag } })).status : null;
  const warmUntil = performance.now() + (light ? 100 : 400);
  while (performance.now() < warmUntil) await get(port, scenario.path, { gzip: true });
  const sequential = [];
  for (let i = 0; i < seq; i += 1) sequential.push((await get(port, scenario.path, { gzip: true })).ms);
  const base = {
    status: 200, bytes: probe.bytes, wireBytes: gz.bytes, encoding: gz.headers['content-encoding'] ?? 'identity', cacheControl: probe.headers['cache-control'] ?? null,
    revalidate: conditional, sequential: stats(sequential),
  };
  if (light) return base;
  // Three short bursts: a hiccup on a shared machine spoils one burst, not the figure (the median burst is reported).
  const bursts = [];
  const lat = [];
  let errors = 0;
  for (let b = 0; b < 3; b += 1) {
    const end = performance.now() + duration / 3;
    const t0 = performance.now();
    let n = 0;
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (performance.now() < end) {
        try { const r = await get(port, scenario.path, { gzip: true }); lat.push(r.ms); n += 1; if (r.status !== 200) errors += 1; } catch { errors += 1; }
      }
    }));
    bursts.push(n / ((performance.now() - t0) / 1000));
  }
  bursts.sort((a, b) => a - b);
  return { ...base, concurrent: { c: concurrency, rps: Math.round(bursts[1]), ...stats(lat), errors } };
}

export async function runBench({ arch = 'current', sizes = SIZES, baseline = path.join(TMP, 'baseline'), seq = 40, duration = 2500, concurrency = 10, port = 4300, log = console.log } = {}) {
  const results = { meta: { arch, node: process.version, cpu: os.cpus()[0]?.model, cores: os.cpus().length, platform: `${os.platform()} ${os.release()}`, at: new Date().toISOString(), seq, duration, concurrency }, sizes: {} };
  for (const size of sizes) {
    log(`\n== ${arch}: ${size} companies`);
    const server = await startServer({ arch, size, port, baseline });
    try {
      const rows = JSON.parse(await readFile(server.file, 'utf8'));
      const rssStart = rssMb(server.child.pid);
      const t0 = performance.now();
      const first = await get(port, '/api/startups?search=zzzz'); // the first real request, after the process is up
      const firstMs = Math.round(performance.now() - t0);
      const out = { startMs: server.startMs, firstRequestMs: firstMs, firstStatus: first.status, rssStartMb: rssStart, scenarios: {} };
      for (const sc of scenarios(rows)) {
        if (arch === 'baseline' && !sc.legacy) continue;
        const r = await measure(port, sc, { seq, duration, concurrency });
        out.scenarios[sc.name] = r;
        log(r.skipped ? `  ${sc.name.padEnd(30)} skipped (${r.skipped})` : `  ${sc.name.padEnd(30)} ${String(Math.round(r.bytes / 1024)).padStart(6)} KB (${String(Math.round(r.wireBytes / 1024)).padStart(5)} KB wire ${r.encoding})  p50 ${String(r.sequential.p50).padStart(7)} ms  p95 ${String(r.sequential.p95).padStart(7)} ms  c${concurrency}: ${String(r.concurrent.rps).padStart(5)} rps p95 ${r.concurrent.p95} ms${r.revalidate ? `  304:${r.revalidate === 304}` : ''}`);
      }
      out.rssAfterMb = rssMb(server.child.pid);
      log(`  startup ${server.startMs} ms, first request ${firstMs} ms, memory ${rssStart} -> ${out.rssAfterMb} MB`);
      results.sizes[size] = out;
    } finally {
      await server.stop();
      await sleep(300);
    }
    if (arch === 'current') {
      // The work behind a miss: the same questions with nothing kept, so every one is answered from scratch.
      const bare = await startServer({ arch, size, port, baseline, noCache: true });
      try {
        const rows = JSON.parse(await readFile(bare.file, 'utf8'));
        log('  -- with nothing kept (the cost of a miss):');
        for (const sc of scenarios(rows)) {
          const r = await measure(port, sc, { seq: Math.max(10, Math.floor(seq / 2)), duration, concurrency, light: true });
          if (r.skipped) continue;
          results.sizes[size].scenarios[sc.name].uncached = r.sequential;
          log(`  ${sc.name.padEnd(30)} p50 ${String(r.sequential.p50).padStart(7)} ms  p95 ${String(r.sequential.p95).padStart(7)} ms`);
        }
      } finally { await bare.stop(); await sleep(300); }
    }
  }
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : fallback; };
  const sizes = arg('sizes') ? arg('sizes').split(',').map(Number) : SIZES;
  const out = arg('out');
  runBench({ arch: arg('arch', 'current'), sizes, baseline: arg('baseline', path.join(TMP, 'baseline')), seq: Number(arg('seq', 40)), duration: Number(arg('duration', 2500)), concurrency: Number(arg('concurrency', 10)), port: Number(arg('port', 4300)) })
    .then(async (r) => { if (out) { await mkdir(path.dirname(path.resolve(out)), { recursive: true }); await writeFile(out, `${JSON.stringify(r, null, 2)}\n`); console.log(`\nwrote ${out}`); } })
    .catch((e) => { console.error(e); process.exitCode = 1; });
}
