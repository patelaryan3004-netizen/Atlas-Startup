import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import app from '../src/app.js';

const BACKEND = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Every module the public server loads, found by following its imports.
async function importGraph(entry) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const text = await readFile(file, 'utf8');
    for (const m of text.matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const spec = m[1] ?? m[2];
      if (spec.startsWith('.')) queue.push(path.resolve(path.dirname(file), spec));
    }
  }
  return [...seen].map((f) => path.relative(BACKEND, f).replaceAll('\\', '/'));
}

describe('the Command Center is not part of the public app', () => {
  it('is not loaded by the public server: nothing under admin/, enrichment/ or scripts/ is in what `npm start` imports', async () => {
    const graph = await importGraph(path.join(BACKEND, 'src', 'server.js'));
    expect(graph).toContain('src/app.js');
    expect(graph.filter((f) => /^src\/(admin|enrichment|scheduler)\//.test(f) || f.startsWith('scripts/'))).toEqual([]);
    expect(graph.filter((f) => /store\.js|auditTrail|enrichmentQueue|importRuns|refreshState|jobRuns/.test(f))).toEqual([]);
  });

  it('is started only by its own command, and `start` is still the public server', async () => {
    const pkg = JSON.parse(await readFile(path.join(BACKEND, 'package.json'), 'utf8'));
    expect(pkg.scripts.start).toBe('node src/server.js');
    expect(pkg.scripts.admin).toBe('node scripts/admin.js');
    expect(pkg.scripts.dev).toBe('node --watch src/server.js');
  });

  it('answers 404 to every address the Command Center has, and serves none of what it keeps', async () => {
    for (const p of ['/admin', '/admin/', '/app.js', '/styles.css', '/api/admin', '/api/login', '/api/me', '/api/overview', '/api/candidates', '/api/conflicts', '/api/suggestions',
      '/api/queue', '/api/imports', '/api/audit', '/api/job', '/api/missing', '/api/duplicates', '/api/scheduler', '/audit_trail.json', '/enrichment_queue.json', '/import_runs.json',
      '/refresh_state.json', '/job_runs.json', '/src/data/audit_trail.json', '/src/data/job_runs.json', '/src/data/refresh_state.json', '/src/admin/ui/app.js', '/src/scheduler/scheduler.js']) {
      const res = await request(app).get(p);
      expect(res.status, p).toBe(404);
    }
    for (const p of ['/api/login', '/api/queue/run', '/api/queue/seed', '/api/candidates/cand-x/approve']) {
      expect((await request(app).post(p).send({})).status, `POST ${p}`).toBe(404);
    }
  });

  it('puts nothing the pipeline keeps into what the public API serves', async () => {
    const [list, dir] = [await request(app).get('/api/startups'), await request(app).get('/directory')];
    const everything = `${list.text}${dir.text}`;
    expect(everything).not.toMatch(/aud-\d{10}|enq-[a-z0-9-]+-\d|run-\d{10}|jr-\d{10}|rs-company|audit_trail|enrichment_queue|import_runs|refresh_state|job_runs/);
    for (const c of list.body.results) {
      for (const key of ['confidence_score', 'last_verified_at', 'source_ids', 'created_at', 'updated_at']) expect(c, `${c.name} exposes ${key}`).not.toHaveProperty(key);
    }
  });
});

describe('the scheduler is not part of the public app either, and the public app is not part of it', () => {
  it('is not loaded by the public server, and starts only from its own command', async () => {
    const graph = await importGraph(path.join(BACKEND, 'src', 'server.js'));
    expect(graph.filter((f) => f.includes('scheduler') || /refreshState|jobRuns|funding\.js|status\.js/.test(f))).toEqual([]);
    const pkg = JSON.parse(await readFile(path.join(BACKEND, 'package.json'), 'utf8'));
    expect(pkg.scripts.scheduler).toBe('node scripts/scheduler.js');
    expect(pkg.scripts.start).toBe('node src/server.js');
  });

  it('does not load the web framework, the app or the public read model, so a run can never share a process with them', async () => {
    const graph = await importGraph(path.join(BACKEND, 'scripts', 'scheduler.js'));
    expect(graph).toContain('src/scheduler/scheduler.js');
    expect(graph.filter((f) => /^src\/(app|server)\.js$|^src\/(routes|catalog|middleware)\//.test(f))).toEqual([]);
    for (const f of graph) expect(await readFile(path.join(BACKEND, f), 'utf8'), f).not.toMatch(/from\s*['"](?:express|cors|supertest)['"]/);
  });
});
