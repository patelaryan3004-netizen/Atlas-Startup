import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import request from 'supertest';
import app from '../src/app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, '..', 'src', 'data', 'editSuggestions.json');

async function reset() {
  await writeFile(DATA_PATH, '[]\n', 'utf-8');
}

beforeEach(reset);
afterAll(reset);

describe('POST /api/edits', () => {
  it('rejects a suggestion missing company or message', async () => {
    const res = await request(app).post('/api/edits').send({ company: 'Canva' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/);
  });

  it('rejects blank/whitespace-only fields', async () => {
    const res = await request(app).post('/api/edits').send({ company: '  ', message: 'wrong city' });
    expect(res.status).toBe(400);
  });

  it('accepts a valid edit suggestion and persists it as pending', async () => {
    const res = await request(app).post('/api/edits').send({
      company: 'Canva',
      message: 'Address is out of date, they moved offices.',
      email: 'tipster@example.com',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      company: 'Canva',
      message: 'Address is out of date, they moved offices.',
      status: 'pending',
    });
    expect(res.body.id).toBeTruthy();

    const stored = JSON.parse(await readFile(DATA_PATH, 'utf-8'));
    expect(stored).toHaveLength(1);
    expect(stored[0].company).toBe('Canva');
  });

  it('defaults email to an empty string when omitted', async () => {
    const res = await request(app).post('/api/edits').send({ company: 'Canva', message: 'Logo is wrong' });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe('');
  });
});

describe('GET /api/edits', () => {
  it('lists submitted edit suggestions', async () => {
    await request(app).post('/api/edits').send({ company: 'A', message: 'One' });
    await request(app).post('/api/edits').send({ company: 'B', message: 'Two' });

    const res = await request(app).get('/api/edits');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.results.map((e) => e.company)).toEqual(['A', 'B']);
  });
});
