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
  it('says Yes only for a company whose open roles were checked, and Unverified for one flagged as hiring that no page backs', async () => {
    const res = await request(app).get('/directory');
    const checked = startups.filter((c) => c.hiring === true && c.hiring_verified_at != null).length;
    const flagged = startups.filter((c) => c.hiring === true && c.hiring_verified_at == null).length;
    expect(res.text.split('<td>Yes</td>').length - 1).toBe(checked);
    expect(res.text.split('<td>Unverified</td>').length - 1).toBe(flagged);
  });
});
