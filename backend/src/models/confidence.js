// How far the facts a company record STATES are backed by evidence: 0 to 1, or null
// when no evidence has ever been recorded for it ("not assessed"). It measures trust in
// what is published, not completeness (the audit does that): a record with few facts that
// are all confirmed by the company's own site scores high, a full record nobody has checked
// scores low.
//
// For each fact the record states (an unknown value is not a fact), take how reliable its
// best active evidence is:
//     high 1.0 · medium 0.7 · low 0.4 · a stated fact nothing backs 0.25
//     and 0.2 when another active source disagrees with it
// then average, weighting the facts the map and its filters rest on.
//
// The score is derived, like last_verified_at: the migration recomputes it from the
// evidence, so it can never drift from it, and it moves when a person settles a conflict.
import { activeEvidence, storedValue, valuesEqual, bestConfidence, EVIDENCE_FIELDS } from './evidence.js';

export const CONFIDENCE_WEIGHTS = { website: 2, city: 2, description: 1, sector: 1, stage: 1, founders: 1, founded_year: 1, investors: 1 };
export const RELIABILITY = { high: 1, medium: 0.7, low: 0.4 };
export const UNSOURCED = 0.25;
export const CONFLICTED = 0.2;

// How reliable is one stated value, given the active evidence rows for its field.
function reliability(field, value, rows) {
  const support = rows.filter((r) => valuesEqual(field, value, r.value));
  if (EVIDENCE_FIELDS[field].cardinality === 'single' && rows.some((r) => !valuesEqual(field, value, r.value))) {
    return Math.min(support.length ? RELIABILITY[bestConfidence(support.map((r) => r.confidence))] : UNSOURCED, CONFLICTED);
  }
  return support.length ? RELIABILITY[bestConfidence(support.map((r) => r.confidence))] : UNSOURCED;
}

export function companyConfidence(company, rows) {
  let total = 0;
  let weight = 0;
  for (const [field, w] of Object.entries(CONFIDENCE_WEIGHTS)) {
    const stored = storedValue(company, field);
    if (stored == null) continue;
    const forField = rows.filter((r) => r.field === field);
    const r = EVIDENCE_FIELDS[field].cardinality === 'multi'
      ? stored.reduce((sum, member) => sum + reliability(field, member, forField), 0) / stored.length
      : reliability(field, stored, forField);
    total += r * w;
    weight += w;
  }
  return weight ? Math.round((total / weight) * 100) / 100 : null;
}

export const confidenceLabel = (score) => (score == null ? 'not assessed' : score >= 0.75 ? 'high' : score >= 0.5 ? 'medium' : 'low');

// The derived score for every company that has active evidence; the rest are left as they are.
export function syncConfidence(companies, evidence) {
  const rows = activeEvidence({ evidence });
  const byCompany = new Map();
  for (const r of rows) (byCompany.get(r.company_id) ?? byCompany.set(r.company_id, []).get(r.company_id)).push(r);
  for (const c of companies) {
    const mine = byCompany.get(c.id);
    if (mine?.length) c.confidence_score = companyConfidence(c, mine);
  }
}
