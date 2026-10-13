import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import startups from '../src/data/startups.json' with { type: 'json' };

describe('GET /directory', () => {
  it('returns a plain HTML page listing every company', async () => {
    const res = await request(app).get('/directory');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain(`(${startups.length} companies)`);
    expect(res.text).toContain('<table>');
  });

  it('includes a known company name and does not require JavaScript to render', async () => {
    const res = await request(app).get('/directory');
    expect(res.text).toContain('Canva');
    expect(res.text).not.toContain('<script');
  });

  it('escapes company data so it cannot break the HTML', async () => {
    const res = await request(app).get('/directory');
    // sanity: nothing in the raw JSON should have leaked an unescaped tag
    expect(res.text).not.toMatch(/<script>|<\/table><table>/);
  });
});

// The page lists 250 companies at a time ("Page 1 of 2: next"), so a directory of more than 250 is read a page at a time, as a visitor would.
async function wholeDirectory() {
  const pages = [];
  for (let n = 1; ; n += 1) {
    const res = await request(app).get(n > 1 ? `/directory?page=${n}` : '/directory');
    pages.push(res.text);
    if (!res.text.includes(`href="/directory?page=${n + 1}">next`)) break;
  }
  return { text: pages.join('\n'), pages: pages.length };
}

describe('GET /directory, who is hiring', () => {
  it('says Yes only for a company whose open roles a page confirmed lately, gives an earlier reading its date, and never says No for what nobody read', async () => {
    const res = await wholeDirectory();
    const cells = (text) => res.text.split(`<td>${text}</td>`).length - 1;
    const summary = (await request(app).get('/api/startups/summary')).body;
    expect(cells('Yes')).toBe(summary.hiring);
    expect(res.text.match(/<td>Checked \d{1,2} \w{3}<\/td>/g)?.length ?? 0).toBe(summary.hiringChecked);
    expect(cells('No')).toBe(0);
    // Everything else is either a job board that listed none, or unverified.
    const none = res.text.match(/<td>No open roles listed \(\d{1,2} \w{3}\)<\/td>/g)?.length ?? 0;
    expect(cells('Yes') + (res.text.match(/<td>Checked /g)?.length ?? 0) + none + cells('Roles unverified')).toBe(startups.length);
  });

  it('says a website that no longer answers is unavailable instead of linking it', async () => {
    const res = await wholeDirectory();
    const dead = startups.filter((c) => c.website_status === 'unavailable');
    expect(dead.length).toBeGreaterThan(0);
    expect(res.text.split('Website unavailable').length - 1).toBe(dead.length);
    for (const c of dead) expect(res.text, `${c.name}'s dead address is still linked`).not.toContain(`href="${c.website}"`);
  });

  it('lists every company exactly once across its pages, 250 to a page, and links to the next page', async () => {
    const whole = await wholeDirectory();
    expect(whole.pages).toBe(Math.ceil(startups.length / 250));
    const rows = whole.text.match(/<tr>\s*<td>/g)?.length ?? 0;
    expect(rows).toBe(startups.length);
    if (startups.length > 250) {
      const first = (await request(app).get('/directory')).text;
      expect(first).toContain('Page 1 of 2');
      expect(first).toContain('href="/directory?page=2">next');
      expect((await request(app).get('/directory?page=3')).status).toBe(404);
    }
  });

  it('is on the site\'s dark ground, with no paper or ochre left', async () => {
    const res = await request(app).get('/directory');
    expect(res.text).toContain('--bg:#0a0e0f');
    expect(res.text).not.toMatch(/Georgia|#c05a2e|#f6f3ec|#d8d2c2/i);
  });
});
