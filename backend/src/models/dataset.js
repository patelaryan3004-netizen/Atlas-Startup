// Loads, migrates and validates the file-backed dataset: startups.json plus the
// relationship collections that sit beside it. These are not a second company
// store - companies live only in startups.json; the other files hold the
// entities a company points at, keyed by the company's immutable id.
//
//   people.json          founders        { id, name, slug }
//   investors.json       backers         { id, name, slug, aliases[] }
//   sources.json         provenance      { id, kind, url, title, publisher, retrieved_at, note }
//   funding_rounds.json  owned by a company, FK company_id
//                        { id, company_id, round, amount, currency, announced_on,
//                          lead_investor_ids[], investor_ids[], source_ids[] }
//   jobs.json            owned by a company, FK company_id
//                        { id, company_id, title, location, employment_type, remote,
//                          posted_at, apply_url, status, source_id, retrieved_at }
//   news.json            many-to-many, company_ids[]
//                        { id, headline, url, publisher, published_at, company_ids[], source_id }
//
// Each collection maps one-to-one onto a table, and every id is a stable string,
// so a later move to a real database is a load step, not a redesign.
import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  ADDED_FIELDS, LEGACY_FIELDS, AU_STATES, COMPANY_STATUSES, VERIFICATION_STATUSES,
  HIRING_STATUSES, EMPLOYEE_RANGES, slugify, uniqueSlug, migrateCompanyRecord, toCanonical,
} from './company.js';

export const COLLECTION_FILES = {
  companies: 'startups.json',
  people: 'people.json',
  investors: 'investors.json',
  sources: 'sources.json',
  funding_rounds: 'funding_rounds.json',
  jobs: 'jobs.json',
  news: 'news.json',
};

export const SOURCE_KINDS = [
  'company_website', 'company_document', 'press', 'investor_post',
  'accelerator_profile', 'directory_listing', 'aggregator', 'user_supplied',
];
export const JOB_STATUSES = ['open', 'closed'];

// ---------- file I/O ----------

export async function loadRaw(dir) {
  const raw = {};
  for (const file of Object.values(COLLECTION_FILES)) {
    try {
      raw[file] = await readFile(path.join(dir, file), 'utf-8');
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      raw[file] = null;
    }
  }
  return raw;
}

export function parseRaw(raw) {
  if (raw[COLLECTION_FILES.companies] == null) throw new Error('startups.json is required');
  const ds = {};
  for (const [key, file] of Object.entries(COLLECTION_FILES)) {
    ds[key] = raw[file] == null ? [] : JSON.parse(raw[file]);
  }
  return ds;
}

export const serializeCollection = (rows) => `${JSON.stringify(rows, null, 2)}\n`;

export function serializeDataset(ds) {
  return Object.fromEntries(
    Object.entries(COLLECTION_FILES).map(([key, file]) => [file, serializeCollection(ds[key])]),
  );
}

// Write-then-rename so a crash never leaves a half-written data file.
export async function writeFiles(dir, files) {
  for (const [file, text] of Object.entries(files)) {
    const target = path.join(dir, file);
    const tmp = `${target}.tmp`;
    await writeFile(tmp, text, 'utf-8');
    await rename(tmp, target);
  }
}

// ---------- entity linking ----------

const normKey = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();

// People are matched by exact (case-insensitive) name. Two real people sharing
// a name must be told apart in people.json before the migration runs.
function createPersonLinker(existing) {
  const people = existing.map((p) => ({ ...p }));
  const byName = new Map(people.map((p) => [normKey(p.name), p]));
  const takenIds = new Set(people.map((p) => p.id));
  const takenSlugs = new Set(people.map((p) => p.slug));
  const link = (name) => {
    const key = normKey(name);
    let person = byName.get(key);
    if (!person) {
      const id = uniqueSlug(slugify(name), takenIds);
      takenIds.add(id);
      const slug = uniqueSlug(slugify(name), takenSlugs);
      takenSlugs.add(slug);
      person = { id, name, slug };
      people.push(person);
      byName.set(key, person);
    }
    return person.id;
  };
  return { people, link };
}

// Investor strings in startups.json are free text. Only a case/whitespace
// variant ("AirTree" / "Airtree") is merged, and the other spelling is kept as
// an alias so nothing is lost. Near-duplicates that need a human call
// ("Prosus" / "Prosus Ventures", "Latitude" / "Latitude 37") stay separate
// entities and are surfaced by investorReviewNotes().
function createInvestorLinker(companies, existing) {
  const investors = existing.map((i) => ({ ...i, aliases: [...(i.aliases || [])] }));
  const byKey = new Map();
  for (const inv of investors) {
    byKey.set(normKey(inv.name), inv);
    for (const alias of inv.aliases) byKey.set(normKey(alias), inv);
  }

  // Most frequent spelling names a new entity; ties go to the first seen.
  const spellings = new Map();
  for (const c of companies) {
    for (const raw of c.investors || []) {
      const key = normKey(raw);
      if (!spellings.has(key)) spellings.set(key, new Map());
      const counts = spellings.get(key);
      counts.set(raw, (counts.get(raw) || 0) + 1);
    }
  }

  const takenIds = new Set(investors.map((i) => i.id));
  const takenSlugs = new Set(investors.map((i) => i.slug));
  for (const [key, counts] of spellings) {
    const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
    let entity = byKey.get(key);
    if (!entity) {
      const id = uniqueSlug(slugify(ordered[0]), takenIds);
      takenIds.add(id);
      const slug = uniqueSlug(slugify(ordered[0]), takenSlugs);
      takenSlugs.add(slug);
      entity = { id, name: ordered[0], slug, aliases: [] };
      investors.push(entity);
      byKey.set(key, entity);
    }
    for (const spelling of ordered) {
      if (spelling !== entity.name && !entity.aliases.includes(spelling)) entity.aliases.push(spelling);
    }
  }
  const link = (raw) => byKey.get(normKey(raw)).id;
  return { investors, link };
}

// ---------- migration ----------

function assertLegacyPreserved(before, after) {
  if (before.length !== after.length) throw new Error('migration changed the number of companies');
  before.forEach((b, i) => {
    for (const key of LEGACY_FIELDS) {
      if (key in b && !isDeepStrictEqual(b[key], after[i][key])) {
        throw new Error(`migration altered legacy field "${key}" on "${b.name}"`);
      }
    }
    if (b.name !== after[i].name) throw new Error(`migration reordered companies at index ${i}`);
  });
}

// Pure and idempotent: migrate(migrate(x)) deep-equals migrate(x).
export function migrateDataset(input) {
  const legacy = input.companies;

  const takenIds = new Set(legacy.filter((c) => c.id != null).map((c) => c.id));
  const takenSlugs = new Set(legacy.filter((c) => c.slug != null).map((c) => c.slug));
  const companies = legacy.map((c) => {
    let { id, slug } = c;
    if (id == null) {
      id = uniqueSlug(slugify(c.name), takenIds);
      takenIds.add(id);
    }
    if (slug == null) {
      slug = uniqueSlug(slugify(c.name), takenSlugs);
      takenSlugs.add(slug);
    }
    return migrateCompanyRecord(c, { id, slug });
  });

  // founders[] and investors[] (names) stay the hand-edited source; the id
  // lists are regenerated from them so the two can never disagree.
  const { people, link: linkPerson } = createPersonLinker(input.people);
  const { investors, link: linkInvestor } = createInvestorLinker(companies, input.investors);
  for (const c of companies) {
    c.founder_ids = (c.founders || []).map(linkPerson);
    c.investor_ids = [...new Set((c.investors || []).map(linkInvestor))];
  }

  assertLegacyPreserved(legacy, companies);
  return { ...input, companies, people, investors };
}

// Qualifier/compound names and prefix near-duplicates, for a human to review.
// Reported only - never stored and never merged automatically.
export function investorReviewNotes(investors) {
  const notes = [];
  for (const inv of investors) {
    if (/\b(?:etc\.?|others)\b|[/()]/i.test(inv.name)) {
      notes.push({ name: inv.name, issue: 'qualifier or compound name' });
    }
  }
  const keyed = investors.map((inv) => ({ inv, key: normKey(inv.name) }));
  for (const a of keyed) {
    for (const b of keyed) {
      if (a !== b && b.key.startsWith(a.key) && /^[\s/(]/.test(b.key.slice(a.key.length))) {
        notes.push({ name: b.inv.name, issue: `possible duplicate of "${a.inv.name}"` });
      }
    }
  }
  return notes;
}

// ---------- validation ----------

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const PARTIAL_DATE_RE = /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/;
const URL_RE = /^https?:\/\/\S+$/;
const isStr = (v) => typeof v === 'string' && v.trim() !== '';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function validateDataset(ds) {
  const errors = [];
  const bad = (where, msg) => errors.push(`${where}: ${msg}`);
  const idSet = (rows) => new Set(rows.map((r) => r.id));

  const people = idSet(ds.people);
  const investors = idSet(ds.investors);
  const sources = idSet(ds.sources);
  const companyIds = new Set();
  const slugs = new Set();

  const uniqueIds = (rows, label) => {
    const seen = new Set();
    for (const r of rows) {
      if (!isStr(r.id) || !SLUG_RE.test(r.id)) bad(label, `invalid id ${JSON.stringify(r.id)}`);
      else if (seen.has(r.id)) bad(label, `duplicate id "${r.id}"`);
      seen.add(r.id);
    }
  };
  uniqueIds(ds.people, 'people');
  uniqueIds(ds.investors, 'investors');
  uniqueIds(ds.sources, 'sources');
  uniqueIds(ds.funding_rounds, 'funding_rounds');
  uniqueIds(ds.jobs, 'jobs');
  uniqueIds(ds.news, 'news');
  uniqueIds(ds.companies, 'companies');

  for (const c of ds.companies) {
    const at = `company "${c.name}"`;
    companyIds.add(c.id);
    if (!isStr(c.slug) || !SLUG_RE.test(c.slug)) bad(at, `invalid slug ${JSON.stringify(c.slug)}`);
    else if (slugs.has(c.slug)) bad(at, `duplicate slug "${c.slug}"`);
    slugs.add(c.slug);

    for (const key of ADDED_FIELDS) if (!(key in c)) bad(at, `missing field "${key}"`);

    // Shapes the existing frontend and API rely on.
    if (!isStr(c.name)) bad(at, 'name must be a non-empty string');
    for (const key of ['sector', 'sectorFull', 'city', 'stage', 'website', 'blurb']) {
      if (typeof c[key] !== 'string') bad(at, `legacy field "${key}" must be a string`);
    }
    if (!Array.isArray(c.investors)) bad(at, 'investors must be an array');
    if (typeof c.hiring !== 'boolean') bad(at, 'hiring must be a boolean');
    if (typeof c.verified !== 'boolean') bad(at, 'verified must be a boolean');
    if (typeof c.taskGate?.enabled !== 'boolean') bad(at, 'taskGate.enabled must be a boolean');
    const hasLat = c.lat != null;
    const hasLng = c.lng != null;
    if (hasLat !== hasLng) bad(at, 'lat and lng must both be set or both null');
    if (hasLat && (!isNum(c.lat) || !isNum(c.lng))) bad(at, 'lat/lng must be numbers');

    if (c.state != null && !AU_STATES.includes(c.state)) bad(at, `invalid state ${JSON.stringify(c.state)}`);
    if (c.state != null && c.country !== 'Australia') bad(at, 'state is set but country is not Australia');
    if (c.company_status != null && !COMPANY_STATUSES.includes(c.company_status)) bad(at, `invalid company_status "${c.company_status}"`);
    if (c.hiring_status != null && !HIRING_STATUSES.includes(c.hiring_status)) bad(at, `invalid hiring_status "${c.hiring_status}"`);
    if (c.employee_range != null && !EMPLOYEE_RANGES.includes(c.employee_range)) bad(at, `invalid employee_range "${c.employee_range}"`);
    if (!VERIFICATION_STATUSES.includes(c.verification_status)) bad(at, `invalid verification_status "${c.verification_status}"`);
    if (c.funding_total != null && (!isNum(c.funding_total) || c.funding_total < 0)) bad(at, 'funding_total must be a number >= 0 or null');
    if (c.last_funding_date != null && !PARTIAL_DATE_RE.test(c.last_funding_date)) bad(at, 'last_funding_date must be YYYY, YYYY-MM or YYYY-MM-DD');
    if (c.confidence_score != null && (!isNum(c.confidence_score) || c.confidence_score < 0 || c.confidence_score > 1)) bad(at, 'confidence_score must be 0..1 or null');
    for (const key of ['created_at', 'updated_at', 'last_verified_at']) {
      if (c[key] != null && !ISO_RE.test(c[key])) bad(at, `${key} must be an ISO-8601 UTC timestamp or null`);
    }

    // The two representations of one fact must agree.
    if ((c.hiring === true) !== (c.hiring_status === 'hiring')) bad(at, 'hiring and hiring_status disagree');
    if ((c.verified === true) !== (c.verification_status !== 'unverified')) bad(at, 'verified and verification_status disagree');

    // A record may only claim verification if it cites something.
    if (c.last_verified_at != null && c.source_ids.length === 0) bad(at, 'last_verified_at is set but source_ids is empty');

    const founders = c.founders || [];
    if (c.founder_ids.length !== founders.length) bad(at, 'founder_ids length does not match founders');
    c.founder_ids.forEach((id, i) => {
      const person = ds.people.find((p) => p.id === id);
      if (!person) bad(at, `unknown founder id "${id}"`);
      else if (normKey(person.name) !== normKey(founders[i])) bad(at, `founder_ids[${i}] "${person.name}" does not match founders[${i}] "${founders[i]}"`);
    });
    for (const id of c.investor_ids) if (!investors.has(id)) bad(at, `unknown investor id "${id}"`);
    for (const id of c.source_ids) if (!sources.has(id)) bad(at, `unknown source id "${id}"`);
    for (const raw of c.investors || []) {
      const entity = ds.investors.find((i) => [i.name, ...i.aliases].some((n) => normKey(n) === normKey(raw)));
      if (!entity || !c.investor_ids.includes(entity.id)) bad(at, `investor "${raw}" is not linked in investor_ids`);
    }
  }

  for (const i of ds.investors) {
    if (!isStr(i.name) || !SLUG_RE.test(i.slug) || !Array.isArray(i.aliases)) bad(`investor "${i.id}"`, 'needs name, slug and aliases[]');
  }
  for (const p of ds.people) if (!isStr(p.name) || !SLUG_RE.test(p.slug)) bad(`person "${p.id}"`, 'needs name and slug');

  for (const s of ds.sources) {
    const at = `source "${s.id}"`;
    if (!SOURCE_KINDS.includes(s.kind)) bad(at, `invalid kind "${s.kind}"`);
    if (s.url != null && !URL_RE.test(s.url)) bad(at, 'url must be http(s) or null');
    if (s.retrieved_at != null && !ISO_RE.test(s.retrieved_at)) bad(at, 'retrieved_at must be ISO-8601 UTC or null');
  }

  for (const r of ds.funding_rounds) {
    const at = `funding_round "${r.id}"`;
    if (!companyIds.has(r.company_id)) bad(at, `unknown company_id "${r.company_id}"`);
    if (!isStr(r.round)) bad(at, 'round is required');
    if (r.amount != null && (!isNum(r.amount) || r.amount < 0)) bad(at, 'amount must be a number >= 0 or null');
    if (r.amount != null && !/^[A-Z]{3}$/.test(r.currency || '')) bad(at, 'an amount needs a 3-letter currency');
    if (r.announced_on != null && !PARTIAL_DATE_RE.test(r.announced_on)) bad(at, 'announced_on must be YYYY, YYYY-MM or YYYY-MM-DD');
    for (const id of r.investor_ids) if (!investors.has(id)) bad(at, `unknown investor id "${id}"`);
    for (const id of r.lead_investor_ids) if (!r.investor_ids.includes(id)) bad(at, `lead investor "${id}" is not in investor_ids`);
    for (const id of r.source_ids) if (!sources.has(id)) bad(at, `unknown source id "${id}"`);
  }

  for (const j of ds.jobs) {
    const at = `job "${j.id}"`;
    if (!companyIds.has(j.company_id)) bad(at, `unknown company_id "${j.company_id}"`);
    if (!isStr(j.title)) bad(at, 'title is required');
    if (!JOB_STATUSES.includes(j.status)) bad(at, `invalid status "${j.status}"`);
    if (j.apply_url != null && !URL_RE.test(j.apply_url)) bad(at, 'apply_url must be http(s) or null');
    if (j.source_id != null && !sources.has(j.source_id)) bad(at, `unknown source id "${j.source_id}"`);
  }

  for (const n of ds.news) {
    const at = `news "${n.id}"`;
    if (!isStr(n.headline)) bad(at, 'headline is required');
    if (!URL_RE.test(n.url || '')) bad(at, 'url must be http(s)');
    for (const id of n.company_ids) if (!companyIds.has(id)) bad(at, `unknown company id "${id}"`);
    if (n.source_id != null && !sources.has(n.source_id)) bad(at, `unknown source id "${n.source_id}"`);
  }

  return errors;
}

// ---------- read path ----------

// One company with everything it points at resolved. The read path an API,
// profile page or recommender would use; nothing is inferred - an unlinked
// relationship is simply an empty list.
export function getCompanyWithRelations(ds, idOrSlug) {
  const company = ds.companies.find((c) => c.id === idOrSlug || c.slug === idOrSlug);
  if (!company) return null;
  const pick = (rows, ids) => ids.map((id) => rows.find((r) => r.id === id)).filter(Boolean);
  return {
    ...toCanonical(company),
    founders: pick(ds.people, company.founder_ids),
    investors: pick(ds.investors, company.investor_ids),
    funding_rounds: ds.funding_rounds.filter((r) => r.company_id === company.id),
    jobs: ds.jobs.filter((j) => j.company_id === company.id),
    news: ds.news.filter((n) => n.company_ids.includes(company.id)),
    sources: pick(ds.sources, company.source_ids),
  };
}
