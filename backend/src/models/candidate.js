// Discovery candidates: companies the discovery pipeline has found that are not
// (yet) in the company database. A candidate is staging data. It lives in
// candidates.json, which no route serves, and only becomes a company through an
// explicit human review and publish step - so a candidate can never appear
// publicly by accident.
//
//   candidates.json  one record per company found
//   {
//     id, status, status_history[{ status, at, by, note }],
//     name, aliases[], website, domain, description, city, state, address,
//     founders[], external_ids{ abn, acn },
//     discoveries[{ source_id, source_kind, license_basis, region, key, url, title, observed_at }],
//     first_discovered_at, last_seen_at,
//     evidence[{ field, value, confidence, verified_at, note, source{ kind, url, title, publisher, retrieved_at, note } }],
//     australian{ verdict, score, signals[] }, startup{ verdict, score, signals[] },
//     resolution, matches[{ kind, id, name, outcome, score, signals[], conflicts[] }],
//     decisions{ not_same_as[], same_as },
//     confidence{ score, label, breakdown }, review{ by, at, note }, published_company_id,
//     notes[{ at, by, text }]   things a reviewer should know: a website that is not theirs, a held alias
//   }
//
// Every candidate starts as 'candidate'. The pipeline moves it on; only a person
// moves it to approved, merged or published.
import {
  SOURCE_KINDS, AU_STATES, ISO_RE, URL_RE, isStr, isNum, slugify, uniqueSlug,
} from './company.js';
import { CONFIDENCE_LEVELS, EVIDENCE_FIELDS, checkValue } from './evidence.js';
import { canonicalDomain, isValidABN, isValidACN } from './identity.js';

export const CANDIDATE_STATUSES = ['candidate', 'needs_review', 'matched', 'approved', 'rejected', 'merged', 'published'];

// candidate  just found, not yet processed
// needs_review  processed; waiting for a person (a new company, or a possible duplicate)
// matched  an exact duplicate of an existing company; its enrichment is staged
// approved  a person says it is a new company and may be published
// rejected  not an Australian startup, or a person said no (kept, so it is not rediscovered)
// merged  confirmed to be an existing company; enriched into it
// published  became a company
export const CANDIDATE_TRANSITIONS = {
  candidate: ['needs_review', 'matched', 'rejected'],
  needs_review: ['needs_review', 'matched', 'approved', 'rejected', 'merged'],
  matched: ['needs_review', 'merged', 'rejected'],
  approved: ['needs_review', 'published', 'rejected'],
  rejected: ['needs_review'],
  merged: [],
  published: [],
};

export const RESOLUTIONS = ['NEW_COMPANY', 'EXACT_MATCH', 'LIKELY_MATCH', 'POSSIBLE_MATCH'];
export const VERDICTS = ['yes', 'likely', 'unknown', 'no'];
export const CONFIDENCE_LABELS = ['high', 'medium', 'low'];

const CANDIDATE_ID_RE = /^cand-[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function candidateId(name, taken) {
  return uniqueSlug(`cand-${slugify(name) || 'unnamed'}`, taken);
}

export function createCandidate(fields, { at, by = 'engine' }) {
  const {
    id, name, aliases = [], website = null, description = null, city = null, state = null, address = null,
    founders = [], external_ids = {}, discoveries = [], evidence = [],
  } = fields;
  const d = website ? canonicalDomain(website) : null;
  return {
    id,
    status: 'candidate',
    status_history: [{ status: 'candidate', at, by, note: 'discovered' }],
    name, aliases, website, domain: d && !d.nonCompany ? d.domain : null,
    description, city, state, address, founders,
    external_ids: { abn: external_ids.abn ?? null, acn: external_ids.acn ?? null },
    discoveries, first_discovered_at: at, last_seen_at: at,
    evidence,
    australian: null, startup: null,
    resolution: 'NEW_COMPANY', matches: [], decisions: { not_same_as: [], same_as: null },
    confidence: null, review: null, published_company_id: null, notes: [],
  };
}

export function moveTo(candidate, status, { at, by = 'engine', note = null }) {
  if (!(CANDIDATE_TRANSITIONS[candidate.status] ?? []).includes(status)) {
    throw new Error(`candidate ${candidate.id} cannot go from ${candidate.status} to ${status}`);
  }
  return { ...candidate, status, status_history: [...candidate.status_history, { status, at, by, note }] };
}

const isIso = (v) => typeof v === 'string' && ISO_RE.test(v);

export function validateCandidates(ds) {
  const errors = [];
  const bad = (where, msg) => errors.push(`${where}: ${msg}`);
  const companyIds = new Set(ds.companies.map((c) => c.id));
  const all = ds.candidates ?? [];
  const candidateIds = new Set(all.map((c) => c.id));
  const seen = new Set();

  for (const c of all) {
    const at = `candidate "${c.id}"`;
    if (!isStr(c.id) || !CANDIDATE_ID_RE.test(c.id)) bad('candidates', `invalid id ${JSON.stringify(c.id)}`);
    else if (seen.has(c.id)) bad(at, 'duplicate id');
    seen.add(c.id);
    if (!isStr(c.name)) bad(at, 'name must be a non-empty string');
    if (!CANDIDATE_STATUSES.includes(c.status)) bad(at, `invalid status "${c.status}"`);

    // History: starts at 'candidate', every step allowed, ends where the record says.
    const history = c.status_history;
    if (!Array.isArray(history) || history.length === 0) bad(at, 'status_history is required');
    else {
      if (history[0].status !== 'candidate') bad(at, 'must enter as "candidate"');
      history.forEach((h, i) => {
        if (!isIso(h.at) || !isStr(h.by)) bad(at, `status_history[${i}] needs an ISO "at" and a "by"`);
        if (i > 0 && !(CANDIDATE_TRANSITIONS[history[i - 1].status] ?? []).includes(h.status)) {
          bad(at, `status_history[${i}] goes from ${history[i - 1].status} to ${h.status}, which is not allowed`);
        }
      });
      if (history[history.length - 1].status !== c.status) bad(at, 'status does not match the end of status_history');
    }

    if (c.website != null && !URL_RE.test(c.website)) bad(at, 'website must be an http(s) URL or null');
    const d = c.website ? canonicalDomain(c.website) : null;
    const expectedDomain = d && !d.nonCompany ? d.domain : null;
    if ((c.domain ?? null) !== expectedDomain) bad(at, `domain should be ${JSON.stringify(expectedDomain)}`);
    for (const key of ['aliases', 'founders']) {
      if (!Array.isArray(c[key]) || c[key].some((x) => !isStr(x))) bad(at, `${key} must be an array of strings`);
    }
    if (c.state != null && !AU_STATES.includes(c.state)) bad(at, `invalid state ${JSON.stringify(c.state)}`);
    if (c.external_ids?.abn != null && !isValidABN(c.external_ids.abn)) bad(at, 'external_ids.abn is not a valid ABN');
    if (c.external_ids?.acn != null && !isValidACN(c.external_ids.acn)) bad(at, 'external_ids.acn is not a valid ACN');

    if (!Array.isArray(c.discoveries) || c.discoveries.length === 0) bad(at, 'needs at least one discovery (source and date)');
    for (const [i, x] of (c.discoveries ?? []).entries()) {
      if (!isStr(x.source_id) || !isStr(x.key) || !isIso(x.observed_at) || !SOURCE_KINDS.includes(x.source_kind)) {
        bad(at, `discoveries[${i}] needs source_id, key, a valid source_kind and an ISO observed_at`);
      }
    }
    if (!isIso(c.first_discovered_at) || !isIso(c.last_seen_at)) bad(at, 'first_discovered_at and last_seen_at must be ISO timestamps');
    else if (Date.parse(c.last_seen_at) < Date.parse(c.first_discovered_at)) bad(at, 'last_seen_at is before first_discovered_at');

    for (const [i, e] of (c.evidence ?? []).entries()) {
      const where = `${at} evidence[${i}]`;
      const spec = EVIDENCE_FIELDS[e.field];
      if (!spec) bad(where, `unknown field "${e.field}"`);
      else { const problem = checkValue(spec, e.value); if (problem) bad(where, `value for "${e.field}" ${problem}`); }
      if (!CONFIDENCE_LEVELS.includes(e.confidence)) bad(where, `invalid confidence "${e.confidence}"`);
      if (e.verified_at != null && !isIso(e.verified_at)) bad(where, 'verified_at must be ISO-8601 UTC or null');
      const s = e.source;
      if (!s || !SOURCE_KINDS.includes(s.kind)) bad(where, 'needs a source with a valid kind');
      else {
        if (s.url != null && !URL_RE.test(s.url)) bad(where, 'source url must be http(s) or null');
        if (s.retrieved_at != null && !isIso(s.retrieved_at)) bad(where, 'source retrieved_at must be ISO-8601 UTC or null');
        if (e.verified_at != null && s.retrieved_at == null) bad(where, 'verified_at is set but the source was never retrieved');
      }
      if (e.confidence === 'high' && e.verified_at == null) bad(where, 'high confidence requires verified_at');
    }

    for (const key of ['australian', 'startup']) {
      const a = c[key];
      if (a == null) continue;
      if (!VERDICTS.includes(a.verdict) || !isNum(a.score) || a.score < -1 || a.score > 1 || !Array.isArray(a.signals)) {
        bad(at, `${key} needs a verdict, a score from -1 to 1, and signals`);
      }
    }

    if (!RESOLUTIONS.includes(c.resolution)) bad(at, `invalid resolution "${c.resolution}"`);
    const matches = c.matches ?? [];
    for (const [i, m] of matches.entries()) {
      const where = `${at} matches[${i}]`;
      if (m.kind === 'company' ? !companyIds.has(m.id) : !(m.kind === 'candidate' && candidateIds.has(m.id))) bad(where, `unknown ${m.kind} "${m.id}"`);
      if (!RESOLUTIONS.includes(m.outcome) || m.outcome === 'NEW_COMPANY') bad(where, `invalid outcome "${m.outcome}"`);
      if (!isNum(m.score) || m.score < 0 || m.score > 1) bad(where, 'score must be 0..1');
    }
    if (c.resolution === 'NEW_COMPANY' && matches.length > 0) bad(at, 'resolution is NEW_COMPANY but it has matches');
    if (c.resolution !== 'NEW_COMPANY' && matches[0]?.outcome !== c.resolution) bad(at, 'resolution does not match its best match');

    const decisions = c.decisions ?? {};
    for (const id of decisions.not_same_as ?? []) {
      if (!companyIds.has(id) && !candidateIds.has(id)) bad(at, `decisions.not_same_as names unknown "${id}"`);
    }
    if (decisions.same_as != null && !companyIds.has(decisions.same_as)) bad(at, `decisions.same_as names unknown company "${decisions.same_as}"`);

    if (c.confidence != null) {
      if (!isNum(c.confidence.score) || c.confidence.score < 0 || c.confidence.score > 1 || !CONFIDENCE_LABELS.includes(c.confidence.label)) {
        bad(at, 'confidence needs a score from 0 to 1 and a label');
      }
    }
    if (c.review != null && (!isStr(c.review.by) || !isIso(c.review.at))) bad(at, 'review needs "by" and an ISO "at"');
    for (const [i, n] of (c.notes ?? []).entries()) {
      if (!isIso(n.at) || !isStr(n.by) || !isStr(n.text)) bad(at, `notes[${i}] needs an ISO "at", a "by" and some text`);
    }

    // What each status promises.
    if (c.status === 'matched' && !(c.resolution === 'EXACT_MATCH' && matches[0]?.kind === 'company')) bad(at, 'matched needs an exact match to a company');
    if ((c.status === 'approved' || c.status === 'published') && c.review == null) bad(at, `${c.status} needs a review (who decided)`);
    if (c.status === 'approved' && c.resolution !== 'NEW_COMPANY') bad(at, 'approved needs every possible duplicate settled');
    if (c.status === 'merged' && decisions.same_as == null) bad(at, 'merged needs decisions.same_as');
    if (c.status === 'published' && !companyIds.has(c.published_company_id)) bad(at, 'published needs published_company_id of an existing company');
    if (c.status !== 'published' && c.published_company_id != null) bad(at, 'published_company_id is set but it is not published');
  }
  return errors;
}
