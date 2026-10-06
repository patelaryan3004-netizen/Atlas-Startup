// The only two places discovery data touches the company database:
//
//   applyEnrichment   an exact (or human-confirmed) match: enrich the existing company
//   publishCandidate  an approved new company: add it
//
// Both work on a dataset the caller then migrates, validates and writes; neither
// writes a file. Both are conservative:
//   - Enrichment always adds evidence and identifiers. It fills a company field only
//     if the record leaves it unknown (founders, founded year, website), and never
//     overwrites a value. A name is added as an alias only when the match was on a
//     strong name relation or a person confirmed it, so a lookalike name from a
//     doubtful submission cannot become an alias of a real company.
//   - Publishing needs an approved candidate, and creates the record with exactly
//     what is known: sector and stage stay "Unknown" unless the evidence says, the
//     description is left for a person to write, and the location is unconfirmed
//     (no pin) unless the reviewer supplies and confirms one, at the precision it is
//     known (an address, a suburb or only the city: enrichment/fill.js, confirmLocation).
import { slugify, uniqueSlug } from '../models/company.js';
import { confirmLocation } from '../enrichment/fill.js';
import { makeEvidenceRow, valuesEqual } from '../models/evidence.js';
import { makeIdentifierRow } from '../models/identifiers.js';
import { moveTo } from '../models/candidate.js';
import { canonicalDomain, nameKey, parseNameVariants, personKey, isValidABN, isValidACN } from '../models/identity.js';

const STRONG_NAME = ['name_exact', 'name_legal', 'name_alias', 'name_former'];
const LEGAL_FORM = /\bPty\.?\s+(?:Ltd|Limited)\b/i;
const unique = (list) => [...new Set(list)];

// ---------- sources and evidence ----------

function hostPath(url) {
  try { const u = new URL(url); return `${u.hostname}${u.pathname}`.replace(/\/+$/, ''); } catch { return url; }
}

// The id of the source row for this document, creating the row if it is new.
export function ensureSource(work, src) {
  if (src.url) {
    const hit = work.sources.find((s) => s.url === src.url);
    if (hit) return hit.id;
  }
  const taken = new Set(work.sources.map((s) => s.id));
  const label = src.url ? hostPath(src.url) : `${src.kind} ${src.title ?? ''}`;
  const id = uniqueSlug(slugify(label).slice(0, 64) || 'source', taken);
  work.sources.push({
    id, kind: src.kind, url: src.url ?? null, title: src.title ?? null, publisher: src.publisher ?? null,
    retrieved_at: src.retrieved_at ?? null, note: src.note ?? '',
  });
  return id;
}

// Adds each piece of candidate evidence to the company, once.
export function promoteEvidence(work, companyId, rows) {
  const added = [];
  for (const e of rows) {
    const sourceId = ensureSource(work, e.source);
    const already = work.evidence.some((x) => x.company_id === companyId && x.field === e.field && x.source_id === sourceId && valuesEqual(e.field, x.value, e.value));
    if (already) continue;
    const row = makeEvidenceRow({
      company_id: companyId, field: e.field, value: e.value, source_id: sourceId, confidence: e.confidence,
      verified_at: e.verified_at ?? null, status: 'active', note: e.note ?? null,
    }, new Set(work.evidence.map((x) => x.id)));
    work.evidence.push(row);
    added.push(row);
  }
  return added;
}

// ---------- identifiers ----------

// Adds an identifier unless it is invalid, repeats one, is the company's own name,
// or belongs to another company. Returns { added } or { held: reason }.
export function addIdentifier(work, company, scheme, value, { sourceId = null, note }) {
  const row = makeIdentifierRow({ company_id: company.id, scheme, value, source_id: sourceId, note: sourceId ? null : note }, new Set(work.identifiers.map((i) => i.id)));
  if (!row.value || (scheme === 'abn' && !isValidABN(row.value)) || (scheme === 'acn' && !isValidACN(row.value))) return { held: `${scheme} "${value}" is not valid` };
  const isName = ['alias', 'former_name', 'legal_name'].includes(scheme);
  const key = isName ? nameKey(row.value) : row.value;
  const same = (i) => i.scheme === scheme && (isName ? nameKey(i.value) : i.value) === key;
  if (work.identifiers.some((i) => i.company_id === company.id && same(i))) return { held: 'already recorded' };
  if (!isName) {
    const owner = work.identifiers.find((i) => i.company_id !== company.id && same(i));
    if (owner) return { held: `${scheme} ${row.value} already belongs to ${owner.company_id}` };
    if (scheme === 'domain') {
      const site = work.companies.find((c) => c.id !== company.id && canonicalDomain(c.website)?.domain === row.value);
      if (site) return { held: `domain ${row.value} is the website of ${site.name}` };
    }
  } else if (scheme !== 'legal_name') {
    const own = parseNameVariants(company.name);
    if ([own.primary, ...own.aliases, ...own.formerNames].some((n) => nameKey(n) === key)) return { held: 'already one of its names' };
  }
  work.identifiers.push(row);
  return { added: row };
}

// ---------- enriching an existing company ----------

const mediumUp = (e) => e.confidence === 'high' || e.confidence === 'medium';

export function applyEnrichment(work, candidate, { by, at, companyId = null, confirmedByPerson = false }) {
  const targetId = companyId ?? (candidate.matches[0]?.kind === 'company' ? candidate.matches[0].id : null);
  const company = work.companies.find((c) => c.id === targetId);
  if (!company) throw new Error(`candidate ${candidate.id} has no company to enrich`);
  const summary = { company_id: company.id, evidence: 0, identifiers: [], filled: [], held: [] };

  summary.evidence = promoteEvidence(work, company.id, candidate.evidence).length;

  const best = candidate.matches.find((m) => m.id === company.id);
  const strong = confirmedByPerson || (best?.signals ?? []).some((s) => STRONG_NAME.includes(s.code) || s.code.endsWith('_match') && /^(abn|acn)/.test(s.code));
  const sourceId = candidate.evidence[0] ? ensureSource(work, candidate.evidence[0].source) : null;
  const note = `Found by the discovery engine (${candidate.discoveries[0]?.source_id ?? 'unknown source'}).`;
  const record = (scheme, value) => {
    const r = addIdentifier(work, company, scheme, value, { sourceId, note });
    if (r.added) summary.identifiers.push(`${scheme}: ${r.added.value}`);
    else if (r.held !== 'already recorded' && r.held !== 'already one of its names') summary.held.push(`${scheme} "${value}" not recorded: ${r.held}`);
  };

  // Names: legal names are facts from the company's own page; any other name is
  // added only on a strong name relation or a person's say-so.
  const names = unique([candidate.name, ...candidate.aliases]);
  for (const name of names) {
    if (nameKey(name) === nameKey(parseNameVariants(company.name).primary)) continue;
    if (LEGAL_FORM.test(name)) record('legal_name', name);
    else if (strong) record('alias', name);
    else summary.held.push(`name "${name}" not added as an alias: it matches only loosely (confirm with merge)`);
  }
  if (candidate.external_ids.abn) record('abn', candidate.external_ids.abn);
  if (candidate.external_ids.acn) record('acn', candidate.external_ids.acn);
  const siteDomain = canonicalDomain(company.website)?.domain ?? null;
  if (candidate.domain && candidate.domain !== siteDomain) {
    const idMatch = (best?.signals ?? []).some((s) => /^(abn|acn)_match$/.test(s.code));
    if (confirmedByPerson || idMatch) record('domain', candidate.domain);
    else summary.held.push(`domain ${candidate.domain} not added: it differs from the company's website`);
  }

  // Fill only what the record leaves unknown, from evidence of at least medium confidence.
  const evidence = (field) => candidate.evidence.filter((e) => e.field === field && mediumUp(e));
  if (!(company.founders?.length)) {
    const names2 = unique(evidence('founders').map((e) => e.value)).filter((n) => personKey(n));
    if (names2.length) { company.founders = names2; summary.filled.push(`founders: ${names2.join(', ')}`); }
  }
  if (company.foundedYear == null) {
    const years = unique(evidence('founded_year').map((e) => e.value));
    if (years.length === 1) { company.foundedYear = years[0]; summary.filled.push(`foundedYear: ${years[0]}`); }
  }
  if (!company.website && candidate.website && candidate.evidence.some((e) => e.field === 'website' && e.confidence === 'high')) {
    company.website = candidate.website;
    summary.filled.push(`website: ${candidate.website}`);
  }

  const next = moveTo({ ...candidate, decisions: { ...candidate.decisions, same_as: company.id } }, 'merged', { at, by, note: `enriched ${company.name}` });
  next.review = { by, at, note: confirmedByPerson ? 'confirmed to be the same company' : 'exact match, enriched automatically' };
  next.notes = [...next.notes, ...summary.held.map((text) => ({ at, by, text }))];
  // The dataset is updated here too, so a caller cannot leave the company enriched and
  // its candidate still waiting.
  const slot = work.candidates.findIndex((c) => c.id === candidate.id);
  if (slot >= 0) work.candidates[slot] = next;
  return { candidate: next, summary };
}

// ---------- publishing a new company ----------

export function publishCandidate(work, candidateId, { by, at, location = null }) {
  const candidate = work.candidates.find((c) => c.id === candidateId);
  if (!candidate) throw new Error(`no candidate "${candidateId}"`);
  if (candidate.status !== 'approved') throw new Error(`candidate ${candidateId} is ${candidate.status}: only an approved candidate can be published`);

  const id = uniqueSlug(slugify(candidate.name), new Set(work.companies.map((c) => c.id)));
  const slug = uniqueSlug(slugify(candidate.name), new Set(work.companies.map((c) => c.slug).filter(Boolean)));
  const known = (field) => candidate.evidence.filter((e) => e.field === field && mediumUp(e)).map((e) => e.value);
  const only = (field) => { const v = unique(known(field)); return v.length === 1 ? v[0] : null; };

  const address = candidate.address ?? null;
  const founders = unique(known('founders'));
  const year = only('founded_year');
  const round = only('last_funding_round');
  // A sector is only ever a reviewer's choice (no source states it), so it is there only if one was made.
  const sector = only('sector') ?? 'Unknown';
  // Not located until a person confirms a place (below): what the candidate claims about where it is, is a claim.
  const record = {
    name: candidate.name,
    sector, sectorFull: sector,
    city: candidate.city ?? 'Unknown',
    lat: null, lng: null,
    investors: unique(known('investors')),
    stage: only('stage') ?? round ?? 'Unknown',
    hiring: false, verified: false,
    website: candidate.website ?? '', blurb: '',
    taskGate: { enabled: false, type: null },
    ...(address ? { address } : {}), ...(founders.length ? { founders } : {}), ...(year ? { foundedYear: year } : {}),
    id, slug, ...(round ? { last_funding_round: round } : {}), created_at: at, updated_at: at,
  };
  // A place a person confirmed: how precisely it is known (an address and a point, a suburb and a point, or the
  // city alone) is recorded with it, and a company confirmed to its city alone goes on the map as a city-level group.
  if (location) confirmLocation(record, location, { at });
  work.companies.push(record);
  promoteEvidence(work, id, candidate.evidence);

  const sourceId = candidate.evidence[0] ? ensureSource(work, candidate.evidence[0].source) : null;
  const note = `Found by the discovery engine (${candidate.discoveries[0]?.source_id ?? 'unknown source'}).`;
  for (const alias of candidate.aliases) addIdentifier(work, record, LEGAL_FORM.test(alias) ? 'legal_name' : 'alias', alias, { sourceId, note });
  if (candidate.external_ids.abn) addIdentifier(work, record, 'abn', candidate.external_ids.abn, { sourceId, note });
  if (candidate.external_ids.acn) addIdentifier(work, record, 'acn', candidate.external_ids.acn, { sourceId, note });

  const published = moveTo(candidate, 'published', { at, by, note: `published as ${id}` });
  published.published_company_id = id;
  // Placed back into the dataset here, so an approved candidate cannot be published twice.
  work.candidates[work.candidates.findIndex((c) => c.id === candidate.id)] = published;
  return { company: record, candidate: published };
}
