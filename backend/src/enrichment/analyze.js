// What a company's own website says about it, as evidence. Pure: pages in, claims out. It builds on the
// site reader the discovery engine already has (address, state, founded year, description, structured
// founders, names) and adds what only matters for a company already in the directory:
//
//   hiring_status   'hiring', and the individual postings, from schema.org JobPosting structured data only
//   founders        names in a "founded by ..." sentence (structured founders are already read)
//   investors       investors we already know by name, in a sentence that says they back the company
//
// Every claim is a row { field, value, confidence, verified_at, note, source } like a candidate's, so the
// same evidence model holds both. verified_at is when the page was read: the claim was checked against a
// page that was retrieved on that date. Confidence says how sure the reading is (structured data high,
// a sentence medium).
import { analyzeSite, sourceOf, jobPostingsIn } from '../discovery/enrich.js';
import { nameKey, parseNameVariants, canonicalDomain } from '../models/identity.js';

const MAX_JOBS = 30;
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const unique = (list) => [...new Set(list)];

// Words that say a company is backed. A name only counts if one follows within a short window: page text
// often runs together without punctuation, so a "sentence" can be the whole page.
const BACKING = /\b(?:backed by|funded by|investors?(?:\s+(?:include|are|including))?|investment from|invested in by|raised\b[^.]{0,60}\bfrom|supported by|participated in|portfolio of)\b/gi;
const WINDOW = 200;

// Which of the known investors the text names as backing the company, each with the words it was read from.
export function investorsIn(text, known) {
  const names = unique(known).filter((n) => typeof n === 'string' && n.length >= 4).sort((a, b) => b.length - a.length);
  const hits = new Map();
  for (const m of text.matchAll(BACKING)) {
    let window = text.slice(m.index, m.index + WINDOW);
    for (const name of names) {
      const re = new RegExp(`(?<![A-Za-z0-9])${escape(name)}(?![A-Za-z0-9])`);
      const found = re.exec(window);
      if (!found) continue;
      if (!hits.has(name)) {
        // The words that say it, up to the end of that sentence: page text runs on into menus.
        const end = found.index + name.length;
        const tail = window.slice(end, end + 60).split(/[.!?]|\p{Extended_Pictographic}/u)[0];
        hits.set(name, (window.slice(0, end) + tail).replace(/\s+/g, ' ').trim());
      }
      window = window.replace(re, ' '); // a shorter name inside a longer one ("Latitude" in "Latitude 37") is not a second hit
    }
  }
  return [...hits].map(([name, sentence]) => ({ name, sentence }));
}

// The strongest reading of each distinct (field, value).
function strongest(rows) {
  const seen = new Map();
  for (const r of rows) {
    const key = `${r.field}|${JSON.stringify(r.value)}`;
    const prior = seen.get(key);
    if (!prior || (r.confidence === 'high' && prior.confidence !== 'high')) seen.set(key, r);
  }
  return [...seen.values()];
}

// site: from readSite. names: every name the company is known by (the identity check). knownInvestors: the
// investors in the directory and the accelerators we recognise. website: the URL the record holds, which is
// what the site confirms when it is the same site (a stored "https://acme.com/au" is not contradicted by
// the homepage at https://acme.com).
export function analyzeCompanySite(site, { names, knownInvestors = [], website = null, now = Date.now }) {
  const base = analyzeSite(site, { candidateNames: names, now });
  const out = { ...base, jobs: [] };
  if (base.mismatch || base.blocked || site.pages.length === 0) return out;

  const retrieved = site.retrieved_at ?? new Date(now()).toISOString();
  const rows = base.evidence.map((r) => (r.field === 'website' && website && canonicalDomain(website)?.domain === site.domain.domain ? { ...r, value: website } : r));
  const add = (field, value, confidence, note, page, f) => rows.push({ field, value, confidence, verified_at: retrieved, note, source: sourceOf(page, f, site.domain, retrieved) });

  let firstPostingPage = null;
  for (const { page, facts: f } of base.pageFacts) {
    for (const p of jobPostingsIn(f.nodes, page.finalUrl, names)) {
      out.jobs.push({ ...p, source: sourceOf(page, f, site.domain, retrieved, 'Job posting on the company site.') });
      firstPostingPage ??= { page, f };
    }
    for (const { name, fragment } of f.textFounders) add('founders', name, 'medium', `The page says: "${fragment}".`, page, f);
    for (const { name, sentence } of investorsIn(f.text, knownInvestors)) add('investors', name, 'medium', `The page says: "${sentence}".`, page, f);
  }
  out.jobs = out.jobs.slice(0, MAX_JOBS);
  if (out.jobs.length) {
    const { page, f } = firstPostingPage;
    add('hiring_status', 'hiring', 'high', `${out.jobs.length} open role${out.jobs.length === 1 ? '' : 's'} in the page's structured data, such as "${out.jobs[0].title}".`, page, f);
  }

  // A claim read from a page we retrieved is checked against it on the day it was read, unless it is a
  // guess (low), which nothing here produces.
  out.evidence = strongest(rows.map((r) => ({ ...r, verified_at: r.confidence === 'low' ? null : retrieved })));
  return out;
}

// Every name a company is known by, for the identity check: its name and the variants in it, its aliases,
// former names and legal names.
export function namesOf(company, identifiers = []) {
  const { primary, aliases, formerNames } = parseNameVariants(company.name);
  const mine = identifiers.filter((i) => i.company_id === company.id && ['alias', 'former_name', 'legal_name'].includes(i.scheme)).map((i) => i.value);
  return unique([primary, ...aliases, ...formerNames, ...mine]).filter((n) => nameKey(n));
}
