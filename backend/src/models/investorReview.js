// What a person should look at in the investor layer, worked out from one snapshot of the data. Pure: a dataset and a date
// in, plain objects out, so every number on the Command Center's Investors section can be tested against data whose
// answer is known. This measures the data; the audit trail (auditTrail.js) records what was done to it.
//
//   byStatus        how many investor organisations are in each status
//   issues          what is wrong or unfinished, by kind, with how many records have it
//   rows            the organisations with at least one issue, worst first, each with what to do
//   duplicates      firms (and people) that look like the same one
//   relationships   company -> investor links the directory holds with no source behind them, and investments not yet verified
//   team            team records and people not checked for over a year
//   conflicts       claims two sources disagree about
import { INVESTOR_STATUSES, CHECKED_STATUSES, isPublicStatus } from './investor.js';
import { checkProblems, claimsWithoutRecords, detectInvestorConflicts } from './investorEvidence.js';
import { STALE_DAYS } from './investorGraph.js';
import { canonicalDomain } from './identity.js';

const DAY = 86400000;
const norm = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const COMPOUND = /\b(?:etc\.?|others)\b|[/()]/i;

export const INVESTOR_ISSUES = {
  needs_review: { label: 'Needs review', severity: 'high', note: 'Someone flagged it: a person has to look.' },
  evidence_conflict: { label: 'Sources disagree', severity: 'high', note: 'Two sources give different answers for the same field. A person settles which is right.' },
  possible_duplicate_firm: { label: 'Possible duplicate firm', severity: 'high', note: 'Looks like another record: the same name, website or a name that starts the same way. Merge them or say they are different.' },
  compound_name: { label: 'Name looks like more than one investor', severity: 'medium', note: '"X etc." or "X / Y": it names several investors, or a qualifier, and is not one organisation.' },
  stale_verification: { label: 'Not checked for a year', severity: 'medium', note: 'It was checked against its sources more than a year ago. Funds change.' },
  new_candidate: { label: 'New candidate', severity: 'medium', note: 'Found in the directory and not yet checked against a source.' },
  unsourced_claims: { label: 'States things no page backs', severity: 'medium', note: 'A stage, sector, location or other claim with no source. It cannot be verified or published until each has one.' },
  missing_type: { label: 'Type missing', severity: 'low', note: 'What kind of investor it is is not recorded: venture capital, angel network, a government fund ...' },
  missing_location: { label: 'Location missing', severity: 'low', note: 'Neither a headquarters city nor a country is recorded.' },
  missing_stages: { label: 'Stages missing', severity: 'low', note: 'No stage is recorded. It stays blank unless a page states them: never a guess.' },
  missing_sectors: { label: 'Sectors missing', severity: 'low', note: 'No sector is recorded. It stays blank unless a page states them: never a guess.' },
  missing_website: { label: 'Website missing', severity: 'low', note: 'Its own website is the primary source for almost everything else.' },
  unverified_relationships: { label: 'Backs companies with no source', severity: 'low', note: 'Companies in the directory name it as an investor, and no page that states it is on record. It is not shown as portfolio until one is.' },
};
const RANK = { high: 0, medium: 1, low: 2 };

const daysBetween = (fromIso, toMs) => (fromIso == null ? Infinity : (toMs - Date.parse(fromIso)) / DAY);

// Possible duplicate firms: the same name or alias, the same website, or a name that starts the way another does.
export function possibleDuplicateFirms(investors) {
  const groups = [];
  const seen = new Set();
  const push = (reason, members) => {
    const key = members.map((m) => m.id).sort().join('|');
    if (members.length < 2 || seen.has(key)) return;
    seen.add(key);
    groups.push({ reason, ids: members.map((m) => m.id), names: members.map((m) => m.name) });
  };
  const live = investors.filter((i) => i.verification_status !== 'rejected');

  const byName = new Map();
  for (const i of live) for (const n of [i.name, ...(i.aliases ?? [])]) { const k = norm(n); if (k) byName.set(k, [...(byName.get(k) ?? []), i]); }
  for (const [k, members] of byName) push(`the same name or alias ("${k}")`, [...new Set(members)]);

  const byDomain = new Map();
  for (const i of live) {
    const d = canonicalDomain(i.website);
    if (d && !d.nonCompany) byDomain.set(d.domain, [...(byDomain.get(d.domain) ?? []), i]);
  }
  for (const [domain, members] of byDomain) push(`the same website (${domain})`, members);

  const keyed = live.map((i) => ({ i, k: norm(i.name) }));
  for (const a of keyed) for (const b of keyed) {
    if (a !== b && a.k && b.k.startsWith(`${a.k} `) && COMPOUND.test(b.i.name)) push(`"${b.i.name}" starts with "${a.i.name}" and looks like a qualified form of it`, [a.i, b.i]);
  }
  for (const a of keyed) for (const b of keyed) {
    if (a !== b && a.k && b.k.startsWith(`${a.k} `) && !COMPOUND.test(b.i.name) && a.k.length >= 4) push(`"${b.i.name}" starts with "${a.i.name}"`, [a.i, b.i]);
  }
  return groups;
}

export function possibleDuplicatePeople(people) {
  const groups = [];
  const byName = new Map();
  for (const p of people.filter((x) => x.verification_status !== 'rejected')) { const k = norm(p.name); if (k) byName.set(k, [...(byName.get(k) ?? []), p]); }
  for (const [k, members] of byName) if (members.length > 1) groups.push({ reason: `the same name ("${k}")`, ids: members.map((m) => m.id), names: members.map((m) => m.name) });
  const byLink = new Map();
  for (const p of people.filter((x) => x.linkedin_url)) { const k = p.linkedin_url.toLowerCase().replace(/\/+$/, ''); byLink.set(k, [...(byLink.get(k) ?? []), p]); }
  for (const [k, members] of byLink) if (members.length > 1) groups.push({ reason: `the same LinkedIn page (${k})`, ids: members.map((m) => m.id), names: members.map((m) => m.name) });
  return groups;
}

// Companies that name an investor, and the investors that company-side claims have no page for. A link is "sourced" when an
// investment row (not rejected) joins that organisation and that company.
export function relationshipGaps(ds) {
  const joined = new Set((ds.investments ?? []).filter((i) => i.verification_status !== 'rejected').map((i) => `${i.investor_organisation_id}|${i.company_id}`));
  const orgById = new Map((ds.investors ?? []).map((o) => [o.id, o]));
  const perInvestor = new Map();
  let links = 0;
  for (const c of ds.companies) {
    for (const id of c.investor_ids ?? []) {
      const org = orgById.get(id);
      if (!org || org.verification_status === 'rejected') continue;
      links += 1;
      if (!joined.has(`${id}|${c.id}`)) perInvestor.set(id, [...(perInvestor.get(id) ?? []), { company_id: c.id, name: c.name }]);
    }
  }
  const unsourced = [...perInvestor.values()].reduce((n, rows) => n + rows.length, 0);
  return {
    links, unsourced, sourced: links - unsourced,
    unverified_investments: (ds.investments ?? []).filter((i) => i.verification_status === 'unverified').length,
    by_investor: [...perInvestor].map(([id, rows]) => ({ id, name: orgById.get(id).name, count: rows.length, companies: rows })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };
}

export function reviewInvestors(ds, { asOf = new Date().toISOString() } = {}) {
  const nowMs = Date.parse(asOf);
  const investors = ds.investors ?? [];
  const byStatus = Object.fromEntries(INVESTOR_STATUSES.map((s) => [s, 0]));
  for (const i of investors) byStatus[i.verification_status] += 1;

  const duplicates = { firms: possibleDuplicateFirms(investors), people: possibleDuplicatePeople(ds.investor_people ?? []) };
  const inDuplicate = new Set(duplicates.firms.flatMap((g) => g.ids));
  const conflicts = detectInvestorConflicts(ds).filter((c) => c.subject_type === 'investor_organisation');
  const inConflict = new Set(conflicts.map((c) => c.subject_id));
  const gaps = relationshipGaps(ds);
  const gapOf = new Map(gaps.by_investor.map((g) => [g.id, g.count]));

  const rows = [];
  const counts = Object.fromEntries(Object.keys(INVESTOR_ISSUES).map((c) => [c, 0]));
  for (const org of investors) {
    if (org.verification_status === 'rejected') continue;
    const found = [];
    const flag = (code, detail = null) => found.push({ code, ...INVESTOR_ISSUES[code], detail });
    if (org.verification_status === 'needs_review') flag('needs_review');
    if (org.verification_status === 'candidate') flag('new_candidate');
    if (inConflict.has(org.id)) flag('evidence_conflict');
    if (inDuplicate.has(org.id)) flag('possible_duplicate_firm', duplicates.firms.filter((g) => g.ids.includes(org.id)).map((g) => g.reason).join('; '));
    if (COMPOUND.test(org.name)) flag('compound_name');
    if (CHECKED_STATUSES.includes(org.verification_status) && daysBetween(org.last_verified_at, nowMs) > STALE_DAYS) flag('stale_verification');
    const unbacked = claimsWithoutRecords(ds, 'investor_organisation', org);
    if (unbacked.length) flag('unsourced_claims', `${unbacked.length} claim${unbacked.length === 1 ? '' : 's'}: ${[...new Set(unbacked.map((c) => c.field))].join(', ')}`);
    if (!org.investor_type) flag('missing_type');
    if (!org.country && !org.headquarters_city) flag('missing_location');
    if (!org.stages.length) flag('missing_stages');
    if (!org.sectors.length) flag('missing_sectors');
    if (!org.website) flag('missing_website');
    if (gapOf.get(org.id)) flag('unverified_relationships', `${gapOf.get(org.id)} compan${gapOf.get(org.id) === 1 ? 'y' : 'ies'}`);
    for (const f of found) counts[f.code] += 1;
    if (found.length) {
      found.sort((a, b) => RANK[a.severity] - RANK[b.severity]);
      rows.push({ id: org.id, name: org.name, status: org.verification_status, issues: found, worst: found[0].severity, checkProblems: CHECKED_STATUSES.includes(org.verification_status) ? checkProblems(ds, org) : [] });
    }
  }
  rows.sort((a, b) => RANK[a.worst] - RANK[b.worst] || a.name.localeCompare(b.name));

  // Team: a person's role at a firm that nobody has looked at for a year, or never.
  const staleRoles = (ds.investor_people_organisations ?? []).filter((m) => m.is_current !== false && m.verification_status !== 'rejected' && daysBetween(m.verified_at, nowMs) > STALE_DAYS);
  const peopleById = new Map((ds.investor_people ?? []).map((p) => [p.id, p]));
  const orgById = new Map(investors.map((o) => [o.id, o]));
  const staleTeam = staleRoles.map((m) => ({ id: m.id, person: peopleById.get(m.person_id)?.name ?? m.person_id, organisation: orgById.get(m.organisation_id)?.name ?? m.organisation_id, role: m.role, verified_at: m.verified_at }));
  const staleExtraPeople = (ds.investor_people ?? []).filter((p) => CHECKED_STATUSES.includes(p.verification_status) && daysBetween(p.last_verified_at, nowMs) > STALE_DAYS);

  return {
    asOf, total: investors.length, byStatus,
    public: investors.filter((i) => isPublicStatus(i.verification_status)).length,
    people: (ds.investor_people ?? []).length, funds: (ds.funds ?? []).length, investments: (ds.investments ?? []).length,
    issues: INVESTOR_ISSUES, counts, rows, duplicates, relationships: gaps,
    team: { records: (ds.investor_people_organisations ?? []).length, stale: staleTeam.length + staleExtraPeople.length, stale_roles: staleTeam, stale_people: staleExtraPeople.map((p) => ({ id: p.id, name: p.name, last_verified_at: p.last_verified_at })) },
    conflicts: { count: conflicts.length, items: conflicts },
  };
}
