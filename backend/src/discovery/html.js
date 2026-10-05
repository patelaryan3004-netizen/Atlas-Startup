// Just enough HTML reading for the enrichment step: entities, visible text,
// meta tags, JSON-LD, and links. Regex-based on purpose - only these few
// constructs are needed, and a full parser would be a new dependency to trust
// with untrusted pages. Anything it cannot read it returns as empty.

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…', copy: '©', reg: '®',
};

export function decodeEntities(s) {
  return String(s ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity) => {
      if (entity[0] === '#') {
        const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
      }
      return NAMED[entity.toLowerCase()] ?? whole;
    });
}

// The page's visible text, whitespace collapsed.
export function stripTags(html) {
  const noScripts = String(html ?? '').replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
  return decodeEntities(noScripts.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function attribute(tag, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3]) : null;
}

export function metaContent(html, key) {
  const wanted = key.toLowerCase();
  for (const tag of String(html ?? '').match(/<meta\b[^>]*>/gi) ?? []) {
    const name = (attribute(tag, 'name') ?? attribute(tag, 'property') ?? '').toLowerCase();
    if (name === wanted) return attribute(tag, 'content');
  }
  return null;
}

export function titleOf(html) {
  const m = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(String(html ?? ''));
  return m ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim() || null : null;
}

function flatten(node, out) {
  if (Array.isArray(node)) node.forEach((n) => flatten(n, out));
  else if (node && typeof node === 'object') {
    if (node['@graph']) flatten(node['@graph'], out);
    else out.push(node);
  }
}

// Every JSON-LD object on the page, with @graph flattened. A malformed block is skipped.
export function jsonLd(html) {
  const out = [];
  for (const m of String(html ?? '').matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { flatten(JSON.parse(m[1].trim()), out); } catch { /* skip a malformed block */ }
  }
  return out;
}

export const typesOf = (node) => [].concat(node?.['@type'] ?? []).map(String);

export function links(html, baseUrl) {
  const out = [];
  const seen = new Set();
  for (const m of String(html ?? '').matchAll(/<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = decodeEntities(m[1] ?? m[2]).trim();
    if (!href || /^(?:mailto|tel|javascript|data):/i.test(href)) continue;
    let url;
    try { url = new URL(href, baseUrl); } catch { continue; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
    url.hash = '';
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    out.push({ href: url.href, text: stripTags(m[3]).slice(0, 80) });
  }
  return out;
}
