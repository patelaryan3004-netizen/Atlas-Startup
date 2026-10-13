// The read model for the People pages (Stage 11): the people and institutions worth following, and the curated lists that gather them.
//
// Two sources, both real:
//   people_seed.json   typed in by the owner (models/community.js says what an entry must be, and drops one that is not)
//   the investor directory   the investors a person published in the Command Center appear as institutions, and a published investor
//                            person as a person under Investors, each beside the page that backs it. An entry in the seed with the
//                            same name wins, so a firm is never listed twice.
// Nothing is made up. A field that no source has (a person's "why follow" line, for one) is left out of the card, not written for them.
import { readFile, stat } from 'node:fs/promises';
import { checkSeed, publicInstitution, publicPerson, ROLE_TYPES } from '../models/community.js';
import { checkInstitutionSeed } from '../models/institutionSeed.js';
import { buildInstitutionPins } from './institutionPins.js';

const collator = new Intl.Collator();
// A name as two writings of it would agree (no accents, case, "&" or punctuation), so "Blackbird Ventures" and "blackbird  ventures" are one.
const nameKey = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const places = (location) => (typeof location === 'string' ? location : location?.label ?? location?.city ?? null);
const pagesOf = (sources) => (sources ?? []).filter((s) => s?.url && s?.title).map((s) => ({ label: s.title, url: s.url }));

// The four starter lists (Stage 7). Each gathers what the page already has, in the order it was typed in (the seed's own order, not the
// alphabet); one of the same id in the seed file wins, and a list with no one on it is not shown. `roleType` picks the people.
export const STARTER_LISTS = [
  { id: 'founders-to-follow', title: 'Founders to follow', description: 'Founders of Australian startups, each with the page that backs it.', type: 'people', roleType: 'founder' },
  { id: 'operators-to-learn-from', title: 'Operators to learn from', description: 'People who run the work inside Australian startups, each with the page that backs it.', type: 'people', roleType: 'operator' },
  { id: 'investors-people', title: 'Investors (people)', description: 'The people who back Australian startups, each with the page that backs it.', type: 'people', roleType: 'investor' },
  { id: 'investors-firms', title: 'Investors (firms)', description: 'The firms that back Australian startups.', type: 'institutions', roleType: null },
];
const STARTER_CURATOR = 'AU Startup Map';

export function buildCommunity({ seed, investors = null, production = false, version = 'v0', institutionSeed = null, geocodeRows = [] }) {
  const checked = checkSeed(seed, { production });
  const byName = (a, b) => collator.compare(a.name, b.name) || (a.id < b.id ? -1 : 1);

  const institutions = [...checked.institutions];
  const people = [...checked.people];
  if (investors) {
    const have = new Set(institutions.map((i) => nameKey(i.name)));
    for (const card of investors.cards) {
      if (have.has(nameKey(card.name))) continue;
      const sources = pagesOf(investors.profiles.get(card.slug)?.sources);
      institutions.push(publicInstitution({
        id: `investor-${card.slug}`, name: card.name, type: 'institution', city: card.location?.city ?? null, stageFocus: card.stages ?? [], sectors: card.sectors ?? [],
        website: card.website ?? null, sources, verifiedAt: sources.length ? card.verified_at ?? null : null, href: `/investors/${card.slug}`,
      }));
    }
    const named = new Set(people.map((p) => nameKey(p.name)));
    for (const [slug, p] of investors.personProfiles) {
      if (named.has(nameKey(p.name))) continue;
      const sources = pagesOf(p.sources);
      people.push(publicPerson({
        id: `investor-person-${slug}`, name: p.name, type: 'person', roleType: 'investor', title: p.current_title, orgName: p.organisation?.name ?? null,
        orgType: p.organisation ? 'firm' : null, city: places(p.location), whyFollow: null, links: { website: p.personal_website, linkedin: p.linkedin_url },
        sources, verifiedAt: sources.length ? p.last_verified_at ?? null : null, vouches: [], href: `/investors/people/${slug}`,
      }));
    }
  }
  // The firms of institutions_seed.json (the owner's reviewed file), after those published in the investor directory: a firm that is already
  // there, under the same name, stays as it is (the published one has its pages behind it). A firm with no offices is listed, with no pin.
  const seeded = checkInstitutionSeed(institutionSeed ?? {});
  {
    const have = new Set(institutions.map((i) => nameKey(i.name)));
    const taken = new Set(institutions.map((i) => i.id));
    for (const firm of seeded.institutions) {
      if (have.has(nameKey(firm.name)) || taken.has(firm.id)) continue;
      have.add(nameKey(firm.name));
      institutions.push(publicInstitution({
        id: firm.id, name: firm.name, type: 'institution', city: firm.offices.find((o) => o.city)?.city ?? null, stageFocus: [], sectors: [], website: firm.website,
        sources: [], verifiedAt: null,
      }));
    }
  }
  // The order the owner typed them in, for the lists (the tabs are by name).
  const typedPeople = [...people];
  const typedInstitutions = [...institutions];
  people.sort(byName);
  institutions.sort(byName);

  const personIds = new Set(people.map((p) => p.id));
  const institutionIds = new Set(institutions.map((i) => i.id));
  const problems = [...checked.problems];
  const named = new Set(checked.lists.map((l) => l.id));
  const starter = STARTER_LISTS.filter((l) => !named.has(l.id)).map((l) => ({
    id: l.id, title: l.title, description: l.description, curator: STARTER_CURATOR, type: l.type,
    itemIds: l.type === 'people' ? typedPeople.filter((p) => p.roleType === l.roleType).map((p) => p.id) : typedInstitutions.map((i) => i.id),
  }));
  // A list keeps the ids it can name, in its own order. A people or institutions list that names no one is not shown; a companies
  // list is resolved against the companies when it is asked for (they are another catalog).
  const lists = [...checked.lists, ...starter].flatMap((list) => {
    const known = list.type === 'people' ? personIds : list.type === 'institutions' ? institutionIds : null;
    const itemIds = known ? list.itemIds.filter((id) => known.has(id)) : list.itemIds;
    if (known) for (const id of list.itemIds) if (!known.has(id)) problems.push(`list "${list.id}" names "${id}", which is not a ${list.type === 'people' ? 'person' : 'institution'} here: left out`);
    return itemIds.length ? [{ ...list, itemIds }] : [];
  });

  const counts = { founders: 0, operators: 0, investors: 0, institutions: institutions.length };
  for (const p of people) counts[`${p.roleType}s`] += 1;
  const search = (row) => [row.name, row.title, row.orgName, row.city, row.whyFollow, row.stageFocus, ...(row.sectors ?? [])].filter(Boolean).join('\n').toLowerCase();

  // The firms' offices on the map (institutions_seed.json), each beside the investor page that backs the firm when there is one. A pin the
  // geocoder has not settled is in the report, not on the map.
  const built = buildInstitutionPins(seeded, geocodeRows);
  const pageOf = new Map(institutions.filter((i) => i.href).map((i) => [nameKey(i.name), i.href]));
  const institutionPins = { pins: built.pins.map((pin) => ({ ...pin, href: pageOf.get(nameKey(pin.name)) ?? null })), report: built.report };
  return {
    version, people, institutions, lists, counts, problems, institutionPins,
    personById: new Map(people.map((p) => [p.id, p])), institutionById: new Map(institutions.map((i) => [i.id, i])), listById: new Map(lists.map((l) => [l.id, l])),
    text: new Map([...people, ...institutions].map((row) => [row.id, search(row)])),
  };
}

// Who matches a question: in one role, and/or by a word, and/or on one list (in the list's own order).
export function selectPeople(snap, { role = null, search = '', list = null } = {}) {
  const rows = list ? list.itemIds.map((id) => snap.personById.get(id)).filter(Boolean) : snap.people;
  const inRole = role ? rows.filter((p) => p.roleType === role) : rows;
  const q = search.toLowerCase().trim();
  return { inRole, matched: q ? inRole.filter((p) => snap.text.get(p.id).includes(q)) : inRole };
}

export function selectInstitutions(snap, { search = '', list = null } = {}) {
  const rows = list ? list.itemIds.map((id) => snap.institutionById.get(id)).filter(Boolean) : snap.institutions;
  const q = search.toLowerCase().trim();
  return { inRole: rows, matched: q ? rows.filter((i) => snap.text.get(i.id).includes(q)) : rows };
}

export { ROLE_TYPES };

// ---------- the catalog: the seed file and the investor directory, rebuilt when either changes ----------

async function sigOf(file) {
  try { const info = await stat(file); return `${Math.round(info.mtimeMs)}-${info.size}`; } catch (err) { if (err.code === 'ENOENT') return 'none'; throw err; }
}

// A JSON file, or `fallback` when it is not there; any other failure is a problem to report, and the fallback stands.
async function readJson(file, fallback, problems, what) {
  if (!file) return fallback;
  try { return JSON.parse(await readFile(file, 'utf8')); } catch (err) {
    if (err.code !== 'ENOENT') problems.push(`${what} could not be read: ${err.message}`);
    return fallback;
  }
}

// institutionsFile: the firms' offices (institutions_seed.json); geocodeFile: what the geocoder answered about their addresses.
// Without them the map has no institution pins, and everything else is as it was.
export function createCommunityCatalog({ file, institutionsFile = null, geocodeFile = null, investorCatalog = null, production = false, reloadMs = 1000, now = Date.now } = {}) {
  let snap = null;
  let loading = null;
  let checkedAt = 0;
  let signature = null;

  async function load() {
    const investors = investorCatalog ? await investorCatalog.snapshot() : null;
    const sig = [await sigOf(file), institutionsFile ? await sigOf(institutionsFile) : 'no', geocodeFile ? await sigOf(geocodeFile) : 'no', investors?.version ?? 'none'].join('/');
    if (snap && sig === signature) return snap;
    const problems = [];
    const seed = await readJson(file, {}, problems, 'the people file');
    const institutionSeed = await readJson(institutionsFile, null, problems, 'the institutions file');
    const geocodeRows = await readJson(geocodeFile, [], problems, 'the geocode cache');
    snap = buildCommunity({ seed, investors, production, version: sig, institutionSeed, geocodeRows: Array.isArray(geocodeRows) ? geocodeRows : [] });
    snap.problems.push(...problems);
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
  return { snapshot: current, refresh, file };
}
