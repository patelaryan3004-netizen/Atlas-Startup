// Collects each company's own cover picture for the startup gallery: the preview image its website names for itself (og:image, twitter:image, image_src), read through the
// project's compliant fetcher (robots.txt obeyed on the page AND on the host the picture is on, an honest user agent, pacing, no login or access control bypassed). The picture is
// cut to 16:9, shrunk to 720x405 and kept as a WebP file beside the site's own pictures: the page never depends on another site's image URL.
//
//   node scripts/covers/collect.mjs collect [--only "Name;Name"] [--retry] [--limit n] [--workers n]   read the sites (--retry: only those a network hiccup stopped last time); write frontend/public/img/covers/<id>.webp and scripts/covers/cover-results.json
//   node scripts/covers/collect.mjs report                                                    what the last collection found
//   node scripts/covers/collect.mjs apply --by "name"                                         put each kept picture on its company (cover, cover_source_url, cover_retrieved_at)
//
// What is never kept: a page that says noimageindex, a picture under 600x300 or not roughly landscape (a logo or an icon), and a picture two or more companies share (a template's or a
// platform's default image says nothing about any one of them): those companies get their logo on a neutral tile in the gallery, not somebody else's picture. Nothing is ever drawn,
// generated or guessed. The source of each picture is recorded so it can be taken down.
//
// A company that asks for its picture to be taken down is put in scripts/covers/excluded.json (a list of company ids): collect never reads its site again, and apply clears its cover and
// removes the file.
//
// sharp is not a dependency of the project (the pictures are made once): install it where you run this (npm i sharp in a scratch folder) and set SHARP_FROM to that folder.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFetcher, DEFAULT_USER_AGENT, FetchPolicyError } from '../../src/discovery/http.js';
import { metaContent, decodeEntities } from '../../src/discovery/html.js';
import { loadRaw, parseRaw } from '../../src/models/dataset.js';
import { transact } from '../../src/models/store.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(HERE, '..', '..', 'src', 'data');
const OUT_DIR = path.join(HERE, '..', '..', '..', 'frontend', 'public', 'img', 'covers');
const RESULTS = path.join(HERE, 'cover-results.json');
const EXCLUDED = path.join(HERE, 'excluded.json');
const excluded = () => new Set(existsSync(EXCLUDED) ? JSON.parse(readFileSync(EXCLUDED, 'utf8')) : []);
const [, , step, ...rest] = process.argv;
const flag = (name) => { const i = rest.indexOf(name); return i < 0 ? null : (rest[i + 1] ?? true); };

const WIDTH = 720; const HEIGHT = 405;
const MIN_W = 600; const MIN_H = 300;
const RATIO = [1.4, 2.3]; // landscape, but not so wide that a 16:9 cut would lose half of it
const KINDS = ['image/jpeg', 'image/png', 'image/webp'];

const sharp = (() => {
  const from = process.env.SHARP_FROM;
  const req = createRequire(from ? path.join(path.resolve(from), 'package.json') : import.meta.url);
  return req('sharp');
})();

const attr = (tag, name) => { const m = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag); return m ? (m[2] ?? m[3] ?? m[4]) : null; };
function candidates(html, base) {
  const out = [];
  for (const key of ['og:image', 'og:image:secure_url', 'og:image:url', 'twitter:image', 'twitter:image:src']) {
    const v = metaContent(html, key);
    if (v) out.push(v);
  }
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) if (/image_src/i.test(attr(tag, 'rel') ?? '')) { const h = attr(tag, 'href'); if (h) out.push(h); }
  return [...new Set(out.map((u) => decodeEntities(String(u).trim())).filter(Boolean).map((u) => { try { return new URL(u, base).href; } catch { return null; } }).filter((u) => u && /^https?:\/\//.test(u)))];
}
const refusesImages = (html) => /<meta\b[^>]*name=["']robots["'][^>]*noimageindex/i.test(html) || /<meta\b[^>]*noimageindex[^>]*name=["']robots["']/i.test(html);

async function collect() {
  const ds = parseRaw(await loadRaw(dataDir));
  mkdirSync(OUT_DIR, { recursive: true });
  const only = flag('--only');
  // A site the last run could not reach for a reason that can pass (its robots.txt did not answer, a timeout, a network error) is asked again; one that refused (robots disallow, access control) never is.
  const again = (r) => /^unreadable: (robots_unavailable|timeout|http_error|fetch failed|rate_limited)/.test(r?.status ?? '');
  const before = existsSync(RESULTS) ? new Map(JSON.parse(readFileSync(RESULTS, 'utf8')).results.map((r) => [r.company_id, r])) : new Map();
  const never = excluded();
  const wanted = ds.companies.filter((c) => c.website && !never.has(c.id) && (!only || String(only).split(';').includes(c.name)) && (!flag('--retry') || again(before.get(c.id))));
  const list = wanted.slice(0, Number(flag('--limit') ?? Infinity));
  const html = createFetcher({ userAgent: DEFAULT_USER_AGENT, minDelayMs: 1500, maxBytes: 1500000, timeoutMs: 20000 });
  const pictures = createFetcher({ userAgent: DEFAULT_USER_AGENT, minDelayMs: 1000, maxBytes: 6000000, timeoutMs: 25000 });
  const prior = existsSync(RESULTS) ? JSON.parse(readFileSync(RESULTS, 'utf8')).results : [];
  const results = new Map(prior.map((r) => [r.company_id, r]));
  let next = 0; let done = 0;
  const worker = async () => {
    while (next < list.length) {
      const c = list[next]; next += 1;
      const rec = { company_id: c.id, name: c.name, page: c.website, status: null, source_image: null, width: null, height: null, bytes: null, hash: null, retrieved_at: new Date().toISOString() };
      try {
        const page = await html.get(c.website);
        rec.page = page.finalUrl;
        if (refusesImages(page.text)) rec.status = 'skipped: the page says noimageindex';
        else {
          const urls = candidates(page.text, page.finalUrl);
          if (!urls.length) rec.status = 'no_image: the page names no preview picture';
          for (const url of urls) {
            try {
              const img = await pictures.get(url, { accept: 'image/avif,image/webp,image/png,image/jpeg;q=0.9', allow: KINDS, binary: true });
              const meta = await sharp(img.body).metadata();
              const ratio = meta.width / meta.height;
              if (meta.width < MIN_W || meta.height < MIN_H) { rec.status = `rejected: ${meta.width}x${meta.height} is too small`; continue; }
              if (ratio < RATIO[0] || ratio > RATIO[1]) { rec.status = `rejected: ${meta.width}x${meta.height} is not a landscape picture`; continue; }
              let quality = 74; let buf;
              for (;;) {
                buf = await sharp(img.body).rotate().resize(WIDTH, HEIGHT, { fit: 'cover', position: 'centre' }).webp({ quality, effort: 4 }).toBuffer();
                if (buf.length <= 90000 || quality <= 52) break;
                quality -= 8;
              }
              writeFileSync(path.join(OUT_DIR, `${c.id}.webp`), buf);
              Object.assign(rec, { status: 'saved', source_image: img.finalUrl, width: meta.width, height: meta.height, bytes: buf.length, hash: createHash('sha1').update(buf).digest('hex') });
              break;
            } catch (e) { rec.status = `unreadable: ${e instanceof FetchPolicyError ? e.code : String(e.message ?? e).slice(0, 60)}`; }
          }
        }
      } catch (e) { rec.status = `unreadable: ${e instanceof FetchPolicyError ? e.code : String(e.message ?? e).slice(0, 60)}`; }
      results.set(c.id, rec);
      done += 1;
      if (done % 25 === 0 || done === list.length) { process.stderr.write(`${done}/${list.length} (${[...results.values()].filter((r) => r.status === 'saved').length} kept)\n`); writeFileSync(RESULTS, `${JSON.stringify({ collected_at: new Date().toISOString(), results: [...results.values()] }, null, 1)}\n`); }
    }
  };
  await Promise.all(Array.from({ length: Number(flag('--workers') ?? 6) }, worker));
  dedupe(results);
  writeFileSync(RESULTS, `${JSON.stringify({ collected_at: new Date().toISOString(), results: [...results.values()] }, null, 1)}\n`);
  summary([...results.values()]);
}

// A picture two or more companies share is not about any one of them: drop it for all.
function dedupe(results) {
  const byHash = new Map();
  for (const r of results.values()) if (r.status === 'saved') (byHash.get(r.hash) ?? byHash.set(r.hash, []).get(r.hash)).push(r);
  for (const group of byHash.values()) {
    if (group.length < 2) continue;
    for (const r of group) {
      try { unlinkSync(path.join(OUT_DIR, `${r.company_id}.webp`)); } catch { /* already gone */ }
      Object.assign(r, { status: `rejected: the same picture is on ${group.length} companies' sites (${group.map((g) => g.name).join(', ').slice(0, 80)})` });
    }
  }
}

function summary(rows) {
  const tally = {};
  for (const r of rows) { const k = String(r.status).split(':')[0]; tally[k] = (tally[k] ?? 0) + 1; }
  const kept = rows.filter((r) => r.status === 'saved');
  console.log(JSON.stringify({ companies: rows.length, ...tally, kept_mb: Math.round(kept.reduce((a, r) => a + r.bytes, 0) / 1048576 * 10) / 10 }));
}

async function apply() {
  const by = flag('--by');
  if (typeof by !== 'string') throw new Error('--by "name" is required');
  const R = JSON.parse(readFileSync(RESULTS, 'utf8')).results;
  const never = excluded();
  for (const id of never) { try { unlinkSync(path.join(OUT_DIR, `${id}.webp`)); } catch { /* already gone */ } }
  let n = 0;
  await transact(dataDir, (work, { at }) => {
    const audit = [];
    for (const r of R) {
      const c = work.companies.find((x) => x.id === r.company_id);
      if (!c) continue;
      const have = existsSync(path.join(OUT_DIR, `${r.company_id}.webp`)) && !never.has(r.company_id);
      const want = r.status === 'saved' && have ? { cover: `/img/covers/${r.company_id}.webp`, cover_source_url: r.source_image, cover_retrieved_at: r.retrieved_at } : { cover: null, cover_source_url: null, cover_retrieved_at: null };
      if (c.cover === want.cover && c.cover_source_url === want.cover_source_url) continue;
      Object.assign(c, want);
      n += 1;
    }
    if (n > 0) audit.push({ actor: { name: by, role: 'cli' }, via: 'cli', action: 'enrichment.apply', target: { type: 'system', id: 'covers' }, summary: `Cover pictures from the companies' own websites: ${n} companies updated`, changes: [] });
    return { audit };
  });
  console.log(`${n} companies updated`);
}

if (step === 'collect') await collect();
else if (step === 'report') summary(JSON.parse(readFileSync(RESULTS, 'utf8')).results);
else if (step === 'apply') await apply();
else console.log('Steps: collect, report, apply. See the top of this file.');
