// Enrichment: read a candidate's own website and record what it says about the
// company, as evidence with its source. The company's website is a primary source
// for facts about the company, so what it states in structured data (JSON-LD) is
// high confidence, and what is lifted out of running text by pattern is medium,
// because a pattern can be wrong. The website is only read through the compliant
// fetcher: robots.txt, pacing, no access-controlled pages, a handful of pages
// found by following links from the homepage, never guessed URLs.
//
// If the site does not look like the candidate's (the page names a different
// company) it contributes nothing but a warning: a wrong website is a more likely
// explanation than a company that has two names.
import { AU_STATES } from '../models/company.js';
import {
  canonicalDomain, registrableDomain, nameKey, looseNameKey, similarity, normalizeABN, normalizeACN,
} from '../models/identity.js';
import { FetchPolicyError } from './http.js';
import { stripTags, metaContent, titleOf, jsonLd, typesOf, links } from './html.js';

const STATE_RE = AU_STATES.join('|');
const STREET = 'Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Place|Pl|Parade|Pde|Drive|Dr|Court|Ct|Boulevard|Blvd|Highway|Hwy|Terrace|Tce|Crescent|Cres|Square|Sq|Way|Close|Circuit|Esplanade';
// 1 street, 2 suburb or city (optional), 3 state, 4 postcode
const ADDRESS_RE = new RegExp(`\\b(\\d{1,5}[A-Za-z]?(?:\\s?[-–/]\\s?\\d{1,5})?\\s+[A-Z][A-Za-z'’.-]*(?:\\s+[A-Za-z'’.-]+){0,3}?\\s+(?:${STREET})\\b)\\.?,?(\\s+[A-Za-z'’ .-]{2,40}?)?,?\\s+(${STATE_RE})\\s+(\\d{4})\\b`, 'g');
const LEGAL_FORM_RE = /((?:[\w&'’.-]+\s+){0,6}?[\w&'’.-]+)\s+(?:Pty\.?\s+Ltd\.?|Pty\.?\s+Limited|Proprietary\s+Limited)(?![A-Za-z])/g;
// +61 2 9999 1234, (02) 9999 1234, 02 9999 1234, 0412 345 678, +61 412 345 678
const AU_PHONE = /\+61[\s-]?[2-378][\s-]?\d{4}[\s-]?\d{4}|\(0[2-378]\)[\s-]?\d{4}[\s-]?\d{4}|\b0[2-378][\s-]?\d{4}[\s-]?\d{4}\b|\+61[\s-]?4\d{2}[\s-]?\d{3}[\s-]?\d{3}|\b04\d{2}[\s-]?\d{3}[\s-]?\d{3}\b/g;
const NAME_START = /^(?:[A-Z]|\d+[A-Za-z])/;
const CONNECTOR = /^(?:of|and|the|for|&)$/;

// "Acme Robotics Pty Ltd" from running text: the run of capitalised words just
// before the legal form, stopping at a lowercase word or the end of a sentence.
// "... 1234. Acme Robotics Pty Ltd" gives "Acme Robotics", and "Fastlane is operated
// by Possibility Studios Pty Ltd" gives "Possibility Studios".
export function legalNamesIn(text) {
  const out = [];
  for (const m of text.matchAll(LEGAL_FORM_RE)) {
    const tokens = m[1].split(/\s+/);
    const run = [];
    for (let i = tokens.length - 1; i >= 0; i -= 1) {
      const t = tokens[i];
      if (i < tokens.length - 1 && /[.,;:!?)]$/.test(t)) break;
      if (NAME_START.test(t) || CONNECTOR.test(t)) run.unshift(t); else break;
    }
    while (run.length && CONNECTOR.test(run[0])) run.shift();
    if (run.length) out.push(`${run.join(' ')} Pty Ltd`);
  }
  return out;
}
const PAGE_PRIORITY = [/privacy/i, /terms|legal/i, /contact/i, /about|company|team/i];

const unique = (list) => [...new Set(list)];
const first = (...vals) => vals.find((v) => typeof v === 'string' && v.trim()) ?? null;

function jsonLdFacts(nodes) {
  const orgs = nodes.filter((n) => typesOf(n).some((t) => /^(?:Organization|Corporation|LocalBusiness|NGO|SoftwareApplication|Brand)$/i.test(t)));
  const names = [];
  const legalNames = [];
  let description = null;
  let foundingYear = null;
  const founders = [];
  let address = null;
  for (const org of orgs) {
    if (typeof org.name === 'string') names.push(org.name);
    for (const alt of [].concat(org.alternateName ?? [])) if (typeof alt === 'string') names.push(alt);
    if (typeof org.legalName === 'string') legalNames.push(org.legalName);
    description ??= first(org.description);
    const year = /\b(19|20)\d{2}\b/.exec(String(org.foundingDate ?? ''));
    foundingYear ??= year ? Number(year[0]) : null;
    for (const f of [].concat(org.founder ?? org.founders ?? [])) {
      const n = typeof f === 'string' ? f : f?.name;
      if (typeof n === 'string' && n.trim().split(/\s+/).length >= 2) founders.push(n.trim());
    }
    const a = [].concat(org.address ?? []).find((x) => x && typeof x === 'object');
    if (a && !address) {
      address = {
        street: first(a.streetAddress), locality: first(a.addressLocality), region: first(a.addressRegion),
        postcode: first(String(a.postalCode ?? '')), country: first(typeof a.addressCountry === 'string' ? a.addressCountry : a.addressCountry?.name),
      };
    }
  }
  return { names, legalNames, description, foundingYear, founders: unique(founders), address };
}

// Everything a page says that we use. Pure: text in, facts out. home: whether this is
// the homepage, whose title leads with the company; an inner page's title leads with
// its topic ("Privacy | Acme"), so it is not read as a name.
export function extractFacts(html, { home = true } = {}) {
  // Visible text is the body: the title is not part of the sentence that follows it.
  const body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? String(html ?? '').replace(/<head\b[\s\S]*?<\/head>/i, ' ');
  const text = stripTags(body);
  const ld = jsonLdFacts(jsonLd(html));
  const title = titleOf(html);
  const siteName = metaContent(html, 'og:site_name');
  const description = first(ld.description, metaContent(html, 'description'), metaContent(html, 'og:description'));

  const abns = unique([...text.matchAll(/\bABN[\s:.-]*((?:\d\s?){11})(?!\d)/gi)].map((m) => normalizeABN(m[1])).filter(Boolean));
  const acns = unique([...text.matchAll(/\bACN[\s:.-]*((?:\d\s?){9})(?!\d)/gi)].map((m) => normalizeACN(m[1])).filter(Boolean));
  const legalNames = unique([...ld.legalNames, ...legalNamesIn(text)].map((s) => s.replace(/\s+/g, ' ').trim()).filter((s) => s.length <= 80));

  const addresses = [];
  if (ld.address && /^(?:au|aus|australia)$/i.test(ld.address.country ?? 'AU') && AU_STATES.includes(ld.address.region ?? '') && /^\d{4}$/.test(ld.address.postcode ?? '')) {
    const parts = [ld.address.street, ld.address.locality].filter(Boolean).join(', ');
    addresses.push({ text: `${parts} ${ld.address.region} ${ld.address.postcode}`.trim(), city: ld.address.locality, state: ld.address.region, source: 'structured' });
  }
  for (const m of text.matchAll(ADDRESS_RE)) {
    const city = (m[2] ?? '').replace(/[,\s]+$/, '').replace(/\s+/g, ' ').trim() || null;
    addresses.push({ text: `${m[1].replace(/\s+/g, ' ')}${city ? `, ${city}` : ''} ${m[3]} ${m[4]}`, city, state: m[3], source: 'text' });
  }

  const textYear = /\b(?:founded|established|since|est\.?)\s+(?:in\s+)?((?:19|20)\d{2})\b/i.exec(text);
  const names = unique([...ld.names, siteName, home && title ? title.split(/\s[|–—·-]\s/)[0] : null].filter((n) => typeof n === 'string' && n.trim()).map((n) => n.trim()));
  return {
    title, siteName, description, names, legalNames, abns, acns, addresses,
    phones: (text.match(AU_PHONE) ?? []).length,
    foundedYear: ld.foundingYear ?? (textYear ? Number(textYear[1]) : null), foundedFrom: ld.foundingYear ? 'structured' : 'text',
    founders: ld.founders,
  };
}

// Does the page appear to be about this company? Any of the names the page gives
// itself being the candidate's name, a variant of it, or close to it. A legal name
// counts for a match but not against one (a company's legal name differs from its
// brand). The domain's own word is only used when the page names itself nothing,
// so a matching domain cannot outvote a page that says it is someone else.
export function pageMatchesName(candidateNames, facts, domain) {
  const candidates = candidateNames.map((n) => ({ key: nameKey(n), loose: looseNameKey(n) })).filter((c) => c.key);
  const pageNames = [...facts.names, ...facts.legalNames];
  if (facts.names.length === 0 && domain) pageNames.push(registrableDomain(domain).split('.')[0]);
  for (const page of pageNames) {
    const pk = nameKey(page);
    const pl = looseNameKey(page);
    for (const c of candidates) {
      if (!pk) continue;
      if (pk === c.key || pl === c.loose) return true;
      const [short, long] = pk.length <= c.key.length ? [pk, c.key] : [c.key, pk];
      if (short.length >= 4 && long.startsWith(short)) return true;
      if (short.length >= 5 && similarity(pk, c.key) >= 0.8) return true;
    }
  }
  return false;
}

function pickPages(html, baseUrl, limit) {
  const base = canonicalDomain(baseUrl);
  const found = links(html, baseUrl).filter((l) => {
    const d = canonicalDomain(l.href);
    return d && !d.nonCompany && base && d.domain === base.domain && !/\.(?:pdf|png|jpe?g|gif|svg|zip|docx?)$/i.test(l.href);
  });
  const chosen = [];
  for (const pattern of PAGE_PRIORITY) {
    const hit = found.find((l) => (pattern.test(new URL(l.href).pathname) || pattern.test(l.text)) && !chosen.includes(l.href));
    if (hit) chosen.push(hit.href);
    if (chosen.length >= limit) break;
  }
  return chosen;
}

const isDocument = (url) => /privacy|terms|legal/i.test(new URL(url).pathname);

// Reads up to maxPages of the candidate's site. Never throws for a refusal: it
// records it in `errors` and returns what it could read.
export async function enrichFromWebsite(website, { fetcher, now, candidateNames = [], maxPages = 3 }) {
  const result = { pages: [], evidence: [], facts: null, aliases: [], legalNames: [], external_ids: { abn: null, acn: null }, signals: { phones: 0 }, warnings: [], errors: [] };
  const domain = canonicalDomain(website);
  if (!domain || domain.nonCompany) { result.errors.push({ url: website, code: 'bad_url', message: 'not a company website' }); return result; }

  const read = async (url) => {
    try {
      const res = await fetcher.get(url);
      result.pages.push({ url: res.finalUrl, status: res.status });
      return res;
    } catch (err) {
      if (!(err instanceof FetchPolicyError)) throw err;
      result.errors.push({ url, code: err.code, message: err.message });
      return null;
    }
  };

  const home = await read(`https://${domain.host}/`);
  if (!home) return result;
  const pages = [{ res: home, html: home.text }];
  for (const url of pickPages(home.text, home.finalUrl, maxPages - 1)) {
    const res = await read(url);
    if (res) pages.push({ res, html: res.text });
  }

  const facts = pages.map(({ res, html }, i) => ({ res, facts: extractFacts(html, { home: i === 0 }), html }));
  const combined = {
    names: unique(facts.flatMap((f) => f.facts.names)), legalNames: unique(facts.flatMap((f) => f.facts.legalNames)),
  };
  if (!pageMatchesName(candidateNames, combined, domain.domain)) {
    result.warnings.push(`the website at ${domain.host} does not appear to be ${candidateNames[0] ?? 'this company'}: it calls itself ${combined.names.slice(0, 2).join(' / ') || 'nothing we could read'}`);
    result.facts = { names: combined.names };
    return result;
  }

  const retrieved = new Date(now()).toISOString();
  const sourceFor = (res, f) => ({
    kind: isDocument(res.finalUrl) ? 'company_document' : 'company_website', url: res.finalUrl, title: f.title ?? res.finalUrl,
    publisher: f.legalNames[0] ?? f.siteName ?? domain.host, retrieved_at: retrieved, note: 'Read by the discovery engine.',
  });
  const add = (field, value, confidence, note, res, f) => result.evidence.push({
    field, value, confidence, verified_at: confidence === 'high' ? retrieved : null, note, source: sourceFor(res, f),
  });

  add('website', `https://${domain.host}`, 'high', 'The site itself.', home, facts[0].facts);
  for (const { res, facts: f } of facts) {
    if (f.description) add('description', f.description.slice(0, 400), 'medium', 'The page\'s own description.', res, f);
    const au = f.addresses[0];
    if (au) {
      const conf = au.source === 'structured' ? 'high' : 'medium';
      add('address', au.text, conf, 'Australian address on the page.', res, f);
      add('state', au.state, conf, 'From the address on the page.', res, f);
      if (au.city) add('city', au.city, conf, 'From the address on the page.', res, f);
    }
    if (f.foundedYear) add('founded_year', f.foundedYear, f.foundedFrom === 'structured' ? 'high' : 'medium', 'Stated on the page.', res, f);
    for (const founder of f.founders) add('founders', founder, 'medium', 'Named as a founder in the page\'s structured data.', res, f);
    result.signals.phones += f.phones;
  }

  // One piece of evidence per distinct value, from the strongest reading of it.
  const seen = new Map();
  for (const e of result.evidence) {
    const key = `${e.field}|${JSON.stringify(e.value)}`;
    const prior = seen.get(key);
    if (!prior || (e.confidence === 'high' && prior.confidence !== 'high')) seen.set(key, e);
  }
  result.evidence = [...seen.values()];

  result.legalNames = unique(facts.flatMap((f) => f.facts.legalNames));
  result.aliases = unique(facts.flatMap((f) => f.facts.names)).filter((n) => nameKey(n) && !candidateNames.some((c) => nameKey(c) === nameKey(n)));
  result.external_ids = { abn: facts.flatMap((f) => f.facts.abns)[0] ?? null, acn: facts.flatMap((f) => f.facts.acns)[0] ?? null };
  result.facts = { names: combined.names, addresses: facts.flatMap((f) => f.facts.addresses) };
  return result;
}
