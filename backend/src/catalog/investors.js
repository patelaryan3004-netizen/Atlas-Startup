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
import { cityCentre, cityNamed } from '../geo/places.js';
import { officesOf } from '../investors/offices.js';
import { geoOfLocation, roleClassOf, roleClassLabel, ROLE_CLASSES } from '../investors/people.js';

export const INVESTOR_SORTS = ['name', 'name_desc', 'portfolio', 'location'];
export const INVESTOR_FACETS = ['type', 'stage', 'sector', 'location', 'lead', 'active', 'role', 'scope', 'kind'];
// What a list may hold: firms (the default, as it always was), people, or both. Firms come first in `entries`, so a firm's number is the same in `entries`
// and in `cards`. `scope` is where an investor is based: 'au' (Australia) or 'global' (every investor, Australian or not).
export const ENTRY_KINDS = ['firm', 'person', 'all'];
export const SCOPES = ['au', 'global'];
export const INVESTOR_FILES = {
  investors: 'investors.json', people: 'investor_people.json', funds: 'funds.json', investments: 'investments.json',
  memberships: 'investor_people_organisations.json', records: 'verification_records.json', sources: 'sources.json', companies: 'startups.json',
  geocodes: 'geocode_cache.json', // what the geocoder answered for an office's street address (investors/offices.js); read, never written, here
};
// How many related investors a profile lists, and how many recent investments.
const RELATED = 6;
const RECENT = 5;

const collator = new Intl.Collator();
// Adds a row to the list kept under a key. (Copying the list for each row added cost a firm with many rows the square of them.)
const addTo = (map, key, row) => { const rows = map.get(key); if (rows) rows.push(row); else map.set(key, [row]); };
const domainOf = (website) => { try { return new URL(website).hostname.replace(/^www\./, ''); } catch { return null; } };
const byCount = (a, b) => b[1] - a[1] || collator.compare(a[0], b[0]);
// Newest first; a row with no date after the ones with a date.
const byDateDesc = (a, b) => (a.investment_date == null) - (b.investment_date == null) || String(b.investment_date ?? '').localeCompare(String(a.investment_date ?? '')) || collator.compare(a.company.name, b.company.name);

const locationOf = (o) => {
  const parts = o.state ? [o.headquarters_city, o.state] : [o.headquarters_city, o.country];
  const label = parts.filter(Boolean).join(', ') || o.country || null;
  return { city: o.headquarters_city ?? null, state: o.state ?? null, country: o.country ?? null, label };
};
// The places an investor is found under: its state and its country, so "Australia" lists every Australian investor and "NSW" only the ones in NSW.
const placesOf = (c) => [...new Set([c.location.state, c.location.country].filter(Boolean))];
// Where an entry is based: a person's listing is read by geoOfLocation; a firm is Australian when its record says Australia or names an Australian state. A place
// nobody states is never Australia.
const scopeOf = (e) => (e.kind === 'person' ? e.scope : (e.location.country === 'Australia' || e.location.state ? 'au' : 'global'));
const kindOf = (e) => e.kind ?? 'firm';
// A picture of a person is served only when the record holds an https address for one: a page served over https must not load an http picture.
const httpsOnly = (url) => (typeof url === 'string' && /^https:\/\/\S+$/i.test(url.trim()) ? url.trim() : null);
const keyOf = (e) => e.key ?? e.slug;

export function buildInvestorSnapshot(data, version) {
  const companyById = new Map(data.companies.map((c) => [c.id, c]));
  const sourceById = new Map(data.sources.map((s) => [s.id, s]));
  const orgs = data.investors.filter((o) => isPublicStatus(o.verification_status));
  const orgById = new Map(orgs.map((o) => [o.id, o]));
  // A person is public only when published AND beside a public organisation: a published person whose firm is not public has no page.
  const people = data.people.filter((p) => p.verification_status === 'published' && orgById.has(p.current_organisation_id));
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
    addTo(portfolioOf, i.investor_organisation_id, r);
  }
  for (const rows of portfolioOf.values()) rows.sort(byDateDesc);
  const plain = ({ _fund, ...rest }) => rest;

  const roles = data.memberships.filter((m) => m.verification_status === 'verified' && orgById.has(m.organisation_id) && personById.has(m.person_id) && sourceById.has(m.source_id));
  const teamOf = new Map();
  for (const m of roles) {
    const p = personById.get(m.person_id);
    addTo(teamOf, m.organisation_id, {
      person: { slug: p.slug, name: p.name }, role: m.role, is_current: m.is_current === true, started_on: m.started_on ?? null, ended_on: m.ended_on ?? null, source: page(sourceById.get(m.source_id)),
    });
  }
  for (const rows of teamOf.values()) rows.sort((a, b) => (b.is_current - a.is_current) || collator.compare(a.person.name, b.person.name));

  // Who else backed the same companies, from the verified portfolios.
  const backersOf = new Map();
  for (const [orgId, rows] of portfolioOf) for (const r of rows) addTo(backersOf, r.company.slug, orgId);

  // Found by who they are about, so a firm or a person's records are looked up and not found by scanning every record once for each.
  const recordsAbout = new Map();
  for (const r of activeRecords({ verification_records: data.records })) addTo(recordsAbout, `${r.subject_type}|${r.subject_id}`, r);
  const fundsOf = new Map();
  for (const f of funds) addTo(fundsOf, f.organisation_id, f);
  const rolesOfPerson = new Map();
  for (const m of roles) addTo(rolesOfPerson, m.person_id, m);
  const investmentsOfPerson = new Map();
  for (const i of investments) if (i.investor_person_id != null) addTo(investmentsOfPerson, i.investor_person_id, i);

  const claimSources = (type, id) => {
    const found = new Map();
    for (const r of recordsAbout.get(`${type}|${id}`) ?? []) {
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

  // Each investor's office addresses with where the geocoder put them (the cache is read as it is: an address nobody has asked about has no point).
  const offices = new Map(orgs.map((o) => [o.slug, officesOf(o, data.geocodes ?? [])]));

  const profiles = new Map();
  orgs.forEach((o, i) => {
    const portfolio = portfolioOf.get(o.id) ?? [];
    const cheque = o.typical_cheque_min != null || o.typical_cheque_max != null ? { min: o.typical_cheque_min, max: o.typical_cheque_max, currency: o.cheque_currency } : null;
    const shared = new Map();
    for (const r of portfolio) for (const other of backersOf.get(r.company.slug) ?? []) if (other !== o.id) addTo(shared, other, r.company.name);
    const related = [...shared].map(([id, names]) => ({ org: orgById.get(id), names })).sort((a, b) => b.names.length - a.names.length || collator.compare(a.org.name, b.org.name))
      .slice(0, RELATED).map(({ org, names }) => ({ slug: org.slug, name: org.name, shared: names.length, companies: names.slice(0, 3) }));
    const sources = new Map(claimSources('investor_organisation', o.id));
    for (const r of portfolio) if (!sources.has(r.source.id)) sources.set(r.source.id, { ...r.source, backs: ['portfolio'] }); else if (!sources.get(r.source.id).backs.includes('portfolio')) sources.get(r.source.id).backs.push('portfolio');
    for (const t of teamOf.get(o.id) ?? []) if (!sources.has(t.source.id)) sources.set(t.source.id, { ...t.source, backs: ['team'] }); else if (!sources.get(t.source.id).backs.includes('team')) sources.get(t.source.id).backs.push('team');
    profiles.set(o.slug, {
      ...cards[i], id: o.id, logo: o.logo ?? null, inclusion_basis: o.inclusion_basis ?? null, description: o.description, investment_thesis: o.investment_thesis, geographies: o.geographies, other_offices: o.other_offices,
      // The street addresses its own pages give, each with the city it is under; `located` says whether the geocoder has put it on the map.
      office_addresses: (offices.get(o.slug) ?? []).filter((x) => x.office).map((x) => ({ city: x.office.city, address: x.office.address, located: x.status === 'placed' })),
      cheque, lead_or_follow: o.lead_or_follow, application_url: o.application_url, jobs_url: o.jobs_url,
      team: teamOf.get(o.id) ?? [],
      funds: (fundsOf.get(o.id) ?? []).map((f) => ({
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

  const cardOfOrg = new Map(orgs.map((o, i) => [o.id, cards[i]]));
  const personProfiles = new Map();
  for (const p of people) {
    const rolesOf = (rolesOfPerson.get(p.id) ?? []).map((m) => ({
      organisation: { slug: orgById.get(m.organisation_id).slug, name: orgById.get(m.organisation_id).name }, role: m.role, is_current: m.is_current === true,
      started_on: m.started_on ?? null, ended_on: m.ended_on ?? null, source: page(sourceById.get(m.source_id)),
    })).sort((a, b) => (b.is_current - a.is_current) || collator.compare(a.organisation.name, b.organisation.name));
    // Only what a source attributes to this person by name.
    const attributed = (investmentsOfPerson.get(p.id) ?? []).map((i) => plain(rowOf.get(i.id))).sort(byDateDesc);
    const sources = claimSources('investor_person', p.id);
    for (const r of rolesOf) if (!sources.has(r.source.id)) sources.set(r.source.id, { ...r.source, backs: ['role'] });
    const org = orgById.get(p.current_organisation_id);
    const roleClass = p.role_class ?? roleClassOf(p.current_title);
    const geo = geoOfLocation(p.location);
    personProfiles.set(p.slug, {
      slug: p.slug, name: p.name, photo: httpsOnly(p.photo), current_title: p.current_title ?? null, role_class: roleClass, role_label: roleClassLabel(roleClass),
      organisation: { slug: org.slug, name: org.name, domain: domainOf(org.website), website: org.website ?? null, type_label: typeLabel(org.investor_type), country: org.country ?? null, inclusion_basis: org.inclusion_basis ?? null, sectors: cardOfOrg.get(org.id).sectors, stages: cardOfOrg.get(org.id).stages, scope: scopeOf({ location: locationOf(org) }) },
      location: p.location ?? null, scope: geo.scope, biography: p.biography ?? null, previous_companies: p.previous_companies, previous_investor_organisations: p.previous_investor_organisations,
      sector_focus: p.sector_focus, stage_focus: p.stage_focus, linkedin_url: p.linkedin_url ?? null, personal_website: p.personal_website ?? null,
      roles: rolesOf, investments: attributed, companies: [...new Map(attributed.map((r) => [r.company.slug, r.company])).values()],
      last_verified_at: p.last_verified_at ?? null, sources: [...sources.values()].sort((a, b) => collator.compare(a.title ?? '', b.title ?? '')),
    });
  }

  // The people as the cards of a list. A person's focus is what the record states for them; where it states none, the firm's focus is shown and `focus_from` says
  // so, so a firm's focus is never passed off as the person's own.
  const peopleSearch = [];
  const peopleCards = people.map((p) => {
    const firm = cardOfOrg.get(p.current_organisation_id);
    const org = orgById.get(p.current_organisation_id);
    const roleClass = p.role_class ?? roleClassOf(p.current_title);
    const geo = geoOfLocation(p.location);
    const ownStages = p.stage_focus.length > 0;
    const ownSectors = p.sector_focus.length > 0;
    const card = {
      kind: 'person', key: `people/${p.slug}`, slug: p.slug, name: p.name, photo: httpsOnly(p.photo), title: p.current_title ?? null, role_class: roleClass, role_label: roleClassLabel(roleClass),
      organisation: { slug: org.slug, name: org.name, domain: domainOf(org.website), logo: org.logo ?? null },
      domain: domainOf(org.website), type: firm.type, type_label: firm.type_label,
      stages: ownStages ? p.stage_focus : firm.stages, sectors: ownSectors ? p.sector_focus : firm.sectors,
      focus_from: ownStages || ownSectors ? 'person' : (firm.stages.length || firm.sectors.length ? 'firm' : null),
      location: { city: geo.city, state: geo.state, country: geo.country, label: geo.label }, scope: geo.scope,
      portfolio_count: (investmentsOfPerson.get(p.id) ?? []).length, active_status: null, status: p.verification_status, verified_at: p.last_verified_at ?? null,
    };
    peopleSearch.push([card.name, card.title ?? '', card.role_label ?? '', org.name, ...(org.aliases ?? []), card.location.label ?? '', card.location.state ?? '', card.location.country ?? '', ...card.sectors, ...card.stages].join('\n').toLowerCase());
    return card;
  });
  // Firms first, so a firm has the same number in `entries` as in `cards`; people follow.
  const entries = [...cards, ...peopleCards];

  return { version, loadedAt: Date.now(), count: cards.length, cards, entries, search: [...search, ...peopleSearch], profiles, personProfiles, offices, people: people.length };
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
    const parts = await Promise.all(Object.values(files).map(async (file) => {
      try { const info = await stat(file); return `${Math.round(info.mtimeMs)}-${info.size}`; } catch (err) { if (err.code !== 'ENOENT') throw err; return 'none'; }
    }));
    return parts.join('/');
  }
  async function load() {
    const sig = await signatureOf();
    if (snap && sig === signature) return snap;
    const data = {};
    const entries = Object.entries(files);
    const read = await Promise.all(entries.map(([key, file]) => readJson(file, { required: key === 'companies' })));
    entries.forEach(([key], i) => { data[key] = read[i]; });
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
  for (const key of ['search', 'type', 'stage', 'sector', 'location', 'lead', 'active', 'slug', 'kind', 'scope', 'role']) if (query[key]) f[key] = String(Array.isArray(query[key]) ? query[key].join(',') : query[key]);
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

// The entries a question is about: the firms alone (the default, which is what the list was before people were in it), the people alone, or both.
// `kind` is not validated here: an unknown word is the firms, and the route refuses it before it gets this far.
const rangeOf = (snap, kind) => (kind === 'person' ? [snap.cards.length, snap.entries.length] : kind === 'all' ? [0, snap.entries.length] : [0, snap.cards.length]);

// How many entries a list of this kind is drawn from: the firms, the people, or both.
export const entryTotal = (snap, kind = 'firm') => { const [from, to] = rangeOf(snap, kind); return to - from; };

// Whether a question has been asked about people (a `kind` of person or all): the answer then carries `kind` and `key` on every entry, so a firm can be told from a
// person. A question that does not name a kind is answered as it always was.
export const asksForPeople = (f) => f.kind === 'person' || f.kind === 'all';

export function selectInvestors(snap, f) {
  const types = list(f.type);
  const stages = list(f.stage);
  const sectors = list(f.sector);
  const places = list(f.location);
  const leads = list(f.lead);
  const actives = list(f.active);
  const roles = list(f.role);
  const scope = f.scope === 'au' ? 'au' : null; // 'global' (and no scope) is every investor
  const firmOnly = Boolean(leads || actives || f.chequeMin !== undefined || f.chequeMax !== undefined || f.name); // these describe a firm: a person has none of them
  const names = f.name ? new Set(f.name.map(nameKey).filter(Boolean)) : null;
  const slugs = list(f.slug); // the investors a visitor saved, by their addresses (a person's is people/<slug>)
  const q = f.search ? f.search.toLowerCase().replace(/\n/g, ' ') : null;
  const [from, to] = rangeOf(snap, f.kind);
  const out = [];
  for (let i = from; i < to; i += 1) {
    const c = snap.entries[i];
    const person = c.kind === 'person';
    if (q && !snap.search[i].includes(q)) continue;
    if (slugs && !slugs.has(keyOf(c))) continue;
    if (scope && scopeOf(c) !== scope) continue;
    if (person && firmOnly) continue;
    if (roles && !(person && roles.has(c.role_class))) continue;
    if (names && ![c.name, ...c.aliases].some((n) => names.has(nameKey(n)))) continue;
    if (types && !types.has(c.type)) continue;
    if (stages && !c.stages.some((s) => stages.has(s))) continue;
    if (sectors && !c.sectors.some((s) => [...sectors].some((w) => w.toLowerCase() === s.toLowerCase()))) continue;
    if (places && !placesOf(c).some((p) => places.has(p))) continue;
    if (!person) {
      const profile = snap.profiles.get(c.slug);
      if (leads && !(leads.has(profile.lead_or_follow) || (profile.lead_or_follow === 'both' && (leads.has('lead') || leads.has('follow'))))) continue;
      if (actives && !(actives.has(c.active_status) || (actives.has('inactive') && c.status === 'inactive'))) continue;
      if ((f.chequeMin !== undefined || f.chequeMax !== undefined) && !chequeFits(profile.cheque, f.chequeMin, f.chequeMax)) continue;
    }
    out.push(i);
  }
  return out;
}

export function sortInvestors(snap, matched, sort = 'name') {
  const cards = snap.entries;
  const compare = {
    name: (a, b) => collator.compare(cards[a].name, cards[b].name) || a - b,
    name_desc: (a, b) => collator.compare(cards[b].name, cards[a].name) || a - b,
    portfolio: (a, b) => cards[b].portfolio_count - cards[a].portfolio_count || collator.compare(cards[a].name, cards[b].name) || a - b,
    location: (a, b) => collator.compare(cards[a].location.label ?? '￿', cards[b].location.label ?? '￿') || collator.compare(cards[a].name, cards[b].name) || a - b,
  }[sort];
  return [...matched].sort(compare);
}

// The entry as the API serves it. A question that asked for people gets `kind` and `key` on every entry (a firm's key is its address, a person's is people/<slug>);
// one that did not gets the card exactly as it always was.
export const entryOf = (snap, i, f = {}) => {
  const e = snap.entries[i];
  if (!asksForPeople(f) || e.kind) return e;
  return { kind: 'firm', key: e.slug, scope: scopeOf(e), ...e };
};

// The investors on the map. An investor's record has a city (its headquarters), a list of the cities it has offices in, and, for the offices whose
// own page states one, a street address. An office with an address the geocoder has placed (investors/offices.js) is drawn there: precision EXACT, the
// address as the page gives it. Every other office is drawn as a CITY: the reference point of that city (geo/places.js), labelled city-level, never an
// office. An investor with a headquarters city and two offices is three marks; one with only a country ("Australia") has none, and is counted as
// unplaced. `cities` (names) keeps only the marks in those cities. Like the companies' groups, nothing here is jittered or moved to tell two apart.
export function investorPins(snap, matched, { cities = null } = {}) {
  const wanted = cities ? new Set([...cities].map((c) => String(c).toLowerCase())) : null;
  const items = [];
  let pinned = 0;
  for (const i of matched) {
    const card = snap.cards[i];
    if (!card) continue; // a person (entries after the firms) is never a mark: a place a person lists is not an office
    const profile = snap.profiles.get(card.slug);
    const spots = [];
    const hq = card.location.city ? (cityCentre(card.location.city, card.location.state) ?? cityNamed(card.location.city)) : null;
    if (hq) spots.push({ role: 'headquarters', centre: hq });
    for (const office of profile.other_offices ?? []) {
      const centre = cityNamed(office);
      if (centre && !spots.some((s) => s.centre === centre)) spots.push({ role: 'office', centre });
    }
    const shown = spots.filter(({ centre }) => !wanted || wanted.has(centre.name.toLowerCase()));
    if (spots.length) pinned += 1;
    const placed = (snap.offices?.get(card.slug) ?? []).filter((x) => x.status === 'placed');
    const common = { slug: card.slug, name: card.name, type: card.type, type_label: card.type_label, domain: card.domain, logo: profile.logo ?? null, stages: card.stages, sectors: card.sectors, portfolio_count: card.portfolio_count };
    for (const { role, centre } of shown) {
      const here = placed.filter((x) => x.office.city.toLowerCase() === centre.name.toLowerCase());
      if (here.length) {
        here.forEach((x, n) => items.push({
          ...common, id: `${card.slug}@${centre.name}${n ? `#${n + 1}` : ''}`, lat: x.point.lat, lng: x.point.lng, city: centre.name, state: centre.state,
          place: x.office.address, address: x.office.address, role, precision: 'EXACT',
        }));
      } else {
        items.push({ ...common, id: `${card.slug}@${centre.name}`, lat: centre.lat, lng: centre.lng, city: centre.name, state: centre.state, place: `${centre.name}, ${centre.state}`, address: null, role, precision: 'CITY' });
      }
    }
  }
  return { count: matched.length, pinned, unplaced: matched.length - pinned, items };
}

const sorted = (counts, order = null) => [...counts].sort(order ? (a, b) => order.indexOf(a[0]) - order.indexOf(b[0]) : byCount);

// How many of the matches have each value. Counted over the matches, so every option shown is real.
export function investorFacets(snap, matched, names) {
  const out = {};
  for (const name of names) {
    const counts = new Map();
    for (const i of matched) {
      const c = snap.entries[i];
      const person = c.kind === 'person';
      const p = person ? null : snap.profiles.get(c.slug);
      const values = {
        type: [c.type], stage: c.stages, sector: c.sectors, location: placesOf(c), lead: person ? [] : [p.lead_or_follow],
        active: person ? [] : [c.status === 'inactive' ? 'inactive' : c.active_status],
        role: person && c.role_class ? [c.role_class] : [], scope: [scopeOf(c)], kind: [kindOf(c)],
      }[name];
      for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    const rows = sorted(counts, name === 'stage' ? INVESTOR_STAGES : name === 'role' ? ROLE_CLASSES : null);
    out[name] = {
      distinct: rows.length,
      values: rows.map(([value, count]) => ({ value, count, ...(name === 'type' ? { label: typeLabel(value) } : {}), ...(name === 'role' ? { label: roleClassLabel(value) } : {}) })),
    };
  }
  return out;
}
// Stages in the order an investor's own site would list them, which the facet counts follow.
export { INVESTOR_STAGES };

// The filter vocabulary of the public directory, for the dropdowns, and whether any investor states a cheque size. `kind` is what the list is of (firm, the
// default; person; all): the options are counted over those, so every option offered is one some entry of that kind has. `kinds` and `scopes` always say how many
// of each there are (scopes: au is the Australian ones, global is all of them), so the page can tell whether to offer the choice at all. With `scope` au the
// options are counted over the Australian ones only.
export function investorMeta(snap, kind = 'firm', scope = null) {
  const [from, to] = rangeOf(snap, kind);
  const inRange = Array.from({ length: to - from }, (_, k) => from + k);
  const mine = scope === 'au' ? inRange.filter((i) => scopeOf(snap.entries[i]) === 'au') : inRange; // with scope=au the options are the Australian ones: every option offered finds something
  const facets = investorFacets(snap, mine, INVESTOR_FACETS);
  const everyone = snap.entries.map((_, i) => i);
  const overall = investorFacets(snap, everyone, ['kind', 'scope']);
  const count = (facet, value) => overall[facet].values.find((v) => v.value === value)?.count ?? 0;
  const cheques = snap.cards.map((c) => snap.profiles.get(c.slug).cheque).filter((x) => x && x.currency === 'AUD');
  return {
    total: mine.length,
    types: facets.type.values, stages: facets.stage.values, sectors: facets.sector.values, locations: facets.location.values, lead: facets.lead.values, active: facets.active.values,
    roles: facets.role.values,
    kinds: { firm: count('kind', 'firm'), person: count('kind', 'person') },
    scopes: { au: count('scope', 'au'), global: snap.entries.length },
    cheque: cheques.length ? { currency: 'AUD', count: cheques.length, min: Math.min(...cheques.map((x) => x.min ?? 0)), max: Math.max(...cheques.map((x) => x.max ?? x.min ?? 0)) } : null,
  };
}
