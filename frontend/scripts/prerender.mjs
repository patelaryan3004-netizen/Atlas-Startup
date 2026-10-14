// Writes real HTML for the pages that need it, after `vite build` (npm run build runs both). It draws each page with React's server renderer,
// puts the markup into the built index.html (so the page keeps the same scripts and styles, and is hydrated or drawn over by the browser),
// gives each page its own title, description, canonical address and link-preview tags, and writes robots.txt and sitemap.xml.
//
//   dist/index.html            the map: a heading, a sentence and the way to the plain list (the app draws over it)
//   dist/welcome/index.html    the landing page, hydrated by the browser   (also about/, methodology/, contact/)
//   dist/lists/index.html, dist/investors/index.html   plain versions of the app's pages, for search engines and visitors with no scripts
//   dist/app.html              the same shell with no address of its own: what vercel.json serves for a company, the jobs board, the news...
//
// What it reads: dist/index.html (the template), public/data/snapshot.json (the figures, made by `npm run snapshot` in backend/) and
// prerender-data.json (the lists' counts and the investors, made by the same command). A missing or too old snapshot does not stop the build:
// the landing page is then made without figures and the browser draws it afresh.
import path from 'node:path';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

process.env.NODE_ENV = 'production'; // React's production build for the server render too
const { createServer } = await import('vite');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = process.env.PRERENDER_DIST ? path.resolve(process.env.PRERENDER_DIST) : path.join(root, 'dist'); // (PRERENDER_DIST: for a test that builds elsewhere)
const readJson = async (file) => { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; } };

const escapeAttr = (text) => String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const attrs = (attributes) => Object.entries(attributes).map(([k, v]) => ` ${k}="${escapeAttr(v)}"`).join('');

// (No dependency pre-bundling: a server render needs none, and one still running when the server closes prints "The build was canceled".)
const vite = await createServer({ root, mode: 'production', logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } });
try {
  const server = await vite.ssrLoadModule('/src/entry-server.jsx');
  const site = await vite.ssrLoadModule('/src/siteMeta.js');
  const { SITE_URL, SITE_NAME, absolute } = site;
  // (index.html names the preview image and the address of the site as __SITE_URL__, which is only known here.)
  const template = (await readFile(path.join(dist, 'index.html'), 'utf8')).replaceAll('__SITE_URL__', SITE_URL);
  const data = { snapshot: await readJson(path.join(root, 'public', 'data', 'snapshot.json')), prerenderData: await readJson(path.join(root, 'prerender-data.json')) };
  if (!data.snapshot) console.warn('prerender: no public/data/snapshot.json: the landing page is made without figures.');
  if (!data.prerenderData) console.warn('prerender: no prerender-data.json: the lists and investors pages are made without their counts and names.');

  // The head of one page: its title and description in every place they are said, its address, and the preview image.
  function head(html, route) {
    const { meta } = route;
    const set = (re, replacement) => {
      if (!re.test(html)) throw new Error(`prerender: index.html has no ${re} to give the page its own text`);
      html = html.replace(re, replacement);
    };
    set(/<title>[^<]*<\/title>/, `<title>${escapeAttr(meta.title).replace(/&quot;/g, '"')}</title>`);
    set(/(<meta name="description" content=")[^"]*(")/, `$1${escapeAttr(meta.description)}$2`);
    set(/(<meta property="og:title" content=")[^"]*(")/, `$1${escapeAttr(meta.title)}$2`);
    set(/(<meta property="og:description" content=")[^"]*(")/, `$1${escapeAttr(meta.description)}$2`);
    set(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${escapeAttr(meta.title)}$2`);
    set(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${escapeAttr(meta.description)}$2`);
    {
      const url = absolute(route.path);
      const extra = [
        `<link rel="canonical" href="${escapeAttr(url)}">`,
        `<meta property="og:url" content="${escapeAttr(url)}">`,
      ];
      if (route.json) extra.push(`<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': route.json, name: SITE_NAME, url: `${SITE_URL}/` }).replace(/</g, '\\u003c')}</script>`);
      html = html.replace('</head>', `${extra.join('\n')}\n</head>`);
    }
    return html;
  }

  const put = async (file, text) => {
    const target = path.join(dist, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, text, 'utf8');
    return target;
  };

  // The stylesheets of the pages that are hydrated (written by the build, vitePreload.js): linked in their HTML, so the page is styled before
  // any script runs (and a visitor with no scripts gets it styled at all).
  const manifestFile = path.join(dist, 'prerender-manifest.json');
  const manifest = (await readJson(manifestFile)) ?? {};

  const page = (route) => {
    const { html, attributes } = server.renderRoute(route, data);
    if (!template.includes('<div id="root"></div>')) throw new Error('prerender: index.html has no empty <div id="root"></div> to draw into');
    const sheets = (manifest[route.hydrate] ?? []).map((href) => `<link rel="stylesheet" crossorigin href="${href}">`).join('\n');
    if (route.hydrate && !sheets) console.warn(`prerender: no stylesheet known for ${route.path}: it is styled only once its scripts run`);
    return head(template, route).replace('</head>', `${sheets}\n</head>`).replace('<div id="root"></div>', `<div id="root"${attrs(attributes)}>${html}</div>`);
  };

  const written = [];
  for (const route of server.ROUTES) written.push(await put(route.file, page(route)));
  // The page for every address that has none of its own: the template's own title and description, no address, no preview of its own.
  const generic = server.renderRoute({ shell: server.GENERIC_SHELL }, data);
  written.push(await put('app.html', template.replace('<div id="root"></div>', `<div id="root"${attrs(generic.attributes)}>${generic.html}</div>`)));

  await unlink(manifestFile).catch(() => {}); // a note for this script only: not part of the site
  await put('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
  const urls = server.ROUTES.map((route) => `  <url><loc>${absolute(route.path)}</loc></url>`).join('\n');
  await put('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);

  console.log(`prerender: wrote ${server.ROUTES.length} pages (${server.ROUTES.map((r) => r.path).join(', ')}), app.html, robots.txt and sitemap.xml for ${SITE_URL}`);
} finally {
  await vite.close();
}
