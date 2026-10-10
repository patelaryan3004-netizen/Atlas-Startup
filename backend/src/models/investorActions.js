// What a person (or the CLI) may do to the investor layer, as changes to a working copy of the dataset. No HTTP, no files, no
// audit rows: those belong to the caller (admin/service.js, scripts/investors.js), which runs each of these inside one
// transaction (store.js) and writes the audit row with the change. A rule that says no throws an Error whose message a person
// should read.
//
// The lifecycle (investor.js):  candidate -> verified -> published   (and needs_review, inactive, rejected on the side)
//   approve     candidate | needs_review -> verified   only when every claim has a page behind it (investorEvidence.js)
//   reject      candidate | needs_review | verified -> rejected   kept, so the same name is not proposed again
//   reopen      rejected -> needs_review
//   publish     verified -> published   the one act that reaches the public site
//   unpublish   published | inactive -> verified
//   markInactive  a published or checked record that has stopped investing: says so, and names the page that says so
// And on the data: edit (each claim changed names its page and what it says), merge (two records that are one firm),
// addInvestment (a company an investor backed, with the page that says so) and settle a conflict between two sources.
import { createHash } from 'node:crypto';
import { URL_RE, PARTIAL_DATE_RE, isStr, slugify, uniqueSlug } from './company.js';
import {
  INVESTOR_TYPES, INVESTOR_STAGES, INCLUSION_BASES, LEAD_OR_FOLLOW, ACTIVE_STATUSES, CHECKED_STATUSES, EDITABLE_INVESTOR_FIELDS,
  investorProblems, isPublicStatus,
} from './investor.js';
import { RECORD_FIELDS, makeRecordRow, checkProblems, claimsWithoutRecords, valuesEqualFor, storedValueOf, checkRecordValue } from './investorEvidence.js';
import { LEAD_STATUSES } from './investorGraph.js';
import { diffChanges } from './auditTrail.js';

const fail = (message) => { throw new Error(message); };
const said = (list, max = 5) => `${list.slice(0, max).join('; ')}${list.length > max ? `; and ${list.length - max} more` : ''}`;

export function investorOf(work, id) {
  return (work.investors ?? []).find((o) => o.id === id) ?? fail(`no investor "${id}"`);
}
const touch = (record, at) => { record.created_at ??= at; record.updated_at = at; };

// ---------- the lifecycle ----------

export function approveInvestor(work, id, { at }) {
  const org = investorOf(work, id);
  if (!['candidate', 'needs_review'].includes(org.verification_status)) fail(`${org.name} is ${org.verification_status}, not waiting to be approved`);
  const problems = checkProblems(work, org);
  if (problems.length) fail(`${org.name} cannot be approved yet: ${said(problems)}`);
  org.verification_status = 'verified';
  org.last_verified_at = at;
  touch(org, at);
  return org;
}

export function rejectInvestor(work, id, { at }) {
  const org = investorOf(work, id);
  if (!['candidate', 'needs_review', 'verified'].includes(org.verification_status)) fail(`${org.name} is ${org.verification_status}: unpublish it before rejecting it`);
  org.verification_status = 'rejected';
  touch(org, at);
  return org;
}

export function reopenInvestor(work, id, { at }) {
  const org = investorOf(work, id);
  if (org.verification_status !== 'rejected') fail(`${org.name} is ${org.verification_status}: only a rejected record is reopened`);
  org.verification_status = 'needs_review';
  touch(org, at);
  return org;
}

export function flagInvestor(work, id, { at }) {
  const org = investorOf(work, id);
  if (!['candidate', 'verified'].includes(org.verification_status)) fail(`${org.name} is ${org.verification_status}: only a candidate or a verified record is flagged for review`);
  org.verification_status = 'needs_review';
  touch(org, at);
  return org;
}

export function publishInvestor(work, id, { at }) {
  const org = investorOf(work, id);
  if (org.verification_status !== 'verified') fail(`${org.name} is ${org.verification_status}: only a verified record is published`);
  const problems = [...checkProblems(work, org), ...investorProblems({ ...org, verification_status: org.active_status === 'inactive' ? 'inactive' : 'published' })];
  if (problems.length) fail(`${org.name} cannot be published: ${said(problems)}`);
  // A record that says it has stopped investing is public as inactive: kept and labelled, never listed as active.
  org.verification_status = org.active_status === 'inactive' ? 'inactive' : 'published';
  touch(org, at);
  return org;
}

export function unpublishInvestor(work, id, { at }) {
  const org = investorOf(work, id);
  if (!isPublicStatus(org.verification_status)) fail(`${org.name} is ${org.verification_status}, not public`);
  org.verification_status = 'verified';
  touch(org, at);
  return org;
}

// ---------- sources and records ----------

// The source row for a page, made if it is not on record. The person who names it has read it: that is the retrieval.
export function ensureSource(work, { url, kind = 'investor_website', title = null, publisher = null, note = null }, { at }) {
  if (!isStr(url) || !URL_RE.test(url)) fail('name the page: an http(s) address');
  work.sources ??= [];
  const same = work.sources.find((s) => s.url === url);
  if (same) {
    same.retrieved_at = at;
    return same;
  }
  let host = 'page';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* the URL pattern passed: it parses */ }
  const base = `${slugify(host)}-${createHash('sha1').update(url).digest('hex').slice(0, 8)}`;
  const taken = new Set(work.sources.map((s) => s.id));
  const row = { id: uniqueSlug(base, taken), kind, url, title: title ?? host, publisher: publisher ?? host, retrieved_at: at, note: note ?? 'Read by a person.' };
  work.sources.push(row);
  return row;
}

const confidenceFor = (kind) => (['investor_website', 'investor_document', 'company_website', 'company_document'].includes(kind) ? 'high' : 'medium');

// Records a claim and what its page says. A claim the subject already had a record for, with another value, is superseded.
function recordClaim(work, subjectType, subject, field, value, source, quote, { at, by }) {
  work.verification_records ??= [];
  const spec = RECORD_FIELDS[subjectType][field];
  const taken = new Set(work.verification_records.map((r) => r.id));
  if (spec.cardinality !== 'multi') {
    for (const r of work.verification_records) {
      if (r.subject_type === subjectType && r.subject_id === subject.id && r.field === field && r.status === 'active' && !valuesEqualFor(spec, r.value, value)) {
        r.status = 'superseded';
        r.note = `${r.note ?? ''} Replaced on ${at.slice(0, 10)} by ${by}.`.trim();
      }
    }
  }
  const already = work.verification_records.find((r) => r.subject_type === subjectType && r.subject_id === subject.id && r.field === field && r.source_id === source.id && valuesEqualFor(spec, r.value, value));
  if (already) {
    if (already.status !== 'active') { already.status = 'active'; already.note = quote; }
    already.verified_at = at;
    return already;
  }
  const row = makeRecordRow({ subject_type: subjectType, subject_id: subject.id, field, value, source_id: source.id, confidence: confidenceFor(source.kind), verified_at: at, note: quote }, taken);
  work.verification_records.push(row);
  return row;
}

// Puts a claim's value on the record, in the form the record stores it.
function setClaim(org, field, value) {
  if (field === 'typical_cheque') {
    org.typical_cheque_min = value?.min ?? null;
    org.typical_cheque_max = value?.max ?? null;
    org.cheque_currency = value ? value.currency : null;
  } else if (['other_offices', 'stages', 'sectors', 'geographies'].includes(field)) org[field] = value ?? [];
  else org[field] = value ?? null;
}

// ---------- edit ----------

const text = (v, what, max = 2000) => {
  if (v == null || v === '') return null;
  if (typeof v !== 'string') fail(`${what} must be text`);
  const s = v.replace(/\s+/g, ' ').trim();
  if (s.length > max) fail(`${what} is longer than ${max} characters`);
  return s || null;
};
const list = (v, what) => {
  if (v == null) return [];
  const items = (Array.isArray(v) ? v : String(v).split(/\n|;/)).map((x) => text(x, what, 120)).filter(Boolean);
  return [...new Set(items)];
};
const url = (v, what) => { const s = text(v, what, 500); if (s != null && !URL_RE.test(s)) fail(`${what} must be an http(s) address`); return s; };
const amount = (v, what) => { if (v == null || v === '') return null; const n = Number(v); if (!Number.isFinite(n) || n < 0) fail(`${what} must be a number of 0 or more`); return n; };

// Reads a patch as the form sends it: only the editable fields, each in the form the record stores it.
function readPatch(patch) {
  const unknown = Object.keys(patch).filter((k) => !EDITABLE_INVESTOR_FIELDS.includes(k) && k !== 'name');
  if (unknown.length) fail(`${unknown.join(', ')} cannot be edited here`);
  const out = {};
  for (const [key, value] of Object.entries(patch)) {
    switch (key) {
      case 'name': out.name = text(value, 'the name', 120) ?? fail('the name cannot be empty'); break;
      case 'website': case 'application_url': case 'jobs_url': out[key] = url(value, key.replace('_', ' ')); break;
      case 'investor_type': out[key] = value || null; if (out[key] && !(out[key] in INVESTOR_TYPES)) fail(`the type must be one of ${Object.keys(INVESTOR_TYPES).join(', ')}`); break;
      case 'inclusion_basis': out[key] = value || null; if (out[key] && !INCLUSION_BASES.includes(out[key])) fail(`the basis must be one of ${INCLUSION_BASES.join(', ')}`); break;
      case 'lead_or_follow': out[key] = value || null; if (out[key] && !LEAD_OR_FOLLOW.includes(out[key])) fail(`lead or follow must be one of ${LEAD_OR_FOLLOW.join(', ')}`); break;
      case 'active_status': out[key] = value || null; if (out[key] && !ACTIVE_STATUSES.includes(out[key])) fail(`active status must be one of ${ACTIVE_STATUSES.join(', ')}`); break;
      case 'stages': out[key] = list(value, 'a stage'); for (const s of out[key]) if (!INVESTOR_STAGES.includes(s)) fail(`a stage must be one of ${INVESTOR_STAGES.join(', ')}`); break;
      case 'sectors': case 'geographies': case 'other_offices': out[key] = list(value, key.replace('_', ' ')); break;
      case 'typical_cheque_min': case 'typical_cheque_max': out[key] = amount(value, key.replace(/_/g, ' ')); break;
      case 'cheque_currency': out[key] = value ? String(value).toUpperCase() : null; break;
      case 'state': out[key] = value ? String(value).toUpperCase() : null; break;
      default: out[key] = text(value, key.replace('_', ' '), key === 'description' || key === 'investment_thesis' ? 1200 : 120);
    }
  }
  return out;
}

// The claim fields a patch touches, and the value each ends up with (cheque is one claim of three fields).
function claimsOf(before, after, fields) {
  const claims = [];
  const seen = new Set();
  for (const f of fields) {
    const claim = ['typical_cheque_min', 'typical_cheque_max', 'cheque_currency'].includes(f) ? 'typical_cheque' : f;
    if (seen.has(claim)) continue;
    seen.add(claim);
    claims.push({ field: claim, before: storedValueOf('investor_organisation', before, claim), after: storedValueOf('investor_organisation', after, claim) });
  }
  return claims;
}

// Changes an investor. Each claim the edit sets or changes names the page that states it and says what that page says
// (`source`: { url, kind, title, quote }); clearing a claim needs none, but its records are superseded. A rename keeps
// the old name as an alias, so the companies that name it still find it.
export function editInvestor(work, id, rawPatch, { at, by, source = null }) {
  const org = investorOf(work, id);
  const patch = readPatch(rawPatch);
  const before = structuredClone(org);
  const after = structuredClone(org);

  if (patch.name != null && patch.name !== org.name) {
    if ((work.investors ?? []).some((o) => o.id !== org.id && [o.name, ...(o.aliases ?? [])].some((n) => n.toLowerCase() === patch.name.toLowerCase()))) fail(`another investor is already called "${patch.name}": merge them instead`);
    after.aliases = [...new Set([...after.aliases, org.name])].filter((a) => a.toLowerCase() !== patch.name.toLowerCase());
    after.name = patch.name;
  }
  for (const [key, value] of Object.entries(patch)) if (key !== 'name') after[key] = value;

  const fields = [...Object.keys(patch)];
  const claims = claimsOf(before, after, fields);
  const hasChanged = (c) => !(c.before == null && c.after == null) && JSON.stringify(c.before) !== JSON.stringify(c.after);
  // A value a page states is recorded with that page. One the record already held (a legacy name, a stage nobody ever sourced)
  // and no page backs yet is recorded the same way when a person gives it its page: stating it again is how it gets one.
  const hasRecord = (field, member) => {
    const spec = RECORD_FIELDS.investor_organisation[field];
    return (work.verification_records ?? []).some((r) => r.subject_type === 'investor_organisation' && r.subject_id === org.id && r.field === field && r.status === 'active' && valuesEqualFor(spec, r.value, member));
  };
  const unrecorded = (c) => {
    const spec = RECORD_FIELDS.investor_organisation[c.field];
    if (!spec || c.after == null) return [];
    return spec.cardinality === 'multi' ? c.after.filter((m) => !hasRecord(c.field, m)) : (hasRecord(c.field, c.after) ? [] : [c.after]);
  };
  // A claim that is set or changed brings a page; one that is only cleared, or a list that only loses members, does not.
  const addsSomething = (c) => {
    const spec = RECORD_FIELDS.investor_organisation[c.field];
    if (spec?.cardinality === 'multi') return (c.after ?? []).some((m) => !(c.before ?? []).some((n) => valuesEqualFor(spec, m, n)));
    return c.after != null;
  };
  const needsPage = (c) => (hasChanged(c) && addsSomething(c)) || unrecorded(c).length > 0;
  const touched = claims.filter((c) => hasChanged(c) || unrecorded(c).length > 0);
  const settingOne = touched.filter(needsPage);
  if (settingOne.length) {
    if (!source?.url) fail('name the page that states it: a claim needs a source');
    if (!isStr(source.quote) || source.quote.trim().length < 8) fail('say what the page says, in its own words (a short quote)');
  }
  const problems = investorProblems(after);
  if (problems.length) fail(problems[0]);

  Object.assign(org, after);
  const page = settingOne.length ? ensureSource(work, { url: source.url, kind: source.kind ?? 'investor_website', title: source.title ?? null }, { at }) : null;
  work.verification_records ??= [];
  for (const claim of touched) {
    const spec = RECORD_FIELDS.investor_organisation[claim.field];
    if (!spec) continue;
    if (spec.cardinality === 'multi') {
      const had = claim.before ?? [];
      const now = claim.after ?? [];
      for (const gone of had.filter((m) => !now.some((n) => valuesEqualFor(spec, m, n)))) {
        for (const r of work.verification_records) if (r.subject_type === 'investor_organisation' && r.subject_id === org.id && r.field === claim.field && r.status === 'active' && valuesEqualFor(spec, r.value, gone)) { r.status = 'superseded'; r.note = `${r.note ?? ''} Removed on ${at.slice(0, 10)} by ${by}.`.trim(); }
      }
      const adding = now.filter((m) => !had.some((n) => valuesEqualFor(spec, m, n)) || unrecorded(claim).some((u) => valuesEqualFor(spec, u, m)));
      for (const added of adding) {
        const bad = checkRecordValue(spec, added);
        if (bad) fail(`${claim.field} ${bad}`);
        recordClaim(work, 'investor_organisation', org, claim.field, added, page, source.quote.trim(), { at, by });
      }
    } else if (claim.after == null) {
      for (const r of work.verification_records) if (r.subject_type === 'investor_organisation' && r.subject_id === org.id && r.field === claim.field && r.status === 'active') { r.status = 'superseded'; r.note = `${r.note ?? ''} Cleared on ${at.slice(0, 10)} by ${by}.`.trim(); }
    } else if (needsPage(claim)) {
      const bad = checkRecordValue(spec, claim.after);
      if (bad) fail(`${claim.field} ${bad}`);
      recordClaim(work, 'investor_organisation', org, claim.field, claim.after, page, source.quote.trim(), { at, by });
    }
  }
  if (settingOne.length) org.last_verified_at = at;
  touch(org, at);
  // A checked record that now says something nothing backs cannot stay checked.
  if (CHECKED_STATUSES.includes(org.verification_status)) {
    const left = checkProblems(work, org);
    if (left.length) fail(`${org.name} would be left saying things no page backs: ${said(left)}`);
  }
  return { org, changes: diffChanges(before, org, [...new Set(['name', 'aliases', ...fields])]), recorded: [...new Set(settingOne.map((c) => c.field))] };
}

export function markInactive(work, id, { at, by, source = null }) {
  const org = investorOf(work, id);
  if (org.verification_status === 'rejected') fail(`${org.name} is rejected`);
  if (org.active_status === 'inactive' && org.verification_status === 'inactive') fail(`${org.name} is already inactive`);
  const checked = CHECKED_STATUSES.includes(org.verification_status);
  if (checked && (!source?.url || !isStr(source.quote))) fail('name the page that says it has stopped investing, and what it says');
  const before = structuredClone(org);
  org.active_status = 'inactive';
  if (isPublicStatus(org.verification_status)) org.verification_status = 'inactive';
  if (source?.url && isStr(source.quote)) {
    const page = ensureSource(work, { url: source.url, kind: source.kind ?? 'investor_website', title: source.title ?? null }, { at });
    recordClaim(work, 'investor_organisation', org, 'active_status', 'inactive', page, source.quote.trim(), { at, by });
    org.last_verified_at = at;
  }
  touch(org, at);
  return { org, changes: diffChanges(before, org, ['active_status', 'verification_status']) };
}

// ---------- merge ----------

// Two records that are one firm. The one merged away is deleted; its name and aliases become aliases of the one kept, so every
// company that names it still finds it. Its funds, investments, team roles and verification records move. Nothing is guessed
// about the fields: what the kept record says stays, and a disagreement shows up as a conflict for a person to settle.
export function mergeInvestors(work, fromId, intoId, { at }) {
  if (fromId === intoId) fail('an investor cannot be merged into itself');
  const from = investorOf(work, fromId);
  const into = investorOf(work, intoId);
  if (into.verification_status === 'rejected') fail(`${into.name} is rejected: merge into a record that is not`);
  into.aliases = [...new Set([...into.aliases, from.name, ...from.aliases])].filter((a) => a.toLowerCase() !== into.name.toLowerCase());

  const moved = { funds: 0, investments: 0, dropped: 0, team: 0, records: 0 };
  for (const f of work.funds ?? []) if (f.organisation_id === from.id) { f.organisation_id = into.id; moved.funds += 1; }

  const keep = [];
  const have = new Set((work.investments ?? []).filter((i) => i.investor_organisation_id === into.id).map((i) => `${i.company_id}|${String(i.round ?? '').toLowerCase()}`));
  for (const i of work.investments ?? []) {
    if (i.investor_organisation_id !== from.id) { keep.push(i); continue; }
    const key = `${i.company_id}|${String(i.round ?? '').toLowerCase()}`;
    if (have.has(key)) { moved.dropped += 1; continue; } // the kept record already has it
    have.add(key);
    i.investor_organisation_id = into.id;
    moved.investments += 1;
    keep.push(i);
  }
  const dropped = new Set((work.investments ?? []).filter((i) => !keep.includes(i)).map((i) => i.id));
  work.investments = keep;
  for (const p of work.fund_portfolio_companies ?? []) if (dropped.has(p.investment_id)) p.investment_id = null;

  const roles = [];
  const haveRole = new Set((work.investor_people_organisations ?? []).filter((m) => m.organisation_id === into.id).map((m) => `${m.person_id}|${m.role.toLowerCase()}`));
  for (const m of work.investor_people_organisations ?? []) {
    if (m.organisation_id !== from.id) { roles.push(m); continue; }
    const key = `${m.person_id}|${m.role.toLowerCase()}`;
    if (haveRole.has(key)) continue;
    haveRole.add(key);
    m.organisation_id = into.id;
    moved.team += 1;
    roles.push(m);
  }
  work.investor_people_organisations = roles;
  for (const p of work.investor_people ?? []) if (p.current_organisation_id === from.id) p.current_organisation_id = into.id;

  const spec = (r) => RECORD_FIELDS.investor_organisation[r.field];
  const recs = [];
  for (const r of work.verification_records ?? []) {
    if (r.subject_type !== 'investor_organisation' || r.subject_id !== from.id) { recs.push(r); continue; }
    const twin = (work.verification_records ?? []).find((x) => x.subject_type === 'investor_organisation' && x.subject_id === into.id && x.field === r.field && x.source_id === r.source_id && valuesEqualFor(spec(r), x.value, r.value));
    if (twin) continue;
    r.subject_id = into.id;
    r.id = `${into.id}.${r.id.split('.').slice(1).join('.')}`;
    moved.records += 1;
    recs.push(r);
  }
  const ids = new Set();
  work.verification_records = recs.map((r) => { let id = r.id; for (let n = 2; ids.has(id); n += 1) id = `${r.id}.${n}`; ids.add(id); return { ...r, id }; });

  work.investors = work.investors.filter((o) => o.id !== from.id);
  touch(into, at);
  return { into, from: { id: from.id, name: from.name }, moved };
}

// ---------- investments ----------

const roundOf = (v) => text(v, 'the round', 80);

// A company an investor backed, with the page that says so. Every INVESTED_IN relationship has one.
export function addInvestment(work, input, { at }) {
  const org = investorOf(work, input.investor_id);
  const company = (work.companies ?? []).find((c) => c.id === input.company_id) ?? fail(`no company "${input.company_id}"`);
  // The page is named by its address (and what it says), or is a source already on record (`source_id`, with `note`).
  const { source } = input;
  const onRecord = input.source_id != null ? (work.sources ?? []).find((s) => s.id === input.source_id) ?? fail(`no source "${input.source_id}"`) : null;
  const quote = onRecord ? input.note : source?.quote;
  if (!onRecord && !source?.url) fail('name the page that says it: every investment has a source');
  if (!isStr(quote) || quote.trim().length < 3) fail('say what the page says, in its own words');
  const round = roundOf(input.round);
  const key = `${org.id}|${company.id}|${(round ?? '').toLowerCase()}`;
  if ((work.investments ?? []).some((i) => `${i.investor_organisation_id}|${i.company_id}|${String(i.round ?? '').toLowerCase()}` === key)) fail(`${org.name} already has an investment in ${company.name}${round ? ` (${round})` : ''}`);
  const date = input.investment_date || null;
  if (date != null && !PARTIAL_DATE_RE.test(date)) fail('the date must be YYYY, YYYY-MM or YYYY-MM-DD');
  const money = amount(input.amount, 'the amount');
  const currency = input.currency ? String(input.currency).toUpperCase() : null;
  if (money != null && !/^[A-Z]{3}$/.test(currency ?? '')) fail('an amount needs a 3-letter currency');
  const lead = input.lead_status || null;
  if (lead != null && !LEAD_STATUSES.includes(lead)) fail(`lead status must be one of ${LEAD_STATUSES.join(', ')}`);

  const page = onRecord ?? ensureSource(work, { url: source.url, kind: source.kind ?? 'investor_website', title: source.title ?? null }, { at });
  // A person who read the page says so (verified); a link the code derived from evidence it already held may say it is not yet.
  const status = input.verification_status ?? 'verified';
  if (!['verified', 'unverified'].includes(status)) fail('a new investment is verified or unverified');
  work.investments ??= [];
  const taken = new Set(work.investments.map((i) => i.id));
  const id = uniqueSlug(`${org.slug}-${company.slug ?? company.id}${round ? `-${slugify(round)}` : ''}`, taken);
  const row = {
    id, investor_organisation_id: org.id, fund_id: input.fund_id ?? null, investor_person_id: input.person_id ?? null, company_id: company.id,
    round, investment_date: date, amount: money, currency: money == null ? null : currency, lead_status: lead,
    source_id: page.id, note: quote.trim(), verified_at: status === 'verified' ? at : null, verification_status: status,
  };
  work.investments.push(row);
  touch(org, at);
  return { investment: row, org, company };
}

export function rejectInvestment(work, id, { at }) {
  const row = (work.investments ?? []).find((i) => i.id === id) ?? fail(`no investment "${id}"`);
  if (row.verification_status === 'rejected') fail('that investment is already rejected');
  row.verification_status = 'rejected';
  row.verified_at = at;
  return row;
}

// ---------- conflicts ----------

// Two sources disagree about a field. A person says which value is right: the records that say it stay active, the others are
// turned down (kept, with why), and the investor's record takes the value.
export function resolveInvestorConflict(work, { subject_id: subjectId, field, value, reason }, { at, by }) {
  const org = investorOf(work, subjectId);
  const spec = RECORD_FIELDS.investor_organisation[field];
  if (!spec || spec.cardinality !== 'single') fail(`"${field}" is not a field with one right answer`);
  if (!isStr(reason)) fail('say why that one is right');
  const rows = (work.verification_records ?? []).filter((r) => r.subject_type === 'investor_organisation' && r.subject_id === subjectId && r.field === field && r.status === 'active');
  const winners = rows.filter((r) => valuesEqualFor(spec, r.value, value));
  if (!winners.length) fail('no source on record says that: choose one of the values the sources give');
  const losers = rows.filter((r) => !winners.includes(r));
  if (!losers.length && valuesEqualFor(spec, storedValueOf('investor_organisation', org, field), value)) fail('there is nothing to settle');
  const before = structuredClone(org);
  for (const r of losers) { r.status = 'rejected'; r.note = `${r.note ?? ''} Turned down on ${at.slice(0, 10)} by ${by}: ${reason.trim()}`.trim(); }
  setClaim(org, field, winners[0].value);
  org.last_verified_at = at;
  touch(org, at);
  const fields = field === 'typical_cheque' ? ['typical_cheque_min', 'typical_cheque_max', 'cheque_currency'] : [field];
  return { org, winner: winners[0].value, turnedDown: losers.map((r) => r.id), reason: reason.trim(), changes: diffChanges(before, org, fields) };
}

// ---------- people ----------

const personOf = (work, id) => (work.investor_people ?? []).find((p) => p.id === id) ?? fail(`no investor person "${id}"`);

export function approvePerson(work, id, { at }) {
  const p = personOf(work, id);
  if (!['candidate', 'needs_review'].includes(p.verification_status)) fail(`${p.name} is ${p.verification_status}, not waiting to be approved`);
  const missing = claimsWithoutRecords(work, 'investor_person', p);
  if (missing.length) fail(`${p.name} cannot be approved yet: ${said(missing.map((m) => `its ${m.field.replace(/_/g, ' ')} has no source`))}`);
  if (p.current_organisation_id != null) {
    const role = (work.investor_people_organisations ?? []).find((m) => m.person_id === p.id && m.organisation_id === p.current_organisation_id && m.is_current === true);
    if (!role || role.verification_status !== 'verified') fail(`${p.name} cannot be approved yet: the team record that puts them at their firm is not verified`);
  }
  p.verification_status = 'verified';
  p.last_verified_at = at;
  touch(p, at);
  return p;
}
export function rejectPerson(work, id, { at }) {
  const p = personOf(work, id);
  if (!['candidate', 'needs_review', 'verified'].includes(p.verification_status)) fail(`${p.name} is ${p.verification_status}: unpublish them before rejecting`);
  p.verification_status = 'rejected';
  touch(p, at);
  return p;
}
export function publishPerson(work, id, { at }) {
  const p = personOf(work, id);
  if (p.verification_status !== 'verified') fail(`${p.name} is ${p.verification_status}: only a verified record is published`);
  p.verification_status = 'published';
  touch(p, at);
  return p;
}
export function unpublishPerson(work, id, { at }) {
  const p = personOf(work, id);
  if (!isPublicStatus(p.verification_status)) fail(`${p.name} is ${p.verification_status}, not public`);
  p.verification_status = 'verified';
  touch(p, at);
  return p;
}
