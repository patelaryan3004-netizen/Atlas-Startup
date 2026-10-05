// Renders an audit (see audit.js) as console text, a Markdown report and CSV.
// Presentation only: nothing here reads or changes the dataset.
import { ATTRIBUTES, TASKS, GENERIC_SECTORS, STAGE_VOLATILITY } from './audit.js';

const pct = (n, total) => (total ? `${((100 * n) / total).toFixed(1)}%` : 'n/a');
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const table = (headers, rows) => [
  `| ${headers.join(' | ')} |`,
  `|${headers.map(() => '---').join('|')}|`,
  ...rows.map((r) => `| ${r.map(esc).join(' | ')} |`),
].join('\n');

// In the order the audit was specified, then the extra checks.
const CATEGORIES = [
  ['unknown_values', 'Contains the literal "Unknown"'],
  ['missing_values', 'Missing a core attribute (empty or absent)'],
  ['null_values', 'Explicit null in a content attribute'],
  ['invalid_urls', 'Invalid website URL'],
  ['missing_coordinates', 'Confirmed location without coordinates'],
  ['generic_sectors', 'Generic sector'],
  ['stale_hiring', 'Hiring status with no recent dated check'],
  ['stale_stage', 'Stage with no recent dated check'],
  ['defunct', 'Defunct'],
  ['acquired', 'Acquired or a subsidiary'],
  ['unpinned_unconfirmed', 'No coordinates (location unconfirmed, so expected)'],
  ['outside_australia', 'Pin outside Australia'],
  ['hiring_on_defunct', 'Flagged hiring but defunct'],
  ['possible_duplicates', 'Possible duplicate'],
  ['source_conflicts', 'Sources disagree'],
];

const TIER_NAMES = {
  P0: 'Integrity - public data is wrong or contradicts itself',
  P1: 'Core identity - what the map, filters and cards show',
  P2: 'Freshness and confidence - claims worth re-checking',
  P3: 'Depth - nice to have, and the unverified long tail',
};

function notPresent(a) {
  return ['unknown', 'empty', 'missing', 'null', 'invalid'].filter((k) => a[k]).map((k) => `${a[k]} ${k}`).join(', ') || '-';
}

const uniqueCompanies = (list) => new Set(list.map((x) => x.id)).size;

const splitByRisk = (list) => {
  const n = {};
  for (const x of list) { const risk = x.detail.split(' ')[0]; n[risk] = (n[risk] || 0) + 1; }
  return ['high', 'medium', 'low'].filter((r) => n[r]).map((r) => `${n[r]} ${r} risk`).join(', ');
};

function examples(list, max = 8) {
  const names = [...new Set(list.map((x) => x.name))];
  return names.length <= max ? names.join(', ') : `${names.slice(0, max).join(', ')} and ${names.length - max} more`;
}

// "website 46, description 17": how many companies each value or field accounts for.
function breakdown(list, { split = true, max = 8 } = {}) {
  const counts = new Map();
  for (const x of list) {
    for (const part of split ? String(x.detail).split(', ') : [String(x.detail)]) counts.set(part, (counts.get(part) || 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const shown = sorted.slice(0, max).map(([k, n]) => `${k} ${n}`).join(', ');
  return sorted.length > max ? `${shown} and ${sorted.length - max} more` : shown;
}

function categoryCell(key, list) {
  if (key === 'stale_hiring' || key === 'stale_stage') return splitByRisk(list);
  if (key === 'unknown_values' || key === 'missing_values' || key === 'null_values') return breakdown(list);
  if (key === 'generic_sectors') return breakdown(list, { split: false });
  if (key === 'source_conflicts') return list.map((x) => `${x.name} (${x.detail.split(':')[0]})`).join(', ');
  return examples(list);
}

// "Open tasks" for a queue row: repeated tasks collapse to "x2".
function taskSummary(tasks, max = 4) {
  const counts = new Map();
  for (const t of tasks) counts.set(t.issue, (counts.get(t.issue) || 0) + 1);
  const parts = [...counts.entries()].map(([issue, n]) => (n > 1 ? `${issue} x${n}` : issue));
  return parts.length > max ? `${parts.slice(0, max).join('; ')}; and ${parts.length - max} more` : parts.join('; ');
}

// ---------- console ----------

export function renderConsole(audit) {
  const h = audit.headline;
  const line = (label, n) => `${`${label}:`.padEnd(34)}${String(n).padStart(4)} / ${audit.total}  ${pct(n, audit.total)}`;
  const out = [
    `${audit.total} total companies (${audit.cohorts.withoutSources} with no recorded source, ${audit.cohorts.withSources} with sources) - as of ${audit.asOf}`,
    '',
    line('Website coverage', h.website),
    line('Sector coverage', h.sector),
    line('  ...with a specific sector', h.specificSector),
    line('Location coverage (city+state+pin)', h.location),
    line('Stage coverage', h.stage),
    line('Hiring flag recorded', h.hiring),
    line('Description coverage', h.description),
    line('Founder coverage', h.founder),
    line('Founded-year coverage', h.founded_year),
    line('Funding coverage', h.funding),
    line('Investor coverage', h.investors),
    line('Source coverage', h.source),
    line('Last-verified coverage', h.last_verified),
    '',
    'Issues:',
  ];
  for (const [key, label] of CATEGORIES) {
    const list = audit.issues[key] ?? [];
    out.push(`  ${label.padEnd(54)}${String(uniqueCompanies(list)).padStart(4)}`);
  }
  const t = audit.tierCounts;
  out.push('', `Enrichment queue: ${audit.queue.length} companies - P0 ${t.P0}, P1 ${t.P1}, P2 ${t.P2}, P3 ${t.P3}`);
  for (const q of audit.queue.slice(0, 10)) {
    out.push(`  #${String(q.rank).padStart(3)} ${q.priority} ${q.name.padEnd(28)} ${q.tasks.slice(0, 3).map((x) => x.code).join(', ')}`);
  }
  return out.join('\n');
}

// ---------- markdown ----------

export function renderMarkdown(audit, context = {}) {
  const h = audit.headline;
  const lines = [];
  const add = (...s) => lines.push(...s);

  add(`# Data completeness audit - ${audit.asOf}`, '',
    `${audit.total} companies: ${audit.cohorts.withoutSources} with no recorded source and ${audit.cohorts.withSources} with at least one.`,
    'Generated by `npm run data:audit`. The audit is read-only: it changes no company value and proposes none. The queue lists questions, not answers.', '');

  add('## Coverage', '',
    `- Website coverage: **${pct(h.website, h.total)}** (${h.website}/${h.total})`,
    `- Sector coverage: **${pct(h.sector, h.total)}** (${h.sector}/${h.total}); ${pct(h.specificSector, h.total)} with a specific sector`,
    `- Location coverage (city, state and a pin): **${pct(h.location, h.total)}** (${h.location}/${h.total})`,
    `- Stage coverage: **${pct(h.stage, h.total)}** (${h.stage}/${h.total})`,
    `- Founder coverage: **${pct(h.founder, h.total)}** (${h.founder}/${h.total})`,
    `- Funding coverage: **${pct(h.funding, h.total)}** (${h.funding}/${h.total})`,
    `- Investor coverage: **${pct(h.investors, h.total)}** (${h.investors}/${h.total})`,
    '',
    'Per attribute. "Evidence-backed" counts companies with at least one active evidence row for it, so a filled-in but unsourced field shows as the gap it is.', '',
    table(['Attribute', 'Have it', 'Coverage', 'Not present', 'Evidence-backed'],
      audit.attributes.map((a) => [a.label, a.present, pct(a.present, a.total), notPresent(a), `${a.evidenceBacked} (${pct(a.evidenceBacked, a.total)})`])),
    '',
    'Hiring status is a recorded flag on every company, but no legacy flag has a date, so "have it" says a value exists, not that it is current.', '');

  add('## Issues', '',
    table(['Check', 'Companies', 'Detail'],
      CATEGORIES.map(([key, label]) => [label, uniqueCompanies(audit.issues[key] ?? []), categoryCell(key, audit.issues[key] ?? [])])),
    '');

  if (audit.sectorVariants.length || audit.pins.sharedPoints) {
    add('### Also worth knowing', '');
    for (const group of audit.sectorVariants) {
      add(`- Sector spelled more than one way: ${group.map((v) => `${v.label} (${v.count})`).join(' / ')}. The sector filter lists each spelling as its own option and the map colours them separately.`);
    }
    const big = audit.pins.largest[0];
    if (big) {
      add(`- ${audit.pins.companiesOnSharedPoints} of ${audit.pins.pinned} pins share a point with another company (${audit.pins.distinctPoints} distinct points for ${audit.pins.pinned} pins). The largest stack is ${big.companies} companies at ${big.point}; ${big.withoutAddress} of them have no street address, so ${big.withoutAddress === big.companies ? 'it is' : 'much of it is'} a city-level fallback and not a street location.`);
    }
    add(`- Possible duplicates by website domain or name: ${audit.duplicates.length}.`, '');
  }

  const p = audit.provenance;
  add('## Provenance baseline', '',
    `- Sources on file: ${p.sources}. Evidence rows: ${p.evidence.rows} (${Object.entries(p.evidence.byStatus).map(([k, v]) => `${v} ${k}`).join(', ') || 'none'}); by confidence: ${Object.entries(p.evidence.byConfidence).map(([k, v]) => `${v} ${k}`).join(', ') || 'none'}.`,
    `- Companies with any evidence: ${p.evidence.companiesWithEvidence} of ${audit.total}.`,
    `- Open source conflicts: ${p.conflicts.length}. Evidence not yet applied to a record: ${p.unapplied.length}. Stored values backed only by low-confidence evidence: ${p.weak.length}.`, '');
  if (p.conflicts.length) {
    add('Open conflicts (a person decides; nothing was overwritten):', '');
    for (const c of p.conflicts) {
      add(`- **${c.company_name}** - ${c.field}, stored ${JSON.stringify(c.stored)}: ${c.values.map((v) => `${JSON.stringify(v.value)} (${v.best_confidence}, ${v.source_ids.join(', ')})`).join(' vs ')}`);
    }
    add('');
  }

  add('## Prioritized enrichment queue', '',
    `${audit.queue.length} companies have at least one open task. Full list: \`enrichment-queue-${audit.asOf}.csv\`.`, '',
    table(['Priority', 'Companies', 'Meaning'], ['P0', 'P1', 'P2', 'P3'].map((k) => [k, audit.tierCounts[k], TIER_NAMES[k]])), '');

  const packages = Object.entries(audit.taskCounts)
    .map(([code, n]) => ({ code, n, ...TASKS[code] }))
    .sort((a, b) => a.tier - b.tier || b.n - a.n);
  add('### Work packages', '', 'The same work grouped so it can be done in batches, in the order to do it.', '',
    table(['Tier', 'Task', 'Companies', 'What to do'], packages.map((x) => [`P${x.tier}`, x.issue, x.n, x.action])), '');

  add('### Top of the queue', '',
    table(['#', 'Priority', 'Company', 'Score', 'Open tasks'],
      audit.queue.slice(0, 25).map((q) => [q.rank, q.priority, q.name, q.score, taskSummary(q.tasks)])), '');

  add('## Method and definitions', '',
    `- **Present** means a real value. \`Unknown\`/\`N/A\`/\`TBD\`, empty strings and empty lists are not present, and the five ways the legacy data says "unknown" (literal Unknown, empty, absent key, null, empty list) are counted separately.`,
    '- **Location** needs city, state and coordinates inside Australia. **Funding** is any funding total, round or date, or a funding-round row. **Source** is at least one source on the record.',
    `- **Invalid URL** is checked for syntax only (parseable, http or https, a public host, not a social or aggregator site). Whether a site still loads is not checked.`,
    `- **Generic sector** is a business-model or product-type label: ${GENERIC_SECTORS.join(', ')}. Extend \`GENERIC_SECTORS\` in \`audit.js\` to change it.`,
    `- **Potentially stale** means no dated check on record, or one older than ${audit.params.hiringStaleDays} days for hiring and ${audit.params.stageStaleDays} days for stage. The legacy data has no observation dates, so every legacy record qualifies; risk tiers say which matter. Hiring is high risk when the flag is true (a public "hiring now" claim). Stage volatility: ${Object.entries(STAGE_VOLATILITY).map(([k, v]) => `${k} ${v}`).join(', ')}. An undated stage is queued as unverified (P3); it is queued as stale (P2) only when a known check is old or an early-stage label sits on a company founded six or more years ago.`,
    '- **Pin precision** is approximated by whether the record has a street address; companies without one are pinned at a postcode or city centre.',
    '- **Score** is the sum of the open tasks\' weights (see `TASKS` in `audit.js`). Companies are ordered by their most severe tier, then score, then prominence (later stage and hiring first), then name.');
  if (context.commitDates?.length) {
    add(`- **Data age.** startups.json was committed on ${context.commitDates.join(', ')} (git history). That bounds when a value was entered, not when it was last true.`);
  }
  add('');
  return lines.join('\n');
}

// ---------- CSV ----------

const cell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
// UTF-8 BOM so Excel reads non-ASCII text correctly; CRLF line endings.
export const toCsv = (columns, rows) =>
  `﻿${[columns.join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))].join('\r\n')}\r\n`;

export function queueToCsv(queue) {
  const columns = ['rank', 'priority', 'score', 'company_id', 'name', 'website', 'city', 'stage', 'hiring', 'on_map', 'tasks', 'issues', 'next_actions'];
  return toCsv(columns, queue.map((q) => ({
    rank: q.rank, priority: q.priority, score: q.score, company_id: q.company_id, name: q.name, website: q.website,
    city: q.city, stage: q.stage, hiring: q.hiring ? 'yes' : 'no', on_map: q.verified ? 'yes' : 'no',
    tasks: q.tasks.map((t) => t.code).join('; '),
    issues: q.tasks.map((t) => (t.detail ? `${t.issue} (${t.detail})` : t.issue)).join('; '),
    next_actions: [...new Set(q.tasks.slice(0, 3).map((t) => t.action))].join(' | '),
  })));
}

export function companiesToCsv(audit) {
  const columns = ['company_id', 'name', 'on_map', 'hiring_flag', ...ATTRIBUTES.map((a) => a.key), 'evidence_backed_attributes', 'priority', 'score', 'findings'];
  return toCsv(columns, audit.companies.map((c) => ({
    company_id: c.id, name: c.name, on_map: c.verified ? 'yes' : 'no', hiring_flag: c.hiring ? 'yes' : 'no',
    ...Object.fromEntries(ATTRIBUTES.map((a) => [a.key, c.states[a.key] === 'present' ? 'yes' : c.states[a.key]])),
    evidence_backed_attributes: ATTRIBUTES.filter((a) => c.evidence_backed[a.key]).length,
    priority: c.priority ?? '', score: c.score,
    findings: [...new Set(c.findings.map((f) => f.category))].join('; '),
  })));
}
