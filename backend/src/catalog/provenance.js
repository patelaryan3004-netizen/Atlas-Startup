// Where a company's facts came from, in the form a company's page may show: the public pages behind its facts, what each backs, when
// they were last read, and the page that backs the claim that it is hiring.
//
// Built from the records the pipeline keeps (sources.json, evidence.json, jobs.json) and never from anything a visitor typed:
//   - a source of kind user_supplied (a note from the owner or a form submission) is never served, nor is its note;
//   - a source without a web address is never served: a reader could not open it;
//   - only active evidence counts: a claim that was turned down or replaced backs nothing.
// What is served of a source is its title, its address, who published it, what kind of page it is, and when it was last read.

import { FACT_FIELDS } from '../models/company.js';

// Pages anyone can open, as opposed to what a person told us.
export const PUBLIC_SOURCE_KINDS = [
  'company_website', 'company_document', 'press', 'directory_listing', 'aggregator', 'accelerator_profile',
  'investor_post', 'investor_website', 'investor_document', 'licensed_dataset', 'open_dataset',
];

const isWebAddress = (url) => {
  try {
    const u = new URL(String(url));
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (e) {
    return false;
  }
};

const time = (iso) => { const t = Date.parse(iso); return Number.isNaN(t) ? null : t; };

// Map of company id -> { sources: [{ title, url, publisher, kind, checked_at, backs: [field] }],
//   hiring: { url, checked_at, confirmed_at } | null, no_roles: { url, checked_at } | null,
//   facts: { [field]: [{ value, url, verified_at }] } }  the claims a public page makes about the optional facts (FACT_FIELDS), newest
//   first, except a low-confidence one: a lead nobody confirmed is not something a visitor is told.
export function buildProvenance({ sources = [], evidence = [], jobs = [] } = {}) {
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const servable = (id) => {
    const s = sourceById.get(id);
    return s && PUBLIC_SOURCE_KINDS.includes(s.kind) && isWebAddress(s.url) ? s : null;
  };

  const byCompany = new Map();
  const entry = (id) => {
    if (!byCompany.has(id)) byCompany.set(id, { pages: new Map(), hiring: null, confirmed: null, empty: null, roles: [], facts: {} });
    return byCompany.get(id);
  };

  for (const e of evidence) {
    if (e.status !== 'active') continue;
    const s = servable(e.source_id);
    if (!s) continue;
    const mine = entry(e.company_id);
    if (!mine.pages.has(s.id)) mine.pages.set(s.id, { title: s.title ?? null, url: s.url, publisher: s.publisher ?? null, kind: s.kind, checked_at: null, backs: new Set() });
    const page = mine.pages.get(s.id);
    page.backs.add(e.field);
    if ((time(e.verified_at) ?? -1) > (time(page.checked_at) ?? -1)) page.checked_at = e.verified_at;
    if (FACT_FIELDS.includes(e.field) && e.confidence !== 'low') (mine.facts[e.field] ??= []).push({ value: e.value, url: s.url, verified_at: e.verified_at ?? null });
    // The page that says the company is hiring: its newest check that is not a low-confidence one.
    if (e.field === 'hiring_status' && e.value === 'hiring' && e.confidence !== 'low' && (time(e.verified_at) ?? -1) > (time(mine.hiring?.checked_at) ?? -1)) {
      mine.hiring = { url: s.url, checked_at: e.verified_at };
    }
    // A high-confidence reading (the company's job board, or structured postings on its own page) is a CONFIRMATION: a page was read and
    // listed open roles. A reading of a page's plain text is a check, but it is not confirmed until a person has looked.
    if (e.field === 'hiring_status' && e.value === 'hiring' && e.confidence === 'high' && (time(e.verified_at) ?? -1) > (time(mine.confirmed?.checked_at) ?? -1)) {
      mine.confirmed = { url: s.url, checked_at: e.verified_at };
    }
    // A job board read without trouble that listed no open roles: a positive observation, and the newer it is the more it matters.
    if (e.field === 'hiring_status' && e.value === 'not_hiring' && e.confidence !== 'low' && (time(e.verified_at) ?? -1) > (time(mine.empty?.checked_at) ?? -1)) {
      mine.empty = { url: s.url, checked_at: e.verified_at };
    }
  }
  // An open role read from a page is a check too, when no evidence row says it: the page the role was read from.
  for (const j of jobs) {
    if (j.status !== 'open') continue;
    const s = servable(j.source_id);
    if (!s) continue;
    const mine = entry(j.company_id);
    mine.roles.push(j.retrieved_at); // when each open role was read: how many of them are recent is the catalog's to say
    if ((time(j.retrieved_at) ?? -1) > (time(mine.hiring?.checked_at) ?? -1)) mine.hiring = { url: s.url, checked_at: j.retrieved_at };
  }

  const out = new Map();
  for (const [id, mine] of byCompany) {
    const pages = [...mine.pages.values()]
      .map((p) => ({ ...p, backs: [...p.backs].sort() }))
      .sort((a, b) => b.backs.length - a.backs.length || String(a.title).localeCompare(String(b.title)));
    // confirmed_at: when a page last CONFIRMED the open roles, and null once a board read after that listed none (the claim is in dispute).
    const confirmedAt = mine.confirmed && (time(mine.empty?.checked_at) ?? -1) <= (time(mine.confirmed.checked_at) ?? -1) ? mine.confirmed.checked_at : null;
    for (const rows of Object.values(mine.facts)) rows.sort((a, b) => (time(b.verified_at) ?? -1) - (time(a.verified_at) ?? -1));
    out.set(id, { sources: pages, hiring: mine.hiring ? { ...mine.hiring, confirmed_at: confirmedAt } : null, no_roles: mine.empty, roles: mine.roles, facts: mine.facts });
  }
  return out;
}
