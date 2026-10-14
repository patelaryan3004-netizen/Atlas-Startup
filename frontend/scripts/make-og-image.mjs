// Makes public/og-image.png, the 1200 x 630 picture a link to the site shows in a chat or a feed.  node scripts/make-og-image.mjs
// It is drawn from the site's own pieces: the page's ground and ink, Inter, the landing page's italic serif word, and the country in dots
// (the landing page's picture). It claims nothing: no number, no name but the site's. Needs Chrome or Edge (CHROME_PATH, or the usual places).
import path from 'node:path';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GRID_PATH, VIEW, DOT_SIZE } from '../src/components/landing/australia.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fontFile = (pkg, name) => pathToFileURL(path.join(root, 'node_modules', pkg, 'files', name)).href;
const chrome = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && existsSync(p));
if (!chrome) throw new Error('make-og-image: no Chrome or Edge found (set CHROME_PATH)');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{ font-family:'Inter Variable'; src:url(${fontFile('@fontsource-variable/inter', 'inter-latin-wght-normal.woff2')}) format('woff2'); font-weight:100 900; }
@font-face{ font-family:'Instrument Serif'; src:url(${fontFile('@fontsource/instrument-serif', 'instrument-serif-latin-400-italic.woff2')}) format('woff2'); font-style:italic; }
*{ box-sizing:border-box; margin:0; }
body{ width:1200px; height:630px; position:relative; overflow:hidden; background:#0a0e0f; color:#e8e6de; font-family:'Inter Variable',sans-serif; }
.map{ position:absolute; right:-40px; top:60px; width:640px; opacity:.95; }
.map path{ fill:none; stroke:rgba(232,230,222,.45); stroke-linecap:round; }
.text{ position:absolute; left:72px; top:0; bottom:0; width:640px; display:flex; flex-direction:column; justify-content:center; gap:28px; }
.brand{ font:500 22px/1 ui-monospace,Consolas,monospace; letter-spacing:.14em; text-transform:uppercase; color:#7ee8a0; }
h1{ font-size:84px; font-weight:600; line-height:1.02; letter-spacing:-.035em; }
h1 em{ font-family:'Instrument Serif',serif; font-weight:400; color:#3ecf6e; letter-spacing:-.02em; }
p{ font-size:30px; line-height:1.35; color:rgba(232,230,222,.78); max-width:30ch; }
</style></head><body>
<svg class="map" viewBox="0 0 ${VIEW.width} ${VIEW.height}" aria-hidden="true"><path d="${GRID_PATH}" stroke-width="${DOT_SIZE}"/></svg>
<div class="text"><div class="brand">AU Startup Map</div><h1>Australia&rsquo;s startup ecosystem, <em>mapped.</em></h1><p>Startups, founders, investors and jobs, each with the page its facts came from.</p></div>
</body></html>`;

const dir = await mkdtemp(path.join(tmpdir(), 'og-'));
try {
  const page = path.join(dir, 'og.html');
  await writeFile(page, html, 'utf8');
  const out = path.join(root, 'public', 'og-image.png');
  execFileSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1200,630', '--virtual-time-budget=4000', `--screenshot=${out}`, pathToFileURL(page).href], { stdio: 'ignore', timeout: 60000 });
  console.log(`make-og-image: wrote ${path.relative(process.cwd(), out)}`);
} finally {
  await rm(dir, { recursive: true, force: true });
}
