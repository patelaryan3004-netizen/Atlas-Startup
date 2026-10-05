import { describe, it, expect } from 'vitest';
import { buildImportRun, failedImports, importRunId, validateImportRuns } from '../src/models/importRuns.js';

const T0 = '2026-10-05T04:00:00.000Z';
const T1 = '2026-10-05T04:01:00.000Z';
const report = (over = {}) => ({
  sources: [{ id: 'rss.a', leads: 4, error: null }, { id: 'rss.b', leads: 0, error: 'HTTP 503' }],
  items: [{ id: 'cand-x', name: 'X' }, { id: 'cand-y', name: 'Y', attached: true }], already_seen: 3, attached: 1, skipped: [{ key: 'z' }], applied: [], requests: 9,
  refused: [{ url: 'https://x.example/', code: 'robots_disallow', message: 'robots.txt disallows /' }], ...over,
});
const run = (over = {}, extra = {}) => buildImportRun(report(over), { runs: [], startedAt: T0, finishedAt: T1, trigger: 'cli', by: 'aryan', ...extra });

describe('recording an import run', () => {
  it('turns an engine report into a row: what each source did, what was found, what the fetcher declined', () => {
    expect(run()).toMatchObject({
      id: 'run-20261005040100000', started_at: T0, finished_at: T1, trigger: 'cli', by: 'aryan', dry_run: false, status: 'partial',
      sources: [{ id: 'rss.a', leads: 4, error: null }, { id: 'rss.b', leads: 0, error: 'HTTP 503' }],
      totals: { new: 1, attached: 1, seen: 3, skipped: 1, applied: 0, requests: 9 },
      refused: [{ url: 'https://x.example/', code: 'robots_disallow' }], acknowledged: [],
    });
  });

  it('is ok when every source answered, failed when none did, partial in between', () => {
    expect(run({ sources: [{ id: 'a', leads: 1, error: null }] }).status).toBe('ok');
    expect(run({ sources: [{ id: 'a', error: 'x' }, { id: 'b', error: 'y' }] }).status).toBe('failed');
    expect(run().status).toBe('partial');
  });

  it('gives runs that finish in the same millisecond different ids', () => {
    const first = run();
    expect(importRunId([first], T1)).toBe('run-20261005040100000-2');
  });
});

describe('which imports have failed', () => {
  const at = (n) => `2026-10-0${n}T04:00:00.000Z`;
  const make = (n, sources, extra = {}) => ({ ...run({ sources }, { startedAt: at(n), finishedAt: at(n) }), ...extra });

  it('names a source that errored in the latest run that included it', () => {
    expect(failedImports([make(5, [{ id: 'rss.b', leads: 0, error: 'HTTP 503' }])])).toEqual([
      { run_id: 'run-20261005040000000', source_id: 'rss.b', error: 'HTTP 503', at: at(5) },
    ]);
  });

  it('clears by itself when a later run of that source succeeds, and is not cleared by a different source', () => {
    const earlier = make(5, [{ id: 'rss.b', leads: 0, error: 'HTTP 503' }, { id: 'rss.c', leads: 0, error: 'timeout' }]);
    const later = make(6, [{ id: 'rss.b', leads: 5, error: null }]);
    expect(failedImports([earlier, later]).map((f) => f.source_id)).toEqual(['rss.c']);
  });

  it('is cleared by a person acknowledging it, but returns if the source fails again in a later run', () => {
    const first = make(5, [{ id: 'rss.b', leads: 0, error: 'HTTP 503' }], { acknowledged: [{ source_id: 'rss.b', by: 'aryan', at: at(5), note: 'their outage' }] });
    expect(failedImports([first])).toEqual([]);
    const again = make(6, [{ id: 'rss.b', leads: 0, error: 'HTTP 503' }]);
    expect(failedImports([first, again]).map((f) => f.run_id)).toEqual([again.id]);
  });

  it('ignores a dry run, which saved nothing', () => {
    expect(failedImports([make(5, [{ id: 'rss.b', error: 'x' }], { dry_run: true })])).toEqual([]);
  });
});

describe('checking import runs', () => {
  const rows = (over = {}) => ({ import_runs: [{ ...run(), ...over }] });

  it('accepts a well-formed run, and none', () => {
    expect(validateImportRuns(rows())).toEqual([]);
    expect(validateImportRuns({})).toEqual([]);
  });

  it('catches a status that disagrees with the sources, a finish before the start, and a bad acknowledgement', () => {
    expect(validateImportRuns(rows({ status: 'ok' })).join(' ')).toMatch(/status is ok but its sources say partial/);
    expect(validateImportRuns(rows({ finished_at: '2026-10-05T03:00:00.000Z' })).join(' ')).toMatch(/before started_at/);
    expect(validateImportRuns(rows({ acknowledged: [{ source_id: 'rss.a', by: 'aryan', at: T1 }] })).join(' ')).toMatch(/did not fail in this run/);
    expect(validateImportRuns(rows({ trigger: 'cron' })).join(' ')).toMatch(/invalid trigger/);
  });
});
