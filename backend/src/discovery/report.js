// Plain-text views for a person: a run report, the review queue, one candidate in full.
// Presentation only; nothing here reads or changes data.
import { describeMatch } from './resolve.js';

const pad = (s, n) => String(s ?? '').padEnd(n).slice(0, Math.max(n, String(s ?? '').length));
const table = (rows, columns) => {
  const widths = columns.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length)));
  const line = (r) => columns.map((c, i) => pad(r[c], widths[i])).join('  ').trimEnd();
  return [line(Object.fromEntries(columns.map((c) => [c, c.toUpperCase()]))), ...rows.map(line)].join('\n');
};
const count = (items, key) => items.reduce((acc, i) => ({ ...acc, [i[key]]: (acc[i[key]] || 0) + 1 }), {});

export function renderRunReport(report, { skippedSources = [], dryRun = false } = {}) {
  const out = [`Discovery run ${report.started_at}${dryRun ? ' (dry run: nothing written)' : ''}`, '', 'Sources:'];
  for (const s of report.sources) out.push(`  ${pad(s.id, 30)} ${s.error ? `FAILED - ${s.error}` : `${s.leads} lead(s)`}`);
  for (const s of skippedSources) out.push(`  ${pad(s.id, 30)} skipped - ${s.reason}`);
  if (!report.sources.length && !skippedSources.length) out.push('  (none)');

  const fresh = report.items.filter((i) => !i.attached);
  out.push('', `Leads: ${fresh.length} new candidate(s), ${report.attached} added to an existing candidate, ${report.already_seen} seen before, ${report.skipped.length} skipped.`);
  if (report.items.length) {
    out.push('Status:', ...Object.entries(count(report.items, 'status')).map(([k, v]) => `  ${pad(k, 14)} ${v}`));
    out.push('', table(report.items.map((i) => ({
      id: i.id, status: i.status, resolution: i.resolution ?? '', confidence: i.score != null ? `${i.confidence} ${i.score.toFixed(2)}` : '', match: i.match ?? '', name: i.name,
    })), ['id', 'status', 'resolution', 'confidence', 'match', 'name']));
  }
  if (report.applied.length) {
    out.push('', 'Existing companies enriched:');
    for (const a of report.applied) out.push(`  ${a.company_id}: ${a.evidence} evidence, ${a.identifiers.length} identifier(s)${a.filled.length ? `, filled ${a.filled.join('; ')}` : ''}${a.held.length ? ` - held: ${a.held.join('; ')}` : ''}`);
  }
  if (report.skipped.length) out.push('', 'Skipped:', ...report.skipped.map((s) => `  ${s.source}: ${s.reason}`));
  const refused = report.refused ?? [];
  if (refused.length) {
    out.push('', `Declined to read ${refused.length} page(s):`);
    for (const [code, n] of Object.entries(count(refused, 'code'))) out.push(`  ${pad(code, 20)} ${n}`);
    for (const r of refused.slice(0, 8)) out.push(`    ${r.url}  (${r.message})`);
  }
  if (report.requests != null) out.push('', `Requests made: ${report.requests}`);
  return out.join('\n');
}

export function renderQueue(candidates) {
  if (!candidates.length) return 'No candidates.';
  return table(candidates.map((c) => ({
    id: c.id, status: c.status, resolution: c.resolution, confidence: c.confidence ? `${c.confidence.label} ${c.confidence.score.toFixed(2)}` : '',
    au: c.australian?.verdict ?? '', startup: c.startup?.verdict ?? '', name: c.name,
  })), ['id', 'status', 'resolution', 'confidence', 'au', 'startup', 'name']);
}

const signalLine = (a) => (a ? `${a.verdict} (${a.score.toFixed(2)}): ${a.signals.map((s) => `${s.code} ${s.weight > 0 ? '+' : ''}${s.weight}`).join(', ') || 'no signals'}` : 'not assessed');

// The address, then the city and state only if the address does not already say them.
export function locationOf(c) {
  const address = c.address ?? '';
  // Whole words only: "WA" is not in "Swan Street" and a city with brackets is not a pattern.
  const says = (part) => new RegExp(`(?<![A-Za-z])${part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z])`, 'i').test(address);
  const parts = [address, ...[c.city, c.state].filter((p) => p && !says(p))];
  return parts.filter(Boolean).join(', ') || '(unknown)';
}

export function renderCandidate(c) {
  const out = [
    `${c.name}  [${c.id}]`,
    `  status      ${c.status}${c.review ? ` - ${c.review.by}, ${c.review.at}${c.review.note ? `: ${c.review.note}` : ''}` : ''}`,
    `  website     ${c.website ?? '(none)'}`,
    `  location    ${locationOf(c)}`,
  ];
  if (c.aliases.length) out.push(`  names       ${c.aliases.join('; ')}`);
  if (c.founders.length) out.push(`  founders    ${c.founders.join(', ')}`);
  if (c.external_ids.abn || c.external_ids.acn) out.push(`  registry    ${[c.external_ids.abn && `ABN ${c.external_ids.abn}`, c.external_ids.acn && `ACN ${c.external_ids.acn}`].filter(Boolean).join(', ')}`);
  out.push(`  confidence  ${c.confidence ? `${c.confidence.label} ${c.confidence.score.toFixed(2)} (Australian ${c.confidence.breakdown.australian}, startup ${c.confidence.breakdown.startup}, evidence ${c.confidence.breakdown.evidence}${c.confidence.breakdown.caps.length ? `; capped: ${c.confidence.breakdown.caps.join(', ')}` : ''})` : 'not scored'}`);
  out.push(`  Australian  ${signalLine(c.australian)}`, `  startup     ${signalLine(c.startup)}`);
  out.push('', `Found by ${c.discoveries.length} observation(s):`);
  for (const d of c.discoveries) out.push(`  ${d.observed_at.slice(0, 10)}  ${d.source_id}${d.title ? `  "${d.title}"` : ''}${d.url ? `  ${d.url}` : ''}`);
  if (c.matches.length) {
    out.push('', 'Possible duplicates:');
    for (const m of c.matches) out.push(`  ${describeMatch({ ...m, target: { kind: m.kind, id: m.id, name: m.name } })}`);
  } else out.push('', `Resolution: ${c.resolution}${c.decisions.not_same_as.length ? ` (confirmed not the same as ${c.decisions.not_same_as.join(', ')})` : ''}`);
  if (c.evidence.length) {
    out.push('', 'Evidence:');
    for (const e of c.evidence) out.push(`  ${pad(e.field, 20)} ${pad(JSON.stringify(e.value), 38)} ${pad(e.confidence, 7)} ${e.source.kind}${e.source.url ? ` ${e.source.url}` : ''}`);
  }
  if (c.notes.length) out.push('', 'Notes:', ...c.notes.map((n) => `  ${n.at.slice(0, 10)} ${n.by}: ${n.text}`));
  out.push('', 'History:', ...c.status_history.map((h) => `  ${h.at.slice(0, 16)}  ${pad(h.status, 13)} ${h.by}${h.note ? ` - ${h.note}` : ''}`));
  return out.join('\n');
}
