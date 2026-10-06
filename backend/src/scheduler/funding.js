// Funding stories about companies already in the directory.
//
// A publisher's funding feed names a company, a round and sometimes its investors. When the story is plainly
// about one of OUR companies, that is new information worth recording at once, as evidence with the story as its
// source, so it shows up where a person looks: as a conflict if the record says something else ("Seed" against a
// record that says "Pre-seed"), as a suggested fill if the record says nothing, as a confirmation if it agrees.
// It never changes a company: evidence does not.
//
// "Plainly about one of ours" is stricter than the discovery engine's idea of a possible match, because here a
// wrong guess puts another company's funding on a real company's record. A name on its own is never enough
// (resolve.js never calls a name alone an exact match either). The story must also say something that agrees with
// what the directory already holds: it names an investor the company is already listed with, or it places the
// company in the city the record gives. And only a story that gives a round, from a fresh enough feed item,
// read by a method that is not the weakest guess, and that matches exactly one company, counts.
//
// Everything else is left alone here and goes the way it always did: the discovery engine turns it into a
// candidate for a person to look at. A story that is attached here is NOT also turned into a candidate (it would
// be a "possible duplicate of the company it was just attached to"), so the discovery job asks this same function
// which stories are ours to leave out.
import { identityOfCompany, identityOfLead, resolveLead, OUTCOME_RANK, OUTCOMES } from '../discovery/resolve.js';
import { promoteEvidence } from '../discovery/publish.js';
import { valuesEqual } from '../models/evidence.js';
import { indexState } from '../models/refreshState.js';

export const MAX_STORY_AGE_DAYS = 120;
const DAY = 86400000;
const LIKELY = OUTCOME_RANK[OUTCOMES.LIKELY];
const evidenceOf = (lead, field) => (lead.evidence ?? []).filter((e) => e.field === field).map((e) => e.value);

export const companyIndex = (work) => ({ companies: work.companies.map((c) => identityOfCompany(c, work.identifiers ?? [])), candidates: [] });

// What to do with one lead from a funding feed: { kind: 'attach', company, ... } or { kind: 'pass', reason }.
export function classifyFundingLead(lead, index, work, { at }) {
  const round = evidenceOf(lead, 'last_funding_round')[0] ?? null;
  if (!round) return { kind: 'pass', reason: 'no_round' };
  if (lead.extraction?.method === 'excerpt-round') return { kind: 'pass', reason: 'weak_extraction' };
  const told = lead.observed_at ?? lead.retrieved_at ?? null;
  if (!told || Number.isNaN(Date.parse(told))) return { kind: 'pass', reason: 'undated' };
  if (Date.parse(at) - Date.parse(told) > MAX_STORY_AGE_DAYS * DAY) return { kind: 'pass', reason: 'old' };

  const city = evidenceOf(lead, 'city')[0] ?? null;
  const found = resolveLead(identityOfLead({ name: lead.name, city }), index);
  const ours = found.matches.filter((m) => m.target.kind === 'company' && OUTCOME_RANK[m.outcome] >= LIKELY);
  if (!ours.length) return { kind: 'pass', reason: 'no_company' };
  if (ours.length > 1) return { kind: 'pass', reason: 'ambiguous' };
  const company = work.companies.find((c) => c.id === ours[0].target.id);

  const investors = evidenceOf(lead, 'investors');
  const shared = investors.filter((n) => (company.investors ?? []).some((i) => valuesEqual('investors', i, n)));
  const sameCity = ours[0].signals.some((s) => s.code === 'same_city');
  if (!shared.length && !sameCity) return { kind: 'pass', reason: 'uncorroborated' };
  return { kind: 'attach', company, round, investors, shared, sameCity, date: told.slice(0, 10) };
}

// Splits a feed's leads into the ones attached to companies and the rest. Pure.
export function partitionLeads(leads, work, { at }) {
  const index = companyIndex(work);
  const attach = [];
  const rest = [];
  const passed = {};
  for (const lead of leads) {
    const c = classifyFundingLead(lead, index, work, { at });
    if (c.kind === 'attach') attach.push({ lead, ...c });
    else { rest.push(lead); passed[c.reason] = (passed[c.reason] ?? 0) + 1; }
  }
  return { attach, rest, passed };
}

// Records what an attached story says as evidence on the company, once. A row a person has already turned down,
// or the same claim from the same story, is not added again. Returns how many rows went in.
export function recordFunding(work, attachments, { at }) {
  const state = indexState(work.refresh_state ??= []);
  const report = { stories: attachments.length, companies: new Set(), evidence_added: 0, rounds: [] };
  for (const a of attachments) {
    const { lead, company } = a;
    const source = { kind: 'press', url: lead.url ?? null, title: lead.title ?? null, publisher: lead.publisher ?? null, retrieved_at: lead.retrieved_at ?? at, note: 'A funding story from a publisher\'s feed, read for its headline and link only.' };
    const note = String(lead.title ?? '').slice(0, 200) || null;
    const rows = [{ field: 'last_funding_round', value: a.round, confidence: 'medium', verified_at: null, note, source }];
    // The story's date is the announcement date. It is evidence only when it is later than what the record holds:
    // an older story is not news, and a date the record already has at the same precision is not a disagreement.
    const stored = company.last_funding_date;
    if (!stored || a.date.slice(0, stored.length) > stored) rows.push({ field: 'last_funding_date', value: a.date, confidence: 'medium', verified_at: null, note: `Date of the story: ${note ?? 'a funding story'}`, source });
    for (const name of a.investors) rows.push({ field: 'investors', value: name, confidence: 'medium', verified_at: null, note, source });

    const turnedDown = (r) => work.evidence.some((e) => e.company_id === company.id && e.field === r.field && e.status !== 'active' && valuesEqual(r.field, e.value, r.value));
    const added = promoteEvidence(work, company.id, rows.filter((r) => !turnedDown(r)));

    const row = state.getOrCreate('company', company.id, 'funding');
    Object.assign(row, { last_checked_at: at, last_attempt_at: at, next_check_at: null, checks: row.checks + 1, failures: 0, last_error: null });
    if (added.length) {
      Object.assign(row, { last_verified_at: at, last_changed_at: at, unchanged_streak: 0, last_outcome: 'changed' });
      report.evidence_added += added.length;
      report.companies.add(company.id);
      report.rounds.push({ company_id: company.id, round: a.round, story: lead.url ?? lead.title ?? null });
    } else {
      row.unchanged_streak += 1;
      row.last_outcome = 'unchanged';
    }
    row.meta = { last_story: { round: a.round, date: a.date, url: lead.url ?? null, title: note } };
  }
  return { ...report, companies: [...report.companies] };
}
