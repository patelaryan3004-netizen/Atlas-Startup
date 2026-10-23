// What the investor directory needs to know about a PERSON, worked out from what a record states and never guessed:
//
//   geoOfLocation(text)       where a listed location is (city, state, country) and whether it is Australia. An unknown place is never Australia.
//   roleClassOf(title)        what kind of role a title is (investing, scout, talent, platform, other). A firm affiliation alone does not make someone an
//                             investor: with no title there is no class, and a title that names none of the kinds is "other".
//   profileKey(url)           a professional-profile address as two writings of it would agree (the key a person is matched on).
//
// Pure functions: no files, no network. The public read model (catalog/investors.js) and the people importer (scripts/investors/people_import.mjs) use
// the same ones, so what the importer reports as "Australian" is what the page treats as Australian.
import { KNOWN_CITIES, deriveState } from '../models/company.js';

// ---------- where ----------

const AU = 'Australia';
const AU_STATE_NAMES = {
  nsw: 'NSW', 'new south wales': 'NSW', vic: 'VIC', victoria: 'VIC', qld: 'QLD', queensland: 'QLD', sa: 'SA', 'south australia': 'SA',
  wa: 'WA', 'western australia': 'WA', tas: 'TAS', tasmania: 'TAS', nt: 'NT', 'northern territory': 'NT', act: 'ACT', 'australian capital territory': 'ACT',
};

// What a directory lists for a place that is not Australian, as it writes it. [words that mean it, city, country, region]. A country alone has no city,
// and a region ("Europe", "Southeast Asia") has no country: nothing is made more exact than the listing says.
const ELSEWHERE = [
  [['sf', 'san francisco', 'bay area', 'san francisco bay area', 'palo alto', 'menlo park'], 'San Francisco', 'United States', null],
  [['nyc', 'new york', 'new york city'], 'New York', 'United States', null],
  [['la', 'los angeles'], 'Los Angeles', 'United States', null],
  [['boston'], 'Boston', 'United States', null],
  [['austin'], 'Austin', 'United States', null],
  [['seattle'], 'Seattle', 'United States', null],
  [['us', 'usa', 'united states', 'united states of america'], null, 'United States', null],
  [['london'], 'London', 'United Kingdom', null],
  [['uk', 'united kingdom', 'england', 'britain', 'great britain'], null, 'United Kingdom', null],
  [['canada', 'toronto', 'vancouver'], null, 'Canada', null],
  [['india', 'bengaluru', 'bangalore', 'mumbai', 'delhi', 'new delhi'], null, 'India', null],
  [['singapore'], 'Singapore', 'Singapore', null],
  [['new zealand', 'nz', 'auckland', 'wellington'], null, 'New Zealand', null],
  [['sea', 'southeast asia', 'south east asia'], null, null, 'Southeast Asia'],
  [['europe'], null, null, 'Europe'],
];
const WORDS = new Map(ELSEWHERE.flatMap(([words, city, country, region]) => words.map((w) => [w, { city, country, region }])));

const clean = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

// The Australian cities a listing may name. Only a city whose name is not also a place elsewhere or a suburb in several states (so "Richmond", "Carlton"
// and "Milton" are not here), with the state each is in.
const AU_CITIES = new Map([
  ...KNOWN_CITIES.map((c) => [clean(c), [c, deriveState({ verified: true, city: c })]]),
  ['hobart', ['Hobart', 'TAS']], ['darwin', ['Darwin', 'NT']], ['wollongong', ['Wollongong', 'NSW']], ['geelong', ['Geelong', 'VIC']],
  ['sunshine coast', ['Sunshine Coast', 'QLD']], ['townsville', ['Townsville', 'QLD']], ['cairns', ['Cairns', 'QLD']],
].filter(([, [, state]]) => state));

// { label, city, state, country, region, scope }. `label` is the listing as written. scope is 'au' only when the listing names an Australian city, a state
// or "Australia"; anything else, including a listing that says "Other" or nothing, is 'global': a place is never presumed to be Australian.
export function geoOfLocation(text) {
  const label = text == null || !String(text).trim() ? null : String(text).trim();
  const out = { label, city: null, state: null, country: null, region: null, scope: 'global' };
  if (!label) return out;
  const pieces = String(label).split(/[,/·|]/).map(clean).filter(Boolean); // "Melbourne, VIC" is two
  const whole = clean(label);
  // "Sydney NSW" has no comma: its words are looked at too, one at a time and two at a time.
  const words = whole.split(' ');
  const grams = [...words, ...words.slice(1).map((w, i) => `${words[i]} ${w}`)];
  const multi = pieces.length > 1 || words.length > 1; // a bare "WA" or "SA" is not read as a state
  const au = (n) => n === 'australia' || (AU_STATE_NAMES[n] && (n.length > 3 || multi)) || AU_CITIES.has(n);
  let city = null;
  let state = null; // a state the listing itself names
  let country = null;
  for (const n of [whole, ...pieces, ...grams]) {
    if (n === 'australia') country = AU;
    if (AU_STATE_NAMES[n] && (n.length > 3 || multi)) state ??= AU_STATE_NAMES[n];
    if (AU_CITIES.has(n)) city ??= n;
  }
  // Australia: it says so, or names an Australian state, or is a city of Australia on its own or beside only Australian words ("Melbourne, Florida" is not).
  const rest = pieces.filter((p) => !au(p));
  if (country || state || (city && (rest.length === 0 || pieces.length === 1))) {
    const [name, st] = city ? AU_CITIES.get(city) : [null, null];
    return { ...out, city: name, state: state ?? st, country: AU, scope: 'au' };
  }
  for (const n of [whole, ...pieces]) {
    const hit = WORDS.get(n);
    if (hit) return { ...out, ...hit };
  }
  return out;
}

// ---------- what role ----------

export const ROLE_CLASSES = ['investment', 'scout', 'talent', 'platform', 'other'];
export const ROLE_CLASS_LABELS = { investment: 'Investing', scout: 'Scout', talent: 'Talent', platform: 'Platform', other: 'Other role' };
export const roleClassLabel = (cls) => ROLE_CLASS_LABELS[cls] ?? null;

// The order matters: "Talent Partner" and "Platform Partner" are not investing partners, and "Operating Partner" is a platform role.
const RULES = [
  ['scout', /\bscouts?\b/],
  ['talent', /\b(talent|recruit\w*|people\s+(?:partner|ops|operations|lead)|head\s+of\s+people|human\s+resources|hr)\b/],
  ['platform', /\b(platform|operating\s+partner|operations|portfolio\s+(?:success|support|services)|entrepreneur[-\s]+in[-\s]+residence|eir|community|events?|marketing|communications|content|chief\s+of\s+staff|office\s+manager|executive\s+assistant|finance|legal|counsel|engineer\w*|designer|product|advis[eo]r)\b/],
  ['investment', /\b(general\s+partner|managing\s+partner|managing\s+director|founding\s+partner|venture\s+partner|investment\s+partner|investing\s+partner|partner|principal|investor|investment|associate|analyst|gp|vp\s+of\s+investments?|director\s+of\s+investments?)\b/],
];

// null for no title (a firm affiliation alone says nothing about the role); 'other' for a title none of the kinds names.
export function roleClassOf(title) {
  const t = String(title ?? '').toLowerCase().replace(/[&/]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  for (const [cls, re] of RULES) if (re.test(t)) return cls;
  return 'other';
}

// ---------- matching ----------

// A professional-profile address as two writings of it agree: the host without "www." and without a country sub-domain of LinkedIn
// (au.linkedin.com), lower case, no query, no fragment, no trailing slash; a LinkedIn /in/ handle decoded and lower-cased. null for anything that is not
// a web address.
export function profileKey(url) {
  let u;
  try { u = new URL(String(url).trim()); } catch (e) { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  let host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (/(^|\.)linkedin\.com$/.test(host)) host = 'linkedin.com';
  let path = u.pathname.replace(/\/+$/, '');
  try { path = decodeURIComponent(path); } catch (e) { /* keep as written */ }
  if (host === 'linkedin.com') path = path.toLowerCase();
  return `${host}${path}`;
}

export const isLinkedIn = (url) => /^linkedin\.com\//.test(profileKey(url) ?? '');
// A LinkedIn address is a person's professional profile only at /in/<handle>; a company page, a search page or a post is not.
export const isLinkedInProfile = (url) => /^linkedin\.com\/in\/[^/]+$/.test(profileKey(url) ?? '');

// A name as two writings of it would agree: no accents, case, punctuation or a title ("Dr").
export const personNameKey = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\b(dr|mr|mrs|ms|prof)\.?\s/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
