// What a person can do with a candidate. The engine never takes any of these steps
// itself: approving, merging and publishing are human decisions, and each one is
// recorded with who made it and when.
//
//   approve      "this is a new company"        needs_review -> approved
//   reject       "no"                            -> rejected (kept, so it is not rediscovered)
//   reopen       "look again"                    rejected -> needs_review
//   markDistinct "this is not that company"      settles one possible duplicate
//   merge        "this is that company"          -> merged, enriching the existing record
//   renameCompany  a rebrand: the old name is kept as a former name
//
// Each works on a dataset in memory and changes it in place, so a caller passes a
// working copy, then migrates, validates and writes it (scripts/discovery.js does).
import { moveTo } from '../models/candidate.js';
import { isStr } from '../models/company.js';
import { nameKey, parseNameVariants } from '../models/identity.js';
import { buildIndex, resolveCandidate } from './resolve.js';
import { scoreCandidate } from './score.js';
import { applyEnrichment, addIdentifier } from './publish.js';

const unique = (list) => [...new Set(list)];

function find(work, id) {
  const candidate = work.candidates.find((c) => c.id === id);
  if (!candidate) throw new Error(`no candidate "${id}"`);
  return candidate;
}
function replace(work, next) {
  work.candidates[work.candidates.findIndex((c) => c.id === next.id)] = next;
  return next;
}
function requirePerson(by) {
  if (!isStr(by)) throw new Error('say who is deciding (by): every review decision is recorded with a name');
}

export function approveCandidate(work, id, { by, note = null, at }) {
  requirePerson(by);
  const c = find(work, id);
  if (c.status !== 'needs_review') throw new Error(`candidate ${id} is ${c.status}: only a candidate waiting for review can be approved`);
  if (c.resolution !== 'NEW_COMPANY') {
    throw new Error(`candidate ${id} still has possible duplicates (${c.matches.map((m) => m.name).join(', ')}): mark each as distinct, or merge it, before approving`);
  }
  const next = moveTo(c, 'approved', { at, by, note });
  next.review = { by, at, note };
  return replace(work, next);
}

export function rejectCandidate(work, id, { by, reason, at }) {
  requirePerson(by);
  if (!isStr(reason)) throw new Error('say why it is rejected (reason)');
  const c = find(work, id);
  const next = moveTo(c, 'rejected', { at, by, note: reason });
  next.review = { by, at, note: reason };
  return replace(work, next);
}

export function reopenCandidate(work, id, { by, at }) {
  requirePerson(by);
  const c = find(work, id);
  const next = moveTo(c, 'needs_review', { at, by, note: 'reopened' });
  next.review = null;
  return replace(work, next);
}

// "This is not that company": the engine stops proposing the match, and re-resolves
// what is left. If nothing is left the candidate becomes a clean NEW_COMPANY.
export function markDistinct(work, id, otherId, { by, at, note = null }) {
  requirePerson(by);
  const c = find(work, id);
  if (!['needs_review', 'matched'].includes(c.status)) throw new Error(`candidate ${id} is ${c.status}: its matches can only be settled while it waits for review`);
  const exists = work.companies.some((x) => x.id === otherId) || work.candidates.some((x) => x.id === otherId);
  if (!exists) throw new Error(`no company or candidate "${otherId}"`);
  const other = work.companies.find((x) => x.id === otherId)?.name ?? work.candidates.find((x) => x.id === otherId)?.name;
  let next = { ...c, decisions: { ...c.decisions, not_same_as: unique([...c.decisions.not_same_as, otherId]) } };
  next = { ...next, ...resolveCandidate(next, buildIndex(work)) };
  next.confidence = scoreCandidate(next);
  next = moveTo(next, 'needs_review', { at, by, note: note ?? `not the same as ${other}` });
  next.notes = [...next.notes, { at, by, text: `Confirmed not the same as ${other} (${otherId}).` }];
  return replace(work, next);
}

// "This is that company": merge into the existing record, with a person's say-so,
// which is what allows its name and other identifiers to become aliases.
export function mergeCandidate(work, id, companyId, { by, at }) {
  requirePerson(by);
  const c = find(work, id);
  if (!['needs_review', 'matched'].includes(c.status)) throw new Error(`candidate ${id} is ${c.status}: only one waiting for review can be merged`);
  if (!work.companies.some((x) => x.id === companyId)) throw new Error(`no company "${companyId}"`);
  const { candidate, summary } = applyEnrichment(work, c, { by, at, companyId, confirmedByPerson: true });
  replace(work, candidate);
  return summary;
}

// A rebrand. The company keeps its id and slug (links and relationships must not
// break); the new name goes on the record and every name it used to have is kept as
// an alias or former name, so the old name still finds it.
export function renameCompany(work, companyId, newName, { by, at, reason = null }) {
  requirePerson(by);
  const company = work.companies.find((c) => c.id === companyId);
  if (!company) throw new Error(`no company "${companyId}"`);
  const name = String(newName ?? '').replace(/\s+/g, ' ').trim();
  if (!name) throw new Error('say the new name');
  const old = parseNameVariants(company.name);
  if (nameKey(parseNameVariants(name).primary) === nameKey(old.primary) && !old.aliases.length && !old.formerNames.length) throw new Error('that is already its name');
  const previous = company.name;
  company.name = name;
  company.updated_at = at;
  const note = `Renamed from "${previous}" by ${by} on ${at.slice(0, 10)}${reason ? `: ${reason}` : ''}.`;
  const kept = [];
  const keep = (scheme, value) => { const r = addIdentifier(work, company, scheme, value, { note }); if (r.added) kept.push(`${scheme}: ${value}`); };
  keep('former_name', old.primary);
  for (const a of old.aliases) keep('alias', a);
  for (const f of old.formerNames) keep('former_name', f);
  return { company_id: companyId, from: previous, to: name, kept };
}
