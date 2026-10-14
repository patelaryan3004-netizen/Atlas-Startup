// Two build steps that start downloads earlier. Both read the finished build (the file names carry a hash, so they are not known before it)
// and write into index.html. In `vite dev` there is no build, so they do nothing.

// The page is set in one typeface (Inter, one variable file for the Latin letters, served with the site). Asking for that file in the page's
// head, beside its first stylesheet, starts its download while the page's scripts are still arriving, instead of when the first text is
// laid out. (Text outside Latin, which is rare, fetches its own slice later.)
export function preloadInter() {
  return {
    name: 'preload-inter',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const file = Object.keys(ctx.bundle ?? {}).find((name) => /inter-latin-wght-normal-.*\.woff2$/.test(name));
        if (!file) return html;
        return { html, tags: [{ tag: 'link', attrs: { rel: 'preload', as: 'font', type: 'font/woff2', href: `/${file}`, crossorigin: '' }, injectTo: 'head' }] };
      },
    },
  };
}

// The page a visit opens is a file of its own, asked for only when the app starts (lazyLoad.jsx), which is a whole round trip after the
// HTML. The address already says which page it is, so index.html's small script adds the page's files to the head at once, beside the app's
// own file: the page, the files it needs with it, and its stylesheets. `PAGES` names the files each kind of address needs (by the name of the
// chunk); the script in index.html picks by address and reads the lists from the line it marks with ROUTE_FILES.
// (The landing page is left out on purpose: measured, preloading its eleven small files beside the app's own made its largest paint later,
// 3.1 s against 2.7 s on a slow phone, because they share the same slow connection; the other pages gained.)
const PAGES = {
  app: ['App'],
  map: ['MapView'],
  list: ['ListView'],
  jobs: ['JobsView'],
};

export function preloadPages() {
  return {
    name: 'preload-pages',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const bundle = ctx.bundle;
        if (!bundle || !html.includes('/*ROUTE_FILES*/')) return html;
        const chunks = Object.values(bundle).filter((o) => o.type === 'chunk');
        const entry = chunks.find((c) => c.isEntry);
        if (!entry) return html;
        const already = new Set([entry.fileName, ...entry.imports]); // index.html loads these itself
        // What a chunk needs at once: itself, everything it imports by name, and their stylesheets.
        const needs = (chunk, seen) => {
          if (!chunk || seen.has(chunk.fileName) || already.has(chunk.fileName)) return seen;
          seen.add(chunk.fileName);
          for (const dep of chunk.imports) needs(bundle[dep], seen);
          return seen;
        };
        const files = {};
        for (const [kind, names] of Object.entries(PAGES)) {
          const seen = new Set();
          for (const name of names) needs(chunks.find((c) => c.name === name), seen);
          if (seen.size === 0) continue;
          const css = [...seen].flatMap((file) => bundle[file].viteMetadata?.importedCss ? [...bundle[file].viteMetadata.importedCss] : []);
          files[kind] = { js: [...seen].map((f) => `/${f}`), css: [...new Set(css)].map((f) => `/${f}`) };
        }
        return html.replace('/*ROUTE_FILES*/{}', JSON.stringify(files));
      },
    },
  };
}
