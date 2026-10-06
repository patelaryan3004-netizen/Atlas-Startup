import { describe, it, expect, afterEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createAdminService } from '../src/admin/service.js';
import { runDiscovery } from '../src/discovery/pipeline.js';
import { approveCandidate, rejectCandidate } from '../src/discovery/review.js';
import { createFetcher } from '../src/discovery/http.js';
import { loadRaw } from '../src/models/dataset.js';
import { PERMISSIONS } from '../src/admin/roles.js';
import { ForbiddenError, BadRequestError, NotFoundError, ConflictError } from '../src/admin/errors.js';
import { NOW, dataset, lead, fakeSource, fetcherFor, auPage, co } from './helpers/discovery.js';
import { makeDataDir, readDataDir, removeMadeDirs } from './helpers/store.js';

afterEach(removeMadeDirs);

const viewer = { name: 'Sam', role: 'viewer' };
const reviewer = { name: 'Riley', role: 'reviewer' };
const admin = { name: 'Aryan', role: 'admin' };
const T = '2026-10-05T04:00:00.000Z';
const AT = Date.parse('2026-10-06T01:00:00.000Z');

// A directory with something of every kind in it: new candidates, a likely duplicate, an exact match, an
// approved one and a rejected one, evidence in conflict, suggestions, a failed import.
async function build() {
  const { fetcher } = fetcherFor({ 'https://zorbly.com.au/': { body: auPage('Zorbly', { abn: '53004085616' }) }, 'https://xylo.com.au/': { body: auPage('Xylo') } });
  const leads = [
    lead({ key: 'z', name: 'Zorbly', website: 'zorbly.com.au', title: 'Zorbly raises $4m seed', text: 'Zorbly raises $4m seed round. Aussie startup' }),
    lead({ key: 'x', name: 'Xylo', website: 'xylo.com.au', title: 'Xylo raises $2m', text: 'Xylo raises $2m seed round. Aussie startup' }),
    lead({ key: 'l', name: 'Leonardo.Ai', text: 'Aussie startup raises $4m' }), // a likely duplicate of a company
    lead({ key: 'e', name: 'Leonardo.Ai Exact', website: 'https://leonardo.ai' }),
    lead({ key: 'q', name: 'Quill', website: 'quill.example', text: 'Quill raises $1m. Aussie startup' }),
    lead({ key: 'r', name: 'Rumble', website: 'rumble.example', text: 'Rumble raises $1m. Aussie startup' }),
  ];
  const { ds } = await runDiscovery({ ds: dataset(), sources: [fakeSource({ leads })], fetcher, now: () => NOW });
  const work = structuredClone(ds);
  work.companies.find((c) => c.id === 'hex').blurb = ''; // so there is a description for the evidence to suggest
  const id = (name) => work.candidates.find((c) => c.name === name)?.id;
  approveCandidate(work, id('Quill'), { by: 'Riley', at: T });
  rejectCandidate(work, id('Rumble'), { by: 'Riley', reason: 'A hobby project.', at: T });

  // Evidence: a conflict on Acme's founded year, a description suggestion for Hex, a failed import.
  work.sources.push({ id: 'site', kind: 'company_website', url: 'https://acme.com.au/', title: 'Acme', publisher: null, retrieved_at: T, note: '' }, { id: 'press', kind: 'press', url: 'https://news.example/acme', title: 'Press', publisher: null, retrieved_at: T, note: '' });
  const row = (company_id, field, value, source_id) => ({ id: `${company_id}.${field}.${source_id}`, company_id, field, value, source_id, confidence: 'medium', verified_at: T, status: 'active', note: null });
  work.evidence.push(row('acme-robotics', 'founded_year', 2019, 'site'), row('acme-robotics', 'founded_year', 2021, 'press'), { ...row('hex', 'description', 'Hex makes hexes.', 'site'), id: 'hex.description.site' });
  work.import_runs = [{
    id: 'run-20261005040000000', started_at: T, finished_at: T, trigger: 'cli', by: 'Me', dry_run: false, status: 'partial',
    sources: [{ id: 'rss.a', leads: 3, error: null }, { id: 'rss.b', leads: 0, error: 'HTTP 503' }], totals: { new: 1, attached: 0, seen: 0, skipped: 0, applied: 0, requests: 5 }, refused: [], acknowledged: [],
  }];
  const dir = await makeDataDir(work);
  return { dir, id, service: createAdminService({ dir, now: () => AT }) };
}
const trail = async (dir) => (await readDataDir(dir)).audit_trail;
const files = async (dir) => loadRaw(dir);

describe('who may do what, in the service itself', () => {
  // [permission, how to ask for it as a given person]: one entry per action the service has
  const table = (s, id) => [
    ['candidate.approve', (a) => s.approve(a, id('Zorbly'))],
    ['candidate.reject', (a) => s.reject(a, id('Xylo'), { reason: 'Not a startup.' })],
    ['candidate.reopen', (a) => s.reopen(a, id('Rumble'))],
    ['candidate.edit', (a) => s.edit(a, id('Zorbly'), { patch: { city: 'Brisbane' } })],
    ['candidate.note', (a) => s.note(a, id('Zorbly'), { text: 'Worth a look.' })],
    ['candidate.distinct', (a) => s.distinct(a, id('Leonardo.Ai'), { from: 'leonardo-ai' })],
    ['candidate.merge', (a) => s.merge(a, id('Leonardo.Ai'), { into: 'leonardo-ai' })],
    ['candidate.publish', (a) => s.publish(a, id('Quill'))],
    ['conflict.resolve', (a) => s.resolveConflict(a, { company_id: 'acme-robotics', field: 'founded_year', winner: { value: 2019 }, reason: 'Its own site.' })],
    ['suggestion.apply', (a) => s.applySuggestion(a, { company_id: 'hex', field: 'description', value: 'Hex makes hexes.' })],
    ['suggestion.dismiss', (a) => s.dismissSuggestion(a, { company_id: 'hex', field: 'description', value: 'Hex makes hexes.', reason: 'Not accurate.' })],
    ['enrichment.seed', (a) => s.seedQueue(a, {})],
    ['enrichment.enqueue', (a) => s.enqueue(a, { kind: 'company', id: 'acme-robotics' })],
    ['import.dismiss', (a) => s.dismissImport(a, { run_id: 'run-20261005040000000', source_id: 'rss.b', note: 'Their outage.' })],
  ];

  it('refuses every action to a person without the role for it, before anything is read or written, and allows it to one with the role', async () => {
    for (const [permission] of table({}, () => '')) {
      // each case on its own copy of the data, so one action does not change what the next one finds
      const { dir, id, service } = await build();
      const t = table(service, id).find(([p]) => p === permission)[1];
      const before = await files(dir);
      const lowest = PERMISSIONS[permission];
      const below = lowest === 'admin' ? [viewer, reviewer] : [viewer];
      for (const person of below) {
        await expect(Promise.resolve().then(() => t(person)), `${permission} as ${person.role}`).rejects.toBeInstanceOf(ForbiddenError);
      }
      expect(await files(dir), `${permission}: a refusal must change nothing`).toEqual(before);
      await expect(t(lowest === 'admin' ? admin : reviewer), `${permission} as ${lowest}`).resolves.toBeTruthy();
    }
  }, 60000);

  it('has a case here for every permission that changes anything, so a new action cannot be added without being checked', () => {
    const covered = new Set(table({}, () => '').map(([p]) => p));
    const needed = Object.keys(PERMISSIONS).filter((p) => p !== 'read' && p !== 'enrichment.run' && p !== 'enrichment.retry' && p !== 'enrichment.cancel' && p !== 'candidate.enrich');
    expect(needed.filter((p) => !covered.has(p))).toEqual([]);
  });

  it('lets a viewer read everything', async () => {
    const { service } = await build();
    for (const read of ['overview', 'conflicts', 'suggestions', 'queue', 'imports']) await expect(service[read](viewer), read).resolves.toBeTruthy();
    await expect(service.candidates(viewer, {})).resolves.toBeTruthy();
    await expect(service.audit(viewer, {})).resolves.toBeTruthy();
    await expect(service.companies(viewer, 'leo')).resolves.toBeTruthy();
  });

  it('refuses a person who is not signed in as anyone, for a read as well as a change', async () => {
    const { service, id } = await build();
    await expect(service.overview(null)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.approve(undefined, id('Zorbly'))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.approve({ name: 'X', role: 'root' }, id('Zorbly'))).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('every action leaves exactly one audit row, saying who, what, to what and why', () => {
  const only = async (dir, run) => {
    const before = (await trail(dir)).length;
    await run();
    const rows = await trail(dir);
    expect(rows.length - before).toBe(1);
    return rows.at(-1);
  };

  it('for a decision about a candidate', async () => {
    const { dir, id, service } = await build();
    expect(await only(dir, () => service.approve(reviewer, id('Zorbly'), { note: 'Real.' }))).toMatchObject({
      actor: 'Riley', role: 'reviewer', via: 'admin-ui', action: 'candidate.approve', target: { type: 'candidate', id: id('Zorbly') }, reason: 'Real.',
      changes: [{ field: 'status', from: 'needs_review', to: 'approved' }], at: new Date(AT).toISOString(),
    });
    expect(await only(dir, () => service.reject(reviewer, id('Xylo'), { reason: 'Not a startup.' }))).toMatchObject({ action: 'candidate.reject', reason: 'Not a startup.' });
    expect(await only(dir, () => service.reopen(reviewer, id('Rumble')))).toMatchObject({ action: 'candidate.reopen' });
    expect(await only(dir, () => service.note(reviewer, id('Zorbly'), { text: 'Spoke to the founder.' }))).toMatchObject({ action: 'candidate.note', reason: 'Spoke to the founder.' });
    expect(await only(dir, () => service.edit(reviewer, id('Zorbly'), { patch: { city: 'Brisbane', state: 'qld' }, reason: 'Per their site.' }))).toMatchObject({
      action: 'candidate.edit', reason: 'Per their site.', changes: expect.arrayContaining([{ field: 'city', from: expect.anything(), to: 'Brisbane' }, { field: 'state', from: expect.anything(), to: 'QLD' }]),
    });
  });

  it('for what reaches a company: merge, publish, a settled conflict, an applied suggestion', async () => {
    const { dir, id, service } = await build();
    expect(await only(dir, () => service.merge(admin, id('Leonardo.Ai Exact'), { into: 'leonardo-ai' }))).toMatchObject({ action: 'candidate.merge', actor: 'Aryan', role: 'admin' });
    expect(await only(dir, () => service.publish(admin, id('Quill')))).toMatchObject({ action: 'candidate.publish', summary: expect.stringMatching(/Published Quill as quill.*unconfirmed location/) });
    expect(await only(dir, () => service.resolveConflict(admin, { company_id: 'acme-robotics', field: 'founded_year', winner: { value: 2019 }, reason: 'Its own site.' }))).toMatchObject({
      action: 'conflict.resolve', target: { type: 'company', id: 'acme-robotics' }, reason: 'Its own site.', changes: [{ field: 'foundedYear', from: null, to: 2019 }],
    });
    expect(await only(dir, () => service.applySuggestion(admin, { company_id: 'hex', field: 'description', value: 'Hex makes hexes.' }))).toMatchObject({ action: 'suggestion.apply', changes: [{ field: 'blurb', from: '', to: 'Hex makes hexes.' }] });
  });

  it('for the queue and the imports', async () => {
    const { dir, service } = await build();
    expect(await only(dir, () => service.seedQueue(admin, { limit: 2 }))).toMatchObject({ action: 'enrichment.seed', target: { type: 'queue', id: 'enrichment' } });
    const task = (await readDataDir(dir)).enrichment_queue.find((t) => t.status === 'queued');
    expect(await only(dir, () => service.cancelTask(reviewer, task.id))).toMatchObject({ action: 'enrichment.cancel', target: { type: 'queue', id: task.id } });
    expect(await only(dir, () => service.retryTask(reviewer, task.id))).toMatchObject({ action: 'enrichment.retry' });
    expect(await only(dir, () => service.dismissImport(reviewer, { run_id: 'run-20261005040000000', source_id: 'rss.b', note: 'Their outage.' }))).toMatchObject({ action: 'import.dismiss', reason: 'Their outage.', target: { type: 'import_run', id: 'run-20261005040000000' } });
  });

  it('and none at all for an action a rule refused: nothing is written, the audit trail included', async () => {
    const { dir, id, service } = await build();
    const before = await files(dir);
    const refused = [
      () => service.approve(reviewer, id('Leonardo.Ai')), // a possible duplicate is unsettled
      () => service.approve(reviewer, id('Rumble')), // rejected
      () => service.reject(reviewer, id('Xylo'), { reason: '' }),
      () => service.publish(admin, id('Xylo')), // not approved
      () => service.merge(admin, id('Xylo'), { into: 'no-such-company' }),
      () => service.resolveConflict(admin, { company_id: 'acme-robotics', field: 'founded_year', winner: { value: 1999 }, reason: 'Because.' }),
      () => service.applySuggestion(admin, { company_id: 'hex', field: 'description', value: 'Not what the evidence says.' }),
      () => service.edit(reviewer, id('Zorbly'), { patch: {} }),
      () => service.edit(reviewer, id('Zorbly'), { patch: { status: 'approved' } }),
      () => service.note(reviewer, id('Zorbly'), { text: '' }),
      () => service.dismissImport(reviewer, { run_id: 'run-20261005040000000', source_id: 'rss.a', note: 'It did not fail.' }),
    ];
    for (const run of refused) await expect(run()).rejects.toBeTruthy();
    expect(await files(dir)).toEqual(before);
  });

  it('naming the person from the sign-in, never from anything in the request', async () => {
    const { dir, id, service } = await build();
    await service.approve(reviewer, id('Zorbly'), { by: 'Somebody Else', actor: { name: 'The Boss', role: 'admin' }, role: 'admin', note: 'fine' });
    const row = (await trail(dir)).at(-1);
    expect(row).toMatchObject({ actor: 'Riley', role: 'reviewer' });
    expect((await readDataDir(dir)).candidates.find((c) => c.id === id('Zorbly')).review.by).toBe('Riley');
  });
});

describe('what an action does beyond the one thing', () => {
  it('approving a candidate whose website has not been read queues it; publishing queues the new company ahead of everything', async () => {
    const { dir, id, service } = await build();
    await service.seedQueue(admin, {});
    const approved = await service.approve(reviewer, id('Xylo'));
    expect(approved).toMatchObject({ status: 'approved' });
    const published = await service.publish(admin, id('Quill'), { location: { city: 'Melbourne', lat: -37.8, lng: 144.96 } });
    expect(published).toMatchObject({ on_map: true, company_id: 'quill' });
    const queue = (await readDataDir(dir)).enrichment_queue;
    const quill = queue.find((t) => t.target_id === 'quill');
    expect(quill).toMatchObject({ kind: 'company', reason: 'published' });
    expect(quill.priority).toBe(Math.max(...queue.map((t) => t.priority)));
  });

  it('a conflict settled for the Forward case takes the company off the map and keeps the true claim', async () => {
    const dir = await makeDataDir(structuredClone({
      ...dataset([co('Forward', { city: 'Sydney' })]),
      sources: [{ id: 'site', kind: 'company_website', url: 'https://f.example/', title: 'F', publisher: null, retrieved_at: T, note: '' }, { id: 'yc', kind: 'accelerator_profile', url: 'https://yc.example/f', title: 'YC', publisher: null, retrieved_at: T, note: '' }],
      evidence: [
        { id: 'forward.city.site', company_id: 'forward', field: 'city', value: 'Sydney', source_id: 'site', confidence: 'medium', verified_at: T, status: 'active', note: null },
        { id: 'forward.city.yc', company_id: 'forward', field: 'city', value: 'San Francisco', source_id: 'yc', confidence: 'high', verified_at: T, status: 'active', note: null },
      ],
    }));
    const service = createAdminService({ dir, now: () => AT });
    expect((await service.conflicts(viewer)).map((c) => [c.company_id, c.field, c.sides.length])).toEqual([['forward', 'city', 2]]);
    await service.resolveConflict(admin, { company_id: 'forward', field: 'city', winner: { value: 'San Francisco' }, record: { type: 'unconfirm' }, reason: 'YC says San Francisco.' });
    const ds = await readDataDir(dir);
    expect(ds.companies[0]).toMatchObject({ verified: false, city: 'Unknown', lat: null });
    expect(ds.evidence.map((e) => [e.value, e.status]).sort()).toEqual([['San Francisco', 'active'], ['Sydney', 'rejected']]);
    expect(await service.conflicts(viewer)).toEqual([]);
  });

  it('two people deciding at once both get their decision in, in turn', async () => {
    const { dir, id, service } = await build();
    await Promise.all([service.approve(reviewer, id('Zorbly')), service.reject(reviewer, id('Xylo'), { reason: 'Not a startup.' }), service.note(viewer.role === 'viewer' ? reviewer : reviewer, id('Quill'), { text: 'x1' })]);
    const ds = await readDataDir(dir);
    expect(ds.candidates.find((c) => c.id === id('Zorbly')).status).toBe('approved');
    expect(ds.candidates.find((c) => c.id === id('Xylo')).status).toBe('rejected');
    expect(ds.audit_trail).toHaveLength(3);
    expect(new Set(ds.audit_trail.map((r) => r.id)).size).toBe(3);
  });
});

describe('what the dashboard shows', () => {
  it('counts the eight headline numbers from the data, and says what each one covers', async () => {
    const { service } = await build();
    const o = await service.overview(viewer);
    expect(o.tiles).toMatchObject({
      total_companies: 4, published: 4, needs_review: 3, // Zorbly, Xylo and the likely duplicate: the exact match is 'matched', not waiting for review
      new_candidates: 5, // found in the last 7 days and still open: everything but the rejected one
      failed_imports: 1, updated_this_week: 2, // the two companies that have just had evidence checked
    });
    expect(o.tiles.potential_duplicates).toBeGreaterThanOrEqual(2); // the likely duplicate and the exact match
    expect(o.detail).toMatchObject({ published: { on_map: 4, unconfirmed: 0 }, failed_imports: { sources: 1, enrichment_tasks: 0 } });
    expect(o.quality.map((q) => q.key)).toEqual(['website', 'sector', 'location', 'stage', 'founders', 'funding', 'investors']);
    expect(o.quality.find((q) => q.key === 'website')).toMatchObject({ total: 4, present: expect.any(Number), pct: expect.any(Number) });
    expect(o.attention).toMatchObject({ open_conflicts: 1, suggestions: 1 });
  });

  it('offers the sectors and stages the directory already uses, most used first, and never "Unknown" or a lifecycle note', async () => {
    const dir = await makeDataDir(dataset([
      co('A', { sector: 'Fintech' }), co('B', { sector: 'Fintech' }), co('F', { sector: 'Fintech' }), // three
      co('C', { stage: 'Acquired' }), co('E', { stage: 'Defunct (in liquidation)' }), // AI twice: not stages to choose
      co('D', { sector: 'Unknown', stage: 'Unknown' }),
    ]));
    const { vocab } = await createAdminService({ dir, now: () => AT }).overview(viewer);
    expect(vocab.sectors).toEqual(['Fintech', 'AI']);
    expect(vocab.stages).toEqual(['Seed']);
  });

  it('lists the new startups discovered with what a person needs: company, source, location, sector, confidence, date, and the actions open to them', async () => {
    const { service, id } = await build();
    const r = await service.candidates(viewer, { status: 'open' });
    const zorbly = r.results.find((c) => c.id === id('Zorbly'));
    expect(zorbly).toMatchObject({
      name: 'Zorbly', status: 'needs_review', resolution: 'NEW_COMPANY', source: { id: 'test.feed', count: 1 }, location: expect.stringMatching(/5 Collins Street, Melbourne VIC 3000/),
      sector: null, confidence: { label: expect.any(String), score: expect.any(Number) }, discovered_at: expect.stringMatching(/^2026-10-05/), actions: ['approve', 'reject', 'edit', 'merge', 'enrich'],
    });
    const dup = r.results.find((c) => c.id === id('Leonardo.Ai'));
    expect(dup.actions).toEqual(['distinct', 'merge', 'reject', 'edit', 'enrich']);
    expect(dup.match).toMatchObject({ kind: 'company', id: 'leonardo-ai' });
    expect(r.results.find((c) => c.id === id('Quill')).actions).toEqual(['publish', 'reject', 'edit', 'reopen', 'enrich']);
    expect(r.results.some((c) => c.id === id('Rumble'))).toBe(false); // rejected: not in the open list
    expect((await service.candidates(viewer, { status: 'rejected' })).results.map((c) => c.id)).toEqual([id('Rumble')]);
    expect((await service.candidates(viewer, { status: 'rejected' })).results[0].actions).toEqual(['reopen']);
  });

  it('filters, searches by name and website, and counts each filter', async () => {
    const { service, id } = await build();
    expect((await service.candidates(viewer, { status: 'duplicates' })).results.map((c) => c.id).sort()).toEqual([id('Leonardo.Ai'), id('Leonardo.Ai Exact')].sort());
    expect((await service.candidates(viewer, { status: 'all', q: 'zorb' })).results.map((c) => c.name)).toEqual(['Zorbly']);
    expect((await service.candidates(viewer, { status: 'all', q: 'xylo.com.au' })).results.map((c) => c.name)).toEqual(['Xylo']);
    const counts = (await service.candidates(viewer, {})).counts;
    expect(counts).toMatchObject({ all: 6, open: 5, needs_review: 3, duplicates: 2 });
  });

  it('shows one candidate in full: evidence with its sources, the reasons for a match, the notes and the history', async () => {
    const { service, id } = await build();
    const c = await service.candidate(viewer, id('Zorbly'));
    expect(c).toMatchObject({ name: 'Zorbly', website: 'https://zorbly.com.au', external_ids: { abn: '53004085616' }, status_history: expect.any(Array), notes: expect.any(Array) });
    expect(c.evidence.map((e) => e.field)).toEqual(expect.arrayContaining(['website', 'address', 'founded_year']));
    expect(c.evidence.find((e) => e.field === 'website').source).toMatchObject({ kind: 'company_website', url: 'https://zorbly.com.au/' });
    await expect(service.candidate(viewer, 'cand-nobody')).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.candidate(viewer, '../../etc/passwd')).rejects.toBeInstanceOf(BadRequestError);
  });

  it('shows each conflict with every side and where it came from, and each suggestion with its evidence', async () => {
    const { service } = await build();
    const [conflict] = await service.conflicts(viewer);
    expect(conflict).toMatchObject({ company_id: 'acme-robotics', field: 'founded_year', kind: 'sources_disagree', location: false });
    expect(conflict.sides.map((s) => s.value).sort()).toEqual([2019, 2021]);
    expect(conflict.sides[0].evidence[0].source).toMatchObject({ title: expect.any(String), url: expect.stringMatching(/^https/) });
    const [suggestion] = await service.suggestions(viewer);
    expect(suggestion).toMatchObject({ company_id: 'hex', field: 'description', value: 'Hex makes hexes.' });
    expect(suggestion.evidence[0].source.url).toBe('https://acme.com.au/');
  });

  it('searches companies for a merge, by name, and not for one character', async () => {
    const { service } = await build();
    expect((await service.companies(viewer, 'leon')).map((c) => c.id)).toEqual(['leonardo-ai']);
    expect(await service.companies(viewer, 'l')).toEqual([]);
  });

  it('leads from MISSING DATA to the companies behind the number, saying what each one lacks', async () => {
    const { service } = await build();
    const [o, m] = [await service.overview(viewer), await service.missing(viewer)];
    expect(m.total).toBe(o.tiles.missing_data); // one definition: the tile and the list cannot disagree
    expect(m.results.every((r) => r.missing.length > 0 && r.missing.every((k) => ['website', 'sector', 'location', 'stage', 'description'].includes(k)))).toBe(true);
    expect(m.results.find((r) => r.id === 'hex')).toMatchObject({ name: 'Hex', missing: expect.arrayContaining(['website', 'description']), enrichment: null });
    expect(m.counts.website).toBe(m.results.filter((r) => r.missing.includes('website')).length);
    const sizes = m.results.map((r) => r.missing.length);
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a)); // the most incomplete first
  });

  it('says whether a company that lacks something is already waiting to have its website read', async () => {
    const unknown = { sector: 'Unknown', sectorFull: 'Unknown' };
    const dir = await makeDataDir(dataset([co('Blank', { ...unknown, website: 'https://blank.example' }), co('Bare', unknown), co('Whole', { website: 'https://whole.example' })]));
    const service = createAdminService({ dir, now: () => AT });
    const before = await service.missing(viewer);
    expect(before.results.map((r) => [r.id, r.missing])).toEqual([['bare', ['website', 'sector']], ['blank', ['sector']]]); // the most incomplete first; the whole one is not listed
    expect(before.results.find((r) => r.id === 'blank').enrichment).toBeNull();
    await service.enqueue(reviewer, { kind: 'company', id: 'blank' });
    expect((await service.missing(viewer)).results.find((r) => r.id === 'blank').enrichment).toMatchObject({ status: 'queued', outcome: null });
  });

  it('leads from POTENTIAL DUPLICATES to the pairs of published companies that look alike', async () => {
    const dir = await makeDataDir(dataset([co('Acme', { website: 'https://acme.com.au' }), co('Acme Robotics', { website: 'https://acme.com.au/about' }), co('Zed', { website: 'https://zed.example' })]));
    const service = createAdminService({ dir, now: () => AT });
    expect(await service.duplicates(viewer)).toEqual([{ reason: 'same website domain', names: ['Acme', 'Acme Robotics'], company_ids: ['acme', 'acme-robotics'] }]);
    expect((await service.overview(viewer)).detail.potential_duplicates.company_pairs).toBe(1);
  });

  it('shows the audit trail newest first, filtered by who or by what', async () => {
    const { service, id } = await build();
    await service.approve(reviewer, id('Zorbly'));
    await service.reject(admin, id('Xylo'), { reason: 'Not a startup.' });
    const all = await service.audit(viewer, {});
    expect(all.results.map((r) => r.action)).toEqual(['candidate.reject', 'candidate.approve']);
    expect((await service.audit(viewer, { actor: 'Riley' })).results.map((r) => r.actor)).toEqual(['Riley']);
    expect((await service.audit(viewer, { action: 'candidate' })).total).toBe(2);
    expect((await service.audit(viewer, { target: id('Xylo') })).results).toHaveLength(1);
  });
});

describe('reading websites in the background', () => {
  const html = (body) => ({ body, headers: { 'content-type': 'text/html' } });
  async function withSite() {
    const dir = await makeDataDir(dataset([co('Acme Robotics', { website: 'https://acme.com.au', blurb: '' })]));
    const routes = { 'https://acme.com.au/': html(auPage('Acme Robotics')) };
    const gate = { release: null, started: null };
    const fetcherFactory = () => createFetcher({
      fetchImpl: async (u) => { if (gate.started && !u.endsWith('robots.txt')) { gate.started(); await new Promise((r) => { gate.release = r; }); } const hit = routes[u]; return hit ? new Response(hit.body, { status: 200, headers: hit.headers }) : new Response('nope', { status: 404, headers: { 'content-type': 'text/html' } }); },
      resolveHost: async () => ['93.184.216.34'], sleep: async () => {}, now: () => NOW,
    });
    const service = createAdminService({ dir, now: () => AT, fetcherFactory });
    await service.seedQueue(admin, {});
    return { dir, service, gate };
  }

  it('starts, returns at once, shows its progress, and records the run in the audit trail', async () => {
    const { dir, service } = await withSite();
    const job = service.startEnrichmentRun(admin, { concurrency: 1 });
    expect(job).toMatchObject({ kind: 'enrichment', state: 'running', by: 'Aryan' });
    await service.jobs.idle();
    expect(service.job(viewer)).toMatchObject({ state: 'done', progress: { claimed: 1, done: 1, failed: 0 }, log: expect.arrayContaining([expect.stringMatching(/suggest mode/), expect.stringMatching(/done acme-robotics/)]) });
    const ds = await readDataDir(dir);
    expect(ds.evidence.some((e) => e.company_id === 'acme-robotics')).toBe(true);
    expect(ds.companies[0].blurb).toBe(''); // suggest mode changed no company
    expect(ds.audit_trail.at(-1)).toMatchObject({ action: 'enrichment.run', actor: 'Aryan', role: 'admin', summary: expect.stringMatching(/suggest mode: 1 read/) });
  });

  it('refuses a second run while one is going, can be stopped, and is for admins only', async () => {
    const { service, gate } = await withSite();
    expect(() => service.startEnrichmentRun(reviewer, {})).toThrow(ForbiddenError);
    const started = new Promise((r) => { gate.started = r; });
    service.startEnrichmentRun(admin, { concurrency: 1 });
    await started;
    expect(() => service.startEnrichmentRun(admin, {})).toThrow(ConflictError);
    expect(service.stopEnrichmentRun(admin)).toMatchObject({ stopping: true });
    gate.started = null;
    gate.release();
    await service.jobs.idle();
    expect(service.job(viewer).state).toBe('stopped');
    expect(() => service.stopEnrichmentRun(reviewer)).toThrow(ForbiddenError);
  });

  it('checks what it is asked for: the mode, the concurrency and the limit', async () => {
    const { service } = await withSite();
    expect(() => service.startEnrichmentRun(admin, { mode: 'yolo' })).toThrow(/mode must be one of suggest, fill/);
    expect(() => service.startEnrichmentRun(admin, { concurrency: 50 })).toThrow(/concurrency must be from 1 to 6/);
    expect(() => service.startEnrichmentRun(admin, { limit: 0 })).toThrow(/limit must be a number from 1/);
  });

  it('can fill when told to, and says so in the run it records', async () => {
    const { dir, service } = await withSite();
    service.startEnrichmentRun(admin, { mode: 'fill', concurrency: 1 });
    await service.jobs.idle();
    expect((await readDataDir(dir)).companies[0].blurb).toBe('Acme Robotics makes things.');
    expect((await trail(dir)).at(-1).summary).toMatch(/fill mode.*field\(s\) filled/);
  });
});

describe('the data it reads', () => {
  it('is the data on disk now: a change from anywhere else shows at once', async () => {
    const { dir, service, id } = await build();
    const { service: other } = { service: createAdminService({ dir, now: () => AT }) };
    await other.approve(reviewer, id('Zorbly'));
    expect((await service.candidates(viewer, { status: 'approved' })).results.map((c) => c.name).sort()).toEqual(['Quill', 'Zorbly']);
    expect(await readFile(path.join(dir, 'candidates.json'), 'utf8')).toContain('approved');
  });
});
