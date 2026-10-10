// The public read model for the investor directory: what a person has published, and nothing else.
//
// Built from several data files (investors.json, investor_people.json, funds.json, investments.json,
// investor_people_organisations.json, verification_records.json, sources.json and startups.json), loaded once and rebuilt
// when any of them changes, as catalog.js does for the companies. A request costs the work of its own answer.
//
// What is public, and why:
//   an investor     only one whose status is published or inactive (a person published it; inactive says it stopped investing)
//   a person        only one who is published, and only beside an organisation that is public
//   a fund          only a public one of a public organisation
//   the portfolio   only INVESTED_IN rows that are verified and name the page that says so, for a company in the directory.
//                   A company that merely lists an investor in its own record is not portfolio: that is the company's claim
//                   and the investor page does not repeat it until a source backs it.
//   a team          only verified roles of published people
//   the sources     only the pages behind a public record, with what each backs. The words a page says are not served.
//
// A cheque size, a stage or a thesis reaches this file only if a source backs it: the data cannot be verified or published
// otherwise (investorEvidence.js), so there is nothing here to guess.
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { INVESTOR_STAGES, isPublicStatus, typeLabel } from '../models/investor.js';
import { activeRecords } from '../models/investorEvidence.js';

export const INVESTOR_SORTS = ['name', 'portfolio', 'location'];
export const INVESTOR_FACETS = ['type', 'stage', 'sector', 'location', 'lead', 'active'];
export const INVESTOR_FILES = {
  investors: 'investors.json', people: 'investor_people.json', funds: 'funds.json', investments: 'investments.json',
  memberships: 'investor_people_organisations.json', records: 'verification_records.json', sources: 'sources.json', companies: 'startups.json',
};
// How many related investors a profile lists, and how many recent investments.
const RELATED = 6;
const RECENT = 5;

const collator = new Intl.Collator();
const domainOf = (website) => { try { return new URL(website).hostname.replace(/^www\./, ''); } catch { return null; } };
const byCount = (a, b) => b[1] - a[1] || collator.compare(a[0], b[0]);
// Newest first; a row with no date after the ones with a date.
const byDateDesc = (a, b) => (a.investment_date == null) - (b.investment_date == null) || String(b.investment_date ?? '').localeCompare(String(a.investment_date ?? '')) || collator.compare(a.company.name, b.company.name);

const locationOf = (o) => {
  const parts = o.state ? [o.headquarters_city, o.state] : [o.headquarters_city, o.country];
  const label = parts.filter(Boolean).join(', ') || o.country || null;
  return { city: o.headquarters_city ?? null, state: o.state ?? null, country: o.country ?? null, label };
};
// The place an investor is filtered by: its state when it has one, otherwise its country.
const placeKey = (o) => o.state ?? o.country ?? null;

export function buildInvestorSnapshot(data, version) {
  const companyById = new Map(data.companies.map((c) => [c.id, c]));
  const sourceById = new Map(data.sources.map((s) => [s.id, s]));
  const orgs = data.investors.filter((o) => isPublicStatus(o.verification_status));
  const orgById = new Map(orgs.map((o) => [o.id, o]));
  const people = data.people.filter((p) => p.verification_status === 'published');
  const personById = new Map(people.map((p) => [p.id, p]));
  const funds = data.funds.filter((f) => isPublicStatus(f.verification_status) && orgById.has(f.organisation_id));
  const fundById = new Map(funds.map((f) => [f.id, f]));

  const company = (c) => ({ slug: c.slug ?? c.id, name: c.name, sector: c.sector ?? null, city: c.city ?? null, stage: c.stage ?? null, hiring: c.hiring === true, website: c.website || null });
  const page = (s) => ({ id: s.id, title: s.title ?? null, url: s.url ?? null, publisher: s.publisher ?? null, kind: s.kind, retrieved_at: s.retrieved_at ?? null });

  const investments = data.investments.filter((i) => i.verification_status === 'verified' && orgById.has(i.investor_organisation_id) && companyById.has(i.company_id) && sourceById.has(i.source_id));
  const portfolioOf = new Map();
  const row = (i) => ({
    company: company(companyById.get(i.company_id)), round: i.round ?? null, investment_date: i.investment_date ?? null, amount: i.amount ?? null,
    currency: i.currency ?? null, lead_status: i.lead_status ?? null,
    fund: fundById.has(i.fund_id) ? { slug: fundById.get(i.fund_id).slug, name: fundById.get(i.fund_id).name } : null,
    person: personById.has(i.investor_person_id) ? { slug: personById.get(i.investor_person_id).slug, name: personById.get(i.investor_person_id).name } : null,
    source: page(sourceById.get(i.source_id)), verified_at: i.verified_at ?? null,
  });
  // Each row keeps the ids it came from (_fund, _person) until it is served, so a fund's count and a person's attributed
  // investments can be worked out; `plain` takes them off.
  const rowOf = new Map();
  for (const i of investments) {
    const r = { ...row(i), _fund: i.fund_id };
    rowOf.set(i.id, r);
    portfolioOf.set(i.investor_organisation_id, [...(portfolioOf.get(i.investor_organisation_id) ?? []), r]);
  }
  for (const rows of portfolioOf.values()) rows.sort(byDateDesc);
  const plain = ({ _fund, ...rest }) => rest;

  const roles = data.memberships.filter((m) => m.verification_status === 'verified' && orgById.has(m.organisation_id) && personById.has(m.person_id) && sourceById.has(m.source_id));
  const teamOf = new Map();
  for (const m of roles) {
    const p = personById.get(m.person_id);
    teamOf.set(m.organisation_id, [...(teamOf.get(m.organisation_id) ?? []), {
      person: { slug: p.slug, name: p.name }, role: m.role, is_current: m.is_current === true, started_on: m.started_on ?? null, ended_on: m.ended_on ?? null, source: page(sourceById.get(m.source_id)),
    }]);
  }
  for (const rows of teamOf.values()) rows.sort((a, b) => (b.is_current - a.is_current) || collator.compare(a.person.name, b.person.name));

  // Who else backed the same companies, from the verified portfolios.
  const backersOf = new Map();
  for (const [orgId, rows] of portfolioOf) for (const r of rows) backersOf.set(r.company.slug, [...(backersOf.get(r.company.slug) ?? []), orgId]);

  const records = activeRecords({ verification_records: data.records });
  const claimSources = (type, id) => {
    const found = new Map();
    for (const r of records) {
      if (r.subject_type !== type || r.subject_id !== id) continue;
      const s = sourceById.get(r.source_id);
      if (!s) continue;
      if (!found.has(s.id)) found.set(s.id, { ...page(s), backs: [] });
      if (!found.get(s.id).backs.includes(r.field)) found.get(s.id).backs.push(r.field);
    }
    return found;
  };

  const cards = orgs.map((o) => {
    const portfolio = portfolioOf.get(o.id) ?? [];
    return {
      slug: o.slug, name: o.name, aliases: o.aliases, type: o.investor_type, type_label: typeLabel(o.investor_type), website: o.website, domain: domainOf(o.website),
      stages: o.stages, sectors: o.sectors, location: locationOf(o), portfolio_count: portfolio.length, active_status: o.active_status,
      status: o.verification_status, verified_at: o.last_verified_at,
    };
  });

  const profiles = new Map();
  orgs.forEach((o, i) => {
    const portfolio = portfolioOf.get(o.id) ?? [];
    const cheque = o.typical_cheque_min != null || o.typical_cheque_max != null ? { min: o.typical_cheque_min, max: o.typical_cheque_max, currency: o.cheque_currency } : null;
    const shared = new Map();
    for (const r of portfolio) for (const other of backersOf.get(r.company.slug) ?? []) if (other !== o.id) shared.set(other, [...(shared.get(other) ?? []), r.company.name]);
    const related = [...shared].map(([id, names]) => ({ org: orgById.get(id), names })).sort((a, b) => b.names.length - a.names.length || collator.compare(a.org.name, b.org.name))
      .slice(0, RELATED).map(({ org, names }) => ({ slug: org.slug, name: org.name, shared: names.length, companies: names.slice(0, 3) }));
    const sources = new Map(claimSources('investor_organisation', o.id));
    for (const r of portfolio) if (!sources.has(r.source.id)) sources.set(r.source.id, { ...r.source, backs: ['portfolio'] }); else if (!sources.get(r.source.id).backs.includes('portfolio')) sources.get(r.source.id).backs.push('portfolio');
    for (const t of teamOf.get(o.id) ?? []) if (!sources.has(t.source.id)) sources.set(t.source.id, { ...t.source, backs: ['team'] }); else if (!sources.get(t.source.id).backs.includes('team')) sources.get(t.source.id).backs.push('team');
    profiles.set(o.slug, {
      ...cards[i], id: o.id, logo: o.logo ?? null, description: o.description, investment_thesis: o.investment_thesis, geographies: o.geographies, other_offices: o.other_offices,
      cheque, lead_or_follow: o.lead_or_follow, application_url: o.application_url, jobs_url: o.jobs_url,
      team: teamOf.get(o.id) ?? [],
      funds: funds.filter((f) => f.organisation_id === o.id).map((f) => ({
        slug: f.slug, name: f.name, vintage_year: f.vintage_year ?? null, size: f.publicly_disclosed_size == null ? null : { amount: f.publicly_disclosed_size, currency: f.size_currency },
        stage_focus: f.stage_focus, sector_focus: f.sector_focus, active_status: f.active_status, portfolio_count: portfolio.filter((r) => r._fund === f.id).length,
      })).sort((a, b) => (b.vintage_year ?? 0) - (a.vintage_year ?? 0) || collator.compare(a.name, b.name)),
      portfolio: portfolio.map(plain),
      recent: portfolio.filter((r) => r.investment_date != null).slice(0, RECENT).map(plain),
      jobs: { url: o.jobs_url, hiring: portfolio.filter((r) => r.company.hiring).map((r) => r.company) },
      related,
      sources: [...sources.values()].sort((a, b) => collator.compare(a.title ?? '', b.title ?? '')),
    });
  });

  const search = cards.map((c, i) => [
    c.name, ...c.aliases, c.type_label ?? '', ...c.stages, ...c.sectors, c.location.label ?? '', c.location.state ?? '', c.location.country ?? '',
    ...(teamOf.get(orgs[i].id) ?? []).map((t) => t.person.name), ...(portfolioOf.get(orgs[i].id) ?? []).map((r) => r.company.name),
  ].join('\n').toLowerCase());

  const personProfiles = new Map();
  for (const p of people) {
    const rolesOf = roles.filter((m) => m.person_id === p.id).map((m) => ({
      organisation: { slug: orgById.get(m.organisation_id).slug, name: orgById.get(m.organisation_id).name }, role: m.role, is_current: m.is_current === true,
      started_on: m.started_on ?? null, ended_on: m.ended_on ?? null, source: page(sourceById.get(m.source_id)),
    })).sort((a, b) => (b.is_current - a.is_current) || collator.compare(a.organisation.name, b.organisation.name));
    // Only what a source attributes to this person by name.
    const attributed = investments.filter((i) => i.investor_person_id === p.id).map((i) => plain(rowOf.get(i.id))).sort(byDateDesc);
    const sources = claimSources('investor_person', p.id);
    for (const r of rolesOf) if (!sources.has(r.source.id)) sources.set(r.source.id, { ...r.source, backs: ['role'] });
    personProfiles.set(p.slug, {
      slug: p.slug, name: p.name, photo: p.photo ?? null, current_title: p.current_title ?? null,
      organisation: orgById.has(p.current_organisation_id) ? { slug: orgById.get(p.current_organisation_id).slug, name: orgById.get(p.current_organisation_id).name } : null,
      location: p.location ?? null, biography: p.biography ?? null, previous_companies: p.previous_companies, previous_investor_organisations: p.previous_investor_organisations,
      sector_focus: p.sector_focus, stage_focus: p.stage_focus, linkedin_url: p.linkedin_url ?? null, personal_website: p.personal_website ?? null,
      roles: rolesOf, investments: attributed, companies: [...new Map(attributed.map((r) => [r.company.slug, r.company])).values()],
      last_verified_at: p.last_verified_at ?? null, sources: [...sources.values()].sort((a, b) => collator.compare(a.title ?? '', b.title ?? '')),
    });
  }

  return { version, loadedAt: Date.now(), count: cards.length, cards, search, profiles, personProfiles, people: people.length };
}

// ---------- the catalog: loaded from the files, rebuilt when one changes ----------

async function readJson(file, { required = false } = {}) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch (err) {
    if (err.code === 'ENOENT' && !required) return [];
    throw err;
  }
}

export function createInvestorCatalog({ dir, reloadMs = 1000, now = Date.now } = {}) {
  const files = Object.fromEntries(Object.entries(INVESTOR_FILES).map(([key, name]) => [key, path.join(dir, name)]));
  let snap = null;
  let loading = null;
  let checkedAt = 0;
  let signature = null;

  async function signatureOf() {
    const parts = [];
    for (const file of Object.values(files)) {
      try { const info = await stat(file); parts.push(`${Math.round(info.mtimeMs)}-${info.size}`); } catch (err) { if (err.code !== 'ENOENT') throw err; parts.push('none'); }
    }
    return parts.join('/');
  }
  async function load() {
    const sig = await signatureOf();
    if (snap && sig === signature) return snap;
    const data = {};
    for (const [key, file] of Object.entries(files)) data[key] = await readJson(file, { required: key === 'companies' });
    snap = buildInvestorSnapshot(data, sig);
    signature = sig;
    return snap;
  }
  async function current() {
    if (snap && now() - checkedAt < reloadMs) return snap;
    checkedAt = now();
    if (!snap) { loading ??= load().finally(() => { loading = null; }); return loading; }
    loading ??= load().catch(() => snap).finally(() => { loading = null; });
    return snap;
  }
  const refresh = async () => { checkedAt = now(); loading ??= load().finally(() => { loading = null; }); return loading; };
  return { snapshot: current, refresh, dir };
}

// ---------- asking it questions ----------

const list = (v) => (v == null || v === '' ? null : new Set(String(Array.isArray(v) ? v.join(',') : v).split(',').map((x) => x.trim()).filter(Boolean)));
// A name as two writings of it would agree: no accents, case, "&" or punctuation ("Blackbird Ventures" and "blackbird  ventures").
const nameKey = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
export function readInvestorFilters(query = {}) {
  const f = {};
  for (const key of ['search', 'type', 'stage', 'sector', 'location', 'lead', 'active']) if (query[key]) f[key] = String(Array.isArray(query[key]) ? query[key].join(',') : query[key]);
  // Exact names (repeat the parameter: a name can hold a comma). It is how a company's investors are matched to their pages.
  if (query.name !== undefined && query.name !== '') f.name = [].concat(query.name).map(String).slice(0, 100);
  for (const key of ['chequeMin', 'chequeMax']) if (query[key] !== undefined && query[key] !== '') f[key] = Number(query[key]);
  return f;
}

// An AUD cheque range overlaps the asked-for range. Only a range stated in Australian dollars is compared: another currency
// is not converted, so it is not claimed to be in or out of range.
const chequeFits = (cheque, min, max) => {
  if (!cheque || cheque.currency !== 'AUD') return false;
  const low = cheque.min ?? 0;
  const high = cheque.max ?? Infinity;
  return (min == null || high >= min) && (max == null || low <= max);
};

export function selectInvestors(snap, f) {
  const types = list(f.type);
  const stages = list(f.stage);
  const sectors = list(f.sector);
  const places = list(f.location);
  const leads = list(f.lead);
  const actives = list(f.active);
  const names = f.name ? new Set(f.name.map(nameKey).filter(Boolean)) : null;
  const q = f.search ? f.search.toLowerCase().replace(/\n/g, ' ') : null;
  const out = [];
  snap.cards.forEach((c, i) => {
    if (q && !snap.search[i].includes(q)) return;
    if (names && ![c.name, ...c.aliases].some((n) => names.has(nameKey(n)))) return;
    if (types && !types.has(c.type)) return;
    if (stages && !c.stages.some((s) => stages.has(s))) return;
    if (sectors && !c.sectors.some((s) => [...sectors].some((w) => w.toLowerCase() === s.toLowerCase()))) return;
    if (places && !places.has(c.location.state ?? c.location.country)) return;
    const profile = snap.profiles.get(c.slug);
    if (leads && !(leads.has(profile.lead_or_follow) || (profile.lead_or_follow === 'both' && (leads.has('lead') || leads.has('follow'))))) return;
    if (actives && !(actives.has(c.active_status) || (actives.has('inactive') && c.status === 'inactive'))) return;
    if ((f.chequeMin !== undefined || f.chequeMax !== undefined) && !chequeFits(profile.cheque, f.chequeMin, f.chequeMax)) return;
    out.push(i);
  });
  return out;
}

export function sortInvestors(snap, matched, sort = 'name') {
  const cards = snap.cards;
  const compare = {
    name: (a, b) => collator.compare(cards[a].name, cards[b].name) || a - b,
    portfolio: (a, b) => cards[b].portfolio_count - cards[a].portfolio_count || collator.compare(cards[a].name, cards[b].name) || a - b,
    location: (a, b) => collator.compare(cards[a].location.label ?? '￿', cards[b].location.label ?? '￿') || collator.compare(cards[a].name, cards[b].name) || a - b,
  }[sort];
  return [...matched].sort(compare);
}

const sorted = (counts, order = null) => [...counts].sort(order ? (a, b) => order.indexOf(a[0]) - order.indexOf(b[0]) : byCount);

// How many of the matches have each value. Counted over the matches, so every option shown is real.
export function investorFacets(snap, matched, names) {
  const out = {};
  for (const name of names) {
    const counts = new Map();
    for (const i of matched) {
      const c = snap.cards[i];
      const p = snap.profiles.get(c.slug);
      const values = {
        type: [c.type], stage: c.stages, sector: c.sectors, location: [c.location.state ?? c.location.country], lead: [p.lead_or_follow],
        active: [c.status === 'inactive' ? 'inactive' : c.active_status],
      }[name];
      for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    const rows = sorted(counts, name === 'stage' ? INVESTOR_STAGES : null);
    out[name] = { distinct: rows.length, values: rows.map(([value, count]) => ({ value, count, ...(name === 'type' ? { label: typeLabel(value) } : {}) })) };
  }
  return out;
}
// Stages in the order an investor's own site would list them, which the facet counts follow.
export { INVESTOR_STAGES };

// The filter vocabulary of the whole public directory, for the dropdowns, and whether any investor states a cheque size.
export function investorMeta(snap) {
  const all = snap.cards.map((_, i) => i);
  const facets = investorFacets(snap, all, INVESTOR_FACETS);
  const cheques = snap.cards.map((c) => snap.profiles.get(c.slug).cheque).filter((x) => x && x.currency === 'AUD');
  return {
    total: snap.count,
    types: facets.type.values, stages: facets.stage.values, sectors: facets.sector.values, locations: facets.location.values, lead: facets.lead.values, active: facets.active.values,
    cheque: cheques.length ? { currency: 'AUD', count: cheques.length, min: Math.min(...cheques.map((x) => x.min ?? 0)), max: Math.max(...cheques.map((x) => x.max ?? x.min ?? 0)) } : null,
  };
}
