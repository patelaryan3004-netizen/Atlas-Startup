import { describe, it, expect } from 'vitest';
import { CADENCE, COMPANY_FACETS, FAILURE_BACKOFF_DAYS, REFUSED_DAYS, intervalDays, jitterFactor, nextCheckAt, taskPriority, unit } from '../src/scheduler/cadence.js';
import { stampCheck, facetsOfTask, reconcileFromQueue, recordHostCooldowns, coolingHosts, makeDue, dropOrphans, hostOf } from '../src/scheduler/state.js';
import { dueRefreshes, planSiteReads, eligibleUnless, facetsForJobs } from '../src/scheduler/plan.js';
import { emptyState, indexState, validateRefreshState } from '../src/models/refreshState.js';
import { PRIORITY } from '../src/models/enrichmentQueue.js';
import { dataset, co, task, read, NOW, ISO, DAY, at, days } from './helpers/scheduler.js';

const work = (companies, extra = {}) => ({ ...structuredClone(dataset(companies)), refresh_state: [], enrichment_queue: [], ...extra });
const ACME = () => co('Acme Robotics', { website: 'https://acme.com.au', hiring: true, hiring_status: 'hiring' });
const rowOf = (w, id, facet, scope = 'company') => w.refresh_state.find((r) => r.scope === scope && r.target_id === id && r.facet === facet);
const daysBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / DAY;

describe('how often each kind of fact is looked at', () => {
  it('puts facts on very different clocks: hiring often, funding moderately, description occasionally, founded year rarely', () => {
    const d = (f) => CADENCE.company[f].baseDays;
    expect(d('hiring')).toBeLessThan(d('status'));
    expect(d('status')).toBeLessThan(d('description'));
    expect(d('description')).toBeLessThan(d('profile'));
    expect(d('profile')).toBeLessThan(d('founded_year'));
    expect(CADENCE.source.funding.baseDays).toBeGreaterThan(d('hiring') / 2); // not as often as a role changes
    expect(CADENCE.source.funding.baseDays).toBeLessThan(d('status'));
    expect(d('hiring')).toBe(3);
    expect(d('founded_year')).toBe(365);
  });

  it('gives the same date for the same state, and spreads companies that share a moment', () => {
    expect(unit('a')).toBe(unit('a'));
    expect(unit('a')).not.toBe(unit('b'));
    for (let i = 0; i < 200; i += 1) { const j = jitterFactor(`seed-${i}`, 0.15); expect(j).toBeGreaterThanOrEqual(0.85); expect(j).toBeLessThanOrEqual(1.15); }
    const spread = new Set(Array.from({ length: 40 }, (_, i) => intervalDays(CADENCE.company.hiring, { seed: `company-${i}` }).toFixed(3)));
    expect(spread.size).toBeGreaterThan(30);
    expect(intervalDays(CADENCE.company.hiring, { seed: 'x' })).toBe(intervalDays(CADENCE.company.hiring, { seed: 'x' }));
  });

  it('waits longer each time a check finds nothing new, up to a ceiling, and a change brings it back', () => {
    const spec = CADENCE.company.description;
    const at0 = intervalDays(spec, { unchangedStreak: 0, seed: 's' });
    const at2 = intervalDays(spec, { unchangedStreak: 2, seed: 's' });
    const at30 = intervalDays(spec, { unchangedStreak: 30, seed: 's' });
    expect(at2).toBeGreaterThan(at0 * 3);
    expect(at30).toBeLessThanOrEqual(spec.maxDays);
    expect(at30).toBeGreaterThan(spec.maxDays * 0.5);
    expect(intervalDays(spec, { unchangedStreak: 0, seed: 's' })).toBe(at0);
  });

  it('looks at a company that is hiring about twice as often as one that is not', () => {
    const hiring = intervalDays(CADENCE.company.hiring, { company: { hiring: true }, seed: 's' });
    const idle = intervalDays(CADENCE.company.hiring, { company: { hiring: false }, seed: 's' });
    expect(idle / hiring).toBeCloseTo(2, 5);
  });

  it('never goes below a minimum or above a maximum, whatever the jitter', () => {
    for (const [facet, spec] of Object.entries(CADENCE.company).filter(([, s]) => s.scheduled !== false)) {
      for (let i = 0; i < 50; i += 1) {
        const n = intervalDays(spec, { unchangedStreak: i % 9, seed: `${facet}${i}` });
        expect(n, facet).toBeGreaterThanOrEqual(spec.minDays);
        expect(n, facet).toBeLessThanOrEqual(spec.maxDays);
      }
    }
  });

  it('backs off a failure on a ladder, treats a refusal as a result with its own wait, and honours Retry-After', () => {
    const row = (failures) => ({ ...emptyState('company', 'acme', 'hiring'), failures, checks: 1 });
    const wait = (outcome, r, extra = {}) => daysBetween(ISO, nextCheckAt({ scope: 'company', facet: 'hiring', at: ISO, outcome, row: r, ...extra }));
    FAILURE_BACKOFF_DAYS.forEach((d, i) => { const n = wait('failed', row(i + 1)); expect(n).toBeGreaterThan(d * 0.8); expect(n).toBeLessThan(d * 1.2); });
    expect(wait('failed', row(40))).toBeLessThan(FAILURE_BACKOFF_DAYS.at(-1) * 1.2); // the ladder ends
    expect(wait('refused', row(0), { code: 'robots_disallow' })).toBe(REFUSED_DAYS.robots_disallow);
    expect(wait('refused', row(0), { code: 'access_controlled' })).toBe(REFUSED_DAYS.access_controlled);
    expect(wait('refused', row(0), { code: 'something_new' })).toBe(14);
    expect(wait('no_website', row(0))).toBe(30);
    expect(wait('mismatch', row(0))).toBe(14);
    expect(wait('failed', row(1), { retryAfterSeconds: 5 * 86400 })).toBeGreaterThanOrEqual(5);
  });

  it('queues the facets that matter most first, and after anything a person asked for', () => {
    expect(taskPriority(['hiring'])).toBeGreaterThan(taskPriority(['description']));
    expect(taskPriority(['description', 'hiring'])).toBe(taskPriority(['hiring']));
    expect(taskPriority(['hiring'])).toBeLessThan(PRIORITY.manual);
    expect(taskPriority(['status'])).toBeGreaterThan(PRIORITY.refresh);
  });
});

describe('stamping a check', () => {
  const company = { hiring: true };
  const fresh = () => emptyState('company', 'acme', 'hiring');

  it('records a check that found something new, and moves the next check to the base interval', () => {
    const row = stampCheck(fresh(), { at: ISO, outcome: 'read', changed: true, verified: true, taskId: 'enq-acme-1', runId: 'jr-1-hiring', company });
    expect(row).toMatchObject({ last_checked_at: ISO, last_verified_at: ISO, last_changed_at: ISO, last_attempt_at: ISO, checks: 1, unchanged_streak: 0, failures: 0, last_outcome: 'changed', last_task_id: 'enq-acme-1', last_run_id: 'jr-1-hiring' });
    expect(daysBetween(ISO, row.next_check_at)).toBeGreaterThan(2.4);
    expect(daysBetween(ISO, row.next_check_at)).toBeLessThan(3.6);
  });

  it('records a check that found nothing new as checked but not changed, and lengthens the wait', () => {
    const row = fresh();
    stampCheck(row, { at: ISO, outcome: 'read', changed: true, verified: true, company });
    const first = daysBetween(ISO, row.next_check_at);
    const later = at(NOW + 3 * DAY);
    stampCheck(row, { at: later, outcome: 'read', changed: false, verified: false, company });
    stampCheck(row, { at: later, outcome: 'read', changed: false, verified: false, company });
    expect(row).toMatchObject({ checks: 3, unchanged_streak: 2, last_changed_at: ISO, last_verified_at: ISO, last_outcome: 'unchanged', last_checked_at: later });
    expect(daysBetween(later, row.next_check_at)).toBeGreaterThan(first);
  });

  it('counts a failure against the back-off, keeps the last good check, and clears the failures on the next success', () => {
    const row = fresh();
    stampCheck(row, { at: ISO, outcome: 'read', changed: true, verified: true, company });
    stampCheck(row, { at: at(NOW + DAY), outcome: 'failed', error: 'timeout: no answer' });
    stampCheck(row, { at: at(NOW + 2 * DAY), outcome: 'unreachable', error: 'HTTP 404' });
    expect(row).toMatchObject({ failures: 2, checks: 1, last_checked_at: ISO, last_attempt_at: at(NOW + 2 * DAY), last_outcome: 'unreachable', last_error: 'HTTP 404' });
    stampCheck(row, { at: at(NOW + 5 * DAY), outcome: 'read', changed: false, company });
    expect(row).toMatchObject({ failures: 0, last_error: null, checks: 2 });
  });

  it('does not count a refusal, a mismatch or a missing website as a failure of ours', () => {
    for (const outcome of ['refused', 'mismatch', 'no_website', 'blocked']) {
      const row = stampCheck(fresh(), { at: ISO, outcome, error: 'a reason', code: 'robots_disallow' });
      expect(row, outcome).toMatchObject({ failures: 0, checks: 0, last_checked_at: null, last_outcome: outcome, last_error: 'a reason' });
      expect(Date.parse(row.next_check_at)).toBeGreaterThan(NOW + 5 * DAY);
    }
  });

  it('stays valid, whatever happened', () => {
    const w = work([ACME()]);
    const row = indexState(w.refresh_state).getOrCreate('company', 'acme-robotics', 'hiring');
    stampCheck(row, { at: ISO, outcome: 'read', changed: true, verified: true, company });
    expect(validateRefreshState(w)).toEqual([]);
  });
});

describe('which facets a finished task bears on', () => {
  it('always the status, and the facets whose fields it asked for', () => {
    expect(facetsOfTask({ wanted: [] })).toEqual(['status']);
    expect(facetsOfTask({ wanted: ['jobs'] }).sort()).toEqual(['hiring', 'status']);
    expect(facetsOfTask({ wanted: ['description', 'website'] }).sort()).toEqual(['description', 'status']);
    expect(facetsOfTask({ wanted: ['address', 'founded_year'] }).sort()).toEqual(['founded_year', 'profile', 'status']);
    expect(facetsOfTask({ wanted: ['hiring_status', 'jobs', 'address', 'city', 'state', 'founders', 'investors', 'description', 'founded_year'] }).sort()).toEqual([...COMPANY_FACETS].sort());
  });
});

describe('learning from the queue', () => {
  it('stamps each facet a finished read covered, from what it found', () => {
    const w = work([ACME()]);
    w.enrichment_queue = [task('acme-robotics', { result: read({ evidence_added: 3, added_fields: ['hiring_status', 'description'], refreshed_fields: ['founders'], jobs: { added: 2, updated: 0, closed: 0 } }) })];
    const r = reconcileFromQueue(w);
    expect(r).toMatchObject({ tasks: 1, stamped: 5 });
    expect(rowOf(w, 'acme-robotics', 'hiring')).toMatchObject({ last_outcome: 'changed', last_changed_at: ISO, last_verified_at: ISO, checks: 1, last_task_id: 'enq-acme-robotics-1' });
    expect(rowOf(w, 'acme-robotics', 'description')).toMatchObject({ last_outcome: 'changed' });
    expect(rowOf(w, 'acme-robotics', 'profile')).toMatchObject({ last_outcome: 'unchanged', last_verified_at: ISO, last_changed_at: null }); // founders read again: confirmed, not new
    expect(rowOf(w, 'acme-robotics', 'founded_year')).toMatchObject({ last_outcome: 'unchanged', last_verified_at: null }); // the page said nothing about it
    expect(rowOf(w, 'acme-robotics', 'status')).toMatchObject({ last_outcome: 'unchanged', last_verified_at: ISO });
    expect(validateRefreshState(w)).toEqual([]);
  });

  it('learns from a task exactly once: running it again changes nothing', () => {
    const w = work([ACME()]);
    w.enrichment_queue = [task('acme-robotics', { result: read({ added_fields: ['description'] }) })];
    reconcileFromQueue(w);
    const once = JSON.stringify(w.refresh_state);
    const again = reconcileFromQueue(w);
    expect(again).toMatchObject({ tasks: 0, stamped: 0 });
    expect(JSON.stringify(w.refresh_state)).toBe(once);
  });

  it('applies tasks in the order they finished, and never lets an older task undo a newer one', () => {
    const w = work([ACME()]);
    const newer = task('acme-robotics', { n: 2, finished_at: at(NOW + 5 * DAY), result: read({ added_fields: ['description'] }) });
    const older = task('acme-robotics', { n: 1, finished_at: ISO, result: read({}) });
    w.enrichment_queue = [newer, older];
    reconcileFromQueue(w);
    expect(rowOf(w, 'acme-robotics', 'description')).toMatchObject({ last_checked_at: at(NOW + 5 * DAY), checks: 2, last_task_id: newer.id });
    // a task from before the row's last attempt that turns up later is ignored
    w.enrichment_queue.push(task('acme-robotics', { n: 3, finished_at: at(NOW + 2 * DAY), result: read({ added_fields: ['description'] }) }));
    const before = JSON.stringify(w.refresh_state);
    reconcileFromQueue(w);
    expect(JSON.stringify(w.refresh_state)).toBe(before);
  });

  it('starts the clocks from the history it finds, even from tasks written before the fields were recorded', () => {
    const w = work([ACME()]);
    const legacy = read({ evidence_added: 4 });
    delete legacy.added_fields; delete legacy.refreshed_fields; delete legacy.confirmed_fields; delete legacy.status_signals;
    w.enrichment_queue = [task('acme-robotics', { finished_at: at(NOW - 20 * DAY), result: legacy })];
    reconcileFromQueue(w);
    expect(rowOf(w, 'acme-robotics', 'hiring')).toMatchObject({ last_checked_at: at(NOW - 20 * DAY), last_outcome: 'changed' });
    expect(Date.parse(rowOf(w, 'acme-robotics', 'hiring').next_check_at)).toBeLessThan(NOW); // due again: it was 20 days ago
    expect(Date.parse(rowOf(w, 'acme-robotics', 'description').next_check_at)).toBeGreaterThan(NOW); // not due for a while
  });

  it('records a company with no website, a site that refuses robots, and one that is gone, each with its own wait', () => {
    const w = work([co('A', { website: 'https://a.example.com' }), co('B', { website: 'https://b.example.com' }), co('C', { website: 'https://c.example.com' })]);
    w.enrichment_queue = [
      task('a', { status: 'skipped', last_error: 'no website on record', result: { outcome: 'no_website' } }),
      task('b', { status: 'skipped', last_error: 'robots_disallow: robots.txt disallows /', result: { outcome: 'refused', code: 'robots_disallow', refused: [] } }),
      task('c', { status: 'skipped', last_error: 'http_error: HTTP 404', result: { outcome: 'refused', code: 'http_error', refused: [] } }),
    ];
    reconcileFromQueue(w);
    expect(rowOf(w, 'a', 'hiring')).toMatchObject({ last_outcome: 'no_website', failures: 0 });
    expect(rowOf(w, 'b', 'hiring')).toMatchObject({ last_outcome: 'refused', failures: 0 });
    expect(daysBetween(ISO, rowOf(w, 'b', 'hiring').next_check_at)).toBe(30);
    expect(rowOf(w, 'c', 'hiring')).toMatchObject({ last_outcome: 'unreachable', failures: 1 });
    expect(rowOf(w, 'c', 'status').meta).toMatchObject({ unreachable_since: ISO });
  });

  it('backs a failed task off, and says why', () => {
    const w = work([ACME()]);
    w.enrichment_queue = [task('acme-robotics', { status: 'failed', last_error: 'timeout: no answer in 15s' })];
    reconcileFromQueue(w);
    expect(rowOf(w, 'acme-robotics', 'hiring')).toMatchObject({ last_outcome: 'failed', failures: 1, last_error: 'timeout: no answer in 15s', checks: 0 });
    expect(daysBetween(ISO, rowOf(w, 'acme-robotics', 'hiring').next_check_at)).toBeLessThan(1);
  });

  it('does not count a hiring check as done when a job board the careers page links to would not answer', () => {
    const w = work([ACME()]);
    w.enrichment_queue = [task('acme-robotics', { result: read({ refused: [{ url: 'https://boards-api.greenhouse.io/v1/boards/acme/jobs', code: 'rate_limited' }] }) })];
    reconcileFromQueue(w);
    expect(rowOf(w, 'acme-robotics', 'hiring')).toMatchObject({ last_outcome: 'incomplete', failures: 1, checks: 0 });
    expect(rowOf(w, 'acme-robotics', 'description')).toMatchObject({ last_outcome: 'unchanged', checks: 1 }); // the other facets were read
    expect(daysBetween(ISO, rowOf(w, 'acme-robotics', 'hiring').next_check_at)).toBeLessThan(2);
  });

  it('treats a site that is someone else\'s as a mismatch for the facts, and a signal for the status', () => {
    const w = work([ACME()]);
    w.enrichment_queue = [task('acme-robotics', { result: read({ outcome: 'mismatch', status_signals: [{ code: 'site_mismatch', detail: 'the website calls itself Orbit' }] }) })];
    reconcileFromQueue(w);
    expect(rowOf(w, 'acme-robotics', 'hiring')).toMatchObject({ last_outcome: 'mismatch', checks: 0 });
    expect(rowOf(w, 'acme-robotics', 'status')).toMatchObject({ last_outcome: 'changed', last_verified_at: null });
    expect(rowOf(w, 'acme-robotics', 'status').meta.signals).toEqual([expect.objectContaining({ code: 'site_mismatch', since: ISO })]);
  });

  it('remembers when a status signal first appeared, and when it went away', () => {
    const w = work([ACME()]);
    const signal = { code: 'acquired_notice', detail: 'the homepage says: "Acme was acquired by Beta"', other: 'Beta' };
    w.enrichment_queue = [
      task('acme-robotics', { n: 1, finished_at: ISO, result: read({ status_signals: [signal] }) }),
      task('acme-robotics', { n: 2, finished_at: at(NOW + 14 * DAY), result: read({ status_signals: [signal] }) }),
    ];
    reconcileFromQueue(w);
    const row = rowOf(w, 'acme-robotics', 'status');
    expect(row.meta.signals[0].since).toBe(ISO); // still the first day
    expect(row).toMatchObject({ last_changed_at: ISO, unchanged_streak: 1, last_verified_at: null });
    w.enrichment_queue.push(task('acme-robotics', { n: 3, finished_at: at(NOW + 28 * DAY), result: read({}) }));
    reconcileFromQueue(w);
    expect(row.meta.signals).toEqual([]);
    expect(row).toMatchObject({ last_changed_at: at(NOW + 28 * DAY), last_verified_at: at(NOW + 28 * DAY) });
  });

  it('notices a site that has been unreachable for several checks over three weeks, and only then', () => {
    const w = work([ACME()]);
    const failed = (n, day) => task('acme-robotics', { n, status: 'failed', finished_at: at(NOW + day * DAY), last_error: 'dns_failed: could not resolve acme.com.au' });
    w.enrichment_queue = [failed(1, 0), failed(2, 7), failed(3, 14)];
    reconcileFromQueue(w);
    expect(rowOf(w, 'acme-robotics', 'status').meta.signals).toEqual([]); // three failures, but only two weeks
    w.enrichment_queue.push(failed(4, 22));
    reconcileFromQueue(w);
    expect(rowOf(w, 'acme-robotics', 'status').meta.signals).toEqual([expect.objectContaining({ code: 'unreachable', detail: expect.stringMatching(/not answered since 2026-10-05 \(4 checks in a row\)/) })]);
    // it answers again: the signal goes
    w.enrichment_queue.push(task('acme-robotics', { n: 5, finished_at: at(NOW + 30 * DAY), result: read({}) }));
    reconcileFromQueue(w);
    expect(rowOf(w, 'acme-robotics', 'status').meta.signals).toEqual([]);
  });

  it('ignores a task that was cancelled or is still waiting, and forgets companies that are gone', () => {
    const w = work([ACME()]);
    w.enrichment_queue = [task('acme-robotics', { status: 'cancelled' }), task('acme-robotics', { n: 2, status: 'queued' }), task('ghost', { result: read({}) })];
    reconcileFromQueue(w);
    expect(w.refresh_state).toEqual([]);
    w.refresh_state.push(emptyState('company', 'ghost', 'hiring'), emptyState('source', 'a.feed', 'funding'));
    expect(dropOrphans(w)).toBe(1);
    expect(w.refresh_state.map((r) => r.target_id)).toEqual(['a.feed']);
  });
});

describe('websites that asked us to slow down', () => {
  it('waits longer each time a host asks, at least as long as it asked, and forgives a host that has been fine', () => {
    const w = work([ACME()]);
    recordHostCooldowns(w, { asked: [{ host: 'boards-api.greenhouse.io', retryAfterSeconds: null }], at: ISO });
    let row = rowOf(w, 'boards-api.greenhouse.io', 'access', 'host');
    expect(row.failures).toBe(1);
    expect(coolingHosts(w, at(NOW + 3600000)).has('boards-api.greenhouse.io')).toBe(true);
    expect(coolingHosts(w, at(NOW + 2 * DAY)).has('boards-api.greenhouse.io')).toBe(false);

    recordHostCooldowns(w, { asked: [{ host: 'boards-api.greenhouse.io', retryAfterSeconds: 5 * 86400 }], at: at(NOW + 2 * DAY) });
    row = rowOf(w, 'boards-api.greenhouse.io', 'access', 'host');
    expect(row.failures).toBe(2);
    expect(daysBetween(at(NOW + 2 * DAY), row.next_check_at)).toBeGreaterThanOrEqual(5);

    // used later, after the wait, and fine: forgiven
    recordHostCooldowns(w, { asked: [], used: new Set(['boards-api.greenhouse.io']), at: at(NOW + 10 * DAY) });
    expect(rowOf(w, 'boards-api.greenhouse.io', 'access', 'host')).toMatchObject({ failures: 0, next_check_at: null });
    expect(validateRefreshState(w)).toEqual([]);
  });

  it('does not forgive a host that is still inside its wait just because it was in the list', () => {
    const w = work([ACME()]);
    recordHostCooldowns(w, { asked: [{ host: 'slow.example', retryAfterSeconds: null }], at: ISO });
    recordHostCooldowns(w, { asked: [], used: new Set(['slow.example']), at: at(NOW + 3600000) });
    expect(rowOf(w, 'slow.example', 'access', 'host').failures).toBe(1);
  });

  it('brings a clock forward, but not one that is due already and not one checked recently when told to wait', () => {
    const row = stampCheck(emptyState('company', 'acme', 'hiring'), { at: ISO, outcome: 'read', changed: true, company: { hiring: true } });
    expect(makeDue(row, { at: at(NOW + DAY), recheckAfterDays: 7 })).toBe(false); // checked yesterday
    expect(makeDue(row, { at: at(NOW + DAY) })).toBe(true);
    expect(row.next_check_at).toBe(at(NOW + DAY));
    expect(makeDue(row, { at: at(NOW + DAY) })).toBe(false); // already due
    const never = emptyState('company', 'acme', 'status');
    expect(makeDue(never, { at: ISO })).toBe(false); // null is due now already
  });
});

describe('what is due', () => {
  const dueIds = (w, opts = {}) => dueRefreshes(w, { at: ISO, ...opts }).due.map((d) => d.company.id);

  it('has every company with a website due for every facet the first time, most important first', () => {
    const w = work([co('B', { website: 'https://b.example.com' }), co('A', { website: 'https://a.example.com' }), co('NoSite', { website: '' })]);
    const { due, skipped } = dueRefreshes(w, { at: ISO });
    expect(due.map((d) => d.company.id)).toEqual(['a', 'b']);
    expect(due[0].due.map((d) => d.facet).sort()).toEqual([...COMPANY_FACETS].sort());
    expect(due[0].due.every((d) => d.reason === 'never')).toBe(true);
    expect(skipped).toMatchObject({ no_website: 1 });
  });

  it('puts a company that was never checked before one that is merely overdue, and an overdue hiring check before an overdue description', () => {
    const w = work([co('Old', { website: 'https://old.example.com' }), co('Fresh', { website: 'https://fresh.example.com' })]);
    w.enrichment_queue = [task('old', { finished_at: at(NOW - 50 * DAY), result: read({}) })];
    reconcileFromQueue(w);
    expect(dueIds(w)).toEqual(['fresh', 'old']);
  });

  it('is not due again until its clock says so, and then is', () => {
    const w = work([ACME()]);
    w.enrichment_queue = [task('acme-robotics', { result: read({ added_fields: ['hiring_status'] }) })];
    reconcileFromQueue(w);
    expect(dueIds(w)).toEqual([]);
    expect(dueIds(w, { at: at(NOW + 4 * DAY) })).toEqual(['acme-robotics']);
    const later = dueRefreshes(w, { at: at(NOW + 4 * DAY) }).due[0].due.map((d) => d.facet);
    expect(later).toEqual(['hiring']); // the others are not due for weeks
  });

  it('picks a company up again when a website is added after it was found to have none', () => {
    const w = work([co('Late', { website: '' })]);
    w.enrichment_queue = [task('late', { status: 'skipped', last_error: 'no website on record', result: { outcome: 'no_website' } })];
    reconcileFromQueue(w);
    expect(dueIds(w, { at: at(NOW + DAY) })).toEqual([]);
    w.companies[0].website = 'https://late.example.com';
    expect(dueRefreshes(w, { at: at(NOW + DAY) }).due[0].due.every((d) => d.reason === 'website_added')).toBe(true);
  });

  it('only asks a company that has closed or been acquired about its status', () => {
    const w = work([co('Gone', { website: 'https://gone.example.com', stage: 'Defunct' })]);
    expect(dueRefreshes(w, { at: ISO }).due[0].due.map((d) => d.facet)).toEqual(['status']);
  });

  it('leaves a website that asked us to slow down alone, and says how many', () => {
    const w = work([ACME(), co('Other', { website: 'https://other.example.com' })]);
    const r = dueRefreshes(w, { at: ISO, cooling: new Set(['acme.com.au']) });
    expect(r.due.map((d) => d.company.id)).toEqual(['other']);
    expect(r.skipped.cooling).toBe(1);
  });

  it('with force, ignores the clocks and takes what was checked longest ago first', () => {
    const w = work([co('Recent', { website: 'https://recent.example.com' }), co('Ancient', { website: 'https://ancient.example.com' })]);
    w.enrichment_queue = [task('recent', { finished_at: at(NOW - DAY), result: read({}) }), task('ancient', { finished_at: at(NOW - 90 * DAY), result: read({}) })];
    reconcileFromQueue(w);
    expect(dueIds(w)).toEqual(['ancient']); // by the clocks, only the old one
    expect(dueIds(w, { force: true })).toEqual(['ancient', 'recent']);
  });
});

describe('queueing what is due', () => {
  const queued = (w) => w.enrichment_queue.filter((t) => t.status === 'queued');

  it('queues one task per company for everything due at once, asking only for what the due facets need', () => {
    const w = work([ACME()]);
    const r = planSiteReads(w, { at: ISO });
    expect(r).toMatchObject({ due: 1, planned: 1, deferred: 0 });
    const [t] = queued(w);
    expect(t).toMatchObject({ target_id: 'acme-robotics', reason: 'refresh', created_by: 'scheduler', max_pages: 4 });
    expect([...t.wanted].sort()).toEqual(['address', 'city', 'description', 'founded_year', 'founders', 'hiring_status', 'investors', 'jobs', 'state']);
    expect(t.priority).toBe(taskPriority(COMPANY_FACETS));
  });

  it('asks for just the homepage when only the status is due', () => {
    const w = work([ACME()]);
    w.enrichment_queue = [task('acme-robotics', { result: read({}) })];
    reconcileFromQueue(w);
    planSiteReads(w, { at: at(NOW + 30 * DAY), facets: ['status'] }); // a clean check lengthens the wait to about three weeks
    expect(queued(w)[0]).toMatchObject({ wanted: [], max_pages: 1 });
  });

  it('queues no more than the limit, most important first, and says how many are left', () => {
    const w = work(Array.from({ length: 6 }, (_, i) => co(`Co ${i}`, { website: `https://co${i}.example.com` })));
    const r = planSiteReads(w, { at: ISO, limit: 2 });
    expect(r).toMatchObject({ due: 6, planned: 2, deferred: 4 });
    expect(queued(w).map((t) => t.target_id)).toEqual(['co-0', 'co-1']);
  });

  it('is idempotent: asking again adds no second task, and a person\'s task keeps its higher priority', () => {
    const w = work([ACME()]);
    planSiteReads(w, { at: ISO });
    planSiteReads(w, { at: ISO });
    expect(queued(w)).toHaveLength(1);
    const w2 = work([ACME()]);
    w2.enrichment_queue = [task('acme-robotics', { status: 'queued', priority: PRIORITY.manual, reason: 'manual', wanted: ['description'], max_pages: 2 })];
    planSiteReads(w2, { at: ISO });
    expect(w2.enrichment_queue).toHaveLength(1);
    expect(w2.enrichment_queue[0]).toMatchObject({ priority: PRIORITY.manual, reason: 'manual', max_pages: 4 });
    expect(w2.enrichment_queue[0].wanted).toEqual(expect.arrayContaining(['description', 'jobs']));
  });

  it('plans only the facets of the jobs asked for', () => {
    const w = work([ACME()]);
    planSiteReads(w, { at: ISO, facets: facetsForJobs(['hiring']) });
    expect(queued(w)[0].wanted.sort()).toEqual(['hiring_status', 'jobs']);
    expect(facetsForJobs(['enrichment']).sort()).toEqual(['description', 'founded_year', 'profile']);
  });

  it('leaves a task for later when its company\'s website asked us to slow down', () => {
    const w = work([ACME(), co('Other', { website: 'https://other.example.com' })]);
    planSiteReads(w, { at: ISO });
    const eligible = eligibleUnless(new Set(['acme.com.au']));
    const ready = queued(w).filter((t) => eligible(t, w)).map((t) => t.target_id);
    expect(ready).toEqual(['other']);
    expect(eligibleUnless(new Set())).toBeNull();
    expect(hostOf('https://www.acme.com.au/careers')).toBe('acme.com.au');
  });
});

describe('the validity of what is stored', () => {
  it('refuses a row with the wrong id, an unknown facet, a company that does not exist, or a bad date', () => {
    const w = work([ACME()]);
    const good = emptyState('company', 'acme-robotics', 'hiring');
    expect(validateRefreshState({ ...w, refresh_state: [good] })).toEqual([]);
    const bad = [
      { ...good, id: 'rs-other' },
      { ...emptyState('company', 'acme-robotics', 'status'), facet: 'nope' },
      emptyState('company', 'ghost', 'hiring'),
      { ...emptyState('company', 'acme-robotics', 'profile'), next_check_at: 'tomorrow' },
      { ...emptyState('company', 'acme-robotics', 'description'), failures: -1 },
      { ...emptyState('company', 'acme-robotics', 'founded_year'), last_verified_at: ISO },
      { ...emptyState('source', 'a.feed', 'hiring') },
    ];
    const errors = validateRefreshState({ ...w, refresh_state: bad });
    expect(errors.length).toBeGreaterThanOrEqual(bad.length);
    expect(errors.join('\n')).toMatch(/id should be/);
    expect(errors.join('\n')).toMatch(/not a facet of a source/);
    expect(errors.join('\n')).toMatch(/unknown company "ghost"/);
  });
});
