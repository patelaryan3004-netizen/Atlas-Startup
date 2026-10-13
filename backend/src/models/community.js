// The people and institutions worth following, and the lists that gather them (Stage 11).
//
// Everything here is typed in by the owner, in people_seed.json, and nothing is made up: a person is only ever what an entry
// says, and an entry that does not meet the rules below is left out of every answer (and named in `problems`), never repaired. What
// a visitor sees of an entry is its public projection (publicPerson, publicInstitution): vouches only where the person said yes,
// links only where they are web addresses, and nothing else.
//
// The rules, in short:
//   a person       id, name, type "person", roleType founder | operator | investor; title, orgName, orgType (company | firm | null),
//                  city; whyFollow of 140 characters at most; links { website, linkedin, x } that are http(s) addresses or null;
//                  sources [{ label, url }]; verifiedAt (a date; it needs at least one source: a check no page backs is not shown);
//                  vouches [{ name, role, note, consented }], shown only where consented is true.
//   an institution id, name, type "institution", city, stageFocus, sectors, website, sources, verifiedAt (same source rule).
//   a list         id, title, description, curator, type people | institutions | companies, itemIds (each must name an entry of
//                  that kind; one that does not is left out).
//   a placeholder  an entry marked placeholder: true shows an owner the layout while building, on a machine that sets SHOW_PLACEHOLDERS=1,
//                  and is never served anywhere else.

export const ROLE_TYPES = ['founder', 'operator', 'investor'];
export const ORG_TYPES = ['company', 'firm'];
export const LIST_TYPES = ['people', 'institutions', 'companies'];
export const WHY_MAX = 140;

const text = (v) => (typeof v === 'string' ? v.trim() : '');
const isWebAddress = (v) => {
  try { const u = new URL(String(v)); return u.protocol === 'http:' || u.protocol === 'https:'; } catch (e) { return false; }
};
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) && !Number.isNaN(Date.parse(v));
const isSlug = (v) => typeof v === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(v);

function linksProblems(links, where) {
  if (links == null) return [];
  if (typeof links !== 'object' || Array.isArray(links)) return [`${where}: links must be an object`];
  const out = [];
  for (const [key, value] of Object.entries(links)) {
    if (!['website', 'linkedin', 'x'].includes(key)) out.push(`${where}: links.${key} is not one of website, linkedin, x`);
    else if (value != null && !isWebAddress(value)) out.push(`${where}: links.${key} must be an http(s) address or null`);
  }
  return out;
}

function sourcesProblems(sources, where) {
  if (sources == null) return [];
  if (!Array.isArray(sources)) return [`${where}: sources must be a list`];
  return sources.flatMap((s, i) => [
    ...(text(s?.label) ? [] : [`${where}: sources[${i}] needs a label`]),
    ...(isWebAddress(s?.url) ? [] : [`${where}: sources[${i}] needs an http(s) address`]),
  ]);
}

function verifiedProblems(entry, where) {
  if (entry.verifiedAt == null) return [];
  if (!isDate(entry.verifiedAt)) return [`${where}: verifiedAt must be a date`];
  if (!Array.isArray(entry.sources) || entry.sources.length === 0) return [`${where}: verifiedAt needs at least one source: a check no page backs is not shown`];
  return [];
}

export function personProblems(p, where = `person "${p?.id}"`) {
  if (!p || typeof p !== 'object') return [`${where}: not an entry`];
  const out = [];
  if (!isSlug(p.id)) out.push(`${where}: id must be lowercase letters, digits and hyphens`);
  if (!text(p.name)) out.push(`${where}: name is needed`);
  if (p.type !== 'person') out.push(`${where}: type must be "person"`);
  if (!ROLE_TYPES.includes(p.roleType)) out.push(`${where}: roleType must be one of ${ROLE_TYPES.join(', ')}`);
  if (p.orgType != null && !ORG_TYPES.includes(p.orgType)) out.push(`${where}: orgType must be company, firm or null`);
  if (p.whyFollow != null && (typeof p.whyFollow !== 'string' || p.whyFollow.length > WHY_MAX)) out.push(`${where}: whyFollow must be text of ${WHY_MAX} characters or fewer`);
  out.push(...linksProblems(p.links, where), ...sourcesProblems(p.sources, where), ...verifiedProblems(p, where));
  if (p.vouches != null) {
    if (!Array.isArray(p.vouches)) out.push(`${where}: vouches must be a list`);
    else p.vouches.forEach((v, i) => {
      if (typeof v?.consented !== 'boolean') out.push(`${where}: vouches[${i}].consented must be true or false`);
      if (!text(v?.name)) out.push(`${where}: vouches[${i}] needs a name`);
    });
  }
  return out;
}

export function institutionProblems(o, where = `institution "${o?.id}"`) {
  if (!o || typeof o !== 'object') return [`${where}: not an entry`];
  const out = [];
  if (!isSlug(o.id)) out.push(`${where}: id must be lowercase letters, digits and hyphens`);
  if (!text(o.name)) out.push(`${where}: name is needed`);
  if (o.type !== 'institution') out.push(`${where}: type must be "institution"`);
  if (o.sectors != null && !Array.isArray(o.sectors)) out.push(`${where}: sectors must be a list`);
  if (o.website != null && !isWebAddress(o.website)) out.push(`${where}: website must be an http(s) address or null`);
  out.push(...sourcesProblems(o.sources, where), ...verifiedProblems(o, where));
  return out;
}

export function listProblems(l, where = `list "${l?.id}"`) {
  if (!l || typeof l !== 'object') return [`${where}: not an entry`];
  const out = [];
  if (!isSlug(l.id)) out.push(`${where}: id must be lowercase letters, digits and hyphens`);
  if (!text(l.title)) out.push(`${where}: title is needed`);
  if (!LIST_TYPES.includes(l.type)) out.push(`${where}: type must be one of ${LIST_TYPES.join(', ')}`);
  if (!Array.isArray(l.itemIds) || l.itemIds.some((id) => typeof id !== 'string')) out.push(`${where}: itemIds must be a list of ids`);
  return out;
}

// What a visitor may see of a person: the vouches that were said yes to, links that are addresses, and the fields the card shows.
// Nothing else of the entry (a note to the owner, an email) is ever passed on.
export function publicPerson(p) {
  const links = Object.fromEntries(Object.entries(p.links ?? {}).filter(([, v]) => typeof v === 'string' && isWebAddress(v)));
  const person = {
    id: p.id, name: text(p.name), type: 'person', roleType: p.roleType, title: text(p.title) || null, orgName: text(p.orgName) || null, orgType: p.orgType ?? null,
    city: text(p.city) || null, whyFollow: text(p.whyFollow) || null, links,
    sources: (p.sources ?? []).map((s) => ({ label: text(s.label), url: s.url })), verifiedAt: p.verifiedAt ?? null,
    vouches: (p.vouches ?? []).filter((v) => v?.consented === true).map((v) => ({ name: text(v.name), role: text(v.role) || null, note: text(v.note) || null })),
  };
  if (p.href) person.href = p.href; // an internal page this person already has (an investor's)
  if (p.placeholder === true) person.placeholder = true;
  return person;
}

export function publicInstitution(o) {
  const stage = Array.isArray(o.stageFocus) ? o.stageFocus.filter(Boolean).join(', ') : text(o.stageFocus);
  const institution = {
    id: o.id, name: text(o.name), type: 'institution', city: text(o.city) || null, stageFocus: stage || null,
    sectors: (o.sectors ?? []).filter((s) => typeof s === 'string' && s.trim()), website: o.website && isWebAddress(o.website) ? o.website : null,
    sources: (o.sources ?? []).map((s) => ({ label: text(s.label), url: s.url })), verifiedAt: o.verifiedAt ?? null,
  };
  if (o.href) institution.href = o.href;
  if (o.placeholder === true) institution.placeholder = true;
  return institution;
}

// The seed, checked entry by entry: the entries that meet the rules (placeholders only outside production), and a plain account of
// each one that did not. Nothing is repaired.
export function checkSeed(seed, { production = false } = {}) {
  const problems = [];
  const keep = (rows, kind, test, make) => (Array.isArray(rows) ? rows : []).flatMap((row) => {
    const found = test(row);
    if (found.length) { problems.push(...found); return []; }
    if (row.placeholder === true && production) return [];
    return [make(row)];
  });
  const people = keep(seed?.people, 'person', personProblems, publicPerson);
  const institutions = keep(seed?.institutions, 'institution', institutionProblems, publicInstitution);
  const lists = keep(seed?.lists, 'list', listProblems, (l) => ({
    id: l.id, title: text(l.title), description: text(l.description) || null, curator: text(l.curator) || null, type: l.type, itemIds: l.itemIds,
  }));
  // An id is one entry's: the first stays, and a later entry with the same id is left out.
  const firstOf = (rows, kind) => {
    const seen = new Set();
    return rows.filter((row) => {
      if (seen.has(row.id)) { problems.push(`${kind} id "${row.id}" is used more than once: the later entry is left out`); return false; }
      seen.add(row.id);
      return true;
    });
  };
  return { people: firstOf(people, 'person'), institutions: firstOf(institutions, 'institution'), lists: firstOf(lists, 'list'), problems };
}
