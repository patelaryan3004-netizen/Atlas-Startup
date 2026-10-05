import { describe, it, expect } from 'vitest';
import {
  enqueueTask, claimNext, finishTask, failTask, cancelTask, requeueTask, recoverExpired, seedFromAudit, queueSummary, validateEnrichmentQueue,
  MAX_ATTEMPTS, BACKOFF_MS, LEASE_MS, PRIORITY,
} from '../src/models/enrichmentQueue.js';
import { auditDataset } from '../src/models/audit.js';
import { dataset, co } from './helpers/discovery.js';

const T = (min) => new Date(Date.parse('2026-10-06T00:00:00.000Z') + min * 60000).toISOString();
const base = () => dataset([co('Alpha', { website: 'https://alpha.example' }), co('Beta', { website: 'https://beta.example' }), co('Gamma')]);
const queue = (...tasks) => ({ ...base(), enrichment_queue: tasks });
const add = (work, targetId, over = {}) => enqueueTask(work, { kind: 'company', targetId, by: 'aryan', at: T(0), ...over }).task;

describe('queueing work', () => {
  it('creates one waiting task per company, and a second request only raises its priority and widens what it wants', () => {
    const work = base();
    const first = enqueueTask(work, { kind: 'company', targetId: 'alpha', by: 'aryan', at: T(0), priority: 100, wanted: ['description'] });
    const second = enqueueTask(work, { kind: 'company', targetId: 'alpha', by: 'aryan', at: T(1), priority: 900, wanted: ['founders', 'description'] });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(work.enrichment_queue).toHaveLength(1);
    expect(work.enrichment_queue[0]).toMatchObject({ id: 'enq-alpha-1', status: 'queued', priority: 900, wanted: ['description', 'founders'], attempts: 0, finished_at: null });
  });

  it('allows a new task once the last one is finished', () => {
    const work = base();
    const t = add(work, 'alpha');
    claimNext(work, { at: T(1) });
    finishTask(work, t.id, { at: T(2), result: { outcome: 'read' } });
    expect(enqueueTask(work, { kind: 'company', targetId: 'alpha', by: 'aryan', at: T(3) })).toMatchObject({ created: true, task: { id: 'enq-alpha-2' } });
  });
});

describe('taking the next task', () => {
  it('takes the highest priority first, then the oldest, and marks it running with a lease', () => {
    const work = base();
    add(work, 'alpha', { priority: 100, at: T(0) });
    add(work, 'beta', { priority: 900, at: T(5) });
    add(work, 'gamma', { priority: 900, at: T(2) });
    const order = [1, 2, 3].map((n) => claimNext(work, { at: T(10 + n) }).target_id);
    expect(order).toEqual(['gamma', 'beta', 'alpha']);
    expect(claimNext(work, { at: T(20) })).toBeNull();
    expect(work.enrichment_queue.find((t) => t.target_id === 'gamma')).toMatchObject({ status: 'running', started_at: T(11), lease_until: T(11 + LEASE_MS / 60000) });
  });

  it('leaves a task backing off until its time, and does not take a running one twice', () => {
    const work = base();
    const t = add(work, 'alpha');
    t.not_before = T(30);
    expect(claimNext(work, { at: T(10) })).toBeNull();
    expect(claimNext(work, { at: T(31) }).id).toBe(t.id);
    expect(claimNext(work, { at: T(32) })).toBeNull();
  });

  it('can take only one kind of task', () => {
    const work = { ...base(), candidates: [] };
    add(work, 'alpha');
    expect(claimNext(work, { at: T(1), kinds: ['candidate'] })).toBeNull();
    expect(claimNext(work, { at: T(1), kinds: ['company'] }).target_id).toBe('alpha');
  });
});

describe('finishing, failing and recovering', () => {
  it('records what a finished task found, and that it is done', () => {
    const work = base();
    const t = add(work, 'alpha');
    claimNext(work, { at: T(1) });
    finishTask(work, t.id, { at: T(2), result: { outcome: 'read', applied: ['description'] } });
    expect(t).toMatchObject({ status: 'done', finished_at: T(2), lease_until: null, result: { outcome: 'read', applied: ['description'] } });
  });

  it('puts a task that failed for a transient reason back with a growing back-off, and gives up after the last attempt', () => {
    const work = base();
    const t = add(work, 'alpha');
    for (let n = 1; n < MAX_ATTEMPTS; n += 1) {
      claimNext(work, { at: T(n * 1000) });
      failTask(work, t.id, { at: T(n * 1000), error: 'timeout' });
      expect(t).toMatchObject({ status: 'queued', attempts: n, last_error: 'timeout', not_before: new Date(Date.parse(T(n * 1000)) + BACKOFF_MS[n - 1]).toISOString() });
      t.not_before = null; // as if the back-off had passed
    }
    claimNext(work, { at: T(9000) });
    failTask(work, t.id, { at: T(9000), error: 'timeout' });
    expect(t).toMatchObject({ status: 'failed', attempts: MAX_ATTEMPTS, finished_at: T(9000) });
  });

  it('fails at once for a reason a retry cannot fix', () => {
    const work = base();
    const t = add(work, 'alpha');
    claimNext(work, { at: T(1) });
    failTask(work, t.id, { at: T(1), error: 'a bug', retryable: false });
    expect(t.status).toBe('failed');
  });

  it('counts a task whose worker died as a failed attempt, once its lease runs out', () => {
    const work = base();
    const t = add(work, 'alpha');
    claimNext(work, { at: T(0) });
    expect(recoverExpired(work, T(10))).toEqual([]); // the lease is 15 minutes
    expect(recoverExpired(work, T(16))).toEqual([t.id]);
    expect(t).toMatchObject({ status: 'queued', attempts: 1, last_error: expect.stringMatching(/lease expired/) });
  });

  it('recovers an expired lease when the next task is claimed, and the recovered task backs off before it is tried again', () => {
    const work = base();
    const dead = add(work, 'alpha', { priority: 100 });
    claimNext(work, { at: T(0) });
    add(work, 'beta', { priority: 50 });
    const next = claimNext(work, { at: T(20) });
    expect(dead).toMatchObject({ status: 'queued', attempts: 1 });
    expect(next.target_id).toBe('beta'); // alpha is backing off, so the lower priority task goes first
    expect(claimNext(work, { at: T(20 + BACKOFF_MS[0] / 60000 + 1) }).target_id).toBe('alpha');
  });
});

describe('cancelling and retrying', () => {
  it('cancels a waiting task, and refuses to cancel one that is finished', () => {
    const work = base();
    const t = add(work, 'alpha');
    cancelTask(work, t.id, { at: T(1) });
    expect(t).toMatchObject({ status: 'cancelled', finished_at: T(1) });
    expect(() => cancelTask(work, t.id, { at: T(2) })).toThrow(/only a queued or running task/);
  });

  it('retries a failed task from the start, at a raised priority, but not one that is done or waiting', () => {
    const work = base();
    const t = add(work, 'alpha', { priority: 10 });
    claimNext(work, { at: T(1) });
    failTask(work, t.id, { at: T(1), error: 'x', retryable: false });
    requeueTask(work, t.id, { at: T(2) });
    expect(t).toMatchObject({ status: 'queued', attempts: 0, last_error: null, finished_at: null, reason: 'retry', priority: PRIORITY.retry });
    expect(() => requeueTask(work, t.id, { at: T(3) })).toThrow(/only a failed, cancelled or skipped task/);
  });
});

describe('seeding the queue from the completeness audit', () => {
  const seeded = (ds, opts = {}) => {
    const work = structuredClone(ds);
    const audit = auditDataset(work, { asOf: T(0).slice(0, 10) });
    const report = seedFromAudit(work, audit, { at: T(0), by: 'aryan', ...opts });
    return { work, report };
  };

  it('queues every company that has a website, and says so for one that has none, instead of leaving it out silently', () => {
    const { work, report } = seeded(base());
    expect(report).toMatchObject({ queued: 2, no_website: 1 });
    expect(work.enrichment_queue.filter((t) => t.status === 'queued').map((t) => t.target_id).sort()).toEqual(['alpha', 'beta']);
    expect(work.enrichment_queue.find((t) => t.target_id === 'gamma')).toMatchObject({ status: 'skipped', result: { outcome: 'no_website' }, last_error: expect.stringMatching(/no website/) });
  });

  it('asks each task for the fields its company is missing, and puts the most incomplete first', () => {
    const ds = dataset([
      co('Complete', { website: 'https://complete.example', blurb: 'A full description of a company.', founders: ['A B'], foundedYear: 2020, investors: ['Blackbird'] }),
      co('Gappy', { website: 'https://gappy.example', sector: 'Unknown', blurb: '', verified: false, city: 'Unknown', lat: null, lng: null }),
    ]);
    const { work } = seeded(ds);
    const tasks = work.enrichment_queue.filter((t) => t.status === 'queued').sort((a, b) => b.priority - a.priority);
    expect(tasks.map((t) => t.target_id)).toEqual(['gappy', 'complete']);
    expect(tasks[0].wanted).toEqual(expect.arrayContaining(['description', 'address', 'city', 'state', 'website']));
    expect(tasks[0].wanted).not.toContain('sector'); // a company's own site cannot say its sector
    expect(tasks[0].priority).toBeGreaterThan(tasks[1].priority);
  });

  it('does not queue a company twice, and not at all when it was checked recently, unless forced', () => {
    const { work } = seeded(base());
    const audit = auditDataset(work, { asOf: T(0).slice(0, 10) });
    expect(seedFromAudit(work, audit, { at: T(1), by: 'aryan' })).toMatchObject({ queued: 0, already_queued: 2, no_website: 0 });
    for (const t of work.enrichment_queue.filter((x) => x.status === 'queued')) { claimNext(work, { at: T(2) }); finishTask(work, t.id, { at: T(3), result: {} }); }
    expect(seedFromAudit(work, audit, { at: T(4), by: 'aryan' })).toMatchObject({ queued: 0, fresh: 2 });
    expect(seedFromAudit(work, audit, { at: T(4), by: 'aryan', force: true })).toMatchObject({ queued: 2 });
    // ...and a month later it is due again.
    const later = structuredClone(work);
    later.enrichment_queue = later.enrichment_queue.filter((t) => t.status === 'done');
    expect(seedFromAudit(later, audit, { at: T(31 * 24 * 60), by: 'aryan' })).toMatchObject({ queued: 2, fresh: 0 });
  });

  it('queues a company that had no website once it has one', () => {
    const { work } = seeded(base());
    work.companies.find((c) => c.id === 'gamma').website = 'https://gamma.example';
    const audit = auditDataset(work, { asOf: T(0).slice(0, 10) });
    expect(seedFromAudit(work, audit, { at: T(1), by: 'aryan' }).queued).toBe(1);
    expect(work.enrichment_queue.filter((t) => t.target_id === 'gamma').map((t) => t.status)).toEqual(['skipped', 'queued']);
  });

  it('does not repeat the "no website" task while there is still no website', () => {
    const { work } = seeded(base());
    const audit = auditDataset(work, { asOf: T(0).slice(0, 10) });
    seedFromAudit(work, audit, { at: T(1), by: 'aryan' });
    expect(work.enrichment_queue.filter((t) => t.target_id === 'gamma')).toHaveLength(1);
  });

  it('can be limited to a first batch', () => {
    const { report, work } = seeded(base(), { limit: 1 });
    expect(report).toMatchObject({ queued: 1, limited: 1 });
    expect(work.enrichment_queue.filter((t) => t.status === 'queued')).toHaveLength(1);
  });
});

describe('summarising and checking the queue', () => {
  it('counts tasks by status and says how many are ready now', () => {
    const work = base();
    add(work, 'alpha');
    const waiting = add(work, 'beta');
    waiting.not_before = T(60);
    expect(queueSummary(work.enrichment_queue, T(0))).toMatchObject({ total: 2, ready: 1, backing_off: 1, counts: { queued: 2, running: 0, done: 0 }, oldest_ready: T(0) });
  });

  it('accepts a valid queue', () => {
    const work = base();
    add(work, 'alpha');
    expect(validateEnrichmentQueue(work)).toEqual([]);
    expect(validateEnrichmentQueue({ companies: [] })).toEqual([]);
  });

  it('catches an unknown target, a running task with no lease, a finished task with no finish time, and two waiting tasks for one company', () => {
    const work = base();
    const t = add(work, 'alpha');
    const errors = (over) => validateEnrichmentQueue({ ...work, enrichment_queue: [{ ...t, ...over }] }).join(' ');
    expect(errors({ target_id: 'nobody' })).toMatch(/unknown company "nobody"/);
    expect(errors({ status: 'running' })).toMatch(/needs started_at and lease_until/);
    expect(errors({ status: 'done' })).toMatch(/done needs finished_at/);
    expect(errors({ wanted: ['astrology'] })).toMatch(/wanted must be a list/);
    expect(validateEnrichmentQueue({ ...work, enrichment_queue: [t, { ...t, id: 'enq-alpha-2' }] }).join(' ')).toMatch(/more than one task waiting or running/);
  });
});
