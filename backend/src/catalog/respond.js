// How a public read is answered cheaply, however many ask.
//
//   1. The ETag is the data's version plus the question, so a client that already has the answer is told so
//      (304) before anything is worked out.
//   2. The serialised answer is kept, keyed by the question, until the data changes: the same page of the same
//      list is built once, not once per visitor. The cache is bounded (entries and bytes), least recently used out.
//   3. A big answer is compressed once, off the event loop, and the compressed copy is what is sent.
//
// A question that cannot be answered (a bad `limit`) is an HttpError: it is sent, never kept.
import { createHash } from 'node:crypto';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';

const gzipAsync = promisify(gzip);

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// The question a request asks: its path and the parameters the API understands, in a fixed order. A parameter
// the API ignores is not part of the question, so adding junk to a URL can neither dodge the kept answer nor
// fill the cache with copies of it.
// (Both `search` and `q` are questions; `page` is the directory's.)
const KNOWN = new Set(['search', 'sector', 'city', 'investor', 'stage', 'hiring', 'taskGate', 'verified', 'name', 'limit', 'offset', 'sort', 'view', 'facets', 'q', 'page']);
export function questionKey(req) {
  const parts = [];
  for (const [key, value] of Object.entries(req.query ?? {})) {
    if (!KNOWN.has(key)) continue;
    for (const v of [].concat(value)) parts.push(`${key}=${typeof v === 'string' ? v : JSON.stringify(v)}`);
  }
  return `${req.baseUrl}${req.path}?${parts.sort().join('&')}`;
}

export function createResponder(catalog, { maxEntries = 300, maxBytes = 64 * 1024 * 1024, maxAge = 60, staleWhileRevalidate = 600 } = {}) {
  const cache = new Map();
  let bytes = 0;
  let version = null;
  const evict = () => {
    while ((cache.size > maxEntries || bytes > maxBytes) && cache.size) {
      const [key, entry] = cache.entries().next().value;
      bytes -= entry.bytes;
      cache.delete(key);
    }
  };

  const respond = async function respond(req, res, build, { key = questionKey(req), type = 'application/json; charset=utf-8' } = {}) {
    const snap = await catalog.snapshot();
    if (snap.version !== version) { cache.clear(); bytes = 0; version = snap.version; }
    const etag = `W/"${snap.version}-${createHash('sha1').update(key).digest('base64url').slice(0, 12)}"`;
    if ((req.headers['if-none-match'] ?? '').split(/\s*,\s*/).includes(etag)) {
      res.set({ ETag: etag, 'Cache-Control': `public, max-age=${maxAge}, stale-while-revalidate=${staleWhileRevalidate}`, Vary: 'Accept-Encoding' });
      return res.status(304).end();
    }
    let entry = cache.get(key);
    if (entry) { cache.delete(key); cache.set(key, entry); } else {
      let body;
      try {
        body = await build(snap);
      } catch (err) {
        if (!(err instanceof HttpError)) throw err;
        res.set('Cache-Control', 'no-store');
        return res.status(err.status).json({ error: err.message });
      }
      const buffer = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
      entry = { json: buffer, gz: null, bytes: buffer.length };
      cache.set(key, entry);
      bytes += entry.bytes;
      evict();
    }
    res.set({ ETag: etag, 'Cache-Control': `public, max-age=${maxAge}, stale-while-revalidate=${staleWhileRevalidate}`, Vary: 'Accept-Encoding', 'Content-Type': type });
    if (entry.json.length > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '')) {
      entry.gz ??= gzipAsync(entry.json, { level: 5 }).then((b) => { entry.bytes += b.length; bytes += b.length; return b; });
      const compressed = await entry.gz;
      res.set({ 'Content-Encoding': 'gzip', 'Content-Length': compressed.length });
      return res.end(compressed);
    }
    res.set('Content-Length', entry.json.length);
    return res.end(entry.json);
  };
  respond.stats = () => ({ entries: cache.size, bytes });
  return respond;
}
