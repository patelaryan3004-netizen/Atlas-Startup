// Import runs: one row per run of the discovery engine, so "did the imports work?"
// has an answer that outlives the terminal. Written by `discovery run` (and anything
// else that runs the engine) in the same write as the candidates it found.
//
//   import_runs.json
//   {
//     id, started_at, finished_at, trigger ('cli' | 'admin' | 'scheduler'), by, dry_run,
//     status,                     ok (every source answered), partial (some failed), failed (all failed)
//     sources[{ id, leads, error }],
//     totals { new, attached, seen, skipped, applied, requests },
//     refused[{ url, code, message }],   pages the fetcher declined (robots.txt, access control): expected, not failures
//     acknowledged[{ source_id, by, at, note }]   source failures a person has looked at
//   }
//
// A FAILED import is a source that errored in the latest run that included it and
// that nobody has acknowledged. A later run that succeeds clears it by itself.
import { ISO_RE, isStr } from './company.js';

export const IMPORT_STATUSES = ['ok', 'partial', 'failed'];
export const IMPORT_TRIGGERS = ['cli', 'admin', 'scheduler'];

export function importRunId(runs, at) {
  const prefix = `run-${at.replace(/\D/g, '')}`;
  const taken = new Set(runs.map((r) => r.id));
  let id = prefix;
  for (let n = 2; taken.has(id); n += 1) id = `${prefix}-${n}`;
  return id;
}

// An engine report (pipeline.js) as a stored row.
export function buildImportRun(report, { runs = [], startedAt, finishedAt, trigger = 'cli', by = null, dryRun = false }) {
  const sources = (report.sources ?? []).map((s) => ({ id: s.id, leads: s.leads ?? 0, error: s.error ?? null }));
  const failed = sources.filter((s) => s.error).length;
  const items = report.items ?? [];
  return {
    id: importRunId(runs, finishedAt),
    started_at: startedAt, finished_at: finishedAt, trigger, by, dry_run: dryRun,
    status: failed === 0 ? 'ok' : failed === sources.length ? 'failed' : 'partial',
    sources,
    totals: {
      new: items.filter((i) => !i.attached).length, attached: report.attached ?? 0, seen: report.already_seen ?? 0,
      skipped: (report.skipped ?? []).length, applied: (report.applied ?? []).length, requests: report.requests ?? 0,
    },
    refused: (report.refused ?? []).map((r) => ({ url: r.url, code: r.code, message: String(r.message ?? '').slice(0, 200) })),
    acknowledged: [],
  };
}

// Source failures still needing a look: the latest run that included each source, if it errored and
// was not acknowledged.
export function failedImports(runs) {
  const latest = new Map();
  for (const run of [...runs].sort((a, b) => Date.parse(a.finished_at) - Date.parse(b.finished_at))) {
    if (run.dry_run) continue;
    for (const s of run.sources) latest.set(s.id, { run, source: s });
  }
  return [...latest.values()]
    .filter(({ run, source }) => source.error && !run.acknowledged.some((a) => a.source_id === source.id))
    .map(({ run, source }) => ({ run_id: run.id, source_id: source.id, error: source.error, at: run.finished_at }));
}

export function validateImportRuns(ds) {
  const errors = [];
  const bad = (where, msg) => errors.push(`${where}: ${msg}`);
  const seen = new Set();
  for (const r of ds.import_runs ?? []) {
    const at = `import run "${r.id}"`;
    if (!isStr(r.id) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(r.id)) bad('import_runs', `invalid id ${JSON.stringify(r.id)}`);
    else if (seen.has(r.id)) bad(at, 'duplicate id');
    seen.add(r.id);
    if (!ISO_RE.test(r.started_at ?? '') || !ISO_RE.test(r.finished_at ?? '')) bad(at, 'started_at and finished_at must be ISO-8601 UTC');
    else if (Date.parse(r.finished_at) < Date.parse(r.started_at)) bad(at, 'finished_at is before started_at');
    if (!IMPORT_TRIGGERS.includes(r.trigger)) bad(at, `invalid trigger "${r.trigger}"`);
    if (!IMPORT_STATUSES.includes(r.status)) bad(at, `invalid status "${r.status}"`);
    if (!Array.isArray(r.sources) || r.sources.some((s) => !isStr(s.id) || (s.error != null && typeof s.error !== 'string'))) bad(at, 'sources need an id and an error (a string or null)');
    else {
      const failed = r.sources.filter((s) => s.error).length;
      const expected = failed === 0 ? 'ok' : failed === r.sources.length ? 'failed' : 'partial';
      if (r.status !== expected) bad(at, `status is ${r.status} but its sources say ${expected}`);
    }
    if (!r.totals || Object.values(r.totals).some((n) => !Number.isInteger(n) || n < 0)) bad(at, 'totals must be whole numbers');
    if (!Array.isArray(r.refused)) bad(at, 'refused must be a list');
    for (const a of r.acknowledged ?? []) {
      if (!isStr(a.source_id) || !isStr(a.by) || !ISO_RE.test(a.at ?? '')) bad(at, 'an acknowledgement needs source_id, by and an ISO at');
      else if (!r.sources.some((s) => s.id === a.source_id && s.error)) bad(at, `acknowledges "${a.source_id}", which did not fail in this run`);
    }
  }
  return errors;
}
