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
import { isStr, AU_STATES } from '../models/company.js';
import { nameKey, parseNameVariants, websiteUrl, canonicalDomain, personKey } from '../models/identity.js';
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

// ---------- editing a candidate ----------

export const EDITABLE = ['name', 'aliases', 'website', 'city', 'state', 'address', 'description', 'founders', 'sector', 'stage'];
const TEXT_LIMIT = { city: 80, address: 200, description: 500 };

// A reviewer's correction to what the engine found. What it changes:
//   - the candidate's own fields (name, aliases, website, city, state, address, description, founders);
//   - sector and stage, which a candidate has no field for, as evidence a reviewer supplied: medium confidence,
//     because it is a person's editorial call, and it is what publishing reads;
//   - a new name keeps the old one as an alias: names are preserved, never replaced.
// Afterwards the candidate is checked for duplicates again and rescored: a changed name or website can make it
// a different company, or the same as one we have. If that is no longer what its status promised (an approved
// candidate that now looks like a duplicate), it goes back to review. Nothing here is silent: the candidate gets
// a note saying who changed what.
export function editCandidate(work, id, patch, { by, at, keepOldName = true }) {
  requirePerson(by);
  const c = find(work, id);
  if (!['candidate', 'needs_review', 'matched', 'approved'].includes(c.status)) throw new Error(`candidate ${id} is ${c.status}: it can no longer be edited`);
  const unknownKeys = Object.keys(patch).filter((k) => !EDITABLE.includes(k));
  if (unknownKeys.length) throw new Error(`cannot edit ${unknownKeys.join(', ')}: only ${EDITABLE.join(', ')}`);

  const next = { ...c, evidence: [...c.evidence], aliases: [...c.aliases] };
  const changed = [];
  const text = (key, value) => {
    const s = value == null ? null : String(value).replace(/\s+/g, ' ').trim() || null;
    if (s && s.length > TEXT_LIMIT[key]) throw new Error(`${key} is longer than ${TEXT_LIMIT[key]} characters`);
    return s;
  };

  if ('name' in patch) {
    const name = String(patch.name ?? '').replace(/\s+/g, ' ').trim();
    if (name.length < 2 || name.length > 80 || !nameKey(name)) throw new Error('the name must be 2 to 80 characters');
    if (name !== c.name) {
      // The old name stays as an alias (a rebrand keeps its former name). A reviewer correcting a name that was
      // simply wrong can say so (keepOldName: false), so the wrong name does not keep the old match alive; the
      // audit trail still records it.
      next.aliases = unique([...(keepOldName && nameKey(c.name) !== nameKey(name) ? [c.name] : []), ...next.aliases.filter((a) => nameKey(a) !== nameKey(name) && (keepOldName || nameKey(a) !== nameKey(c.name)))]);
      next.name = name;
      changed.push('name');
    }
  }
  if ('aliases' in patch) {
    if (!Array.isArray(patch.aliases) || patch.aliases.some((a) => !isStr(a))) throw new Error('aliases must be a list of names');
    // An alias can be added or removed by a person, but the old name a rename produced is not lost by editing the list.
    const cleaned = unique(patch.aliases.map((a) => a.replace(/\s+/g, ' ').trim()).filter((a) => nameKey(a) && nameKey(a) !== nameKey(next.name)));
    if (JSON.stringify(cleaned) !== JSON.stringify(next.aliases)) { next.aliases = cleaned; changed.push('aliases'); }
  }
  if ('website' in patch) {
    const raw = patch.website == null ? '' : String(patch.website).trim();
    const url = raw ? websiteUrl(raw) : null;
    if (raw && !url) throw new Error(`"${raw}" is not a usable company website`);
    if (url !== c.website) {
      const d = url ? canonicalDomain(url) : null;
      Object.assign(next, { website: url, domain: d && !d.nonCompany ? d.domain : null });
      if (url) next.evidence.push({ field: 'website', value: url, confidence: 'low', verified_at: null, note: `Supplied by ${by}.`, source: { kind: 'user_supplied', url: null, title: 'Supplied by a reviewer', publisher: by, retrieved_at: at, note: '' } });
      changed.push('website');
    }
  }
  for (const key of ['city', 'address', 'description']) {
    if (!(key in patch)) continue;
    const v = text(key, patch[key]);
    if (v !== (c[key] ?? null)) { next[key] = v; changed.push(key); }
  }
  if ('state' in patch) {
    const v = patch.state == null || patch.state === '' ? null : String(patch.state).toUpperCase();
    if (v !== null && !AU_STATES.includes(v)) throw new Error(`state must be one of ${AU_STATES.join(', ')}`);
    if (v !== (c.state ?? null)) { next.state = v; changed.push('state'); }
  }
  if ('founders' in patch) {
    if (!Array.isArray(patch.founders) || patch.founders.some((f) => !isStr(f) || !personKey(f))) throw new Error('each founder needs a first and last name');
    const founders = unique(patch.founders.map((f) => f.replace(/\s+/g, ' ').trim()));
    if (JSON.stringify(founders) !== JSON.stringify(c.founders)) {
      next.founders = founders;
      for (const f of founders.filter((x) => !c.founders.includes(x))) next.evidence.push(chosenBy('founders', f, by, at));
      changed.push('founders');
    }
  }
  for (const field of ['sector', 'stage']) {
    if (!(field in patch)) continue;
    const value = patch[field] == null ? null : String(patch[field]).replace(/\s+/g, ' ').trim() || null;
    const before = c.evidence.filter((e) => e.field === field && e.source?.kind === 'user_supplied').at(-1)?.value ?? null;
    if (value === before) continue;
    next.evidence = next.evidence.filter((e) => !(e.field === field && e.source?.kind === 'user_supplied'));
    if (value) next.evidence.push(chosenBy(field, value, by, at));
    changed.push(field);
  }
  if (!changed.length) throw new Error('nothing was changed');

  let edited = { ...next, ...resolveCandidate(next, buildIndex(work)) };
  edited.confidence = scoreCandidate(edited);
  edited.notes = [...edited.notes, { at, by, text: `Edited by ${by}: ${changed.join(', ')}.` }];
  edited = reroute(edited, { at, by });
  return replace(work, edited);
}

const chosenBy = (field, value, by, at) => ({ field, value, confidence: 'medium', verified_at: null, note: `Chosen by ${by}.`, source: { kind: 'user_supplied', url: null, title: 'Chosen by a reviewer', publisher: by, retrieved_at: at, note: '' } });

// After an edit, a candidate stays where it was only if that is still true of it.
function reroute(c, { at, by }) {
  const exact = c.resolution === 'EXACT_MATCH' && c.matches[0]?.kind === 'company';
  const go = (status, note) => moveTo(c, status, { at, by, note });
  if (c.status === 'matched' && !exact) return go('needs_review', 'edited: no longer an exact match for a company');
  if (c.status === 'approved' && c.resolution !== 'NEW_COMPANY') return go('needs_review', 'edited: it now looks like a company we have, so it needs a second look');
  if (c.status === 'needs_review' && exact) return go('matched', `edited: now an exact match for ${c.matches[0].name}`);
  return c;
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
