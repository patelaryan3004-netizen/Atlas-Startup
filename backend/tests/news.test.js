import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import seedDeals from '../src/data/seedDeals.json' with { type: 'json' };

function rssXml(items) {
  const body = items
    .map(
      (i) => `
      <item>
        <title>${i.title}</title>
        <link>${i.link}</link>
        <pubDate>${i.pubDate}</pubDate>
        <source url="https://example.com">${i.source}</source>
      </item>`
    )
    .join('');
  return `<?xml version="1.0"?><rss><channel>${body}</channel></rss>`;
}

function mockFetchOk(xml) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(xml) }));
}

function mockFetchFail() {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve('') }));
}

describe('GET /api/news', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches and parses real live headlines from the RSS feed', async () => {
    mockFetchOk(
      rssXml([
        { title: 'Startup X raises $5M Seed', link: 'https://example.com/a1', pubDate: 'Mon, 01 Sep 2026 10:00:00 GMT', source: 'Example News' },
        { title: 'Startup Y closes Series A', link: 'https://example.com/a2', pubDate: 'Tue, 02 Sep 2026 10:00:00 GMT', source: 'Other Outlet' },
      ])
    );

    const res = await request(app).get('/api/news?refresh=1');
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('live');
    expect(res.body.deals).toHaveLength(2);
    expect(res.body.deals[0].headline).toBe('Startup X raises $5M Seed');
    expect(res.body.deals[0].url).toBe('https://example.com/a1');
    expect(res.body.deals[0].meta).toContain('Example News');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('news.google.com/rss/search'),
      expect.any(Object)
    );
  });

  it('falls back to the seeded deals when the RSS fetch fails', async () => {
    mockFetchFail();
    const res = await request(app).get('/api/news?refresh=1');
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('seeded');
    expect(res.body.deals).toEqual(seedDeals);
  });

  it('falls back to the seeded deals when the RSS response has no parseable items', async () => {
    mockFetchOk('<?xml version="1.0"?><rss><channel></channel></rss>');
    const res = await request(app).get('/api/news?refresh=1');
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('seeded');
    expect(res.body.deals).toEqual(seedDeals);
  });

  it('serves from cache on the next request and does not call fetch again', async () => {
    mockFetchOk(rssXml([{ title: 'Cached headline', link: 'https://example.com/cached', pubDate: '', source: 'News Co' }]));
    const first = await request(app).get('/api/news?refresh=1');
    expect(first.body.source).toBe('live');

    vi.stubGlobal('fetch', vi.fn()); // if called again, this would return garbage/undefined
    const second = await request(app).get('/api/news');
    expect(second.status).toBe(200);
    expect(second.body.source).toBe('cache');
    expect(second.body.deals).toEqual(first.body.deals);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('?refresh=1 bypasses the cache and fetches again', async () => {
    mockFetchOk(rssXml([{ title: 'First headline', link: 'https://example.com/1', pubDate: '', source: 'A' }]));
    const first = await request(app).get('/api/news?refresh=1');
    expect(first.body.deals[0].headline).toBe('First headline');

    mockFetchOk(rssXml([{ title: 'Second headline', link: 'https://example.com/2', pubDate: '', source: 'B' }]));
    const second = await request(app).get('/api/news?refresh=1');
    expect(second.body.source).toBe('live');
    expect(second.body.deals[0].headline).toBe('Second headline');
  });

  it('every returned deal has a headline, meta and url', async () => {
    mockFetchFail();
    const res = await request(app).get('/api/news?refresh=1');
    res.body.deals.forEach((d) => {
      expect(d).toHaveProperty('headline');
      expect(d).toHaveProperty('meta');
      expect(d).toHaveProperty('url');
      expect(typeof d.url).toBe('string');
    });
  });
});
