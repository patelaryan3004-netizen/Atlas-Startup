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
    for (const type of ['feedback', 'feature', 'bug']) {
      const res = await request(app).post('/api/feedback').send({ type, message: `A ${type} report` });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ type, message: `A ${type} report`, status: 'pending' });
      expect(res.body.id).toBeTruthy();
    }

    const stored = JSON.parse(await readFile(DATA_PATH, 'utf-8'));
    expect(stored).toHaveLength(3);
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
