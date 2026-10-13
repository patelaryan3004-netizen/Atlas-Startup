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

describe('GET /directory, who is hiring', () => {
  it('says Yes only for a company whose open roles a page confirmed lately, gives an earlier reading its date, and never says No for what nobody read', async () => {
    const res = await request(app).get('/directory');
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
    const res = await request(app).get('/directory');
    const dead = startups.filter((c) => c.website_status === 'unavailable');
    expect(dead.length).toBeGreaterThan(0);
    expect(res.text.split('Website unavailable').length - 1).toBe(dead.length);
    for (const c of dead) expect(res.text, `${c.name}'s dead address is still linked`).not.toContain(`href="${c.website}"`);
  });

  it('is on the site\'s dark ground, with no paper or ochre left', async () => {
    const res = await request(app).get('/directory');
    expect(res.text).toContain('--bg:#0a0e0f');
    expect(res.text).not.toMatch(/Georgia|#c05a2e|#f6f3ec|#d8d2c2/i);
  });
});
