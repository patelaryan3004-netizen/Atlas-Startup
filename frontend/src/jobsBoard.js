// The hiring desk's logic, apart from its look: what the address asks for, which roles match, how many there are in each place, how a role's dates and status are worded.
//
// The page is given the whole board (backend/src/network/board.js: every open role a visitor can work in Australia, confirmed within two weeks) and does the rest here, so a tap on
// "Melbourne" answers at once and every number on the page is counted from the same list. Nothing is typed in: a card's count is the roles that match, a role open in two cities is in
// both cards and once in the national count.
import { fetchJobBoard } from './networkApi.js';

export const PLACE_CARDS = [
  { id: 'Melbourne', label: 'Melbourne', photo: '/img/jobs/melbourne.webp' },
  { id: 'Sydney', label: 'Sydney', photo: '/img/jobs/sydney.webp' },
  { id: 'Perth', label: 'Perth', photo: '/img/jobs/perth.webp' },
  { id: 'remote-au', label: 'Remote AU', photo: '/img/jobs/remote.svg', outline: true },
];
export const OTHER_PLACES = ['Brisbane', 'Adelaide', 'Canberra', 'Gold Coast', 'Newcastle', 'Hobart', 'Darwin'];
export const OTHER_AU = 'other-au';
export const REMOTE_AU = 'remote-au';
export const PLACE_LABELS = { 'remote-au': 'Remote AU', 'other-au': 'Elsewhere in Australia' };
export const placeLabel = (id) => PLACE_LABELS[id] ?? id;

export const EMPTY = { place: '', search: '', sector: '', stage: '', type: '', level: '', arrangement: '', company: '', saved: false, sort: 'latest' };
export const SORTS = [['latest', 'Latest additions'], ['company', 'Company A–Z'], ['title', 'Role A–Z']];
const KNOWN_PLACES = new Set([...PLACE_CARDS.map((p) => p.id), ...OTHER_PLACES, OTHER_AU]);

// A company whose directory record has no sector is "Unknown" in the data; the page says what that means.
export const sectorLabel = (value) => (value === 'Unknown' ? 'Sector not supplied' : value);

// What the address asks for. ?place=Melbourne (or remote-au, other-au, or any of the other capitals); the old ?city=Sydney still opens the board on that place, and the old ?remote=yes on
// remote roles. ?sector=Unknown is a link that has always worked and still does.
export function readFilters(search = '') {
  const p = new URLSearchParams(search);
  const get = (k) => p.get(k) ?? '';
  const place = normalisePlace(get('place') || get('city'));
  return {
    ...EMPTY, place, search: get('search'), sector: get('sector'), stage: get('stage'), type: get('type'), level: get('level'), company: get('company'),
    arrangement: get('arrangement') || (get('remote') === 'yes' ? 'remote' : ''), saved: get('saved') === '1', sort: SORTS.some(([id]) => id === get('sort')) ? get('sort') : 'latest',
  };
}

function normalisePlace(value) {
  const v = String(value ?? '').trim().toLowerCase().replace(/\s+/g, '-');
  if (!v) return '';
  if (v === 'remote-au' || v === 'remote') return REMOTE_AU;
  if (v === OTHER_AU) return OTHER_AU;
  return [...KNOWN_PLACES].find((id) => id.toLowerCase().replace(/\s+/g, '-') === v) ?? '';
}

// The query string for a set of filters: only what differs from the start, so the default board is plain /jobs.
export function writeFilters(f) {
  const p = new URLSearchParams();
  for (const k of ['place', 'search', 'sector', 'stage', 'type', 'level', 'arrangement', 'company']) if (f[k]) p.set(k, f[k]);
  if (f.saved) p.set('saved', '1');
  if (f.sort && f.sort !== 'latest') p.set('sort', f.sort);
  const text = p.toString();
  return text ? `?${text}` : '';
}

export const activeSecondary = (f) => ['sector', 'stage', 'type', 'level', 'arrangement'].filter((k) => f[k]).length;
export const isStart = (f) => Object.keys(EMPTY).every((k) => f[k] === EMPTY[k]);

// ---------- which roles match ----------

export function inPlace(role, place) {
  if (!place) return true;
  if (place === REMOTE_AU) return role.work.remote_au === true;
  if (place === OTHER_AU) return role.region === 'au' && role.work.cities.length === 0 && !role.work.remote_au;
  return role.work.cities.includes(place);
}

const text = (role) => [role.title, role.company.name, role.location, role.team, ...(role.work.places ?? []).map((p) => p.label)].filter(Boolean).join(' ').toLowerCase();

// `ignore` names the filters left out: the place cards count with every filter but the place; the company index with every one but the company.
export function matches(role, f, ignore = []) {
  const on = (k) => f[k] && !ignore.includes(k);
  if (on('place') && !inPlace(role, f.place)) return false;
  if (on('search')) { const t = text(role); if (!f.search.toLowerCase().split(/\s+/).filter(Boolean).every((w) => t.includes(w))) return false; }
  if (on('sector') && role.company.sector !== f.sector) return false;
  if (on('stage') && role.company.stage !== f.stage) return false;
  if (on('type') && role.employment_type !== f.type) return false;
  if (on('level') && role.level !== f.level) return false;
  if (on('arrangement') && !(role.work.arrangement === f.arrangement || (f.arrangement === 'remote' && role.remote === true))) return false;
  if (on('company') && (role.company.slug ?? role.company.name) !== f.company) return false;
  return true;
}

export const filterRoles = (roles, f, ignore = []) => roles.filter((r) => matches(r, f, ignore));

// How many roles each card shows: those that match every filter but the place. The national figure counts each role once.
export function placeCounts(roles, f) {
  const base = filterRoles(roles, f, ['place']);
  const out = { national: base.length, [REMOTE_AU]: 0, [OTHER_AU]: 0 };
  for (const id of [...PLACE_CARDS.map((p) => p.id), ...OTHER_PLACES]) out[id] = 0;
  for (const r of base) {
    for (const c of r.work.cities) out[c] = (out[c] ?? 0) + 1;
    if (r.work.remote_au) out[REMOTE_AU] += 1;
    if (inPlace(r, OTHER_AU)) out[OTHER_AU] += 1;
  }
  return out;
}

// How the national figure splits, counted from the same roles the cards count (everything that matches but the place). Every role is in exactly one group, so the groups add up to the
// national figure; a role open in two cities is one role, so the city counts can add up to more. Nothing here is typed in: it is all read from the roles.
export function placeBreakdown(roles, f) {
  const base = filterRoles(roles, f, ['place']);
  const out = { total: base.length, uniqueIds: new Set(base.map((r) => r.id)).size, inCity: 0, inTwoCities: 0, cityCounts: 0, remoteOnly: 0, elsewhere: 0 };
  for (const r of base) {
    const n = new Set(r.work.cities).size;
    out.cityCounts += n;
    if (n) { out.inCity += 1; if (n > 1) out.inTwoCities += 1; } else if (r.work.remote_au) out.remoteOnly += 1; else out.elsewhere += 1;
  }
  return out;
}

// "Who's hiring": the companies with a role among those that match every filter but the company, most roles first.
export function companyIndex(roles, f) {
  const by = new Map();
  for (const r of filterRoles(roles, f, ['company'])) {
    const key = r.company.slug ?? r.company.name;
    const hit = by.get(key) ?? { key, name: r.company.name, slug: r.company.slug, website: r.company.website, count: 0 };
    hit.count += 1;
    by.set(key, hit);
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

// The date a role is placed by in "Latest additions": when its employer posted it, else when we first saw it, else the day we last confirmed it.
const addedKey = (r) => Date.parse(r.posted_at ?? r.first_seen_at ?? r.last_confirmed_at ?? 0) || 0;
export function sortRoles(list, sort = 'latest') {
  const copy = [...list];
  if (sort === 'company') return copy.sort((a, b) => a.company.name.localeCompare(b.company.name) || a.title.localeCompare(b.title));
  if (sort === 'title') return copy.sort((a, b) => a.title.localeCompare(b.title) || a.company.name.localeCompare(b.company.name));
  return copy.sort((a, b) => addedKey(b) - addedKey(a) || a.company.name.localeCompare(b.company.name) || a.title.localeCompare(b.title));
}

// What a visitor may choose in the Filters panel: only what some role (among those the place and search leave) has.
export function filterOptions(roles, f) {
  const base = filterRoles(roles, f, ['sector', 'stage', 'type', 'level', 'arrangement']);
  const count = (pick) => { const m = new Map(); for (const r of base) { const v = pick(r); if (v) m.set(v, (m.get(v) ?? 0) + 1); } return [...m].map(([value, n]) => ({ value, count: n })).sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value))); };
  return {
    sectors: count((r) => r.company.sector), stages: count((r) => r.company.stage), types: count((r) => r.employment_type), levels: count((r) => r.level),
    arrangements: count((r) => r.work.arrangement ?? (r.remote === true ? 'remote' : null)),
  };
}
export const TYPE_LABELS = { full_time: 'Full-time', part_time: 'Part-time', contract: 'Contract', internship: 'Internship', fixed_term: 'Fixed term' };
export const LEVEL_LABELS = { intern: 'Intern', graduate: 'Graduate', junior: 'Junior', mid: 'Mid-level', senior: 'Senior', lead: 'Lead or principal', head: 'Head or director' };
export const ARRANGEMENT_LABELS = { remote: 'Remote', hybrid: 'Hybrid', on_site: 'On-site' };

// ---------- words ----------

const dayStart = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
const shortDate = (iso, now) => { const d = new Date(iso); return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', ...(d.getFullYear() === new Date(now).getFullYear() ? {} : { year: 'numeric' }) }); };

// When the board was last confirmed this role was listed: "today", "yesterday", or the day.
export function confirmedWords(iso, now = Date.now()) {
  if (!iso || Number.isNaN(Date.parse(iso))) return '';
  const days = Math.round((dayStart(now) - dayStart(Date.parse(iso))) / 86400000);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : shortDate(iso, now);
}

// A place's label without the word "remote" (the arrangement says that) and without brackets and dashes: "Remote (Victoria, Australia)" is "Victoria, Australia".
const bare = (label) => String(label ?? '').replace(/\(?\bremote\b\)?/gi, ' ').replace(/[()\-\u2013\u2014]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^[,;:\s]+|[,;:\s]+$/g, '');

// Where a role can be worked, in the employer's words trimmed to the place: the capitals it names, else the Australian place it names as the employer wrote it ("Cairns, Queensland", "Waterloo, NSW",
// "Victoria"), never a city the employer did not name. A role whose place is only "Australia" says so ("Australia, no city given"); a role that is remote from Australia and names no place is "Australia".
const COUNTRY_TAIL = /,\s*(australia|au)$/i;
export function whereWords(role) {
  const { cities, remote_au: remote, places } = role.work;
  if (cities.length) return cities.join(' / ');
  const other = [...new Set((places ?? []).filter((p) => p.au).map((p) => bare(p.label).replace(COUNTRY_TAIL, '').trim()).filter(Boolean))];
  if (other.length) return other.map((p) => (/^(australia|au)$/i.test(p) && !remote ? 'Australia, no city given' : p)).join(' / ');
  return remote ? 'Australia' : '';
}

// What the row says besides the title: the company, where, how it is worked. Anything the employer did not say is left out, not written as "not stated".
export function rowMeta(role) {
  return [role.company.name, whereWords(role), role.work.arrangement ? ARRANGEMENT_LABELS[role.work.arrangement] : ''].filter(Boolean);
}

// A role's standing, for a bookmark and for a role that needs a look: null when it is open and confirmed.
export function standing(role, now = Date.now()) {
  const day = shortDate(role.last_confirmed_at, now);
  switch (role.lifecycle) {
    case 'hidden': return { tone: 'gone', label: 'Not on the employer\'s board at the last check', detail: `The employer\'s board did not list it when we last read it (${day}). It may be filled or taken down: check the employer\'s site.` };
    case 'archived': return { tone: 'gone', label: 'No longer listed by the employer', detail: `It has been off the employer\'s board for at least two checks (last confirmed ${day}).` };
    case 'closed': return { tone: 'gone', label: 'Closed by the employer', detail: `The employer closed it (last confirmed ${day}).` };
    default:
      if (role.confirmation === 'recheck') return { tone: 'recheck', label: `Not rechecked since ${day}`, detail: `We could not recheck this employer\'s board since ${day}, so we cannot say the role is still open. Confirm on the employer\'s site.` };
      if (role.confirmation === 'stale') return { tone: 'stale', label: `Not confirmed since ${day}`, detail: `Nothing has confirmed this role for more than two weeks (${day}), so it is off the main board. Check the employer\'s site.` };
      return null;
  }
}

// How current the board says it is. `sync` is the board's own account (backend/src/network/board.js syncSummary).
export function feedStamp(board, now = Date.now(), source = 'live') {
  const last = board?.sync?.last_success_at;
  const stamp = (iso) => new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).replace(/ (am|pm)$/i, (m) => m.toLowerCase());
  // A saved copy never reads as live: it says it is a copy and when the employers' boards were last checked for it.
  if (source === 'snapshot') {
    const checked = last ?? board?.generated_at;
    return { text: checked ? `Saved copy · checked ${stamp(checked)}` : 'Saved copy', tone: 'saved' };
  }
  if (!last) return { text: 'No employer board has been read yet', tone: 'none' };
  const hours = (now - Date.parse(last)) / 3600000;
  if (hours > 6) return { text: `Employer boards last read ${stamp(last)}. The hourly check has not run since.`, tone: 'late' };
  return { text: `Employer boards last read ${stamp(last)}`, tone: 'ok' };
}

// ---------- the board's data ----------

const SNAPSHOT_URL = '/data/jobs-board.json';
const MAX_SNAPSHOT_DAYS = 14;

// The saved copy of the board that comes with the site, when it is recent enough to show; or null.
export async function loadSnapshot(now = Date.now(), fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl(SNAPSHOT_URL, { headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const board = await res.json();
    if (board?.schema !== 1 || !Array.isArray(board.roles)) return null;
    return now - Date.parse(board.generated_at) > MAX_SNAPSHOT_DAYS * 86400000 ? null : board;
  } catch (e) { return null; }
}

// The live board; or null when the server has no such answer (an older server) or cannot be reached.
export async function loadLive(opts) {
  try {
    const board = await fetchJobBoard(opts);
    return board?.schema === 1 && Array.isArray(board.roles) ? board : null;
  } catch (e) { if (e?.name === 'AbortError') throw e; return null; }
}

// A role from any of the API's answers as the page reads it: an older server's answer (no `work`, no lifecycle) still has a place, so a saved role from before is shown, not lost.
export function normaliseRole(role) {
  if (!role) return null;
  const work = role.work ?? { places: role.location ? [{ label: role.location, au: role.region === 'au', city: null }] : [], cities: [], remote_au: false, remote_evidence: null, arrangement: role.remote ? 'remote' : null };
  return {
    ...role, work: { cities: [], places: [], remote_au: false, arrangement: null, ...work }, company: { name: '', slug: null, website: '', sector: '', stage: '', city: '', ...(role.company ?? {}) },
    lifecycle: role.lifecycle ?? role.status ?? 'open', last_confirmed_at: role.last_confirmed_at ?? role.last_checked_at ?? null,
    confirmation: role.confirmation ?? (role.status === 'open' || !role.status ? (role.stale ? 'stale' : 'confirmed') : null),
  };
}

export const initialsOf = (name) => {
  const words = String(name ?? '').replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  return words.length === 1 ? words[0].slice(0, 2).replace(/^./, (c) => c.toUpperCase()) : `${words[0][0]}${words[1][0]}`.toUpperCase();
};

// A soft tint for a company's mark when it has no logo, the same every time for the same name.
const TINTS = ['#fbe6cd', '#e5dcf5', '#cce7ff', '#e0e6ff', '#d6ebe6', '#f0e1d7', '#e8efc9', '#f7d9d9'];
export const tintOf = (name) => { let h = 0; for (const ch of String(name ?? '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return TINTS[h % TINTS.length]; };
