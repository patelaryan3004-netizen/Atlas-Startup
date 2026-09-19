import { Router } from 'express';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_PATH = path.join(__dirname, '..', 'data', 'seedDeals.json');

const CACHE_MS = 6 * 60 * 60 * 1000; // 6 hours
let cache = { ts: 0, deals: null };

const RSS_URL = `https://news.google.com/rss/search?q=${encodeURIComponent('Australian startup funding')}&hl=en-AU&gl=AU&ceid=AU:en`;

function decodeEntities(s) {
  return s
    .replace('<![CDATA[', '')
    .replace(']]>', '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, '’')
    .replace(/&quot;/g, '"')
    .trim();
}

function parseRssItems(xml, limit) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRegex.exec(xml)) && items.length < limit) {
    const block = m[1];
    const title = (block.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
    const link = (block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '';
    const pubDate = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '';
    const source = (block.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1] || '';
    if (title && link) {
      items.push({ title: decodeEntities(title), link: decodeEntities(link), pubDate, source: decodeEntities(source) });
    }
  }
  return items;
}

function toDeal(item) {
  const date = item.pubDate
    ? new Date(item.pubDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
    : '';
  return {
    headline: item.title,
    meta: [item.source, date].filter(Boolean).join(' · '),
    url: item.link,
  };
}

// Real live source: Google News RSS, no API key required. Throws on any
// failure so the route can fall back to the seed file rather than error out.
async function fetchLiveDeals() {
  const res = await fetch(RSS_URL, { headers: { 'User-Agent': 'au-startup-map/1.0' } });
  if (!res.ok) throw new Error(`news fetch failed: ${res.status}`);
  const xml = await res.text();
  const items = parseRssItems(xml, 6);
  if (!items.length) throw new Error('no news items parsed');
  return items.map(toDeal);
}

async function loadSeedDeals() {
  const raw = await readFile(SEED_PATH, 'utf-8');
  return JSON.parse(raw);
}

const router = Router();

// GET /api/news — recent AU startup deal headlines, cached server-side for 6h.
// ?refresh=1 bypasses the cache and forces a fresh fetch.
router.get('/', async (req, res, next) => {
  try {
    const force = req.query.refresh === '1' || req.query.force === 'true';
    const now = Date.now();
    if (!force && cache.deals && now - cache.ts < CACHE_MS) {
      return res.json({ source: 'cache', deals: cache.deals });
    }

    try {
      const deals = await fetchLiveDeals();
      cache = { ts: now, deals };
      res.json({ source: 'live', deals });
    } catch (liveErr) {
      const deals = await loadSeedDeals();
      cache = { ts: now, deals };
      res.json({ source: 'seeded', deals });
    }
  } catch (err) {
    next(err);
  }
});

export default router;
