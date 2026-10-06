// Drives a real headless Chrome over the DevTools protocol to measure what a visitor's browser does with the app
// at each dataset size, for the OLD and the NEW app side by side. STAGING DATA ONLY (see fixtures.js).
//
//   node scripts/scale/cdp-bench.js --profile desktop --sizes 213,500,1000,2500,5000,10000 --repeat 3 --heavy-once --out ../docs/scale/browser-desktop.json
//   node scripts/scale/cdp-bench.js --profile mobile  --arch current --sizes 5000
//
// Why a driver and not a browser tab: a page in a hidden window has its timers throttled to one a second and
// no animation frames, which makes every timing meaningless. A headless browser is always "visible", it can
// block other people's servers (logos and map tiles) at the network, switch the cache off so every load is a
// first visit, and throttle: the `mobile` profile is a 390x844 phone with a CPU four times slower and a
// 1.6 Mbit/s, 150 ms network, which is what Lighthouse calls "slow 4G" mobile. Logos are answered locally with a
// one-pixel image (see measure()), and map tiles are refused.
//
// It expects four servers (docs/scale.md says how to start them): each app's backend on its own port, each app's
// built front end behind `vite preview` on its own port with its proxy pointing at that backend. The data under
// a backend is swapped between sizes by copying a fixture over the file the backend reads.
import { spawn } from 'node:child_process';
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SIZES, writeFixture } from './fixtures.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(os.tmpdir(), 'au-scale');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// A 1x1 transparent PNG, base64: what every logo request is answered with.
const ONE_PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
// Leaflet's own stylesheet, as the page shell would have fetched it from a CDN, from the copy the front end installs.
let leafletCssCache = null;
const leafletCss = () => {
  if (leafletCssCache == null) {
    const file = path.join(HERE, '..', '..', '..', 'frontend', 'node_modules', 'leaflet', 'dist', 'leaflet.css');
    leafletCssCache = (existsSync(file) ? readFileSync(file) : Buffer.from('/* leaflet.css is not installed here */')).toString('base64');
  }
  return leafletCssCache;
};

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => existsSync(p));

const PROFILES = {
  desktop: { width: 1280, height: 800, dsf: 1, mobile: false, cpu: 1, network: null },
  // Lighthouse's mobile preset: 4x CPU slowdown, 1.6 Mbit/s down, 750 kbit/s up, 150 ms round trip.
  mobile: { width: 390, height: 844, dsf: 3, mobile: true, cpu: 4, network: { latency: 150, down: 1.6e6 / 8, up: 750e3 / 8 } },
};

// ---------- a very small DevTools protocol client ----------

export async function launch() {
  if (!CHROME) throw new Error('no Chrome or Edge found: install one, or set the path in CHROME');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'au-chrome-'));
  const port = 9300 + Math.floor(Math.random() * 400);
  const child = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--enable-precise-memory-info', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--mute-audio', 'about:blank'], { stdio: 'ignore' });
  // On a laptop that is also being used for other things, a little above normal priority keeps what else is running
  // from deciding the result (its renderers inherit it). Not "high": this is a test, not the person's work.
  try { os.setPriority(child.pid, os.constants.priority.PRIORITY_ABOVE_NORMAL); } catch { /* not allowed: carry on */ }
  for (let i = 0; i < 100; i += 1) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) break; } catch { /* starting */ }
    await sleep(100);
  }
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let nextId = 0;
  const pending = new Map();
  const listeners = new Map();
  ws.onmessage = (event) => {
    const m = JSON.parse(event.data);
    if (m.id !== undefined) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) p.reject(new Error(`${p.method}: ${m.error.message}`)); else p.resolve(m.result);
    } else for (const fn of listeners.get(m.method) ?? []) fn(m.params);
  };
  return {
    send: (method, params = {}) => new Promise((resolve, reject) => { nextId += 1; pending.set(nextId, { resolve, reject, method }); ws.send(JSON.stringify({ id: nextId, method, params })); }),
    on: (method, fn) => { if (!listeners.has(method)) listeners.set(method, new Set()); listeners.get(method).add(fn); },
    once: (method, ms = 120000) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${method}`)), ms);
      const fn = (params) => { clearTimeout(timer); listeners.get(method).delete(fn); resolve(params); };
      if (!listeners.has(method)) listeners.set(method, new Set());
      listeners.get(method).add(fn);
    }),
    close: async () => { try { ws.close(); } catch { /* closed */ } child.kill(); await sleep(300); await rm(dir, { recursive: true, force: true }).catch(() => {}); },
  };
}

// ---------- one measurement ----------

async function measure({ url, profile, script, budgetMs }) {
  const p = PROFILES[profile];
  const cdp = await launch();
  try {
    for (const domain of ['Page', 'Network', 'Performance', 'Runtime']) await cdp.send(`${domain}.enable`);
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    // Other people's servers stay out of it. The map's tiles are refused. A company's logo (Clearbit, Google's favicon
    // service) is answered here with a one-pixel image, as if it had loaded: that is what a visitor normally sees, and
    // refusing logos instead would make every card and panel run its failure path, which is the worst case for the
    // old app, not the usual one. Nothing leaves the machine, so no fake company's address is sent to anyone.
    // The page shell also asks other people's servers for Leaflet's stylesheet (cdnjs) and a font (Google Fonts); a
    // stylesheet in the head holds the app's script back until it arrives or fails, so a slow outside network would
    // delay every run by the same many seconds. They are answered here too: Leaflet's real stylesheet from this
    // repository's own copy (the map lays out as it does for a visitor), the font stylesheet empty.
    await cdp.send('Network.setBlockedURLs', { urls: ['*tile.openstreetmap.org*', '*fonts.gstatic.com*'] });
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*clearbit.com*' }, { urlPattern: '*google.com/s2/favicons*' }, { urlPattern: '*fonts.googleapis.com*' }, { urlPattern: '*cdnjs.cloudflare.com*' }] });
    cdp.on('Fetch.requestPaused', (p) => {
      const url = p.request.url;
      const answer = /clearbit\.com|google\.com\/s2\/favicons/.test(url) ? { type: 'image/png', body: ONE_PIXEL_PNG }
        : /fonts\.googleapis\.com/.test(url) ? { type: 'text/css', body: Buffer.from('/* the font is not loaded in the benchmark */').toString('base64') }
          : /cdnjs\.cloudflare\.com.*leaflet.*\.css/.test(url) ? { type: 'text/css', body: leafletCss() }
            : null;
      const reply = answer
        ? cdp.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: answer.type }, { name: 'Cache-Control', value: 'no-store' }], body: answer.body })
        : cdp.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 404, responseHeaders: [{ name: 'Content-Type', value: 'text/plain' }], body: '' });
      reply.catch(() => {});
    });
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: p.width, height: p.height, deviceScaleFactor: p.dsf, mobile: p.mobile });
    if (p.mobile) await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    if (p.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: p.cpu });
    if (p.network) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: p.network.latency, downloadThroughput: p.network.down, uploadThroughput: p.network.up });

    // From the first moment of the page, note when pins appear on the map and when they last change.
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__pinWatch = { first: null, last: null, count: 0 };
        new MutationObserver(() => {
          const n = document.querySelectorAll('.leaflet-marker-icon').length;
          const w = window.__pinWatch;
          if (n !== w.count) { w.count = n; w.last = performance.now(); if (n > 0 && w.first === null) w.first = w.last; }
        }).observe(document, { subtree: true, childList: true });`,
    });
    const t0 = Date.now();
    const loaded = cdp.once('Page.loadEventFired');
    await cdp.send('Page.navigate', { url });
    await loaded;
    const loadMs = Date.now() - t0;
    const knobs = `window.__blockImages = false; window.__budgetMs = ${budgetMs}; window.__quietCapMs = ${Math.min(30000, budgetMs / 3)}; window.__loadCapMs = ${Math.min(150000, budgetMs / 2)}; window.__untilCapMs = ${Math.min(150000, budgetMs / 2)};`;
    const evaluated = await cdp.send('Runtime.evaluate', { expression: `${knobs}\n${script}`, awaitPromise: true, returnByValue: true, timeout: budgetMs + 20000 });
    if (evaluated.exceptionDetails) throw new Error(`the page script failed: ${evaluated.exceptionDetails.exception?.description ?? evaluated.exceptionDetails.text}`);
    const out = JSON.parse(evaluated.result.value);
    const m = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
    out.navigationLoadEventMs = loadMs;
    out.chrome = {
      heapUsedMb: Math.round(m.JSHeapUsedSize / 1048576), nodes: m.Nodes, layouts: m.LayoutCount, styleRecalcs: m.RecalcStyleCount,
      mainThreadSeconds: Math.round(m.TaskDuration * 100) / 100, scriptSeconds: Math.round(m.ScriptDuration * 100) / 100, layoutSeconds: Math.round(m.LayoutDuration * 100) / 100,
    };
    return out;
  } finally {
    await cdp.close();
  }
}

// ---------- swapping the data under a server ----------

export async function swap({ arch, size, setup }) {
  const src = path.join(TMP, 'fixtures', String(size), 'startups.json');
  if (!existsSync(src)) await writeFixture(size, path.dirname(src));
  await copyFile(src, setup[arch].liveFile);
  for (let i = 0; i < 100; i += 1) {
    await sleep(300);
    try {
      const r = await fetch(`http://localhost:${setup[arch].backendPort}/api/startups?search=zzzzzzzz`);
      if ((await r.json()).total === size) return;
    } catch { /* not up */ }
  }
  throw new Error(`${arch} did not start serving ${size} companies`);
}

// A company's slug in the address of a call is the name of an invented company. The raw results keep the shape of every
// call, not the name, so nothing in docs/scale/ names a company, invented or not.
export const maskSlug = (url) => url.replace(/(\/api\/startups\/)(?!(?:meta|summary|count|markers)(?:[/?#]|$))[^/?#]+/, '$1:slug').replace(/(\/api\/people\/)[^/?#]+/, '$1:name');

// How busy the whole machine was between two readings, as a percentage: everything on it, this test included. A cell
// measured while something else was hogging the processor shows as busier than its neighbours, which is how a
// disturbed measurement is told from a slow one.
const cpuTimes = () => os.cpus().reduce((t, c) => ({ idle: t.idle + c.times.idle, total: t.total + Object.values(c.times).reduce((a, b) => a + b, 0) }), { idle: 0, total: 0 });
const busyBetween = (a, b) => (b.total === a.total ? null : Math.round(100 * (1 - (b.idle - a.idle) / (b.total - a.total))));

// repeat: each cell is measured that many times (the report uses the median run; every run is kept). heavyOnce: a cell
// that takes minutes (the old app at 5,000 companies and over) is measured once, because the difference is a
// factor of ten or more and noise cannot change what it says.
// save: called with the results so far after every run, so a sweep of an hour that is cut short (the machine slept, a
// server died) keeps what it had measured; meta.complete says whether it reached the end.
export async function run({ profile = 'desktop', archs = ['baseline', 'current'], sizes = SIZES, setup, budgetMs = 60000, repeat = 1, heavyOnce = false, save = null, log = console.log }) {
  const script = await readFile(path.join(HERE, 'browser-measure.js'), 'utf8');
  const results = { meta: { profile, node: process.version, chrome: CHROME, cpu: os.cpus()[0]?.model, cores: os.cpus().length, at: new Date().toISOString(), profileSettings: PROFILES[profile], repeat, heavyOnce, complete: false }, runs: [] };
  for (const size of sizes) {
    for (const arch of archs) {
      const times = heavyOnce && arch === 'baseline' && size >= 5000 ? 1 : repeat;
      for (let rep = 1; rep <= times; rep += 1) {
        await swap({ arch, size, setup });
        const before = cpuTimes();
        const r = await measure({ url: setup[arch].url, profile, script, budgetMs });
        r.machineBusyPct = busyBetween(before, cpuTimes());
        if (Array.isArray(r.requests)) r.requests = r.requests.map((c) => ({ ...c, url: maskSlug(c.url) }));
        results.runs.push({ arch, size, rep, ...r });
        await save?.(results);
        const l = r.load;
        log(`${profile} ${arch.padEnd(8)} ${String(size).padStart(5)} #${rep}: pins at ${l.pinsFirstSeenMs} ms, api ${l.requests} calls ${l.wireKB} KB wire (${l.bodyKB} KB), dom ${l.domNodes}, heap ${r.chrome.heapUsedMb} MB | zoomIn blocked ${r.zoomIn?.blockedMs ?? '-'} ms | list ${r.list?.cards ?? '-'} cards, blocked ${r.list?.blockedMs ?? '-'} ms, dom ${r.list?.domNodes ?? '-'} | search ${r.search?.requests ?? '-'} requests | machine ${r.machineBusyPct}% busy, main thread ${r.chrome.mainThreadSeconds} s`);
      }
    }
  }
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : fallback; };
  const baselineDir = arg('baseline', path.join(TMP, 'baseline'));
  const setup = {
    baseline: { url: arg('baseline-url', 'http://localhost:4173/'), backendPort: Number(arg('baseline-backend', 4001)), liveFile: path.join(baselineDir, 'backend', 'src', 'data', 'startups.json') },
    current: { url: arg('current-url', 'http://localhost:4174/'), backendPort: Number(arg('current-backend', 4002)), liveFile: arg('current-file', path.join(TMP, 'live-current', 'startups.json')) },
  };
  try { os.setPriority(0, os.constants.priority.PRIORITY_ABOVE_NORMAL); } catch { /* not allowed: carry on */ } // the driver too
  const archs = arg('arch', 'both') === 'both' ? ['baseline', 'current'] : [arg('arch')];
  const sizes = arg('sizes') ? arg('sizes').split(',').map(Number) : SIZES;
  const out = arg('out');
  const write = async (r) => { await mkdir(path.dirname(path.resolve(out)), { recursive: true }); await writeFile(out, `${JSON.stringify(r, null, 2)}\n`); };
  run({ profile: arg('profile', 'desktop'), archs, sizes, setup, budgetMs: Number(arg('budget', 60000)), repeat: Number(arg('repeat', 1)), heavyOnce: process.argv.includes('--heavy-once'), save: out ? write : null })
    .then(async (r) => { if (out) { r.meta.complete = true; await write(r); console.log(`\nwrote ${out}`); } })
    .catch((e) => { console.error(e); process.exitCode = 1; });
}
