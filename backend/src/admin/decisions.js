// What a person decides about evidence, as changes to a working copy of the dataset (the service migrates,
// validates and writes it, with the audit row, in one transaction).
//
//   resolveConflict    two sources disagree, or a source disagrees with the record: one claim is right.
//                      The others are turned down (kept, with the reason: never deleted, so the claim is
//                      not added again), and the record is brought into line if it differs.
//   applySuggestion    evidence the record does not say yet is put on the record.
//   dismissSuggestion  evidence is turned down, with the reason.
//
// What it will not do: settle without a reason, put a value on the record that no source claims, move a
// company on the map without coordinates, or leave the conflict it was asked to settle still open. A
// location is the careful case: a pin on the map is public, so changing where a company is takes a confirmed
// place (coordinates inside Australia) or taking it off the map ("Unconfirmed"), and nothing less.
import { activeEvidence, detectConflicts, findUnappliedEvidence, valuesEqual, storedValue, EVIDENCE_FIELDS } from '../models/evidence.js';
import { setField, isUnknown, confirmLocation, unconfirmLocation, FILLABLE } from '../enrichment/fill.js';
import { BadRequestError, NotFoundError } from './errors.js';

export const LOCATION_FIELDS = ['city', 'state', 'address'];

export function reasonOf(reason) {
  const s = String(reason ?? '').replace(/\s+/g, ' ').trim();
  if (s.length < 3) throw new BadRequestError('say why, in a few words');
  if (s.length > 500) throw new BadRequestError('the reason is longer than 500 characters');
  return s;
}

const companyOf = (work, id) => work.companies.find((c) => c.id === id) ?? (() => { throw new NotFoundError(`no company "${id}"`); })();
const rowsFor = (work, companyId, field) => activeEvidence(work).filter((e) => e.company_id === companyId && e.field === field);

// The location a person confirms: a city and coordinates, with an address and a state if they have them.
function locationFrom(input) {
  const loc = input ?? {};
  return { city: loc.city, address: loc.address ?? null, state: loc.state ?? null, lat: Number(loc.lat), lng: Number(loc.lng) };
}

// input: { company_id, field, winner: 'stored' | { value }, record?, reason }
//   record (for a location field only): { type: 'keep' } | { type: 'confirm', location: { city, lat, lng, address?, state? } } | { type: 'unconfirm' }
export function resolveConflict(work, input, { by, at }) {
  const company = companyOf(work, input.company_id);
  const { field } = input;
  const spec = EVIDENCE_FIELDS[field];
  if (!spec) throw new BadRequestError(`unknown field "${field}"`);
  if (spec.cardinality !== 'single') throw new BadRequestError(`${field} can hold several values, so its evidence never conflicts`);
  const open = detectConflicts(work).find((c) => c.company_id === company.id && c.field === field);
  if (!open) throw new BadRequestError(`there is no open conflict on ${company.name}'s ${field}`);
  const reason = reasonOf(input.reason);

  const rows = rowsFor(work, company.id, field);
  const stored = storedValue(company, field);
  let winner;
  if (input.winner === 'stored') {
    if (stored == null) throw new BadRequestError('the record has no value to keep');
    winner = stored;
  } else {
    winner = input.winner?.value;
    if (winner === undefined || !rows.some((r) => valuesEqual(field, r.value, winner))) throw new BadRequestError('the winner must be one of the claims');
  }

  const changes = [];
  const differs = stored == null || !valuesEqual(field, stored, winner);
  if (LOCATION_FIELDS.includes(field)) {
    const record = input.record ?? { type: 'keep' };
    if (record.type === 'confirm') changes.push(...confirmLocation(company, locationFrom(record.location)));
    else if (record.type === 'unconfirm') changes.push(...unconfirmLocation(company));
    else if (record.type !== 'keep') throw new BadRequestError('record must be keep, confirm or unconfirm');
    else if (differs && stored != null) {
      // The record would go on contradicting the claim a person has just said is right.
      throw new BadRequestError(`the record says ${JSON.stringify(stored)}, not ${JSON.stringify(winner)}: confirm a location (with coordinates) or take the company off the map`);
    }
  } else if (differs) {
    if (!FILLABLE.includes(field)) throw new BadRequestError(`${field} cannot be applied to the record here: edit the record itself`);
    changes.push(...setField(company, field, winner));
  }

  // Every other claim is turned down, with the reason; the winner and its agreeing claims stay.
  const turnedDown = rowsFor(work, company.id, field).filter((r) => !valuesEqual(field, r.value, winner));
  for (const r of turnedDown) Object.assign(r, { status: 'rejected', note: `Turned down by ${by} on ${at.slice(0, 10)}: ${reason}` });

  if (detectConflicts(work).some((c) => c.company_id === company.id && c.field === field)) {
    throw new BadRequestError(`that would leave ${field} in conflict: the record would still disagree with what the sources say`);
  }
  return { company, winner, changes, turnedDown: turnedDown.map((r) => r.id), reason };
}

// input: { company_id, field, value, record? }  record: { type: 'address_only' } | { type: 'confirm', location }
export function applySuggestion(work, input, { by, at }) {
  const company = companyOf(work, input.company_id);
  const { field, value } = input;
  const spec = EVIDENCE_FIELDS[field];
  if (!spec) throw new BadRequestError(`unknown field "${field}"`);
  const support = rowsFor(work, company.id, field).filter((r) => valuesEqual(field, r.value, value));
  if (!support.length) throw new NotFoundError(`no active evidence says ${JSON.stringify(value)} for ${company.name}'s ${field}`);

  const changes = [];
  if (LOCATION_FIELDS.includes(field)) {
    const record = input.record;
    if (record?.type === 'address_only' && field === 'address') {
      const before = company.address ?? null;
      company.address = String(value).trim();
      if (before !== company.address) changes.push({ field: 'address', from: before, to: company.address });
    } else if (record?.type === 'confirm') changes.push(...confirmLocation(company, locationFrom(record.location)));
    else throw new BadRequestError('a location needs coordinates: confirm a place, or record the address text only');
  } else if (spec.cardinality === 'multi') {
    const have = storedValue(company, field) ?? [];
    if (have.some((m) => valuesEqual(field, m, value))) throw new BadRequestError(`${value} is already on the record`);
    changes.push(...setField(company, field, [value]));
  } else {
    if (!isUnknown(company, field)) throw new BadRequestError(`the record already has a ${field}: if the evidence disagrees, settle it as a conflict`);
    changes.push(...setField(company, field, value));
  }
  if (changes.length) company.updated_at = at;
  return { company, changes, evidence_ids: support.map((r) => r.id), by };
}

// input: { company_id, field, value, reason }
export function dismissSuggestion(work, input, { by, at }) {
  const company = companyOf(work, input.company_id);
  const reason = reasonOf(input.reason);
  const rows = rowsFor(work, company.id, input.field).filter((r) => valuesEqual(input.field, r.value, input.value));
  if (!rows.length) throw new NotFoundError(`no active evidence says ${JSON.stringify(input.value)} for ${company.name}'s ${input.field}`);
  for (const r of rows) Object.assign(r, { status: 'rejected', note: `Dismissed by ${by} on ${at.slice(0, 10)}: ${reason}` });
  return { company, evidence_ids: rows.map((r) => r.id), reason };
}

// The evidence the record does not say yet, for a person: one suggestion per company, field and value.
// Free text (a description) is not covered by the evidence model's own check, which compares values, so a blank
// description with a description on file is added here, as the strongest one.
export function suggestionsOf(ds) {
  const byId = new Map(ds.companies.map((c) => [c.id, c]));
  const suggestions = findUnappliedEvidence(ds).map((u) => ({
    company_id: u.company_id, company_name: u.company_name, field: u.field, value: u.value, confidence: u.best_confidence,
    location: LOCATION_FIELDS.includes(u.field), pinned: byId.get(u.company_id)?.verified === true, evidence_ids: u.evidence_ids,
  }));
  const active = activeEvidence(ds);
  for (const c of ds.companies) {
    if (!isUnknown(c, 'description')) continue;
    const rows = active.filter((e) => e.company_id === c.id && e.field === 'description');
    if (!rows.length) continue;
    const best = [...rows].sort((a, b) => ['high', 'medium', 'low'].indexOf(a.confidence) - ['high', 'medium', 'low'].indexOf(b.confidence))[0];
    suggestions.push({ company_id: c.id, company_name: c.name, field: 'description', value: best.value, confidence: best.confidence, location: false, pinned: c.verified === true, evidence_ids: rows.map((r) => r.id) });
  }
  return suggestions;
}
