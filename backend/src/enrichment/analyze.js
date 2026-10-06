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
import { statusSignals, claimsOf } from './status.js';

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
  // lenient: the website is one a person chose for this company, so a shared distinctive word is enough.
  const base = analyzeSite(site, { candidateNames: names, now, lenient: true });
  const out = { ...base, jobs: [] };
  // What the homepage says about the company's own status (status.js). Worked out before the early returns below,
  // because a site that has moved, or is now someone else's, is exactly what it is there to notice. A site that is
  // someone else's says nothing about this company, so only the watches survive there, never a claim.
  const homePage = base.pageFacts?.[0] ?? null;
  const signals = statusSignals(site, { facts: homePage?.facts ?? null, names });
  if (base.mismatch) {
    const called = (base.facts?.names ?? []).slice(0, 2).join(' / ');
    out.status = { signals: [...signals.filter((s) => !s.claim && s.code !== 'renamed_notice'), { code: 'site_mismatch', detail: `the website calls itself ${called || 'something else'}`, claim: null, value: null, other: null }] };
  } else {
    out.status = { signals };
  }
  if (base.mismatch || base.blocked || site.pages.length === 0) return out;

  const retrieved = site.retrieved_at ?? new Date(now()).toISOString();
  const rows = base.evidence.map((r) => (r.field === 'website' && website && canonicalDomain(website)?.domain === site.domain.domain ? { ...r, value: website } : r));
  const add = (field, value, confidence, note, page, f) => rows.push({ field, value, confidence, verified_at: retrieved, note, source: sourceOf(page, f, site.domain, retrieved) });
  for (const claim of claimsOf(signals)) add(claim.field, claim.value, 'medium', claim.note, homePage.page, homePage.facts);

  let firstPostingPage = null;
  for (const { page, facts: f } of base.pageFacts) {
    for (const p of jobPostingsIn(f.nodes, page.finalUrl, names)) {
      out.jobs.push({ ...p, source: sourceOf(page, f, site.domain, retrieved, 'Job posting on the company site.') });
      firstPostingPage ??= { page, f };
    }
    for (const { name, fragment } of f.textFounders) add('founders', name, 'medium', `The page says: "${fragment}".`, page, f);
    for (const { name, sentence } of investorsIn(f.text, knownInvestors)) add('investors', name, 'medium', `The page says: "${sentence}".`, page, f);
  }
  const fromPages = out.jobs.length;
  // The job boards the company's own careers page points at (boards.js): a different source for the same claim.
  const boardSources = [];
  for (const b of site.boards ?? []) {
    const source = {
      kind: 'company_website', url: b.page_url, title: `${b.name} job board`, publisher: site.domain.host, retrieved_at: b.retrieved_at, slug: `${b.provider}-jobs`,
      note: `The company's ${b.name} job board, which its careers page links to, read through the board's public feed.`,
    };
    for (const j of b.jobs) out.jobs.push({ ...j, apply_url: j.apply_url ?? b.page_url, source });
    if (b.jobs.length) boardSources.push({ source, board: b });
  }
  out.jobs = out.jobs.slice(0, MAX_JOBS);
  out.pages = [...out.pages, ...(site.boards ?? []).map((b) => ({ url: b.page_url, status: 200 }))];
  out.errors = [...out.errors, ...(site.board_errors ?? [])];
  const when = (n) => `${n} open role${n === 1 ? '' : 's'}`;
  if (fromPages) {
    const { page, f } = firstPostingPage;
    add('hiring_status', 'hiring', 'high', `${when(fromPages)} in the page's structured data, such as "${out.jobs[0].title}".`, page, f);
  }
  for (const { source, board } of boardSources) {
    rows.push({ field: 'hiring_status', value: 'hiring', confidence: 'high', verified_at: retrieved, source, note: `${when(board.jobs.length)} on the company's ${board.name} job board, which its careers page links to, such as "${board.jobs[0].title}".` });
  }
  // A job board the careers page points at, read without trouble, that lists nothing, with no role found anywhere
  // else this time: a positive observation that the board is empty today, which is how a company that has stopped
  // hiring shows up. Medium, because it says nothing about a role advertised somewhere we did not look. It never
  // changes the record: against a record that says "hiring" it is a conflict for a person to settle.
  if (out.jobs.length === 0) {
    for (const b of site.boards ?? []) {
      const source = {
        kind: 'company_website', url: b.page_url, title: `${b.name} job board`, publisher: site.domain.host, retrieved_at: b.retrieved_at, slug: `${b.provider}-jobs`,
        note: `The company's ${b.name} job board, which its careers page links to, read through the board's public feed.`,
      };
      rows.push({ field: 'hiring_status', value: 'not_hiring', confidence: 'medium', verified_at: retrieved, source, note: `The company's ${b.name} job board, which its careers page links to, listed no open roles when it was read.` });
    }
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
