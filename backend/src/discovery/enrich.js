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
import { AU_STATES, KNOWN_CITIES } from '../models/company.js';
import {
  canonicalDomain, registrableDomain, nameKey, looseNameKey, nameTokens, similarity, normalizeABN, normalizeACN, personKey,
} from '../models/identity.js';
import { FetchPolicyError } from './http.js';
import { stripTags, metaContent, titleOf, jsonLd, typesOf, links } from './html.js';

const STATE_RE = AU_STATES.join('|');
const STREET = 'Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Place|Pl|Parade|Pde|Drive|Dr|Court|Ct|Boulevard|Blvd|Highway|Hwy|Terrace|Tce|Crescent|Cres|Square|Sq|Way|Close|Circuit|Esplanade';
// 1 street, 2 suburb or city (optional), 3 state, 4 postcode. A unit may be dotted
// ("Suite 1.103/477 Pitt St"): it is kept whole, never cut to a number the page did not give.
const ADDRESS_RE = new RegExp(`\\b(\\d{1,5}[A-Za-z]?(?:\\.\\d{1,4})?(?:\\s?[-–/]\\s?\\d{1,5})?\\s+[A-Z][A-Za-z'’.-]*(?:\\s+[A-Za-z'’.-]+){0,3}?\\s+(?:${STREET})\\b)\\.?,?(\\s+[A-Za-z'’ .-]{2,40}?)?,?\\s+(${STATE_RE})\\s+(\\d{4})\\b`, 'g');
const LEGAL_FORM_RE = /((?:[\w&'’.-]+\s+){0,6}?[\w&'’.-]+)\s+(Pty\.?\s+Ltd\.?|Pty\.?\s+Limited|Proprietary\s+Limited)(?![A-Za-z])/g;
// Words that label a contact block rather than start a company name: in running text a
// person and a role often sit right before the entity ("Mitch Deam Privacy Officer
// Trendspek Operations Pty Ltd"), and the name starts after them.
const LABEL_WORDS = new Set(['privacy', 'officer', 'contact', 'director', 'manager', 'email', 'phone', 'fax', 'attention', 'address', 'terms', 'policy', 'copyright', 'rights', 'reserved', 'registered', 'trading', 'operated', 'owned', 'welcome', 'about']);
// +61 2 9999 1234, (02) 9999 1234, 02 9999 1234, 0412 345 678, +61 412 345 678
const AU_PHONE = /\+61[\s-]?[2-378][\s-]?\d{4}[\s-]?\d{4}|\(0[2-378]\)[\s-]?\d{4}[\s-]?\d{4}|\b0[2-378][\s-]?\d{4}[\s-]?\d{4}\b|\+61[\s-]?4\d{2}[\s-]?\d{3}[\s-]?\d{3}|\b04\d{2}[\s-]?\d{3}[\s-]?\d{3}\b/g;
const NAME_START = /^(?:[A-Z]|\d+[A-Za-z])/;
const CONNECTOR = /^(?:of|and|the|for|&)$/;

// "Acme Robotics Pty Ltd" from running text: the run of capitalised words just
// before the legal form, stopping at a lowercase word, a label word, or the end of a
// sentence. "... 1234. Acme Robotics Pty Ltd" gives "Acme Robotics"; "Fastlane is
// operated by Possibility Studios Pty Ltd" gives "Possibility Studios"; "Mitch Deam
// Privacy Officer Trendspek Operations Pty Ltd" gives "Trendspek Operations". The
// legal form keeps the wording the company uses ("Pty Limited" stays "Pty Limited").
export function legalNamesIn(text) {
  const out = [];
  for (const m of text.matchAll(LEGAL_FORM_RE)) {
    const tokens = m[1].split(/\s+/);
    const run = [];
    for (let i = tokens.length - 1; i >= 0; i -= 1) {
      const t = tokens[i];
      if (i < tokens.length - 1 && /[.,;:!?)]$/.test(t)) break;
      if (LABEL_WORDS.has(t.toLowerCase())) break;
      if (NAME_START.test(t) || CONNECTOR.test(t)) run.unshift(t); else break;
    }
    while (run.length && CONNECTOR.test(run[0])) run.shift();
    const form = m[2].replace(/\s+/g, ' ').replace(/\.$/, '').replace(/^Pty\.\s*/, 'Pty ').replace(/\bLtd\.$/, 'Ltd');
    if (run.length) out.push(`${run.join(' ')} ${form}`);
  }
  return out;
}

// A homepage title is a name only if it looks like one. "Trendspek | Home" names the
// company; "Quality, online, social learning for Health Professionals" is a tagline.
// Page titles that are a kind of page, not a name: "Home", "Welcome", "Sign in".
const GENERIC_TITLE = /^(?:home|homepage|welcome|index|untitled|official (?:web)?site|main page|log ?in|sign ?in|dashboard)\b/i;
export const looksLikeName = (s) => typeof s === 'string' && s.trim().split(/\s+/).length <= 4 && !/[,:;]/.test(s) && /^[A-Z0-9]/.test(s.trim()) && !GENERIC_TITLE.test(s.trim());

// "getatomi.com" is Atomi's and "heykit.com.au" is Kit's: a verb in front of the brand is a common way for a
// startup to name its domain, and "acmehq.com" for Acme. The brand may be the label as it is or without that.
const DOMAIN_VERB = /^(?:hey|get|try|use|go|my|join|meet|hello|with|the)(?=[a-z0-9]{3,})/;
export function brandsOfDomain(domain) {
  const label = registrableDomain(domain).split('.')[0];
  return unique([label, label.replace(DOMAIN_VERB, ''), label.replace(/hq$/, '')]).filter((s) => s.length >= 3);
}

// Words too common to say two names are the same company's.
const COMMON_WORDS = new Set(['group', 'holdings', 'labs', 'lab', 'technologies', 'technology', 'tech', 'software', 'systems', 'solutions', 'ventures', 'global', 'international',
  'australia', 'australian', 'aus', 'digital', 'studio', 'studios', 'capital', 'partners', 'services', 'company', 'the', 'and', 'data', 'cloud', 'online', 'health', 'finance']);
// Do two sets of names share a distinctive word ("Reach" in "Reach Alternative Investments" and "Reach Alts")?
function sharesDistinctiveWord(namesA, namesB) {
  const words = (names) => new Set(names.flatMap((n) => nameTokens(n)).filter((t) => t.length >= 4 && !COMMON_WORDS.has(t)));
  const b = words(namesB);
  return [...words(namesA)].some((t) => b.has(t));
}
// The pages worth reading, and the fields each one tends to answer. A task that wants an address reads the
// privacy policy, terms and contact page first; one that wants founders reads the about page. With no
// wish stated, the original order is kept and the careers page is not read.
const PAGES = [
  { re: /privacy/i, serves: ['address', 'city', 'state'] },
  { re: /terms|legal/i, serves: ['address', 'city', 'state'] },
  { re: /contact/i, serves: ['address', 'city', 'state'] },
  { re: /about|company|team|our-story/i, serves: ['founders', 'founded_year', 'investors', 'description'] },
  { re: /careers?|jobs|join-?us|work-?with-?us|vacanc|we.?re-?hiring/i, serves: ['hiring_status', 'jobs'] },
];

const unique = (list) => [...new Set(list)];

// What a page says when it is not showing its own content: a bot gate, an error, a parked domain. A site
// that serves this to an automated reader is declining to be read, so nothing is taken from it, and it is
// not worked around.
const NOT_ITS_OWN_PAGE = /\b(?:unsupported (?:client|browser)|enable javascript|javascript is (?:disabled|required)|access denied|attention required|just a moment|checking your browser|request blocked|you have been blocked|page not found|404 not found|403 forbidden|under construction|coming soon|domain (?:is )?for sale|this domain (?:is|may be))\b/i;
export const isGatePage = (s) => typeof s === 'string' && NOT_ITS_OWN_PAGE.test(s);

// ---------- people, and job postings, as a page states them ----------

// "founded by Jane Doe and John Roe": a sentence on the company's own page, so medium confidence at
// best. A name is two or three capitalised words; "Jane Doe, CEO" gives Jane Doe and drops "CEO".
const NAME_PART = "[A-Z](?:[a-z]+|['’][A-Z][a-z]+)(?:['’-][A-Z]?[a-z]+)*"; // Jane, Li, O'Neil, Smith-Jones
const PERSON = `(?:(?:Dr|Mr|Mrs|Ms|Miss|Prof|Professor|Sir|Dame)\\.?\\s+)?${NAME_PART}(?:\\s+${NAME_PART}){1,2}`;
// A title may follow a name ("Jane Doe, CEO, and John Roe"). The verb is matched in either case by hand,
// because the names must stay case-sensitive: "founded by two former engineers" names nobody.
const TITLE = '(?:,?\\s*(?:CEO|CTO|COO|CFO|CPO|[Cc]o-?[Ff]ounder|[Ff]ounder))?';
const SEPARATOR = '\\s*(?:,\\s*(?:and\\b|&)|,|\\band\\b|&)\\s*'; // ", " or " and " or ", and " or " & "
// Only founding verbs: "created by" says who made a page or a product ("created by Wix"), not who founded a company.
const FOUNDED_BY = new RegExp(`\\b(?:[Cc]o-?[Ff]ounded|[Ff]ounded|[Ss]tarted)\\s+by\\s+(${PERSON}${TITLE}(?:${SEPARATOR}${PERSON}${TITLE})*)`, 'g');
const NOT_A_PERSON = /\b(?:capital|ventures?|group|holdings|labs?|pty|ltd|limited|inc|university|institute|foundation|partners|studio|studios|sourcing)\b/i;
const HONORIFIC = /^(?:Dr|Mr|Mrs|Ms|Miss|Prof|Professor|Sir|Dame)\.?\s+/;
// A run of capital letters can run on into the next sentence ("Andrew Barnes One MRI is ..."): a third word that is
// plainly not a surname is dropped.
const NOT_A_SURNAME = new Set(['One', 'The', 'This', 'Our', 'We', 'They', 'He', 'She', 'It', 'In', 'At', 'On', 'Since', 'After', 'And', 'But', 'With', 'As', 'From', 'Who', 'Is', 'Was', 'To', 'For', 'Of', 'By', 'An', 'Today', 'Now', 'Co']);
const cleanPerson = (part) => {
  const tokens = part.trim().replace(HONORIFIC, '').split(/\s+/);
  while (tokens.length >= 3 && NOT_A_SURNAME.has(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join(' ');
};
// Each name comes with the words it was read from, so a person can check it at a glance.
export function foundersInText(text) {
  const found = new Map();
  for (const m of text.matchAll(FOUNDED_BY)) {
    for (const part of m[1].split(/\s*(?:,|\band\b|&)\s*/)) {
      const name = cleanPerson(part);
      if (name && personKey(name) && !NOT_A_PERSON.test(name) && !found.has(name)) found.set(name, m[0].slice(0, 160));
    }
  }
  return [...found].map(([name, fragment]) => ({ name, fragment }));
}

const asText = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const placeOf = (loc) => {
  const a = [].concat(loc ?? []).find((x) => x && typeof x === 'object')?.address;
  if (!a || typeof a !== 'object') return null;
  const parts = [asText(a.addressLocality), asText(a.addressRegion)].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
};

// schema.org JobPosting nodes, as job rows. Only structured data counts: a page that merely says "we're
// hiring" is not a posting. Needs a title; a posting for another organisation is left out.
export function jobPostingsIn(nodes, pageUrl, companyNames = []) {
  const out = [];
  for (const n of nodes.filter((x) => typesOf(x).some((t) => /^JobPosting$/i.test(t)))) {
    const title = asText(n.title);
    if (!title) continue;
    const org = asText(typeof n.hiringOrganization === 'string' ? n.hiringOrganization : n.hiringOrganization?.name);
    if (org && companyNames.length && !companyNames.some((c) => { const a = nameKey(c); const b = nameKey(org); return a && b && (a === b || a.startsWith(b) || b.startsWith(a) || similarity(a, b) >= 0.8); })) continue;
    const url = asText(n.url);
    out.push({
      title: title.slice(0, 120),
      location: placeOf(n.jobLocation) ?? (/telecommute/i.test(String(n.jobLocationType ?? '')) ? 'Remote' : null),
      employment_type: asText([].concat(n.employmentType ?? [])[0]),
      remote: /telecommute/i.test(String(n.jobLocationType ?? '')) ? true : null,
      posted_at: /^\d{4}-\d{2}-\d{2}/.test(String(n.datePosted ?? '')) ? String(n.datePosted).slice(0, 10) : null,
      apply_url: url && /^https?:\/\//i.test(url) ? url : pageUrl,
    });
  }
  return out;
}
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
  const nodes = jsonLd(html);
  const ld = jsonLdFacts(nodes);
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

  // "Since 2019" is not a founding date ("trusted by customers since 2019", "hiring since 2021"), so it is not read as one.
  const textYear = /\b(?:founded|established|est\.?)\s+(?:in\s+)?((?:19|20)\d{2})\b/i.exec(text);
  // names: what the page states about itself (structured data, og:site_name). titleName: the
  // head of a homepage title, which is only sometimes a name (see looksLikeName).
  const names = unique([...ld.names, siteName].filter((n) => typeof n === 'string' && n.trim()).map((n) => n.trim()));
  const titleName = home && title ? title.split(/\s[|–—·-]\s/)[0].trim() || null : null;
  return {
    title, siteName, description, names, titleName, legalNames, abns, acns, addresses,
    phones: (text.match(AU_PHONE) ?? []).length,
    foundedYear: ld.foundingYear ?? (textYear ? Number(textYear[1]) : null), foundedFrom: ld.foundingYear ? 'structured' : 'text',
    founders: ld.founders,
    // What a company's own page says in a sentence, not in structured data.
    textFounders: foundersInText(text),
    nodes, text,
  };
}

// Does the page appear to be about this company? Any of the names the page gives
// itself being the candidate's name, a variant of it, or close to it. A legal name
// counts for a match but not against one (a company's legal name differs from its
// brand). A tagline for a title is not a name and is ignored. The domain's own word is
// only used when the page names itself nothing, so a matching domain cannot outvote a
// page that says it is someone else.
export function pageMatchesName(candidateNames, facts, domain, { lenient = false } = {}) {
  const candidates = candidateNames.map((n) => ({ key: nameKey(n), loose: looseNameKey(n) })).filter((c) => c.key);
  const selfNames = [...facts.names, ...(looksLikeName(facts.titleName) ? [facts.titleName] : [])];
  const pageNames = [...selfNames, ...facts.legalNames];
  if (selfNames.length === 0 && domain) pageNames.push(...brandsOfDomain(domain));
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
  // For a company whose website a person already chose, a shared distinctive word is enough ("Reach Alts" on
  // reachalts.com.au is Reach Alternative Investments). A new candidate's website does not get that benefit.
  return lenient && sharesDistinctiveWord(candidateNames, [...selfNames, ...facts.legalNames]);
}

// The links on a homepage worth reading, up to limit, for the fields wanted. Same site only; never a file.
export function pickPages(html, baseUrl, limit, wanted = null) {
  const base = canonicalDomain(baseUrl);
  const found = links(html, baseUrl).filter((l) => {
    const d = canonicalDomain(l.href);
    return d && !d.nonCompany && base && d.domain === base.domain && !/\.(?:pdf|png|jpe?g|gif|svg|zip|docx?)$/i.test(l.href);
  });
  const serving = (p) => p.serves.filter((f) => wanted.includes(f)).length;
  const order = wanted ? [...PAGES].sort((a, b) => serving(b) - serving(a)) : PAGES.slice(0, 4);
  const chosen = [];
  for (const { re } of order) {
    const hit = found.find((l) => (re.test(new URL(l.href).pathname) || re.test(l.text)) && !chosen.includes(l.href));
    if (hit) chosen.push(hit.href);
    if (chosen.length >= limit) break;
  }
  return chosen;
}

const isDocument = (url) => /privacy|terms|legal/i.test(new URL(url).pathname);

// A page as the source of a claim, with when it was read.
export function sourceOf(page, f, domain, retrieved, note = 'Read by the discovery engine.') {
  return {
    kind: isDocument(page.finalUrl) ? 'company_document' : 'company_website', url: page.finalUrl, title: f.title ?? page.finalUrl,
    publisher: f.legalNames[0] ?? f.siteName ?? domain.host, retrieved_at: retrieved, note,
  };
}

// The network step: reads the homepage and up to maxPages - 1 pages it links to, through the compliant
// fetcher. Never throws for a refusal: it records it in `errors` and returns what it could read. `wanted`
// (fields a task asks for) chooses which linked pages are worth reading. This is the only part that waits
// on the network, so a caller can do it outside a data transaction and apply the result inside one.
export async function readSite(website, { fetcher, now = Date.now, maxPages = 3, wanted = null }) {
  const site = { domain: null, pages: [], errors: [], retrieved_at: null };
  const domain = canonicalDomain(website);
  if (!domain || domain.nonCompany) { site.errors.push({ url: website, code: 'bad_url', message: 'not a company website' }); return site; }
  site.domain = domain;

  const read = async (url) => {
    try {
      const res = await fetcher.get(url);
      site.pages.push({ url: res.url, finalUrl: res.finalUrl, status: res.status, html: res.text });
      return res;
    } catch (err) {
      if (!(err instanceof FetchPolicyError)) throw err;
      site.errors.push({ url, code: err.code, message: err.message });
      return null;
    }
  };

  const home = await read(`https://${domain.host}/`);
  if (!home) return site;
  for (const url of pickPages(home.text, home.finalUrl, maxPages - 1, wanted)) await read(url);
  site.retrieved_at = new Date(now()).toISOString();
  return site;
}

// Reads up to maxPages of a candidate's site and says what it states. See readSite and analyzeSite.
export async function enrichFromWebsite(website, { fetcher, now = Date.now, candidateNames = [], maxPages = 3, wanted = null }) {
  return analyzeSite(await readSite(website, { fetcher, now, maxPages, wanted }), { candidateNames, now });
}

// The analysis step: pure. What a site that has been read says about the company, as evidence with its
// source, or a warning and nothing else if it does not look like this company's site.
export function analyzeSite(site, { candidateNames = [], now = Date.now, lenient = false } = {}) {
  const result = {
    pages: site.pages.map((p) => ({ url: p.finalUrl, status: p.status })), evidence: [], facts: null, aliases: [], legalNames: [],
    external_ids: { abn: null, acn: null }, signals: { phones: 0 }, warnings: [], errors: [...site.errors], pageFacts: [],
    retrieved_at: site.retrieved_at,
  };
  const { domain } = site;
  if (!domain || site.pages.length === 0) return result;

  const facts = site.pages.map((page, i) => ({ res: page, facts: extractFacts(page.html, { home: i === 0 }), html: page.html }));
  const home = site.pages[0];
  result.pageFacts = facts.map(({ res, facts: f }) => ({ page: res, facts: f }));
  // The title decides: a real page with a poor meta description is still a real page.
  const gate = [facts[0].facts.title].find(isGatePage);
  if (gate) {
    result.warnings.push(`the website at ${domain.host} served a page that is not its own content ("${gate.slice(0, 80)}"): it may be refusing automated readers, so nothing was recorded from it`);
    result.blocked = true;
    return result;
  }
  const combined = {
    names: unique(facts.flatMap((f) => f.facts.names)), legalNames: unique(facts.flatMap((f) => f.facts.legalNames)), titleName: facts[0].facts.titleName,
  };
  if (!pageMatchesName(candidateNames, combined, domain.domain, { lenient })) {
    const called = [...combined.names, ...(looksLikeName(combined.titleName) ? [combined.titleName] : [])];
    result.warnings.push(`the website at ${domain.host} does not appear to be ${candidateNames[0] ?? 'this company'}: it calls itself ${called.slice(0, 2).join(' / ') || 'nothing we could read'}`);
    result.facts = { names: combined.names };
    result.mismatch = true;
    return result;
  }

  const retrieved = site.retrieved_at ?? new Date(now()).toISOString();
  const sourceFor = (res, f) => sourceOf(res, f, domain, retrieved);
  const add = (field, value, confidence, note, res, f) => result.evidence.push({
    field, value, confidence, verified_at: confidence === 'high' ? retrieved : null, note, source: sourceFor(res, f),
  });

  add('website', `https://${domain.host}`, 'high', 'The site itself.', home, facts[0].facts);
  for (const [i, { res, facts: f }] of facts.entries()) {
    // A description is what the homepage says about the company; an inner page's is about the page.
    // A one-word placeholder ("Home", "Welcome") is not a description.
    if (i === 0 && f.description && f.description.trim().split(/\s+/).length >= 3 && !isGatePage(f.description)) add('description', f.description.slice(0, 400), 'medium', 'The page\'s own description.', res, f);
    const au = f.addresses[0];
    if (au) {
      const conf = au.source === 'structured' ? 'high' : 'medium';
      add('address', au.text, conf, 'Australian address on the page.', res, f);
      add('state', au.state, conf, 'From the address on the page.', res, f);
      // A suburb ("Haymarket") is not a city here; the address already holds it. city is
      // recorded only when it is a city this directory uses, so the city filter is not fragmented.
      if (au.city && KNOWN_CITIES.includes(au.city)) add('city', au.city, conf, 'From the address on the page.', res, f);
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
  // Other names: those the site states (structured data, og:site_name), plus the homepage
  // title if it looks like a name that resembles the candidate's. A tagline is never an alias.
  const resembles = (name) => candidateNames.some((c) => {
    const a = nameKey(c);
    const b = nameKey(name);
    return a && b && (a === b || a.startsWith(b) || b.startsWith(a) || similarity(a, b) >= 0.8);
  });
  const titled = looksLikeName(combined.titleName) && resembles(combined.titleName) ? [combined.titleName] : [];
  result.aliases = unique([...combined.names, ...titled]).filter((n) => nameKey(n) && !candidateNames.some((c) => nameKey(c) === nameKey(n)));
  result.external_ids = { abn: facts.flatMap((f) => f.facts.abns)[0] ?? null, acn: facts.flatMap((f) => f.facts.acns)[0] ?? null };
  // Both numbers are recorded as the page gives them. But a company's ABN ends with its ACN,
  // so a pair that does not line up names two legal entities (Medcast's page does), and the
  // candidate must not look as if one entity holds both.
  const { abn, acn } = result.external_ids;
  if (abn && acn && !abn.endsWith(acn)) {
    result.warnings.push(`the site gives ABN ${abn} and ACN ${acn}, which do not belong to one company (a company's ABN ends with its ACN): they probably identify two legal entities, so check which is which before relying on either`);
  }
  result.facts = { names: combined.names, addresses: facts.flatMap((f) => f.facts.addresses) };
  return result;
}
