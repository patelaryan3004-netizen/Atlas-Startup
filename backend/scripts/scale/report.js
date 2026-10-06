// Turns the raw result files in docs/scale/ into the tables docs/scale.md quotes, so no number in the write-up is typed by hand.
//
//   node scripts/scale/report.js                    prints markdown to the terminal
//   node scripts/scale/report.js --out ../docs/scale/results.md
//
// Inputs (all produced by this folder's own scripts, on staging data only):
//   results-baseline.json, results-current.json     HTTP benchmark (bench.js): the old and the new public API
//   browser-desktop.json, browser-mobile.json       headless Chrome (cdp-bench.js): the old and the new app
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.join(HERE, '..', '..', '..', 'docs', 'scale');
const load = async (name) => JSON.parse(await readFile(path.join(DOCS, name), 'utf8'));

const nf = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 1 });
const num = (v) => (v == null || Number.isNaN(v) ? '–' : nf.format(v));
const ms = (v) => (v == null ? '–' : v >= 10000 ? `${nf.format(v / 1000)} s` : v >= 1000 ? `${nf.format(Math.round(v / 100) / 10)} s` : `${nf.format(Math.round(v * 10) / 10)} ms`);
const kb = (bytes) => (bytes == null ? '–' : bytes >= 1048576 ? `${nf.format(bytes / 1048576)} MB` : `${nf.format(Math.round(bytes / 102.4) / 10)} KB`);
const mb = (v) => (v == null ? '–' : `${nf.format(v)} MB`);
const table = (head, rows) => [`| ${head.join(' | ')} |`, `| ${head.map((_, i) => (i === 0 ? '---' : '---:')).join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
const pair = (a, b) => `${a} → ${b}`; // old → new

const SIZES = [213, 500, 1000, 2500, 5000, 10000];

function httpSections(base, cur) {
  const out = [];
  const at = (r, size) => r.sizes[String(size)];
  const sc = (r, size, name) => at(r, size).scenarios[name];

  out.push('### What it costs to open the map\n');
  out.push('The data a visitor needs before the map is usable. **Old:** the whole directory (`/api/startups`) plus the filter options. **New:** compact pins for the whole map (`/api/startups/markers`), the counts, and the filter options. Bytes are what crosses the wire. The old server sent its answers uncompressed; a CDN in front of it may compress them in production, so the column "Old, if compressed" shows what the same answer weighs gzipped (the new server\'s own gzip of the identical body). The time is the median of one call; for the new server, from a cold cache entry ("uncached") and from the cache.\n');
  out.push(table(['Companies', 'Old: bytes', 'Old, if compressed', 'New: bytes', 'Old: one call, median', 'New: slowest call, uncached', 'New: slowest call, cached'], SIZES.map((n) => {
    const oldBytes = sc(base, n, 'list all (legacy)').wireBytes + sc(base, n, 'filter options (meta)').wireBytes;
    const oldGzipped = sc(cur, n, 'list all (legacy)').wireBytes + sc(base, n, 'filter options (meta)').wireBytes;
    const parts = ['map markers (all)', 'summary counts', 'filter options (meta)'].map((name) => sc(cur, n, name));
    const newBytes = parts.reduce((s, p) => s + p.wireBytes, 0);
    return [n.toLocaleString('en-AU'), kb(oldBytes), kb(oldGzipped), kb(newBytes), ms(sc(base, n, 'list all (legacy)').sequential.p50), ms(Math.max(...parts.map((p) => p.uncached.p50))), ms(Math.max(...parts.map((p) => p.sequential.p50)))];
  })));

  out.push('\n### The heaviest call each app makes, with ten visitors at once\n');
  out.push('Old: the whole directory. New: the whole map\'s pins. Requests per second the server sustains, and how long a visitor waits (median and 95th percentile).\n');
  out.push(table(['Companies', 'Old: requests/s', 'Old: median wait', 'Old: p95 wait', 'New: requests/s', 'New: median wait', 'New: p95 wait'], SIZES.map((n) => {
    const o = sc(base, n, 'list all (legacy)').concurrent;
    const c = sc(cur, n, 'map markers (all)').concurrent;
    return [n.toLocaleString('en-AU'), num(o.rps), ms(o.p50), ms(o.p95), num(c.rps), ms(c.p50), ms(c.p95)];
  })));

  out.push('\n### Every call, at 10,000 companies\n');
  out.push('Median of sequential calls (cached), the same call computed from scratch, and requests per second at ten at once. "Old" is the previous server answering the same request. Calls the old server did not have show –.\n');
  const names = Object.keys(sc(cur, 10000 , 'list all (legacy)') ? at(cur, 10000).scenarios : {});
  out.push(table(['Call', 'Old: wire', 'Old: median', 'Old: req/s at 10', 'New: wire', 'New: median (cached)', 'New: uncached', 'New: req/s at 10'], names.map((name) => {
    const o = at(base, 10000).scenarios[name];
    const c = sc(cur, 10000, name);
    return [`\`${name}\``, o ? kb(o.wireBytes) : '–', o ? ms(o.sequential.p50) : '–', o ? num(o.concurrent.rps) : '–', kb(c.wireBytes), ms(c.sequential.p50), ms(c.uncached?.p50), num(c.concurrent.rps)];
  })));

  out.push('\n### The server itself\n');
  out.push('Time from process start to answering the first request, and resident memory before and after the load (Render\'s free tier has 512 MB).\n');
  out.push(table(['Companies', 'Old: start', 'New: start', 'Old: memory after load', 'New: memory after load', 'New: memory at start'], SIZES.map((n) => [n.toLocaleString('en-AU'), ms(at(base, n).startMs), ms(at(cur, n).startMs), mb(at(base, n).rssAfterMb), mb(at(cur, n).rssAfterMb), mb(at(cur, n).rssStartMb)])));
  return out.join('\n');
}

// A cell may have been measured several times. Each number in the tables is the median of its own measurement across
// the runs (a run that was disturbed by something else on the machine is outvoted, but only for the number it
// disturbed), so one row can mix runs. Every run stays in the raw file.
const runsIn = (r, arch, size) => r.runs.filter((x) => x.arch === arch && x.size === size);
const medianBy = (r, arch, size, pick) => {
  const rows = runsIn(r, arch, size).filter((x) => pick(x) != null).sort((a, b) => pick(a) - pick(b));
  return rows[Math.floor((rows.length - 1) / 2)];
};
const runOf = (r, arch, size) => medianBy(r, arch, size, (x) => x.chrome.mainThreadSeconds); // the whole session
const pinsRun = (r, arch, size) => medianBy(r, arch, size, (x) => x.load.pinsFirstSeenMs); // opening the map
const stepRun = (r, arch, size, name) => medianBy(r, arch, size, (x) => x[name]?.worstGapMs); // one step: by its longest freeze
const spread = (rows, pick) => { const v = rows.map(pick).filter((x) => x != null); return v.length ? (Math.min(...v) === Math.max(...v) ? `${Math.min(...v)}` : `${Math.min(...v)}–${Math.max(...v)}`) : '–'; };
const step = (run, name) => run?.[name] ?? null;
const stepMs = (s, key) => (!s ? '–' : s.skipped ? 'out of time' : ms(s[key]));
// The map makes its pins a few at a time, so a step can be several short freezes where it used to be one long one and
// add up to more blocked time while being far easier to use. The longest single freeze is what a visitor feels as the
// page stopping; the total (in brackets) is how much of the step was spent that way.
const flags = (s) => `${s.neverShown ? ' (never appeared)' : ''}${s.settled === false ? ' (never settled)' : ''}`;
const freeze = (s) => (!s ? '–' : s.skipped ? 'out of time' : `${ms(s.worstGapMs)} (${ms(s.blockedMs)})${flags(s)}`);
const longest = (s) => (!s ? '–' : s.skipped ? 'out of time' : `${ms(s.worstGapMs)}${s.neverShown ? ' (never appeared)' : ''}`);

function browserSections(r, label) {
  const p = r.meta.profileSettings;
  const out = [];
  out.push(`Profile: ${p.width}×${p.height}${p.mobile ? ' phone' : ''}${p.cpu > 1 ? `, CPU ${p.cpu}× slower` : ''}${p.network ? `, ${nf.format(p.network.down * 8 / 1e6)} Mbit/s with ${p.network.latency} ms round trip` : ', no throttling'}. Cache off, so every load is a first visit. Nothing leaves the machine except calls to the app's own API: a logo is answered with a one-pixel image as if it had loaded, Leaflet's stylesheet comes from this repository's copy, the font stylesheet is empty and map tiles are refused. So this is the app's own work, not other people's servers.\n`);

  out.push(`#### ${label}: opening the map\n`);
  out.push('"Pins visible" is when the first pins are on the map; the time and data are from navigation start. "Wire" is what the app\'s own API calls sent over the network.\n');
  out.push(table(['Companies', 'Pins visible', 'API calls', 'Wire', 'Page nodes', 'JS heap'], SIZES.map((n) => {
    const o = pinsRun(r, 'baseline', n); const c = pinsRun(r, 'current', n);
    return [n.toLocaleString('en-AU'), pair(ms(o.load.pinsFirstSeenMs), ms(c.load.pinsFirstSeenMs)), pair(o.load.requests, c.load.requests), pair(kb(o.load.wireKB * 1024), kb(c.load.wireKB * 1024)), pair(num(o.load.domNodes), num(c.load.domNodes)), pair(mb(o.load.heapMb), mb(c.load.heapMb))];
  })));

  out.push(`\n#### ${label}: using the map\n`);
  out.push('Each cell is the **longest freeze** (the longest single stretch in which the page could not answer a click while the step ran) and, in brackets, the total of every such stretch (a 10 ms heartbeat\'s gaps over 60 ms). Zoom is a jump to street level in the Sydney CBD, then back out to Australia. Search types "cob" at about 12 keys a second.\n');
  out.push(table(['Companies', 'Zoom in: longest freeze (total)', 'Zoom out: longest freeze (total)', 'Search: requests', 'Search: longest freeze (total)'], SIZES.map((n) => {
    const at = (name, arch) => step(stepRun(r, arch, n, name), name);
    return [n.toLocaleString('en-AU'), pair(freeze(at('zoomIn', 'baseline')), freeze(at('zoomIn', 'current'))), pair(freeze(at('zoomOut', 'baseline')), freeze(at('zoomOut', 'current'))), pair(num(at('search', 'baseline')?.requests), num(at('search', 'current')?.requests)), pair(freeze(at('search', 'baseline')), freeze(at('search', 'current')))];
  })));

  out.push(`\n#### ${label}: the list, a company, jobs\n`);
  out.push('Cards and page nodes after the List tab opens and after the Jobs link is followed (a step ends when the cards are on the page and the page has gone quiet); the freezes are as above (longest, with the total in brackets). A company opens from the first card.\n');
  out.push(table(['Companies', 'List: cards', 'List: page nodes', 'List: longest freeze (total)', 'Open a company: longest freeze (total)'], SIZES.map((n) => {
    const at = (name, arch) => step(stepRun(r, arch, n, name), name);
    return [n.toLocaleString('en-AU'), pair(num(at('list', 'baseline')?.cards), num(at('list', 'current')?.cards)), pair(num(at('list', 'baseline')?.domNodes), num(at('list', 'current')?.domNodes)), pair(freeze(at('list', 'baseline')), freeze(at('list', 'current'))), pair(freeze(at('profile', 'baseline')), freeze(at('profile', 'current')))];
  })));
  out.push('');
  out.push(table(['Companies', 'Jobs: cards', 'Jobs: page nodes', 'Jobs: longest freeze (total)'], SIZES.map((n) => {
    const at = (name, arch) => step(stepRun(r, arch, n, name), name);
    return [n.toLocaleString('en-AU'), pair(num(at('jobs', 'baseline')?.cards), num(at('jobs', 'current')?.cards)), pair(num(at('jobs', 'baseline')?.domNodes), num(at('jobs', 'current')?.domNodes)), pair(freeze(at('jobs', 'baseline')), freeze(at('jobs', 'current')))];
  })));

  out.push(`\n#### ${label}: how many times each was measured, and how busy the machine was\n`);
  out.push('Each cell was measured this many times, and each number in the tables above is the median of its own measurement across those runs. The laptop was also being used for other things, so the percentage is how busy the whole machine was while a run went on (this test included): a run much busier than its neighbours is a disturbed one, and the small numbers (a few hundred milliseconds on a desktop) move with it. The old app at 5,000 companies and over takes minutes and was measured once; it differs from the new one by a factor of ten or more, which noise cannot change.\n');
  out.push(table(['Companies', 'Old: runs', 'Old: machine busy %', 'Old: main thread busy, range', 'New: runs', 'New: machine busy %', 'New: main thread busy, range'], SIZES.map((n) => {
    const o = runsIn(r, 'baseline', n); const c = runsIn(r, 'current', n);
    return [n.toLocaleString('en-AU'), o.length, spread(o, (x) => x.machineBusyPct), `${spread(o, (x) => Math.round(x.chrome.mainThreadSeconds * 10) / 10)} s`, c.length, spread(c, (x) => x.machineBusyPct), `${spread(c, (x) => Math.round(x.chrome.mainThreadSeconds * 10) / 10)} s`];
  })));

  out.push(`\n#### ${label}: the whole session\n`);
  out.push('Everything the page did from load to the end of the scenario, as Chrome counts it: seconds the main thread was busy, and layouts (a rough measure of how much the page redrew).\n');
  out.push(table(['Companies', 'Main thread busy', 'Script', 'Layouts', 'Heap at the end'], SIZES.map((n) => {
    const o = runOf(r, 'baseline', n); const c = runOf(r, 'current', n);
    return [n.toLocaleString('en-AU'), pair(`${num(o.chrome.mainThreadSeconds)} s`, `${num(c.chrome.mainThreadSeconds)} s`), pair(`${num(o.chrome.scriptSeconds)} s`, `${num(c.chrome.scriptSeconds)} s`), pair(num(o.chrome.layouts), num(c.chrome.layouts)), pair(mb(o.chrome.heapUsedMb), mb(c.chrome.heapUsedMb))];
  })));
  return out.join('\n');
}

// The browser results in two small tables, for the write-up's summary: what a visitor on a slow phone and on a desktop
// meets. Old → new, the median run of each cell; the freezes are the longest single one.
export function headlineTable(desktop, mobile) {
  const phone = table(
    ['Companies', 'First pins', 'Zoom to street level: longest freeze', 'List tab: longest freeze', 'Jobs page: longest freeze', 'Whole session: main thread busy'],
    SIZES.map((n) => {
      const at = (name, arch) => step(stepRun(mobile, arch, n, name), name);
      const o = runOf(mobile, 'baseline', n); const c = runOf(mobile, 'current', n);
      return [n.toLocaleString('en-AU'), pair(ms(pinsRun(mobile, 'baseline', n).load.pinsFirstSeenMs), ms(pinsRun(mobile, 'current', n).load.pinsFirstSeenMs)), pair(longest(at('zoomIn', 'baseline')), longest(at('zoomIn', 'current'))), pair(longest(at('list', 'baseline')), longest(at('list', 'current'))), pair(longest(at('jobs', 'baseline')), longest(at('jobs', 'current'))), pair(`${num(o.chrome.mainThreadSeconds)} s`, `${num(c.chrome.mainThreadSeconds)} s`)];
    }),
  );
  const desk = table(
    ['Companies', 'Data to open the map', 'First pins', 'List tab: page elements', 'List tab: longest freeze', 'Jobs page: longest freeze', 'Memory at the end'],
    SIZES.map((n) => {
      const at = (name, arch) => step(stepRun(desktop, arch, n, name), name);
      const o = runOf(desktop, 'baseline', n); const c = runOf(desktop, 'current', n);
      return [n.toLocaleString('en-AU'), pair(kb(o.load.wireKB * 1024), kb(c.load.wireKB * 1024)), pair(ms(pinsRun(desktop, 'baseline', n).load.pinsFirstSeenMs), ms(pinsRun(desktop, 'current', n).load.pinsFirstSeenMs)), pair(num(at('list', 'baseline')?.domNodes), num(at('list', 'current')?.domNodes)), pair(longest(at('list', 'baseline')), longest(at('list', 'current'))), pair(longest(at('jobs', 'baseline')), longest(at('jobs', 'current'))), pair(mb(o.chrome.heapUsedMb), mb(c.chrome.heapUsedMb))];
    }),
  );
  return `**On a phone** (390×844, processor 4× slower, 1.6 Mbit/s with 150 ms round trip):\n\n${phone}\n\n**On a desktop** (1280×800, no throttling):\n\n${desk}`;
}

export async function buildReport() {
  const [base, cur, desktop, mobile] = await Promise.all(['results-baseline.json', 'results-current.json', 'browser-desktop.json', 'browser-mobile.json'].map(load));
  const m = base.meta;
  return [
    '# Scale results',
    '',
    `Generated by \`backend/scripts/scale/report.js\` from the raw files in this folder. Do not edit by hand. **Staging data only:** the companies in every run are synthetic fixtures made by \`scripts/scale/fixtures.js\`, which refuses to write anywhere near production data.`,
    '',
    `Machine: ${m.cpu}, ${m.cores} cores, ${m.platform}, Node ${m.node}. HTTP runs ${base.meta.at.slice(0, 10)}; browser runs ${desktop.meta.at.slice(0, 10)}. One shared laptop that was also being used for other things while the tests ran (the browser tables below say how busy it was): read differences of tens of percent in the small numbers as noise.`,
    '',
    'Every table shows **old → new** where both exist: the old app and API are the commit before this work (`973f554`), built and served the same way as the new ones, on the same fixtures.',
    '',
    '## 1. The API and the server',
    '',
    httpSections(base, cur),
    '',
    '## 2. In a browser',
    '',
    '### Desktop',
    '',
    browserSections(desktop, 'Desktop'),
    '',
    '### A phone on a slow connection',
    '',
    browserSections(mobile, 'Phone'),
    '',
  ].join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--out');
  if (process.argv.includes('--headline')) {
    Promise.all(['browser-desktop.json', 'browser-mobile.json'].map(load)).then(([d, m]) => console.log(headlineTable(d, m))).catch((e) => { console.error(e); process.exitCode = 1; });
  } else buildReport().then(async (text) => {
    if (i > -1) { await writeFile(path.resolve(process.argv[i + 1]), text); console.log(`wrote ${process.argv[i + 1]}`); } else console.log(text);
  }).catch((e) => { console.error(e); process.exitCode = 1; });
}
