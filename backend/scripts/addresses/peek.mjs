// Reads one page through the compliant fetcher and prints the lines around a word: node scripts/addresses/peek.mjs <url> <word> [<word> ...]
import { createFetcher, DEFAULT_USER_AGENT } from '../../src/discovery/http.js';
const [, , url, ...words] = process.argv;
const f = createFetcher({ userAgent: DEFAULT_USER_AGENT, minDelayMs: 1500, maxBytes: 3000000, timeoutMs: 25000 });
try {
  const r = await f.get(url);
  const text = r.text.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  console.log(`status ${r.status} ${r.contentType} final ${r.finalUrl} | ${text.length} chars`);
  for (const w of words) {
    const re = new RegExp(`.{0,140}${w}.{0,140}`, 'ig');
    const hits = [...text.matchAll(re)].slice(0, 4).map((m) => m[0]);
    console.log(`  "${w}": ${hits.length ? '' : '(not found)'}`);
    for (const h of hits) console.log(`     ...${h}...`);
  }
} catch (e) { console.log(`could not read: ${e.code ?? ''} ${e.message}`); }
