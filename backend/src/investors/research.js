// How an investor's record is built from what its own pages say, without anyone typing a fact in from memory.
//
// A research file (scripts/investors/research.json) lists, for each investor, the pages that were read and the claims they
// support, each with the words the page uses (`quote`). Nothing is applied on trust: a claim is applied only if its quote is
// found, word for word (case, spacing and quotation marks aside), in the page as it was fetched. A claim whose page was not
// read, or whose words are not on it, is refused and reported, and the record is left saying less, never something else.
//
// The pages are read through discovery/http.js (robots.txt obeyed, paced, no LinkedIn) and kept in a cache folder that is not
// committed, so the quote check can be repeated without asking the site again.
import { stripTags, metaContent, titleOf, links } from '../discovery/html.js';
import { editInvestor, investorOf, mergeInvestors, approveInvestor } from '../models/investorActions.js';
import { migrateInvestorRecord } from '../models/investor.js';
import { checkProblems } from '../models/investorEvidence.js';
import { slugify, uniqueSlug } from '../models/company.js';

// ---------- reading a page ----------

// What a page holds that a reader would use: its title and description, its visible text, its links, and the labels a logo
// carries (an image's alt text, a link's aria-label), which is how a portfolio page often names a company.
export function pageFacts(html, url) {
  const labels = [];
  for (const m of String(html ?? '').matchAll(/\b(?:alt|aria-label)\s*=\s*"([^"]{2,80})"/gi)) labels.push(m[1].replace(/\s+/g, ' ').trim());
  return {
    url, title: titleOf(html), description: metaContent(html, 'description') ?? metaContent(html, 'og:description'),
    text: stripTags(html), links: links(html, url).slice(0, 800), labels: [...new Set(labels)].slice(0, 800),
  };
}

// The kinds of page worth reading after the home page, by what their address or link text says.
const KINDS = {
  about: /\b(?:about|who-we-are|our-story|story|philosophy|approach|mission|thesis|why)\b/i,
  portfolio: /\b(?:portfolio|companies|investments|startups|founders|ventures)\b/i,
  team: /\b(?:team|people|partners|leadership|meet)\b/i,
  contact: /\b(?:contact|get-in-touch|offices|locations)\b/i,
  apply: /\b(?:apply|pitch|submit|funding|work-with-us|founders)\b/i,
  jobs: /\b(?:jobs|careers|talent)\b/i,
};
export const PAGE_KINDS = Object.keys(KINDS);

// Same-site pages of each kind that the home page links to, best first, at most `perKind` of each.
export function suggestPages(facts, { perKind = 1 } = {}) {
  let host;
  try { host = new URL(facts.url).hostname.replace(/^www\./, ''); } catch { return []; }
  const seen = new Set([facts.url]);
  const out = [];
  for (const [kind, pattern] of Object.entries(KINDS)) {
    let taken = 0;
    for (const link of facts.links) {
      let u;
      try { u = new URL(link.href); } catch { continue; }
      if (u.hostname.replace(/^www\./, '') !== host || seen.has(link.href)) continue;
      if (/\.(?:pdf|jpg|png|gif|svg|zip|xml)$/i.test(u.pathname)) continue;
      if (!pattern.test(`${u.pathname} ${link.text}`)) continue;
      seen.add(link.href);
      out.push({ kind, url: link.href, text: link.text });
      taken += 1;
      if (taken >= perKind) break;
    }
  }
  return out;
}

// ---------- the quote check ----------

// Text compared as a reader would: unicode folded, invisible characters dropped, curly quotes and long dashes made plain.
export const squash = (s) => String(s ?? '').normalize('NFKC')
  .replace(/[\u200b-\u200d\ufeff]/g, '')
  .replace(/[\u2018\u2019\u201b]/g, "'")
  .replace(/[\u201c\u201d\u201e]/g, '"')
  .replace(/[\u2013\u2014\u2212]/g, '-')
  .replace(/\s+/g, ' ').trim().toLowerCase();

// Are these words on the page? A quote with an ellipsis is its parts, in order. Too short a quote proves nothing.
export function quoteFound(pageText, quote) {
  const q = squash(quote);
  if (q.length < 6) return false;
  const hay = squash(pageText);
  let at = 0;
  for (const part of q.split(/\s*(?:…|\.\.\.)\s*/).filter(Boolean)) {
    const i = hay.indexOf(part, at);
    if (i < 0) return false;
    at = i + part.length;
  }
  return true;
}

// ---------- applying a research entry ----------

// The order claims are applied in, so a record is valid after each one (a state needs its country first).
const ORDER = ['name', 'website', 'inclusion_basis', 'investor_type', 'country', 'headquarters_city', 'state', 'other_offices', 'stages', 'sectors', 'geographies',
  'typical_cheque', 'lead_or_follow', 'active_status', 'application_url', 'jobs_url', 'description', 'investment_thesis'];
const MULTI = new Set(['other_offices', 'stages', 'sectors', 'geographies']);

// One investor's entry from the research file, applied to a working copy. `pages` maps a page key to { url, text, kind? }.
// Returns what was done: { id, applied, refused: [{ field, value, why }], created, merged, approved }.
export function applyResearchEntry(work, entry, pages, { at, by, approve = true }) {
  const report = { id: entry.id, applied: 0, refused: [], created: false, merged: [], approved: false };

  for (const gone of entry.merge ?? []) {
    if ((work.investors ?? []).some((o) => o.id === gone) && gone !== entry.id) {
      if (!(work.investors ?? []).some((o) => o.id === entry.id)) throw new Error(`cannot merge "${gone}" into "${entry.id}": that investor does not exist`);
      mergeInvestors(work, gone, entry.id, { at });
      report.merged.push(gone);
    }
  }
  if (!(work.investors ?? []).some((o) => o.id === entry.id)) {
    const slugs = new Set(work.investors.map((o) => o.slug));
    work.investors.push(migrateInvestorRecord({ id: entry.id, name: entry.name ?? entry.id, slug: uniqueSlug(slugify(entry.id), slugs), aliases: [], created_at: at, updated_at: at }));
    report.created = true;
  }

  const ranked = [...entry.claims ?? []].sort((a, b) => ORDER.indexOf(a.field) - ORDER.indexOf(b.field));
  for (const claim of ranked) {
    const page = pages[claim.page];
    if (!page?.text) { report.refused.push({ field: claim.field, value: claim.value, why: `the page "${claim.page}" was not read` }); continue; }
    if (!quoteFound(page.text, claim.quote)) { report.refused.push({ field: claim.field, value: claim.value, why: `the words are not on ${page.url}: ${JSON.stringify(claim.quote)}` }); continue; }
    const org = investorOf(work, entry.id);
    let patch;
    if (claim.field === 'typical_cheque') patch = { typical_cheque_min: claim.value.min ?? null, typical_cheque_max: claim.value.max ?? null, cheque_currency: claim.value.currency };
    else if (MULTI.has(claim.field)) patch = { [claim.field]: [...new Set([...org[claim.field], claim.value])] };
    else patch = { [claim.field]: claim.value };
    try {
      editInvestor(work, entry.id, patch, { at, by, source: { url: page.url, kind: page.kind ?? 'investor_website', title: page.title ?? null, quote: claim.quote } });
      report.applied += 1;
    } catch (err) {
      report.refused.push({ field: claim.field, value: claim.value, why: err.message });
    }
  }

  const org = investorOf(work, entry.id);
  if (approve && ['candidate', 'needs_review'].includes(org.verification_status) && entry.review !== true && checkProblems(work, org).length === 0) {
    approveInvestor(work, entry.id, { at });
    report.approved = true;
  }
  return report;
}

// A company's name as a portfolio page shows it, and the company records it could be. Exact, not fuzzy: a link between
// an investor and a company is a public claim, so a near miss is not a match.
export const nameKey = (s) => squash(s).replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

// Which companies in the directory does a portfolio page name? A company counts when its own website appears among the page's
// outbound links (the page links to it), or its name is a whole link text, image label or heading on the page. Returns
// [{ company, how, quote }]. The page's own site and social links never match.
export function matchPortfolio(facts, companies, { ownHost = null } = {}) {
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return null; } };
  const own = ownHost ?? hostOf(facts.url);
  const linked = new Map();
  for (const l of facts.links) { const h = hostOf(l.href); if (h && h !== own && !linked.has(h)) linked.set(h, l); }
  const words = new Map();
  for (const t of [...facts.links.map((l) => l.text), ...(facts.labels ?? [])]) { const k = nameKey(t); if (k) words.set(k, t); }
  const out = [];
  for (const c of companies) {
    const host = hostOf(c.website);
    if (host && linked.has(host)) { out.push({ company: c, how: 'link', quote: linked.get(host).text || c.name, page_host: host }); continue; }
    const k = nameKey(c.name);
    if (k.length >= 4 && words.has(k)) out.push({ company: c, how: 'name', quote: words.get(k) });
  }
  return out;
}
