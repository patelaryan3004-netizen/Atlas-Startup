// Putting a list of investors (people at firms) from a public directory into the investor layer, safely and again and again.
//
// The list comes in as a file (CSV or JSON) of what a public page lists: for each person their name, role, firm, listed location, a public
// professional-profile address and their firm's website. This module reads it, says what each row would do (planImport, which changes nothing), and does
// it (applyPlan, on a working copy of the dataset that the caller migrates, validates and writes). Nothing here reads the network or a file.
//
// The rules it follows, which are the investor layer's own (models/investor.js, docs/investors.md):
//   - A person is matched by their professional-profile address, written one way (profileKey). A row with no address, or one that is not there yet, is
//     matched by name and firm, and a match like that is a doubt for a person to settle, never a merge. A firm is matched by its website's domain; by
//     name only when the row has no website, and then it says so.
//   - What is already on record is never overwritten: a difference is a conflict in the report, and only an empty field is filled.
//   - Everything new is a `candidate`: the person, their firm and the team record that puts one at the other. Nothing becomes public by being imported;
//     checking it against the pages the firm publishes, and publishing it, are a person's acts (the Command Center, or `npm run investors`).
//   - Retrieval is not verification. The listing is the source, with the day it was read (the source row's retrieved_at); every claim made from it is a
//     record with `verified_at: null`, because nobody has yet read the claim on a page the person or their firm publishes.
//   - A row with no role is not imported: a firm alone does not make someone an investor. A row with no firm or no name is not imported either.
//   - Running it again changes nothing: every id is worked out from the record, and what exists is found and left.
import { slugify, uniqueSlug, isStr } from '../models/company.js';
import { migrateInvestorRecord } from '../models/investor.js';
import { migratePerson } from '../models/investorGraph.js';
import { canonicalDomain, nameKey } from '../models/identity.js';
import { geoOfLocation, roleClassOf, profileKey, isLinkedIn, isLinkedInProfile, personNameKey } from './people.js';

// ---------- reading a table ----------

// The headings a file may use for each field, lower case, in the order tried.
export const COLUMNS = {
  name: ['name', 'full name', 'person', 'investor'],
  role: ['role', 'title', 'job title', 'position'],
  firm: ['firm', 'company', 'organisation', 'organization', 'fund', 'employer'],
  location: ['location', 'area', 'city', 'region', 'place'],
  profile_url: ['profile_url', 'profile url', 'profile', 'linkedin', 'linkedin_url', 'li', 'url', 'link', 'professional profile'],
  firm_website: ['firm_website', 'firm website', 'website', 'site', 'firm_url', 'firm url', 'company website', 'company_site', 'domain'],
};

// One CSV record per line, with "quoted, fields" and "" for a quote inside one. A line break inside a quoted field stays in it.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { field += '"'; i += 1; } else if (ch === '"') quoted = false; else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

// A file's rows as objects with the fields above (name, role, firm, location, profile_url, firm_website), whatever it called them. JSON is a list of objects, or
// { rows: [...] } / { investors: [...] }; anything else is CSV with a heading line. A heading this does not know is ignored, and listed in `ignored`.
export function readTable(text, { format = null } = {}) {
  const trimmed = String(text).trim();
  const json = format === 'json' || (format == null && /^[[{]/.test(trimmed));
  let objects;
  if (json) {
    const parsed = JSON.parse(trimmed);
    objects = Array.isArray(parsed) ? parsed : parsed.rows ?? parsed.investors ?? parsed.people ?? null;
    if (!Array.isArray(objects)) throw new Error('a JSON file must be a list of rows, or an object with a rows, investors or people list');
  } else {
    const [head, ...rest] = parseCsv(trimmed);
    if (!head) throw new Error('the file has no rows');
    const keys = head.map((h) => h.trim().toLowerCase());
    objects = rest.map((cells) => Object.fromEntries(keys.map((k, i) => [k, cells[i] ?? ''])));
  }
  const ignored = new Set();
  const known = new Set(Object.values(COLUMNS).flat());
  const rows = objects.map((o) => {
    const lower = Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [String(k).trim().toLowerCase(), v]));
    for (const k of Object.keys(lower)) if (!known.has(k)) ignored.add(k);
    const out = {};
    for (const [field, names] of Object.entries(COLUMNS)) {
      const hit = names.find((n) => lower[n] != null && String(lower[n]).trim() !== '');
      out[field] = hit ? String(lower[hit]).replace(/\s+/g, ' ').trim() : null;
    }
    return out;
  });
  return { rows, ignored: [...ignored].sort() };
}

// ---------- reading a row ----------

// The few short forms a directory writes for a place, written out. Only the ones that cannot mean two things.
const PLACE_WORDS = { sf: 'San Francisco', nyc: 'New York', la: 'Los Angeles', uk: 'United Kingdom', us: 'United States', sea: 'Southeast Asia' };
const placeText = (text) => (text == null ? null : (PLACE_WORDS[String(text).trim().toLowerCase()] ?? String(text).trim()));

const MAX_NAME = 120;
const looksLikeEmail = (s) => /\S+@\S+\.\S+/.test(s);

// One row, cleaned: { ok, row, notes } or { ok: false, reason }. `notes` are things dropped from a row that is otherwise taken (an address that is not a person's
// professional profile).
export function cleanRow(raw) {
  const notes = [];
  const name = raw.name == null ? null : String(raw.name).replace(/\s+/g, ' ').trim();
  if (!name) return { ok: false, reason: 'no name' };
  if (name.length > MAX_NAME || looksLikeEmail(name)) return { ok: false, reason: 'the name is not a name' };
  const role = raw.role && String(raw.role).trim() ? String(raw.role).replace(/\s+/g, ' ').trim() : null;
  if (!role) return { ok: false, reason: 'no role stated: a firm alone does not make someone an investor' };
  const firm = raw.firm && String(raw.firm).trim() ? String(raw.firm).replace(/\s+/g, ' ').trim() : null;
  if (!firm) return { ok: false, reason: 'no firm' };

  let linkedin = null;
  let website = null;
  if (raw.profile_url) {
    const key = profileKey(raw.profile_url);
    if (!key) notes.push(`profile address "${raw.profile_url}" is not a web address: left out`);
    else if (isLinkedIn(raw.profile_url)) {
      if (isLinkedInProfile(raw.profile_url)) linkedin = `https://www.linkedin.com/${key.replace(/^linkedin\.com\//, '')}`;
      else notes.push(`profile address "${raw.profile_url}" is a LinkedIn page that is not a person's profile: left out`);
    } else {
      const d = canonicalDomain(raw.profile_url);
      if (!d || d.nonCompany) notes.push(`profile address "${raw.profile_url}" is a social or directory page, not the person's own site: left out`);
      else website = String(raw.profile_url).trim();
    }
  }
  let firmSite = null;
  if (raw.firm_website) {
    const d = canonicalDomain(raw.firm_website);
    if (!d || d.nonCompany) notes.push(`firm website "${raw.firm_website}" cannot identify a firm (a social, directory or press page): left out`);
    else firmSite = { url: `https://${d.host}/`, domain: d.domain };
  }
  const location = raw.location ? placeText(raw.location) : null;
  return { ok: true, notes, row: { name, role, firm, location, listed_location: raw.location ?? null, linkedin_url: linkedin, personal_website: website, firm_site: firmSite } };
}

// ---------- planning ----------

const clip = (s, n = 60) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));

function indexOf(ds) {
  const peopleByUrl = new Map();
  const peopleByName = new Map();
  for (const p of ds.investor_people ?? []) {
    for (const url of [p.linkedin_url, p.personal_website]) { const k = url ? profileKey(url) : null; if (k) peopleByUrl.set(k, p); }
    const key = personNameKey(p.name);
    if (!peopleByName.has(key)) peopleByName.set(key, []);
    peopleByName.get(key).push(p);
  }
  const firmsByDomain = new Map();
  const firmsByName = new Map();
  for (const o of ds.investors ?? []) {
    const d = o.website ? canonicalDomain(o.website) : null;
    if (d && !d.nonCompany) firmsByDomain.set(d.domain, o);
    for (const n of [o.name, ...(o.aliases ?? [])]) {
      const k = nameKey(n);
      if (!k) continue;
      if (!firmsByName.has(k)) firmsByName.set(k, new Set());
      firmsByName.get(k).add(o);
    }
  }
  return { peopleByUrl, peopleByName, firmsByDomain, firmsByName };
}

// What each row would do, and the report. `ds` is the dataset as it stands; nothing in it is changed.
//   source: { id?, url, name, retrievedAt (an ISO day or time), retrievedBy }
export function planImport(ds, table, source) {
  if (!source?.url || !/^https?:\/\//.test(source.url)) throw new Error('say the address of the page the list was read from (source.url)');
  if (!source.retrievedAt || Number.isNaN(Date.parse(source.retrievedAt))) throw new Error('say when the list was read (source.retrievedAt): the importer never claims to have read a page itself');
  const idx = indexOf(ds);
  const retrievedAt = new Date(Date.parse(source.retrievedAt)).toISOString();
  const day = retrievedAt.slice(0, 10);
  const sourceName = source.name ?? new URL(source.url).hostname.replace(/^www\./, '');
  const sourceId = source.id ?? `${slugify(sourceName)}-${day}`;
  const rows = [];
  const seenUrl = new Map();
  const seenNameFirm = new Map();
  const newFirms = new Map(); // key (domain or name) -> the firm this run will make
  const takenPeople = new Set([...(ds.investor_people ?? []).flatMap((p) => [p.id, p.slug])]);
  const takenFirms = new Set([...(ds.investors ?? []).flatMap((o) => [o.id, o.slug])]);

  table.rows.forEach((raw, n) => {
    const entry = { n: n + 1, listed: { name: raw.name, role: raw.role, firm: raw.firm, location: raw.location }, status: null, reason: null, notes: [], person: null, firm: null, fills: [], conflicts: [] };
    rows.push(entry);
    const cleaned = cleanRow(raw);
    if (!cleaned.ok) { entry.status = 'skipped'; entry.reason = cleaned.reason; return; }
    const r = cleaned.row;
    entry.notes.push(...cleaned.notes);
    entry.clean = r;
    entry.geo = geoOfLocation(r.location);
    entry.role_class = roleClassOf(r.role);

    // ----- the firm -----
    let firm = null;
    if (r.firm_site) {
      const hit = idx.firmsByDomain.get(r.firm_site.domain);
      if (hit) firm = { kind: 'existing', org: hit, by: 'domain' };
      else if (newFirms.has(`d:${r.firm_site.domain}`)) firm = newFirms.get(`d:${r.firm_site.domain}`);
    }
    if (!firm) {
      const named = [...(idx.firmsByName.get(nameKey(r.firm)) ?? [])];
      if (r.firm_site && named.length) {
        // The name is one we have under a different website: the same firm with another site, or another firm with the same name. A person decides.
        entry.status = 'conflict';
        entry.reason = `the firm "${r.firm}" is on record with a different website (${named.map((o) => o.website ?? 'none').join(', ')}), and the listing gives ${r.firm_site.url}`;
        entry.conflicts.push(entry.reason);
        return;
      }
      if (!r.firm_site && named.length === 1) { firm = { kind: 'existing', org: named[0], by: 'name' }; entry.notes.push(`firm matched by name only ("${r.firm}"): the listing gives no website`); } else if (!r.firm_site && named.length > 1) {
        entry.status = 'conflict';
        entry.reason = `the firm "${r.firm}" is on record more than once (${named.map((o) => o.id).join(', ')}) and the listing gives no website to tell them apart`;
        entry.conflicts.push(entry.reason);
        return;
      } else if (!r.firm_site && newFirms.has(`n:${nameKey(r.firm)}`)) firm = newFirms.get(`n:${nameKey(r.firm)}`);
    }
    if (!firm) {
      const id = uniqueSlug(slugify(r.firm) || 'firm', takenFirms);
      takenFirms.add(id);
      firm = { kind: 'new', id, name: r.firm, website: r.firm_site?.url ?? null, domain: r.firm_site?.domain ?? null };
      newFirms.set(r.firm_site ? `d:${r.firm_site.domain}` : `n:${nameKey(r.firm)}`, firm);
      if (r.firm_site) newFirms.set(`n:${nameKey(r.firm)}`, firm);
    }
    entry.firm = firm;
    const firmId = firm.kind === 'existing' ? firm.org.id : firm.id;

    // ----- the person -----
    const url = r.linkedin_url ?? r.personal_website;
    const urlKey = url ? profileKey(url) : null;
    const nameFirm = `${personNameKey(r.name)}|${firmId}`;
    if (urlKey && seenUrl.has(urlKey)) { entry.status = 'duplicate'; entry.reason = `the same profile address as row ${seenUrl.get(urlKey)}`; return; }
    if (!urlKey && seenNameFirm.has(nameFirm)) { entry.status = 'duplicate'; entry.reason = `the same name and firm as row ${seenNameFirm.get(nameFirm)}, and no profile address to tell them apart`; return; }
    if (urlKey) seenUrl.set(urlKey, n + 1);
    seenNameFirm.set(nameFirm, n + 1);

    const byUrl = urlKey ? idx.peopleByUrl.get(urlKey) : null;
    const sameNameFirm = (idx.peopleByName.get(personNameKey(r.name)) ?? []).filter((p) => p.current_organisation_id === firmId);
    if (byUrl) {
      entry.status = 'matched';
      entry.person = { kind: 'existing', person: byUrl, by: 'profile address' };
      if (personNameKey(byUrl.name) !== personNameKey(r.name)) entry.conflicts.push(`the listing says "${r.name}"; the record says "${byUrl.name}"`);
      if (byUrl.current_organisation_id != null && byUrl.current_organisation_id !== firmId) entry.conflicts.push(`the listing puts them at ${r.firm}; the record puts them at another organisation (${byUrl.current_organisation_id})`);
      if (byUrl.current_title && byUrl.current_title.trim().toLowerCase() !== r.role.toLowerCase()) entry.conflicts.push(`the listing says "${r.role}"; the record says "${byUrl.current_title}"`);
      if (!byUrl.location && r.location) entry.fills.push({ field: 'location', to: r.location });
      if (urlKey && ((r.linkedin_url && !byUrl.linkedin_url) || (r.personal_website && !byUrl.personal_website))) entry.fills.push({ field: r.linkedin_url ? 'linkedin_url' : 'personal_website', to: url });
      if (byUrl.location && r.location && byUrl.location.trim().toLowerCase() !== r.location.toLowerCase()) entry.conflicts.push(`the listing says they are in "${r.location}"; the record says "${byUrl.location}"`);
      if (entry.conflicts.length) { entry.status = 'conflict'; entry.reason = entry.conflicts[0]; entry.fills = []; }
      return;
    }
    if (sameNameFirm.length) {
      entry.status = 'conflict';
      entry.person = { kind: 'existing', person: sameNameFirm[0], by: 'name and firm' };
      entry.reason = `"${r.name}" at ${r.firm} is already on record (${sameNameFirm.map((p) => p.id).join(', ')}) with ${urlKey ? 'a different or no' : 'no shared'} profile address: the same person, or two people with one name? A person decides`;
      entry.conflicts.push(entry.reason);
      return;
    }
    const base = slugify(r.name) || 'person';
    let id = uniqueSlug(base, takenPeople);
    // Two people with one name: the second is told from the first by their firm, so the address says who it is.
    if (id !== base) id = uniqueSlug(`${base}-${slugify(r.firm)}`, takenPeople);
    takenPeople.add(id);
    entry.status = 'new';
    entry.person = { kind: 'new', id };
  });

  const accepted = rows.filter((r) => r.status === 'new' || r.status === 'matched');
  const by = (status) => rows.filter((r) => r.status === status);
  const count = (list, key) => list.reduce((m, r) => m.set(key(r), (m.get(key(r)) ?? 0) + 1), new Map());
  const clean = rows.filter((r) => r.clean);
  const scope = count(clean.filter((r) => r.status !== 'skipped'), (r) => (r.geo.scope === 'au' ? 'australian' : r.geo.label ? 'international or unplaced' : 'no location'));
  const firmsNew = [...new Set(rows.filter((r) => r.firm?.kind === 'new' && (r.status === 'new' || r.status === 'matched')).map((r) => r.firm.id))];
  const firmsExisting = [...new Set(rows.filter((r) => r.firm?.kind === 'existing').map((r) => r.firm.org.id))];
  const report = {
    source: { id: sourceId, url: source.url, name: sourceName, retrieved_at: retrievedAt, retrieved_by: source.retrievedBy ?? null },
    collected: table.rows.length,
    new_people: by('new').length,
    new_firms: firmsNew.length,
    existing_people_matched: by('matched').length,
    existing_firms_matched: firmsExisting.length,
    proposed_updates: by('matched').filter((r) => r.fills.length).length,
    conflicts: by('conflict').length,
    duplicates_in_source: by('duplicate').length,
    skipped: by('skipped').length,
    australian: scope.get('australian') ?? 0,
    international_or_unplaced: scope.get('international or unplaced') ?? 0,
    no_location: scope.get('no location') ?? 0,
    roles: Object.fromEntries([...count(accepted, (r) => r.role_class ?? 'none')].sort()),
    ignored_columns: table.ignored ?? [],
  };
  return { source: { ...report.source, id: sourceId }, rows, report, accepted: accepted.length };
}

// ---------- the report, as words ----------

export function reportText(plan, { applied = false, limit = 12 } = {}) {
  const r = plan.report;
  const lines = [
    `${applied ? 'Imported' : 'Dry run of the import'}: ${r.source.name} (${r.source.url}), read ${r.source.retrieved_at.slice(0, 10)}${r.source.retrieved_by ? ` by ${r.source.retrieved_by}` : ''}`,
    '',
    `  Source records collected:        ${r.collected}`,
    `  New people:                      ${r.new_people}`,
    `  New firms:                       ${r.new_firms}`,
    `  Existing people matched:         ${r.existing_people_matched}   (proposed updates to ${r.proposed_updates})`,
    `  Existing firms matched:          ${r.existing_firms_matched}`,
    `  Conflicts, kept for review:      ${r.conflicts}`,
    `  Duplicates inside the source:    ${r.duplicates_in_source}`,
    `  Skipped:                         ${r.skipped}`,
    '',
    `  Australian:                      ${r.australian}`,
    `  International or not placed:     ${r.international_or_unplaced}   (and ${r.no_location} with no location listed)`,
    `  Roles:                           ${Object.entries(r.roles).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`,
  ];
  if (r.ignored_columns.length) lines.push('', `  Columns not used: ${r.ignored_columns.join(', ')}`);
  const section = (title, rows, say) => {
    if (!rows.length) return;
    lines.push('', `${title} (${rows.length}${rows.length > limit ? `, first ${limit}` : ''}):`);
    for (const row of rows.slice(0, limit)) lines.push(`  row ${row.n}: ${clip(row.listed.name ?? '(no name)', 40)}: ${say(row)}`);
  };
  section('Conflicts', plan.rows.filter((x) => x.status === 'conflict'), (x) => x.reason);
  section('Proposed updates', plan.rows.filter((x) => x.status === 'matched' && x.fills.length), (x) => x.fills.map((f) => `${f.field} -> ${clip(f.to, 50)}`).join('; '));
  section('Skipped', plan.rows.filter((x) => x.status === 'skipped' || x.status === 'duplicate'), (x) => x.reason);
  return lines.join('\n');
}

// ---------- doing it ----------

const PERSON_NOTE = (listed, source) => `${source.title} lists ${listed.name}${listed.role ? `, "${listed.role}"` : ''}${listed.firm ? ` at ${listed.firm}` : ''}${listed.location ? `, ${listed.location}` : ''}.`;

// Makes the plan's new people, firms and team records, fills the empty fields it proposed, and records the source and the claims. Works on `work`, a copy
// of the dataset (the store migrates and validates it before anything is written). Returns what it made, for the audit row and for undoing it.
export function applyPlan(work, plan, { at }) {
  const made = { sources: [], investors: [], investor_people: [], investor_people_organisations: [], verification_records: [], filled: [] };
  work.sources ??= [];
  work.investors ??= [];
  work.investor_people ??= [];
  work.investor_people_organisations ??= [];
  work.verification_records ??= [];
  const { source } = plan;

  let src = work.sources.find((s) => s.id === source.id);
  if (!src) {
    src = {
      id: source.id, kind: 'directory_listing', url: source.url, title: source.name, publisher: source.name, retrieved_at: source.retrieved_at,
      note: `A public directory listing, read ${source.retrieved_at.slice(0, 10)}${source.retrieved_by ? ` by ${source.retrieved_by}` : ''}. It is where the claims made from it were found; none has yet been read on a page the person or their firm publishes.`,
    };
    work.sources.push(src);
    made.sources.push(src.id);
  }
  const record = (subjectType, subjectId, field, value, listed) => {
    const id = `${subjectId}.${field}.${slugify(String(value)).slice(0, 40)}.${src.id}`;
    if (work.verification_records.some((x) => x.id === id)) return;
    work.verification_records.push({
      id, subject_type: subjectType, subject_id: subjectId, field, value, source_id: src.id, confidence: 'medium', verified_at: null, status: 'active',
      note: `Listed by ${src.title}${listed ? `: "${listed}"` : ''}.`,
    });
    made.verification_records.push(id);
  };

  const orgOf = (firm) => {
    if (firm.kind === 'existing') return work.investors.find((o) => o.id === firm.org.id) ?? firm.org;
    const have = work.investors.find((o) => o.id === firm.id);
    if (have) return have;
    const org = migrateInvestorRecord({ id: firm.id, name: firm.name, slug: firm.id, aliases: [], website: firm.website, created_at: at, updated_at: at });
    work.investors.push(org);
    made.investors.push(org.id);
    record('investor_organisation', org.id, 'name', org.name, firm.name);
    if (org.website) record('investor_organisation', org.id, 'website', org.website, firm.website);
    return org;
  };

  for (const row of plan.rows) {
    if (row.status === 'new') {
      const org = orgOf(row.firm);
      const r = row.clean;
      const id = row.person.id;
      if (work.investor_people.some((p) => p.id === id)) continue; // made already: running it again changes nothing
      const person = migratePerson({
        id, name: r.name, slug: id, current_title: r.role, current_organisation_id: org.id, location: r.location, linkedin_url: r.linkedin_url, personal_website: r.personal_website,
        verification_status: 'candidate', created_at: at, updated_at: at,
      });
      work.investor_people.push(person);
      made.investor_people.push(id);
      const teamId = `${id}.${org.id}`;
      work.investor_people_organisations.push({
        id: teamId, person_id: id, organisation_id: org.id, role: r.role, is_current: true, started_on: null, ended_on: null, source_id: src.id,
        note: PERSON_NOTE({ name: r.name, role: r.role, firm: r.firm, location: row.listed.location }, src), verified_at: null, verification_status: 'unverified',
      });
      made.investor_people_organisations.push(teamId);
      if (r.location) record('investor_person', id, 'location', r.location, row.listed.location);
      if (r.linkedin_url) record('investor_person', id, 'linkedin_url', r.linkedin_url, r.linkedin_url);
      if (r.personal_website) record('investor_person', id, 'personal_website', r.personal_website, r.personal_website);
    } else if (row.status === 'matched' && row.fills.length) {
      const p = work.investor_people.find((x) => x.id === row.person.person.id);
      for (const f of row.fills) {
        if (p[f.field] != null && p[f.field] !== '') continue; // filled since the plan was made: leave it
        made.filled.push({ person: p.id, field: f.field, to: f.to, was_updated_at: p.updated_at ?? null });
        p[f.field] = f.to;
        p.updated_at = at;
        record('investor_person', p.id, f.field, f.to, f.to);
      }
    }
  }
  return made;
}

// Takes out what a run made, but only while every one of those people and firms is still a candidate nobody has worked on: a record that has been
// checked, published or edited is a person's work and stays (and the undo says so and changes nothing).
export function undoRun(work, made) {
  const people = new Set(made.investor_people);
  const firms = new Set(made.investors);
  const worked = [
    ...work.investor_people.filter((p) => people.has(p.id) && !['candidate', 'needs_review'].includes(p.verification_status)).map((p) => `${p.name} is ${p.verification_status}`),
    ...work.investors.filter((o) => firms.has(o.id) && !['candidate', 'needs_review'].includes(o.verification_status)).map((o) => `${o.name} is ${o.verification_status}`),
    ...work.investor_people.filter((p) => people.has(p.id) && p.updated_at !== p.created_at).map((p) => `${p.name} was edited after the import`),
  ];
  if (worked.length) throw new Error(`not undone, because a person has worked on what it made: ${worked.slice(0, 5).join('; ')}${worked.length > 5 ? '; and more' : ''}`);
  const gone = (list, ids) => list.filter((x) => !ids.has(x.id));
  work.investor_people = gone(work.investor_people, people);
  work.investors = gone(work.investors, firms);
  work.investor_people_organisations = gone(work.investor_people_organisations, new Set(made.investor_people_organisations));
  work.verification_records = gone(work.verification_records, new Set(made.verification_records));
  work.sources = gone(work.sources, new Set(made.sources));
  for (const f of made.filled) {
    const p = work.investor_people.find((x) => x.id === f.person);
    if (p && p[f.field] === f.to) { p[f.field] = null; p.updated_at = f.was_updated_at; }
  }
  return { people: people.size, firms: firms.size, filled: made.filled.length };
}

export { isStr };
