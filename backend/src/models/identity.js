// How names, websites, locations and registry numbers are normalised so one
// company compares equal however a source spells it. Pure functions, no I/O.
// Used by identifiers.json validation and by the discovery pipeline's entity
// resolution.

const stripAccents = (s) => String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '');
const unique = (list) => [...new Set(list)];

// ---------- names ----------

// Legal-form words are not part of what a company is called.
const LEGAL_TAIL = new Set(['pty', 'ltd', 'limited', 'proprietary', 'inc', 'incorporated', 'llc', 'plc', 'corp', 'corporation', 'co', 'gmbh', 'pte']);
// Words that describe a kind of business rather than naming it. Only used for
// the loose key, which can suggest a match but never settle one.
const GENERIC_TAIL = new Set([
  'group', 'holdings', 'labs', 'lab', 'technologies', 'technology', 'tech', 'software', 'systems',
  'solutions', 'ventures', 'global', 'international', 'australia', 'aus', 'au', 'digital', 'studio', 'studios',
]);

function tokensOf(name) {
  const tokens = stripAccents(name).toLowerCase().replace(/&/g, ' and ').replace(/\([^)]*\)/g, ' ').split(/[^a-z0-9]+/).filter(Boolean);
  while (tokens[0] === 'the' && tokens.length > 1) tokens.shift();
  return tokens;
}

// "Leonardo.Ai" and "Leonardo AI" both become "leonardoai"; "Acme Pty Ltd" and
// "ACME" both become "acme".
export function nameKey(name) {
  const tokens = tokensOf(name ?? '');
  while (tokens.length > 1 && LEGAL_TAIL.has(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join('');
}

// Also drops trailing descriptive words, so "DataMesh Group" ~ "DataMesh".
export function looseNameKey(name) {
  const tokens = tokensOf(name ?? '');
  while (tokens.length > 1 && (LEGAL_TAIL.has(tokens[tokens.length - 1]) || GENERIC_TAIL.has(tokens[tokens.length - 1]))) tokens.pop();
  return tokens.join('');
}

export function nameTokens(name) {
  const tokens = tokensOf(name ?? '');
  while (tokens.length > 1 && LEGAL_TAIL.has(tokens[tokens.length - 1])) tokens.pop();
  return tokens;
}

// The legacy data keeps aliases inside the name: "Hone (HoneAg)", "Cor (Cor AI)",
// "Brumby (formerly GrazeMate)". Split them back out. A parenthetical is a
// former name when it says so, an alias otherwise.
export function parseNameVariants(name) {
  const text = String(name ?? '').trim();
  const aliases = [];
  const formerNames = [];
  const primary = text.replace(/\(([^)]*)\)/g, (_, inner) => {
    const s = inner.trim();
    if (!s) return ' ';
    const former = /^(?:formerly|previously|ex|fka|f\/k\/a|was|née)\b[\s:.-]*(.+)$/i.exec(s);
    if (former) { formerNames.push(former[1].trim()); return ' '; }
    const aka = /^(?:aka|a\.k\.a\.?|also known as|trading as|t\/a)\b[\s:.-]*(.+)$/i.exec(s);
    if (aka) { aliases.push(aka[1].trim()); return ' '; }
    aliases.push(s);
    return ' ';
  }).replace(/\s+/g, ' ').trim();
  return { primary: primary || text, aliases: unique(aliases), formerNames: unique(formerNames) };
}

function levenshtein(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return prev[b.length];
}

// 0..1 between two name keys. Edit distance catches typos and a dropped letter;
// bigram overlap catches reordered or partly shared names in longer keys.
export function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const edit = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  if (a.length < 6 || b.length < 6) return edit;
  const grams = (s) => { const g = new Map(); for (let i = 0; i < s.length - 1; i += 1) g.set(s.slice(i, i + 2), (g.get(s.slice(i, i + 2)) || 0) + 1); return g; };
  const [ga, gb] = [grams(a), grams(b)];
  let shared = 0;
  for (const [gram, n] of ga) shared += Math.min(n, gb.get(gram) || 0);
  return Math.max(edit, (2 * shared) / (a.length - 1 + b.length - 1));
}

// ---------- websites ----------

const MULTI_PART_SUFFIX = new Set([
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'asn.au', 'id.au',
  'co.nz', 'org.nz', 'net.nz', 'govt.nz', 'ac.nz',
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk',
  'com.sg', 'com.hk', 'co.jp', 'co.kr', 'co.in', 'com.br', 'com.mx', 'co.za', 'com.cn', 'com.tw', 'com.my',
]);

// Platforms where the subdomain, not the registrable domain, identifies the
// tenant: acme.netlify.app and other.netlify.app are different companies. Only
// the subdomains are shared; the platform's own apex is an ordinary company site.
const SHARED_HOSTS = [
  'github.io', 'gitlab.io', 'netlify.app', 'vercel.app', 'herokuapp.com', 'onrender.com', 'pages.dev', 'workers.dev',
  'web.app', 'firebaseapp.com', 'azurewebsites.net', 'cloudfront.net', 'amazonaws.com', 'wixsite.com', 'squarespace.com',
  'webflow.io', 'framer.website', 'framer.app', 'notion.site', 'carrd.co', 'blogspot.com',
  'wordpress.com', 'weebly.com', 'godaddysites.com', 'myshopify.com', 'bubbleapps.io', 'glideapp.io', 'canva.site',
  'substack.com', 'medium.com',
];
// Platforms whose tenants live under a path (linktr.ee/acme), so a URL with a
// path there is a profile page, not a company website. The bare host is the
// platform's own site.
const PATH_TENANT_HOSTS = ['linktr.ee', 'bio.link', 'medium.com', 'substack.com'];

// Never a company's own website: social profiles, registries, directories,
// app stores, and the press that reports on companies.
export const NON_COMPANY_HOSTS = [
  'linkedin.com', 'lnkd.in', 'facebook.com', 'fb.com', 'instagram.com', 'twitter.com', 'x.com', 't.co', 'youtube.com',
  'youtu.be', 'tiktok.com', 'crunchbase.com', 'pitchbook.com', 'wikipedia.org', 'github.com', 'play.google.com',
  'apps.apple.com', 'news.google.com', 'google.com', 'abr.business.gov.au', 'asic.gov.au',
  'startupdaily.net', 'smartcompany.com.au', 'techboard.com.au', 'innovationaus.com', 'afr.com', 'theaustralian.com.au',
  'smh.com.au', 'theage.com.au', 'abc.net.au', 'itnews.com.au', 'mumbrella.com.au',
];

const onHost = (host, list) => list.some((d) => host === d || host.endsWith(`.${d}`));
const isIpHost = (host) => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(':') || host.startsWith('[');

export function registrableDomain(host) {
  const labels = host.split('.');
  if (labels.length <= 2) return host;
  return MULTI_PART_SUFFIX.has(labels.slice(-2).join('.')) ? labels.slice(-3).join('.') : labels.slice(-2).join('.');
}

// A website, bare domain or email address as { host, domain, shared, nonCompany },
// or null when it names no usable host. domain is what identifies the company:
// the registrable domain (sherpa.net.au for app.sherpa.net.au), or the whole host
// on a shared platform. nonCompany marks hosts that can never identify a company.
export function canonicalDomain(input) {
  let s = String(input ?? '').trim().toLowerCase();
  if (!s) return null;
  if (s.includes('@') && !/[/?#]/.test(s)) s = s.split('@').pop();
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(s)) s = `https://${s}`;
  let url;
  try { url = new URL(s); } catch { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const host = url.hostname.replace(/\.$/, '').replace(/^www\d*\./, '');
  if (!host.includes('.') || isIpHost(host) || host === 'localhost') return null;
  const hasPath = url.pathname.replace(/\/+$/, '') !== '';
  const nonCompany = onHost(host, NON_COMPANY_HOSTS) || (hasPath && PATH_TENANT_HOSTS.includes(host));
  const shared = SHARED_HOSTS.some((d) => host.endsWith(`.${d}`));
  return { host, domain: shared ? host : registrableDomain(host), shared, nonCompany };
}

// The company's website as a clean https URL, or null if the input is not one
// that can identify a company.
export function websiteUrl(input) {
  const d = canonicalDomain(input);
  return d && !d.nonCompany ? `https://${d.host}` : null;
}

// ---------- registry numbers ----------

const digitsOnly = (s) => String(s ?? '').replace(/\D/g, '');

// ATO algorithm: subtract 1 from the first digit, weight the digits, and the
// sum must divide by 89.
export function isValidABN(value) {
  const d = digitsOnly(value);
  if (d.length !== 11) return false;
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const sum = [...d].reduce((acc, ch, i) => acc + (Number(ch) - (i === 0 ? 1 : 0)) * weights[i], 0);
  return sum % 89 === 0;
}

// ASIC algorithm: weight the first eight digits 8..1; the complement of the sum
// mod 10 is the ninth digit.
export function isValidACN(value) {
  const d = digitsOnly(value);
  if (d.length !== 9) return false;
  const sum = [...d.slice(0, 8)].reduce((acc, ch, i) => acc + Number(ch) * (8 - i), 0);
  return (10 - (sum % 10)) % 10 === Number(d[8]);
}

export const normalizeABN = (v) => (isValidABN(v) ? digitsOnly(v) : null);
export const normalizeACN = (v) => (isValidACN(v) ? digitsOnly(v) : null);

// ---------- location and people ----------

const STREET_WORDS = { st: 'street', rd: 'road', ave: 'avenue', av: 'avenue', hwy: 'highway', pde: 'parade', ln: 'lane', cres: 'crescent', ct: 'court', pl: 'place', dr: 'drive', blvd: 'boulevard', tce: 'terrace', sq: 'square' };

// Street and postcode with unit/level prefixes dropped, so "Level 3, 10 George St,
// Sydney NSW 2000" and "10 George Street Sydney NSW 2000" compare equal. A
// corroborating signal only: buildings are shared, so an address never settles identity.
export function normalizeAddress(address) {
  const s = stripAccents(address ?? '').toLowerCase()
    .replace(/\b(?:level|lvl|suite|ste|unit|floor|fl|shop)\s*[\w-]+[\s,/-]*/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ');
  const words = s.split(/\s+/).filter(Boolean).map((w) => STREET_WORDS[w] ?? w);
  return words.join(' ');
}

const STREET_TYPES = new Set(['street', 'road', 'avenue', 'lane', 'place', 'parade', 'drive', 'court', 'boulevard', 'highway', 'terrace', 'crescent', 'square', 'way', 'close', 'circuit', 'esplanade']);

// Where an address is, as far as two writings of it can be compared: the street number and name, and the
// postcode. Unit, level and suburb words are how people write the same place differently, so they are left
// out: "Level 8, 10-14 Waterloo Street, Surry Hills NSW 2010", "10-14 Waterloo St, Surry Hills NSW 2010" and
// "8/4 Martin Place" / "Level 8, 4 Martin Place" are each one place. { street, postcode } or null when no
// street can be found.
export function addressParts(address) {
  const words = stripAccents(address ?? '').toLowerCase()
    // "Level 8, " / "Suite 1.103/" / "Unit 12, ": a unit word and its number, when a street number follows
    .replace(/\b(?:level|lvl|suite|ste|unit|floor|fl|shop)\s*[\w.-]+\s*[,/-]?\s*(?=\d)/g, ' ')
    // "8/4 Martin Place" and "1.103/477": the number before the slash is a unit
    .replace(/\b\d+(?:\.\d+)?[a-z]?\s*\/\s*(?=\d)/g, '')
    .replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean).map((w) => STREET_WORDS[w] ?? w);
  const at = words.findIndex((w, i) => i >= 1 && STREET_TYPES.has(w));
  if (at < 0) return null;
  const postcode = [...words.slice(at + 1)].reverse().find((w) => /^\d{4}$/.test(w)) ?? null;
  return { street: words.slice(0, at + 1).join(' '), postcode };
}

// The same place? Streets must agree, and postcodes too unless one side does not give one.
export function sameAddress(a, b) {
  const x = addressParts(a);
  const y = addressParts(b);
  if (!x || !y) return normalizeAddress(a) === normalizeAddress(b);
  return x.street === y.street && (x.postcode == null || y.postcode == null || x.postcode === y.postcode);
}

export function cityKey(city) {
  const s = stripAccents(city ?? '').toLowerCase().replace(/\s*\([^)]*\)/g, '').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  return !s || s === 'unknown' ? null : s;
}

// A person, by full name. One word is not enough to tell people apart.
export function personKey(name) {
  const tokens = stripAccents(name ?? '').toLowerCase().replace(/[^a-z\s'-]/g, ' ').split(/\s+/).filter(Boolean);
  return tokens.length >= 2 ? tokens.join(' ') : null;
}
