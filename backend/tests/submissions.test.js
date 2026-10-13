import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import request from 'supertest';
import app from '../src/app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, '..', 'src', 'data', 'submissions.json');

async function reset() {
  await writeFile(DATA_PATH, '[]\n', 'utf-8');
}

const ADMIN_KEY = 'test-admin-key';

beforeEach(() => {
  process.env.ADMIN_KEY = ADMIN_KEY;
  return reset();
});
afterAll(reset);

describe('POST /api/submissions', () => {
  it('rejects a submission missing name or description', async () => {
    const res = await request(app).post('/api/submissions').send({ name: 'Acme' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/);
  });

  it('rejects blank/whitespace-only fields', async () => {
    const res = await request(app).post('/api/submissions').send({ name: '   ', description: 'Does things' });
    expect(res.status).toBe(400);
  });

  it('accepts a valid submission and persists it', async () => {
    const res = await request(app).post('/api/submissions').send({
      name: 'Acme Startup',
      description: 'Does things for people',
      website: 'https://acme.example',
      stage: 'Seed',
      email: 'founder@acme.example',
      hiringUrl: 'https://acme.example/careers',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: 'Acme Startup',
      description: 'Does things for people',
      status: 'pending',
    });
    expect(res.body.id).toBeTruthy();
    expect(res.body.submittedAt).toBeTruthy();

    const stored = JSON.parse(await readFile(DATA_PATH, 'utf-8'));
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe('Acme Startup');
  });

  it('defaults optional fields to empty strings', async () => {
    const res = await request(app).post('/api/submissions').send({ name: 'Bare Co', description: 'Minimal info' });
    expect(res.status).toBe(201);
    expect(res.body.website).toBe('');
    expect(res.body.stage).toBe('');
    expect(res.body.email).toBe('');
    expect(res.body.hiringUrl).toBe('');
    expect(res.body).toMatchObject({ city: '', role: '', claim: '' });
  });

  it('keeps the city, the role and the wish to claim the profile, trimmed', async () => {
    const res = await request(app).post('/api/submissions').send({
      name: 'Acme', description: 'Does things', city: '  Melbourne ', role: ' Founder ', claim: 'Yes',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ city: 'Melbourne', role: 'Founder', claim: 'yes' });
    const stored = JSON.parse(await readFile(DATA_PATH, 'utf-8'));
    expect(stored[0]).toMatchObject({ city: 'Melbourne', role: 'Founder', claim: 'yes' });
  });

  it('leaves the claim empty unless it is a yes or a no, and drops anything that is not text, rather than refusing the submission', async () => {
    const odd = await request(app).post('/api/submissions').send({ name: 'Acme', description: 'Does things', claim: 'maybe', city: 42, role: { a: 1 } });
    expect(odd.status).toBe(201);
    expect(odd.body).toMatchObject({ city: '', role: '', claim: '' });
    const no = await request(app).post('/api/submissions').send({ name: 'Beta', description: 'Does more', claim: 'no' });
    expect(no.body.claim).toBe('no');
  });

  it('cuts a very long city or role to 200 characters', async () => {
    const res = await request(app).post('/api/submissions').send({ name: 'Acme', description: 'Does things', city: 'x'.repeat(500), role: 'y'.repeat(500) });
    expect(res.body.city).toHaveLength(200);
    expect(res.body.role).toHaveLength(200);
  });
});

describe('GET /api/submissions', () => {
  it('rejects a request with no admin key', async () => {
    const res = await request(app).get('/api/submissions');
    expect(res.status).toBe(401);
  });

  it('rejects a request with the wrong admin key', async () => {
    const res = await request(app).get('/api/submissions').set('x-admin-key', 'wrong');
    expect(res.status).toBe(401);
  });

  it('lists submissions in insertion order for a request with the right admin key', async () => {
    await request(app).post('/api/submissions').send({ name: 'First', description: 'One' });
    await request(app).post('/api/submissions').send({ name: 'Second', description: 'Two' });

    const res = await request(app).get('/api/submissions').set('x-admin-key', ADMIN_KEY);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.results.map((s) => s.name)).toEqual(['First', 'Second']);
  });
});

describe('GET /api/submissions pages by cursor', () => {
  const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: `s-${i}`, name: `Co ${i}`, description: 'd', status: 'pending' }));
  const get = (query = '') => request(app).get(`/api/submissions${query}`).set('x-admin-key', ADMIN_KEY);

  it('gives 20 at a time, oldest first, each row once, until the last page says there is no more', async () => {
    await writeFile(DATA_PATH, `${JSON.stringify(rows(45))}
`);
    const first = await get();
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ count: 45, limit: 20, hasMore: true });
    expect(first.body.results.map((r) => r.id)).toEqual(rows(45).slice(0, 20).map((r) => r.id));
    const seen = [...first.body.results];
    let next = first.body.nextCursor;
    let pages = 1;
    while (next) {
      const res = await get(`?cursor=${next}`);
      seen.push(...res.body.results);
      next = res.body.nextCursor;
      pages += 1;
      if (!next) expect(res.body.hasMore).toBe(false);
    }
    expect(pages).toBe(3);
    expect(seen.map((r) => r.id)).toEqual(rows(45).map((r) => r.id));
  });

  it('is not moved by a row added while someone reads: the next page still starts after the last row seen', async () => {
    await writeFile(DATA_PATH, `${JSON.stringify(rows(30))}
`);
    const first = await get('?limit=10');
    await writeFile(DATA_PATH, `${JSON.stringify(rows(31))}
`);
    const second = await get(`?limit=10&cursor=${first.body.nextCursor}`);
    expect(second.body.results.map((r) => r.id)).toEqual(rows(31).slice(10, 20).map((r) => r.id));
  });

  it('takes a limit up to 100, and refuses 0, 101, text, and a cursor that names no row', async () => {
    await writeFile(DATA_PATH, `${JSON.stringify(rows(120))}
`);
    expect((await get('?limit=100')).body.results).toHaveLength(100);
    for (const q of ['?limit=0', '?limit=101', '?limit=abc', '?cursor=bm9wZQ', '?cursor=']) expect((await get(q)).status, q).toBe(400);
    expect((await request(app).get(`/api/submissions?limit=5`)).status).toBe(401); // paging does not open the queue
  });
});
