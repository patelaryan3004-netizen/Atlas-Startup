import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import request from 'supertest';
import app from '../src/app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, '..', 'src', 'data', 'feedback.json');

async function reset() {
  await writeFile(DATA_PATH, '[]\n', 'utf-8');
}

const ADMIN_KEY = 'test-admin-key';

beforeEach(() => {
  process.env.ADMIN_KEY = ADMIN_KEY;
  return reset();
});
afterAll(reset);

describe('POST /api/feedback', () => {
  it('rejects an invalid or missing type', async () => {
    const res = await request(app).post('/api/feedback').send({ type: 'complaint', message: 'hi' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/type must be one of/);
  });

  it('rejects a missing or blank message', async () => {
    const res = await request(app).post('/api/feedback').send({ type: 'bug', message: '  ' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/message is required/);
  });

  it('accepts each valid type and persists it as pending', async () => {
    for (const type of ['feedback', 'feature', 'bug', 'investor']) {
      const res = await request(app).post('/api/feedback').send({ type, message: `A ${type} report` });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ type, message: `A ${type} report`, status: 'pending' });
      expect(res.body.id).toBeTruthy();
    }

    const stored = JSON.parse(await readFile(DATA_PATH, 'utf-8'));
    expect(stored).toHaveLength(4);
  });

  it('defaults email to an empty string when omitted', async () => {
    const res = await request(app).post('/api/feedback').send({ type: 'feature', message: 'Add dark mode' });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe('');
  });
});

describe('GET /api/feedback', () => {
  it('rejects a request with no admin key', async () => {
    const res = await request(app).get('/api/feedback');
    expect(res.status).toBe(401);
  });

  it('lists submitted feedback for a request with the right admin key', async () => {
    await request(app).post('/api/feedback').send({ type: 'bug', message: 'One' });
    await request(app).post('/api/feedback').send({ type: 'feature', message: 'Two' });

    const res = await request(app).get('/api/feedback').set('x-admin-key', ADMIN_KEY);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.results.map((f) => f.message)).toEqual(['One', 'Two']);
  });
});

describe('GET /api/feedback pages by cursor', () => {
  const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: `f-${i}`, type: 'bug', message: 'm', status: 'pending' }));
  const get = (query = '') => request(app).get(`/api/feedback${query}`).set('x-admin-key', ADMIN_KEY);

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
    expect((await request(app).get(`/api/feedback?limit=5`)).status).toBe(401); // paging does not open the queue
  });
});
