// Makes public/og-image.png, the 1200 x 630 picture a link to the site shows in a chat or a feed.  node scripts/make-og-image.mjs
// It is the welcome page's opening: the night sky picture (public/img/hero-night.webp), the wordmark "still early." and the headline in Instrument Serif
// with its italic word, and the name of the community. It claims nothing: no number, no name but the site's. Needs Chrome or Edge (CHROME_PATH, or the usual places).
import path from 'node:path';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fontFile = (pkg, name) => pathToFileURL(path.join(root, 'node_modules', pkg, 'files', name)).href;
const art = pathToFileURL(path.join(root, 'public', 'img', 'hero-night.webp')).href;
const chrome = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && existsSync(p));
if (!chrome) throw new Error('make-og-image: no Chrome or Edge found (set CHROME_PATH)');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{ font-family:'Inter Variable'; src:url(${fontFile('@fontsource-variable/inter', 'inter-latin-wght-normal.woff2')}) format('woff2'); font-weight:100 900; }
@font-face{ font-family:'Instrument Serif'; src:url(${fontFile('@fontsource/instrument-serif', 'instrument-serif-latin-400-normal.woff2')}) format('woff2'); font-style:normal; }
@font-face{ font-family:'Instrument Serif'; src:url(${fontFile('@fontsource/instrument-serif', 'instrument-serif-latin-400-italic.woff2')}) format('woff2'); font-style:italic; }
*{ box-sizing:border-box; margin:0; }
body{ width:1200px; height:630px; position:relative; overflow:hidden; background:#071822; color:#faf9f5; font-family:'Inter Variable',sans-serif; }
img{ position:absolute; inset:0; width:100%; height:100%; object-fit:cover; object-position:50% 84%; }
.shade{ position:absolute; inset:0; background:radial-gradient(ellipse 60% 46% at 50% 34%, rgba(7,24,34,.5), transparent 72%), linear-gradient(to bottom, rgba(7,24,34,.55), transparent 30%); }
.mark{ position:absolute; left:56px; top:40px; font:400 56px/1 'Instrument Serif',serif; letter-spacing:-.015em; }
.mark span{ color:#e98369; }
h1{ position:absolute; left:0; right:0; top:104px; text-align:center; font:400 108px/.98 'Instrument Serif',serif; letter-spacing:-.022em; text-shadow:0 2px 30px rgba(7,24,34,.6); }
h1 em{ font-style:italic; }
h1 em span{ opacity:.5; }
.tag{ position:absolute; left:0; right:0; bottom:26px; text-align:center; font:500 15px/1 'Inter Variable',sans-serif; letter-spacing:.34em; color:rgba(250,249,245,.78); }
</style></head><body>
<img src="${art}" alt="">
<div class="shade"></div>
<div class="mark">still early<span>.</span></div>
<h1>The next big thing<br>is <em>someone<span>.</span></em></h1>
<div class="tag">Australia&rsquo;s startup community</div>
</body></html>`;

const dir = await mkdtemp(path.join(tmpdir(), 'og-'));
try {
  const page = path.join(dir, 'og.html');
  await writeFile(page, html, 'utf8');
  const out = path.join(root, 'public', 'og-image.png');
  execFileSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1200,630', '--allow-file-access-from-files', '--virtual-time-budget=4000', `--screenshot=${out}`, pathToFileURL(page).href], { stdio: 'ignore', timeout: 60000 });
  console.log(`make-og-image: wrote ${path.relative(process.cwd(), out)}`);
} finally {
  await rm(dir, { recursive: true, force: true });
}
