// Entity resolution: is this newly discovered company one we already know?
//
// A lead is compared with every existing company and every pending candidate,
// and each comparison ends in one of four outcomes:
//
//   EXACT_MATCH     the same entity: enrich the existing record
//   LIKELY_MATCH    very probably the same: a person decides
//   POSSIBLE_MATCH  worth a look: a person decides
//   NEW_COMPANY     nothing resembles it
//
// What counts, strongest first:
//   1. ABN / ACN - a registry number identifies a legal entity.
//   2. Website domain - the registrable domain (sherpa.net.au, not net.au); a
//      shared platform's whole host (acme.netlify.app), which is a weaker signal.
//   3. Name - normalised so "Leonardo.Ai" and "Leonardo AI" are equal, and read
//      against aliases, former names and legal names, not just the current name.
//   4. Corroboration - same city, same street address, a shared founder. These
//      never make a match on their own: buildings are shared, and so are towns.
//
// Rules that keep it safe:
//   - EXACT needs a registry number or a domain AND a compatible name. A domain
//     alone could be a typo, a forged submission, or an acquirer's site, so a
//     matching website with a different name is a LIKELY match for a person to
//     judge (a rebrand? an acquisition? the wrong website?).
//   - A name on its own is never EXACT, however identical.
//   - A different registry number or website next to a matching name is
//     recorded as a conflict and holds the match below EXACT.
//   - A website shared by two existing companies makes neither match exact.
// Every result carries the signals, conflicts and plain-language reasons behind
// it, so a reviewer sees why, and nothing is merged on a guess.
import {
  nameKey, looseNameKey, parseNameVariants, similarity, canonicalDomain, normalizeAddress,
  cityKey, personKey, isValidABN, isValidACN,
} from '../models/identity.js';
import { lifecycleOf } from '../models/company.js';

export const OUTCOMES = Object.freeze({
  NEW: 'NEW_COMPANY', EXACT: 'EXACT_MATCH', LIKELY: 'LIKELY_MATCH', POSSIBLE: 'POSSIBLE_MATCH',
});
export const OUTCOME_RANK = { NEW_COMPANY: 0, POSSIBLE_MATCH: 1, LIKELY_MATCH: 2, EXACT_MATCH: 3 };

// Names this alike (edit distance / shared bigrams) are worth a human look.
// Among the shipped companies no pair scores even 0.78, so this costs nothing
// there, and for new leads the worst case is a POSSIBLE match to dismiss.
export const SIMILAR_MIN = 0.84;
const SHORT_NAME = 4; // a name this short is shared by many companies

const BANDS = { EXACT_MATCH: [0.9, 1], LIKELY_MATCH: [0.65, 0.89], POSSIBLE_MATCH: [0.3, 0.64] };
const round2 = (n) => Math.round(n * 100) / 100;

// ---------- identities ----------

function addName(names, label, kind) {
  const key = nameKey(label);
  if (key && !names.some((n) => n.key === key && n.kind === kind)) names.push({ label, key, loose: looseNameKey(label), kind });
}

function identityFrom({ kind, id = null, name, aliases = [], formerNames = [], legalNames = [], websites = [], aliasDomains = [], abn = [], acn = [], city, state, address, founders = [], lifecycle = null, status = null }) {
  const v = parseNameVariants(name);
  const names = [];
  addName(names, v.primary, 'primary');
  for (const a of [...v.aliases, ...aliases]) addName(names, a, 'alias');
  for (const f of [...v.formerNames, ...formerNames]) addName(names, f, 'former');
  for (const l of legalNames) addName(names, l, 'legal');

  const domains = new Map();
  const note = (input, via) => {
    const d = canonicalDomain(input);
    if (d && !d.nonCompany && !domains.has(d.domain)) domains.set(d.domain, { via, shared: d.shared });
  };
  websites.forEach((w) => note(w, 'website'));
  aliasDomains.forEach((w) => note(w, 'alias'));

  return {
    kind, id, name, status, names, domains,
    ids: { abn: new Set(abn.filter(isValidABN).map((x) => String(x).replace(/\D/g, ''))), acn: new Set(acn.filter(isValidACN).map((x) => String(x).replace(/\D/g, ''))) },
    city: cityKey(city), state: state ?? null, address: address ? normalizeAddress(address) : null,
    founders: new Set(founders.map(personKey).filter(Boolean)),
    lifecycle,
  };
}

export function identityOfCompany(company, identifiers = []) {
  const mine = identifiers.filter((i) => i.company_id === company.id);
  const values = (scheme) => mine.filter((i) => i.scheme === scheme).map((i) => i.value);
  return identityFrom({
    kind: 'company', id: company.id, name: company.name, aliases: values('alias'), formerNames: values('former_name'),
    legalNames: values('legal_name'), websites: [company.website], aliasDomains: values('domain'),
    abn: values('abn'), acn: values('acn'), city: company.city, state: company.state, address: company.address,
    founders: company.founders ?? [], lifecycle: lifecycleOf(company),
  });
}

export function identityOfCandidate(c) {
  return identityFrom({
    kind: 'candidate', id: c.id, name: c.name, aliases: c.aliases ?? [], websites: [c.website],
    abn: [c.external_ids?.abn], acn: [c.external_ids?.acn], city: c.city, state: c.state, address: c.address,
    founders: c.founders ?? [], status: c.status,
  });
}

// A lead is what an adapter or reviewer supplies: { name, aliases, former_names,
// legal_names, website, external_ids, city, state, address, founders }.
export function identityOfLead(lead) {
  return identityFrom({
    kind: 'lead', name: lead.name, aliases: lead.aliases ?? [], formerNames: lead.former_names ?? [], legalNames: lead.legal_names ?? [],
    websites: [lead.website], abn: [lead.external_ids?.abn], acn: [lead.external_ids?.acn],
    city: lead.city, state: lead.state, address: lead.address, founders: lead.founders ?? [],
  });
}

// Candidates that became companies (published, merged) are represented by the
// company, so they are left out to avoid matching the same entity twice.
export function buildIndex(ds) {
  return {
    companies: ds.companies.map((c) => identityOfCompany(c, ds.identifiers ?? [])),
    candidates: (ds.candidates ?? []).filter((c) => c.status !== 'published' && c.status !== 'merged').map(identityOfCandidate),
  };
}

// Keeps the index current as candidates are created or change. One that became a
// company is dropped: the company now represents it.
export function addToIndex(index, candidate) {
  const at = index.candidates.findIndex((c) => c.id === candidate.id);
  if (candidate.status === 'published' || candidate.status === 'merged') {
    if (at >= 0) index.candidates.splice(at, 1);
    return;
  }
  const identity = identityOfCandidate(candidate);
  if (at >= 0) index.candidates[at] = identity;
  else index.candidates.push(identity);
}

// ---------- comparing two identities ----------

const NAME_WEIGHT = { name_exact: 0.6, name_legal: 0.55, name_alias: 0.5, name_former: 0.5, name_loose: 0.35 };

function nameRelation(leadNames, targetNames) {
  let best = null;
  const consider = (candidate) => { if (!best || candidate.weight > best.weight) best = candidate; };
  for (const l of leadNames) {
    for (const t of targetNames) {
      if (l.key === t.key) {
        const kinds = [l.kind, t.kind];
        const code = kinds.includes('former') ? 'name_former' : kinds.includes('legal') ? 'name_legal' : kinds.includes('alias') ? 'name_alias' : 'name_exact';
        consider({ code, weight: NAME_WEIGHT[code], key: l.key, detail: l.label === t.label ? l.label : `${l.label} / ${t.label}` });
      } else if (l.loose && l.loose === t.loose) {
        consider({ code: 'name_loose', weight: NAME_WEIGHT.name_loose, key: l.key, detail: `${l.label} / ${t.label}` });
      } else {
        const [shorter, longer] = l.key.length <= t.key.length ? [l.key, t.key] : [t.key, l.key];
        const sim = similarity(l.key, t.key);
        if (shorter.length >= 5 && sim >= SIMILAR_MIN) {
          consider({ code: 'name_similar', weight: round2(0.2 + (0.2 * (sim - SIMILAR_MIN)) / (1 - SIMILAR_MIN)), key: l.key, sim, detail: `${l.label} / ${t.label} (${Math.round(sim * 100)}% alike)` });
        } else if (shorter.length >= 4 && longer.startsWith(shorter) && longer.length - shorter.length >= 2) {
          consider({ code: 'name_contained', weight: 0.2, key: shorter, detail: `${l.label} / ${t.label}` });
        }
      }
    }
  }
  return best;
}

function withOutcome(result, outcome, extraReason) {
  const raw = result.signals.reduce((n, s) => n + s.weight, 0);
  const [lo, hi] = BANDS[outcome] ?? [0, 0];
  return {
    ...result, outcome,
    score: outcome === OUTCOMES.NEW ? 0 : round2(lo + (hi - lo) * Math.min(1, raw / 1.6)),
    reasons: extraReason ? [...result.reasons, extraReason] : result.reasons,
  };
}

export function compareIdentities(lead, target) {
  const signals = [];
  const conflicts = [];
  const add = (code, weight, detail) => signals.push({ code, weight, detail });

  // 1. registry numbers
  let idMatch = false;
  let idConflict = false;
  for (const scheme of ['abn', 'acn']) {
    if (!lead.ids[scheme].size || !target.ids[scheme].size) continue;
    const hit = [...lead.ids[scheme]].find((v) => target.ids[scheme].has(v));
    if (hit) { idMatch = true; add(`${scheme}_match`, 1, hit); }
    else { idConflict = true; conflicts.push({ code: `${scheme}_differs`, detail: `${[...lead.ids[scheme]][0]} vs ${[...target.ids[scheme]][0]}` }); }
  }

  // 2. websites
  let domainMatch = false;
  let hostMatch = false;
  for (const [domain, info] of lead.domains) {
    const t = target.domains.get(domain);
    if (!t) continue;
    if (info.shared || t.shared) { hostMatch = true; add('host_match', 0.5, domain); }
    else { domainMatch = true; add(info.via === 'alias' || t.via === 'alias' ? 'domain_alias_match' : 'domain_match', 0.9, domain); }
  }
  const ownDomains = (identity) => [...identity.domains].filter(([, i]) => !i.shared).map(([d]) => d);
  const domainDiffers = !domainMatch && ownDomains(lead).length > 0 && ownDomains(target).length > 0;
  if (domainDiffers) conflicts.push({ code: 'domain_differs', detail: `${ownDomains(lead)[0]} vs ${ownDomains(target)[0]}` });

  // 3. names
  const rel = nameRelation(lead.names, target.names);
  if (rel) add(rel.code, rel.weight, rel.detail);

  // 4. corroboration
  if (lead.city && lead.city === target.city) add('same_city', 0.1, lead.city);
  if (lead.state && target.state) {
    if (lead.state === target.state) add('same_state', 0.05, lead.state);
    else conflicts.push({ code: 'state_differs', detail: `${lead.state} vs ${target.state}` });
  }
  if (lead.address && lead.address === target.address) add('address_match', 0.35, lead.address);
  const sharedFounders = [...lead.founders].filter((f) => target.founders.has(f));
  if (sharedFounders.length) add('founder_overlap', Math.min(0.5, 0.3 * sharedFounders.length), sharedFounders.join(', '));

  const has = (code) => signals.some((s) => s.code === code);
  const strongName = ['name_exact', 'name_legal', 'name_alias', 'name_former'].includes(rel?.code);
  const corroborated = has('same_city') || has('founder_overlap') || has('address_match');
  const reasons = [];
  let outcome = OUTCOMES.NEW;

  if (idMatch) {
    if (!idConflict && rel) { outcome = OUTCOMES.EXACT; reasons.push('same registry number and a compatible name'); }
    else { outcome = OUTCOMES.LIKELY; reasons.push(idConflict ? 'a registry number matches and another differs' : 'same registry number but the names differ: a trading name, a rebrand, or a wrong number'); }
  } else if (domainMatch) {
    if (idConflict) { outcome = OUTCOMES.LIKELY; reasons.push('same website but different registry numbers'); }
    else if (rel) { outcome = OUTCOMES.EXACT; reasons.push('same website and a compatible name'); }
    else { outcome = OUTCOMES.LIKELY; reasons.push('same website but the names differ: a rebrand, an acquisition, or the wrong website'); }
  } else if (hostMatch && strongName) {
    outcome = OUTCOMES.LIKELY; reasons.push('same name on the same shared-platform site');
  } else if (strongName) {
    if (domainDiffers) {
      outcome = has('founder_overlap') || has('address_match') ? OUTCOMES.LIKELY : OUTCOMES.POSSIBLE;
      reasons.push('same name but a different website');
    } else if (rel.key.length <= SHORT_NAME && !corroborated) {
      outcome = OUTCOMES.POSSIBLE; reasons.push('same short name and nothing else to go on');
    } else {
      outcome = OUTCOMES.LIKELY;
      reasons.push(rel.code === 'name_former' ? 'a former name of an existing company: possibly a rebrand' : rel.code === 'name_legal' ? 'the legal name of an existing company' : 'same name');
    }
  } else if (rel?.code === 'name_loose') {
    outcome = corroborated && !domainDiffers ? OUTCOMES.LIKELY : OUTCOMES.POSSIBLE; reasons.push('same name apart from a generic word');
  } else if (rel?.code === 'name_similar') {
    outcome = rel.sim >= 0.93 && corroborated && !domainDiffers ? OUTCOMES.LIKELY : OUTCOMES.POSSIBLE; reasons.push('a very similar name');
  } else if (rel?.code === 'name_contained') {
    outcome = OUTCOMES.POSSIBLE; reasons.push('one name contains the other');
  } else if (has('founder_overlap')) {
    outcome = OUTCOMES.POSSIBLE; reasons.push('shares a founder: possibly a related or successor company');
  }

  if (target.lifecycle && outcome !== OUTCOMES.NEW) reasons.push(`the existing record is marked ${target.lifecycle}`);
  const result = { target: { kind: target.kind, id: target.id, name: target.name }, outcome, score: 0, signals, conflicts, reasons, lifecycle: target.lifecycle };
  return idMatch && !idConflict && outcome === OUTCOMES.EXACT ? { ...result, score: 1 } : withOutcome(result, outcome);
}

// ---------- resolving a lead against everything known ----------

// exclude: ids a person has already said this is not the same as.
export function resolveLead(lead, index, { exclude = [] } = {}) {
  const skip = new Set(exclude);
  const results = [];
  for (const target of [...index.companies, ...index.candidates]) {
    if (skip.has(target.id) || (lead.id && target.id === lead.id && target.kind === lead.kind)) continue;
    const r = compareIdentities(lead, target);
    if (r.outcome !== OUTCOMES.NEW) results.push(r);
  }

  // An exact match has to be to exactly one company. If two companies both claim
  // it, the data already holds a duplicate; settle that before merging into either.
  const exactCompanies = results.filter((r) => r.outcome === OUTCOMES.EXACT && r.target.kind === 'company');
  if (exactCompanies.length > 1) {
    results.forEach((r, i) => {
      if (exactCompanies.includes(r)) results[i] = withOutcome(r, OUTCOMES.LIKELY, 'the same website or number belongs to several existing companies: look for a duplicate');
    });
  }

  results.sort((a, b) =>
    OUTCOME_RANK[b.outcome] - OUTCOME_RANK[a.outcome]
    || (a.target.kind === b.target.kind ? 0 : a.target.kind === 'company' ? -1 : 1)
    || b.score - a.score
    || String(a.target.id).localeCompare(String(b.target.id)));
  const matches = results.slice(0, 5);
  return { outcome: matches[0]?.outcome ?? OUTCOMES.NEW, best: matches[0] ?? null, matches };
}

// Resolves a stored candidate against everything known, honouring what a person has
// already said it is not, and returns it in the form candidates.json keeps.
export function resolveCandidate(candidate, index) {
  const r = resolveLead(identityOfCandidate(candidate), index, { exclude: candidate.decisions?.not_same_as ?? [] });
  return {
    resolution: r.outcome,
    matches: r.matches.map((m) => ({
      kind: m.target.kind, id: m.target.id, name: m.target.name, outcome: m.outcome, score: m.score,
      signals: m.signals, conflicts: m.conflicts, reasons: m.reasons,
    })),
  };
}

// One line for a person to read.
export function describeMatch(m) {
  return `${m.outcome} ${m.score.toFixed(2)} ${m.target.kind} "${m.target.name}" (${m.target.id}): ${m.reasons.join('; ')}${m.conflicts.length ? ` [conflict: ${m.conflicts.map((c) => c.detail).join(', ')}]` : ''}`;
}
