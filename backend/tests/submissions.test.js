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

beforeEach(reset);
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
  });
});

describe('GET /api/submissions', () => {
  it('lists submissions in insertion order', async () => {
    await request(app).post('/api/submissions').send({ name: 'First', description: 'One' });
    await request(app).post('/api/submissions').send({ name: 'Second', description: 'Two' });

    const res = await request(app).get('/api/submissions');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.results.map((s) => s.name)).toEqual(['First', 'Second']);
  });
});
