// Data Command Center: the page. Vanilla JS, no build step, no dependencies.
//
// What this file promises (tests/adminUi.test.js reads it for each of these):
//   - nothing is ever inserted as HTML: every string reaches the page through a text node or textContent, because
//     company names, page titles and addresses come from websites we do not control;
//   - a link that leaves this page is http(s) only, and opens without handing over this window;
//   - the token lives in sessionStorage only, and is sent only as an Authorization header;
//   - no inline script, style or handler: the server's policy would refuse them anyway.

const SVG_NS = 'http://www.w3.org/2000/svg';
const TOKEN_KEY = 'acc.token';
const THEME_KEY = 'acc.theme';
const AU_STATES = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'];
const $ = (selector, root = document) => root.querySelector(selector);

// ======================================================================= small kit

const storage = (area) => ({
  get(key) { try { return area().getItem(key); } catch { return null; } },
  set(key, value) { try { area().setItem(key, value); } catch { /* storage refused: it just will not outlive this page */ } },
  remove(key) { try { area().removeItem(key); } catch { /* nothing to remove */ } },
});
const session = storage(() => sessionStorage);
const prefs = storage(() => localStorage);

function add(el, kids) {
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

// h('button', { class: 'btn', on: { click } }, 'Label'): attributes are set as attributes, children as text or nodes.
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key === 'on') for (const [name, fn] of Object.entries(value)) el.addEventListener(name, fn);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, value);
  }
  return add(el, kids);
}

const ICONS = {
  check: [['path', { d: 'M20 6 9 17l-5-5' }]],
  x: [['path', { d: 'M18 6 6 18M6 6l12 12' }]],
  search: [['circle', { cx: 11, cy: 11, r: 7 }], ['path', { d: 'm21 21-4.3-4.3' }]],
  refresh: [['path', { d: 'M21 12a9 9 0 1 1-3-6.7L21 8' }], ['path', { d: 'M21 3v5h-5' }]],
  external: [['path', { d: 'M15 3h6v6M10 14 21 3' }], ['path', { d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' }]],
  lock: [['rect', { x: 4, y: 11, width: 16, height: 10, rx: 2 }], ['path', { d: 'M8 11V7a4 4 0 0 1 8 0v4' }]],
  signout: [['path', { d: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9' }]],
  sun: [['circle', { cx: 12, cy: 12, r: 4 }], ['path', { d: 'M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4' }]],
  moon: [['path', { d: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z' }]],
  contrast: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M12 3a9 9 0 0 1 0 18Z', fill: 'currentColor' }]],
  play: [['path', { d: 'M7 4.5v15l12-7.5Z' }]],
  stop: [['rect', { x: 6, y: 6, width: 12, height: 12, rx: 1.5 }]],
  plus: [['path', { d: 'M12 5v14M5 12h14' }]],
};

function icon(name, size = 16) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.75, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false', class: 'icon' })) svg.setAttribute(k, v);
  for (const [tag, attrs] of ICONS[name]) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    svg.append(node);
  }
  return svg;
}

const nf = new Intl.NumberFormat('en-AU');
const n = (v) => nf.format(v ?? 0);
const plural = (count, one, many = `${one}s`) => `${n(count)} ${count === 1 ? one : many}`;
const dateFmt = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit' });
const rtf = new Intl.RelativeTimeFormat('en-AU', { numeric: 'auto' });
const valid = (iso) => Boolean(iso) && !Number.isNaN(Date.parse(iso));
const fmtDate = (iso) => (valid(iso) ? dateFmt.format(new Date(iso)) : '');
const fmtTime = (iso) => (valid(iso) ? timeFmt.format(new Date(iso)) : '');
const fmtDateTime = (iso) => (valid(iso) ? `${fmtDate(iso)}, ${fmtTime(iso)}` : '');
function relative(iso, now = Date.now()) {
  if (!valid(iso)) return '';
  const seconds = Math.round((Date.parse(iso) - now) / 1000);
  for (const [unit, size] of [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]]) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return rtf.format(seconds, 'second');
}

const debounce = (fn, ms) => { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); }; };
const clip = (s, max = 140) => { const t = String(s ?? ''); return t.length > max ? `${t.slice(0, max - 1)}…` : t; };
const lines = (s) => String(s ?? '').split('\n').map((x) => x.trim()).filter(Boolean);
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// Only http(s) ever becomes a link: a "javascript:" address in scraped data is shown as text, never followed.
function safeHref(url) {
  try { const u = new URL(String(url)); return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null; } catch { return null; }
}
const hostOf = (url) => { try { return new URL(String(url)).hostname.replace(/^www\./, ''); } catch { return String(url ?? ''); } };
function extLink(url, label, props = {}) {
  const href = safeHref(url);
  if (!href) return h('span', {}, label ?? url ?? '');
  return h('a', { class: 'ext', href, target: '_blank', rel: 'noopener noreferrer', ...props }, label ?? hostOf(href), icon('external', 12), h('span', { class: 'sr' }, ' (opens in a new tab)'));
}

// ======================================================================= words

const STATUS = {
  candidate: ['New', 'info'], needs_review: ['Needs review', 'warn'], matched: ['Exact match', 'info'], approved: ['Approved', 'ok'],
  rejected: ['Rejected', 'muted'], merged: ['Merged', 'muted'], published: ['Published', 'ok'],
  verified: ['Verified', 'ok'], inactive: ['Inactive', 'muted'], unverified: ['Not yet verified', 'warn'],
};
const MATCH = { EXACT_MATCH: 'Same as', LIKELY_MATCH: 'Likely the same as', POSSIBLE_MATCH: 'May be' };
const CONFIDENCE = { high: ['High', 'ok'], medium: ['Medium', 'info'], low: ['Low', 'warn'] };
const FIELD = {
  website: 'Website', sector: 'Sector', city: 'City', state: 'State', address: 'Address', description: 'Description', founders: 'Founders',
  founded_year: 'Founded year', investors: 'Investors', hiring_status: 'Hiring', stage: 'Stage', last_funding_round: 'Last round',
  last_funding_date: 'Last round date', funding_total: 'Funding total', abn: 'ABN', acn: 'ACN',
  name: 'Name', aliases: 'Other names', investor_type: 'Type', inclusion_basis: 'Why it is listed', headquarters_city: 'Headquarters', country: 'Country',
  other_offices: 'Other offices', stages: 'Stages', sectors: 'Sectors', geographies: 'Geographies', typical_cheque: 'Cheque size', typical_cheque_min: 'Cheque, from',
  typical_cheque_max: 'Cheque, to', cheque_currency: 'Cheque currency', lead_or_follow: 'Lead or follow', active_status: 'Investing', application_url: 'How to apply',
  jobs_url: 'Portfolio jobs board', investment_thesis: 'Investment thesis', verification_status: 'Status',
};
const KIND = {
  company_website: 'Company website', company_document: 'Company document', press: 'Press', investor_post: 'Investor post',
  accelerator_profile: 'Accelerator profile', directory_listing: 'Directory listing', aggregator: 'Aggregator', user_supplied: 'Supplied by a person',
  licensed_dataset: 'Licensed dataset', open_dataset: 'Open dataset', investor_website: 'Investor website', investor_document: 'Investor document',
};
const kindLabel = (k) => KIND[k] ?? (k ? String(k).replace(/_/g, ' ') : 'Source');
const fieldLabel = (f) => FIELD[f] ?? String(f).replace(/_/g, ' ');
const ACTION_LABEL = {
  'candidate.approve': 'Approved a candidate', 'candidate.reject': 'Rejected a candidate', 'candidate.reopen': 'Reopened a candidate',
  'candidate.edit': 'Edited a candidate', 'candidate.note': 'Noted a candidate', 'candidate.distinct': 'Settled “not a duplicate”',
  'candidate.merge': 'Merged into a company', 'candidate.publish': 'Published a company', 'candidate.enrich': 'Queued a candidate’s website',
  'company.rename': 'Renamed a company', 'conflict.resolve': 'Settled a conflict', 'suggestion.apply': 'Applied a suggestion',
  'suggestion.dismiss': 'Dismissed a suggestion', 'enrichment.seed': 'Seeded the queue', 'enrichment.enqueue': 'Queued a website',
  'enrichment.task': 'Read a website', 'enrichment.retry': 'Retried a task', 'enrichment.cancel': 'Cancelled a task',
  'enrichment.run': 'Ran the queue', 'import.run': 'Ran an import', 'import.dismiss': 'Acknowledged a failed import',
  'scheduler.run': 'A scheduled job found something',
  'location.set': 'Set where a company is', 'location.geocode': 'Looked an address up on the map', 'location.verify': 'Recorded where an address was found',
  'location.promote': 'Gave a company the address its own website states', 'location.normalize': 'Cleared a city centre that was not a company’s place',
  'investor.import': 'Imported an investor', 'investor.approve': 'Approved an investor', 'investor.reject': 'Rejected an investor', 'investor.reopen': 'Reopened an investor',
  'investor.edit': 'Edited an investor', 'investor.merge': 'Merged two investors', 'investor.publish': 'Published an investor', 'investor.unpublish': 'Took an investor off the site',
  'investor.inactive': 'Marked an investor as no longer investing', 'investor.resolve': 'Settled an investor conflict', 'investor.link': 'Linked an investor to a company',
  'investor.note': 'Sent an investor for review', 'investment.add': 'Recorded an investment', 'investment.reject': 'Turned down an investment',
  'person.approve': 'Approved a person', 'person.reject': 'Rejected a person', 'person.publish': 'Published a person', 'person.unpublish': 'Took a person off the site',
};
const PRECISION = { EXACT: ['Exact', 'ok'], SUBURB: ['Suburb', 'info'], CITY: ['City only', 'warn'], STATE: ['State only', 'warn'], UNKNOWN: ['Unknown', 'bad'] };
const LOCATION_SOURCE = {
  company_website: 'Company website', company_document: 'Company document', credible_profile: 'Credible profile', ecosystem_source: 'Ecosystem source',
  manual: 'Set by a person', directory_record: 'Directory record, no source',
};
const SEVERITY_TONE = { high: 'bad', medium: 'warn', low: 'muted' };
const SECTION_NOTE = 'Changes made here are written to the data files on this machine. They reach the public site when you commit and push them.';

function fmtValue(v) {
  if (v == null || v === '') return 'Unknown';
  if (Array.isArray(v)) return v.length ? v.join(', ') : 'Unknown';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
const unknown = () => h('span', { class: 'muted' }, 'Unknown');

function chip(text, tone = 'muted', plain = false) {
  return h('span', { class: `chip${tone === 'muted' ? '' : ` chip--${tone}`}${plain ? ' chip--plain' : ''}` }, text);
}
const statusChip = (status) => { const [label, tone] = STATUS[status] ?? [status, 'muted']; return chip(label, tone); };
const confidenceChip = (label) => { const [text, tone] = CONFIDENCE[label] ?? [label ?? 'Unknown', 'muted']; return chip(text, tone); };

function btn(label, { variant = '', small = false, icon: glyph = null, onClick, type = 'button', title, quiet = false, fk, attrs = {} } = {}) {
  const classes = ['btn', ...variant.split(' ').filter(Boolean).map((v) => `btn--${v}`), small && 'btn--sm', quiet && 'btn--quiet'].filter(Boolean).join(' ');
  return h('button', {
    type, class: classes, title: title ?? (quiet ? label : undefined), 'aria-label': quiet ? label : undefined, 'data-fk': fk, ...attrs,
    on: onClick ? { click: guard(onClick) } : undefined,
  }, glyph && icon(glyph, 14), quiet ? h('span', { class: 'btn__label' }, label) : label);
}

// A button that is working shows it (aria-busy) and ignores a second press; it stays focusable, so the keyboard keeps its place.
async function busy(button, work) {
  if (button?.getAttribute('aria-busy') === 'true') return undefined;
  button?.setAttribute('aria-busy', 'true');
  try { return await work(); } finally { button?.removeAttribute('aria-busy'); }
}

// A handler that fails shows the reason instead of dying quietly.
function guard(fn) {
  return async (event) => {
    const button = event?.currentTarget instanceof HTMLButtonElement ? event.currentTarget : null;
    try { await busy(button, () => fn(event)); } catch (err) { toast(err.message || 'That did not work.', { tone: 'bad' }); }
  };
}

// ======================================================================= state and the server

class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

const S = {
  token: null, me: null, signedOut: false, data: {}, drawer: null, poll: null, refreshedAt: null,
  ui: {
    filter: 'open', query: '', conflictField: 'all', conflictShown: 8, suggestionField: 'all', suggestionShown: 10,
    missingField: 'all', missingShown: 12, auditAction: '', auditTarget: '', auditLimit: 50, runMode: 'suggest',
    locationFilter: '', locationShown: 12,
    investorStatus: 'open', investorIssue: '', investorQuery: '', investorShown: 12, investorConflictShown: 6,
  },
};
const can = (permission) => S.me?.permissions?.includes(permission) ?? false;

const api = {
  async call(path, { method = 'GET', body } = {}) {
    let res;
    try {
      res = await fetch(path, {
        method, cache: 'no-store',
        headers: { ...(S.token ? { Authorization: `Bearer ${S.token}` } : {}), ...(method === 'GET' ? {} : { 'Content-Type': 'application/json' }) },
        body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
      });
    } catch {
      throw new ApiError('Could not reach the Command Center. Is `npm run admin` still running?', 0);
    }
    const data = await res.json().catch(() => null);
    if (res.status === 401 && path !== '/api/login') {
      signOut('Your session ended: sign in again.');
      throw new ApiError('Your session ended.', 401);
    }
    if (!res.ok) throw new ApiError(data?.error ?? `The server answered ${res.status}.`, res.status);
    return data;
  },
  get: (path) => api.call(path),
  post: (path, body) => api.call(path, { method: 'POST', body }),
};

const enc = encodeURIComponent;
const LOADERS = {
  overview: () => api.get('/api/overview'),
  candidates: () => api.get(`/api/candidates?status=${enc(S.ui.filter)}&q=${enc(S.ui.query)}&limit=200`),
  conflicts: () => api.get('/api/conflicts'),
  suggestions: () => api.get('/api/suggestions'),
  missing: () => api.get('/api/missing'),
  locations: () => api.get(`/api/locations?filter=${enc(S.ui.locationFilter)}&limit=500`),
  investors: () => api.get(`/api/investors?status=${enc(S.ui.investorStatus)}&issue=${enc(S.ui.investorIssue)}&q=${enc(S.ui.investorQuery)}&limit=500`),
  duplicates: () => api.get('/api/duplicates'),
  queue: () => api.get('/api/queue'),
  imports: () => api.get('/api/imports'),
  scheduler: () => api.get('/api/scheduler'),
  audit: () => api.get(`/api/audit?limit=${S.ui.auditLimit}&action=${enc(S.ui.auditAction)}&target=${enc(S.ui.auditTarget)}`),
  job: () => api.get('/api/job'),
};

async function load(name, { quiet = false } = {}) {
  const slot = (S.data[name] ??= { state: 'loading', value: null, error: null, seq: 0 });
  const seq = ++slot.seq;
  if (!quiet && slot.value == null) { slot.state = 'loading'; render(name); }
  try {
    const value = await LOADERS[name]();
    if (seq !== slot.seq) return;
    Object.assign(slot, { value, state: 'ready', error: null });
    if (name === 'overview') S.refreshedAt = Date.now();
  } catch (err) {
    if (seq !== slot.seq || err.status === 401) return;
    if (slot.value != null) toast(`Could not refresh ${name}: ${err.message}`, { tone: 'bad' });
    else Object.assign(slot, { state: 'error', error: err.message });
  }
  render(name);
}
const refresh = (...names) => Promise.all(names.map((name) => load(name, { quiet: true })));
const refreshAll = () => refresh('overview', 'candidates', 'conflicts', 'suggestions', 'missing', 'locations', 'investors', 'duplicates', 'queue', 'imports', 'scheduler', 'audit');
const slotOf = (name) => S.data[name]?.value ?? null;

// ======================================================================= the page frame

const SECTIONS = [
  { id: 'overview', nav: 'Overview', title: null },
  { id: 'discovered', nav: 'Discovered', title: 'New startups discovered', def: 'Companies discovery found that nobody has decided on yet. They are staging data: hidden from the public site until an admin publishes them.' },
  { id: 'quality', nav: 'Quality', title: 'Data quality', def: 'How much of the directory has each fact. A fact counts only when the record holds a real value, never “Unknown”.' },
  { id: 'locations', nav: 'Locations', title: 'Locations', def: 'How well the directory knows where each company is. A pin is drawn only for an exact office or a suburb; a company known only to its city is a group there, and one with no known place is listed but not drawn. Accuracy matters more than a full map.' },
  { id: 'investors', nav: 'Investors', title: 'Investors', def: 'The investor directory’s staging area. A record starts as a candidate and is checked against the pages that state each claim; only a person publishes it. Nothing here reaches the public site until then, and a stage, sector, location or cheque size no page backs is left blank, never guessed.' },
  { id: 'conflicts', nav: 'Conflicts', title: 'Conflicts', def: 'Two sources disagree, or a source disagrees with our record. Nothing is changed until a person says which one is right.' },
  { id: 'suggestions', nav: 'Suggestions', title: 'Suggested fills', def: 'Facts found on company websites that the record does not have yet. Applying one changes the record; dismissing one turns the evidence down for good.' },
  { id: 'queue', nav: 'Enrichment', title: 'Enrichment queue', def: 'Company websites waiting to be read, one at a time. Reading obeys robots.txt and each site’s terms, and never goes near LinkedIn.' },
  { id: 'imports', nav: 'Imports', title: 'Failed imports', def: 'Sources that failed the last time discovery ran, and enrichment tasks that failed. Acknowledge a failure once someone has looked.' },
  { id: 'scheduler', nav: 'Scheduler', title: 'Scheduled refresh', def: 'What keeps the directory current. Six jobs each look at their own kind of fact at their own pace, politely, and write down every run, including the ones that found nothing. This page only shows them.' },
  { id: 'audit', nav: 'Audit', title: 'Audit trail', def: 'Every action taken here, newest first, with who did it and why. Rows cannot be edited or deleted.' },
];

function buildShell() {
  document.title = 'Data Command Center';
  const app = $('#app');
  for (const [id, props] of [['live', { class: 'sr', role: 'status', 'aria-live': 'polite' }], ['toasts', { class: 'toasts', popover: 'manual' }]]) {
    if (!document.getElementById(id)) document.body.append(h('div', { id, ...props }));
  }
  app.replaceChildren(
    h('a', { class: 'skip', href: '#discovered', on: { click: (e) => { e.preventDefault(); goTo('discovered'); } } }, 'Skip to new startups'),
    topbar(),
    h('main', { class: 'page', id: 'main', tabindex: '-1' }, SECTIONS.map((s, i) => frame(s, i))),
  );
  observeSections();
}

function frame(s, index) {
  return h('section', { class: `band${index === 0 ? ' band--first' : ''}`, id: s.id, 'aria-labelledby': `h-${s.id}` },
    h('div', { class: 'band__head' },
      h('div', { class: 'band__titles' },
        h('h2', { class: s.title ? 'band__title' : 'sr', id: `h-${s.id}`, tabindex: '-1' }, s.title ?? 'Overview'),
        s.def && h('p', { class: 'band__def' }, s.def))),
    h('div', { id: `body-${s.id}` }));
}

function topbar() {
  return h('header', { class: 'topbar' },
    h('div', { class: 'topbar__row' },
      h('div', { class: 'brand' }, h('span', { class: 'brand__name' }, 'Data Command Center'), h('span', { class: 'brand__sub' }, 'AU Startup Map')),
      h('nav', { class: 'nav', id: 'nav', 'aria-label': 'Sections' }, SECTIONS.map((s) => h('a', { href: `#${s.id}`, 'data-section': s.id, on: { click: (e) => { e.preventDefault(); goTo(s.id); } } }, s.nav, h('span', { class: 'nav__count', hidden: true })))),
      h('div', { class: 'who' },
        h('span', { class: 'chip chip--plain', title: 'This page is served from your own computer and nowhere else' }, icon('lock', 12), h('span', { class: 'wide-only' }, 'This machine only')),
        h('span', { class: 'who__name' }, S.me.name), chip(S.me.role, 'muted', true),
        btn('Refresh', { variant: 'ghost', small: true, quiet: true, icon: 'refresh', onClick: async () => { await refreshAll(); toast('Refreshed.'); } }),
        themeButton(),
        btn('Sign out', { variant: 'ghost', small: true, quiet: true, icon: 'signout', onClick: () => signOut() }))));
}

const THEMES = ['auto', 'light', 'dark'];
function applyTheme(value) {
  const root = document.documentElement;
  if (value === 'light' || value === 'dark') root.dataset.theme = value; else delete root.dataset.theme;
}
function themeButton() {
  const button = btn('', { variant: 'ghost', small: true });
  const paint = () => {
    const current = THEMES.includes(prefs.get(THEME_KEY)) ? prefs.get(THEME_KEY) : 'auto';
    const next = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length];
    button.replaceChildren(icon(current === 'light' ? 'sun' : current === 'dark' ? 'moon' : 'contrast', 14), h('span', { class: 'btn__label' }, `Theme: ${current}`));
    button.classList.add('btn--quiet');
    button.setAttribute('aria-label', `Theme: ${current}. Switch to ${next}.`);
    button.title = `Theme: ${current}. Click for ${next}.`;
  };
  button.addEventListener('click', () => {
    const current = THEMES.includes(prefs.get(THEME_KEY)) ? prefs.get(THEME_KEY) : 'auto';
    const next = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length];
    prefs.set(THEME_KEY, next); applyTheme(next); paint(); announce(`Theme: ${next}.`);
  });
  paint();
  return button;
}

function goTo(id) {
  const target = document.getElementById(id);
  if (!target) return;
  target.scrollIntoView();
  try { history.replaceState(null, '', `#${id}`); } catch { /* a locked-down browser: the page still moved */ }
  document.getElementById(`h-${id}`)?.focus({ preventScroll: true });
}

function observeSections() {
  if (!('IntersectionObserver' in window)) return;
  const links = new Map([...document.querySelectorAll('#nav a')].map((a) => [a.dataset.section, a]));
  const seen = new Map();
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) seen.set(e.target.id, e.isIntersecting ? e.boundingClientRect.top : null);
    const current = [...seen].filter(([, top]) => top != null).sort((a, b) => Math.abs(a[1]) - Math.abs(b[1]))[0]?.[0];
    for (const [id, a] of links) { if (id === current) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); }
  }, { rootMargin: '-96px 0px -55% 0px', threshold: 0 });
  for (const s of SECTIONS) { const el = document.getElementById(s.id); if (el) io.observe(el); }
}

function renderNav() {
  const overview = slotOf('overview');
  const candidates = slotOf('candidates');
  const counts = {
    discovered: [candidates?.counts?.needs_review ?? overview?.tiles.needs_review, true],
    conflicts: [overview?.attention.open_conflicts, true],
    locations: [overview?.locations?.attention, true],
    investors: [overview?.investors?.by_status?.needs_review, true],
    suggestions: [overview?.attention.suggestions, false],
    imports: [overview?.tiles.failed_imports, true],
    scheduler: [slotOf('scheduler')?.watch?.length, true],
  };
  for (const a of document.querySelectorAll('#nav a')) {
    const badge = a.querySelector('.nav__count');
    const [value, attn] = counts[a.dataset.section] ?? [];
    if (!badge) continue;
    badge.hidden = value == null || value === 0;
    badge.textContent = value == null ? '' : n(value);
    badge.classList.toggle('nav__count--attn', Boolean(attn));
  }
}

// ---------- messages ----------

function announce(message) {
  const live = $('#live');
  if (!live) return;
  live.textContent = '';
  setTimeout(() => { live.textContent = message; }, 40);
}

function toast(message, { tone = 'ok' } = {}) {
  announce(message);
  const host = $('#toasts');
  if (!host) return;
  const item = h('div', { class: `toast${tone === 'bad' ? ' toast--bad' : ''}` },
    h('span', { class: 'toast__msg' }, message),
    h('button', { type: 'button', class: 'toast__x', 'aria-label': 'Dismiss', on: { click: () => close() } }, icon('x', 14)));
  const close = () => { item.remove(); if (!host.children.length && host.matches(':popover-open')) host.hidePopover(); };
  host.append(item);
  // In the top layer, so a message shows above an open dialog or drawer instead of behind its backdrop.
  if (typeof host.showPopover === 'function') { try { if (host.matches(':popover-open')) host.hidePopover(); host.showPopover(); } catch { /* shown in place */ } }
  setTimeout(close, tone === 'bad' ? 12000 : 5000);
}

// ---------- states ----------

function skeletonRows(count = 4) {
  return h('div', { class: 'skel-rows', 'aria-hidden': 'true' }, Array.from({ length: count }, (_, i) => { const el = h('span', { class: 'skel' }); el.style.width = `${[92, 78, 86, 64, 80][i % 5]}%`; return el; }));
}
function errorBox(message, retry) {
  return h('div', { class: 'errorbox', role: 'alert' }, h('p', {}, message), retry && btn('Try again', { small: true, onClick: retry }));
}
function emptyBox(title, ...text) {
  return h('div', { class: 'empty' }, h('p', { class: 'empty__title' }, title), text.length > 0 && h('p', { class: 'empty__text' }, ...text));
}
function view(name, ready, { skeleton = () => skeletonRows(4) } = {}) {
  const slot = S.data[name];
  if (!slot || slot.state === 'loading') return skeleton();
  if (slot.state === 'error') return errorBox(slot.error, () => load(name));
  return ready(slot.value);
}

// Re-drawing a region must not throw the keyboard away: the focused control is found again by its key.
function keepFocus(container, build) {
  const active = document.activeElement;
  const inside = Boolean(active) && active !== document.body && container.contains(active);
  const key = inside ? active.dataset.fk : null;
  const caret = inside && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
  build();
  if (!inside) return;
  const next = key ? [...container.querySelectorAll('[data-fk]')].find((el) => el.dataset.fk === key) : null;
  if (next) {
    next.focus({ preventScroll: true });
    if (caret && typeof next.setSelectionRange === 'function') { try { next.setSelectionRange(...caret); } catch { /* not a text field */ } }
  } else container.closest('section')?.querySelector('h2')?.focus({ preventScroll: true });
}
function restoreFocus(key, sectionId) {
  const target = key ? [...document.querySelectorAll('[data-fk]')].find((el) => el.dataset.fk === key) : null;
  (target ?? document.getElementById(`h-${sectionId}`))?.focus({ preventScroll: true });
}

function grid({ caption, columns, rows, stack = true, wide = false }) {
  return h('div', { class: 'tablewrap' },
    h('table', { class: `grid${stack ? ' grid--stack' : ''}${wide ? ' grid--wide' : ''}`, role: 'table' },
      h('caption', { class: 'sr' }, caption),
      h('thead', { role: 'rowgroup' }, h('tr', { role: 'row' }, columns.map((c) => h('th', { scope: 'col', role: 'columnheader', class: c.cls }, c.label)))),
      h('tbody', { role: 'rowgroup' }, rows.map((cells) => h('tr', { role: 'row' }, cells.map((cell, j) => h('td', { role: 'cell', class: [columns[j].cls, j === 0 ? 'cell-first' : ''].filter(Boolean).join(' '), 'data-label': columns[j].label }, cell)))))));
}

function seg(items, current, onPick, label, keyPrefix) {
  return h('div', { class: 'seg', role: 'group', 'aria-label': label },
    items.map(({ key, text, count }) => h('button', { type: 'button', 'aria-pressed': String(key === current), 'data-fk': `${keyPrefix}:${key}`, on: { click: () => onPick(key) } }, text, count != null && h('span', { class: 'n' }, n(count)))));
}

function pager(shown, total, onMore, what) {
  if (shown >= total) return total > 0 ? h('p', { class: 'pager' }, `Showing all ${n(total)}.`) : null;
  return h('div', { class: 'pager' }, h('span', {}, `Showing ${n(shown)} of ${n(total)}.`), btn(`Show ${Math.min(10, total - shown)} more`, { small: true, onClick: onMore, fk: `more:${what}` }));
}

// ======================================================================= dialogs and fields

let uidCounter = 0;
const uid = (prefix = 'f') => `${prefix}-${++uidCounter}`;

function modal({ title, lead, body, submitLabel = 'Save', tone = 'primary', size = 'md', onSubmit, cancelLabel = 'Cancel' }) {
  const opener = document.activeElement;
  const fk = opener?.dataset?.fk ?? null;
  const section = opener?.closest?.('section[id]')?.id ?? S.drawer?.section ?? 'discovered';
  const titleId = uid('dlg');
  const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const submit = h('button', { type: 'submit', class: `btn ${tone === 'danger' ? 'btn--danger-solid' : 'btn--primary'}` }, submitLabel);
  const form = h('form', { class: 'dlg__form', novalidate: true },
    h('header', { class: 'dlg__head' }, h('h2', { class: 'dlg__title', id: titleId }, title), lead && h('p', { class: 'dlg__lead' }, lead)),
    h('div', { class: 'dlg__body' }, body, error),
    h('footer', { class: 'dlg__foot' }, h('button', { type: 'button', class: 'btn', on: { click: () => dlg.close() } }, cancelLabel), submit));
  const dlg = h('dialog', { class: `dlg${size === 'lg' ? ' dlg--lg' : ''}`, 'aria-labelledby': titleId }, form);
  let pressedOnBackdrop = false;
  dlg.addEventListener('mousedown', (e) => { pressedOnBackdrop = e.target === dlg; });
  dlg.addEventListener('click', (e) => { if (e.target === dlg && pressedOnBackdrop) dlg.close(); });
  dlg.addEventListener('close', () => { dlg.remove(); restoreFocus(fk, section); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submit.getAttribute('aria-busy') === 'true') return;
    error.hidden = true;
    submit.setAttribute('aria-busy', 'true');
    try { await onSubmit(); dlg.close(); } catch (err) { error.textContent = err.message || 'That did not work.'; error.hidden = false; error.scrollIntoView({ block: 'nearest' }); }
    finally { submit.removeAttribute('aria-busy'); }
  });
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

function fieldOf(label, control, { hint, optional = false } = {}) {
  const id = control.id || (control.id = uid());
  const hintId = hint ? `${id}-hint` : null;
  if (hintId) control.setAttribute('aria-describedby', hintId);
  return h('div', { class: 'field' },
    h('label', { class: 'field__label', for: id }, label, optional && h('span', { class: 'field__opt' }, ' (optional)')),
    control, hint && h('p', { class: 'field__hint', id: hintId }, hint));
}
const textInput = (props = {}) => h('input', { class: 'input', type: 'text', autocomplete: 'off', ...props });
const textArea = ({ value = '', rows = 3, ...props } = {}) => h('textarea', { class: 'textarea', rows, ...props }, value);
const selectInput = (options, value = '') => h('select', { class: 'select' }, options.map(([v, text]) => h('option', { value: v, selected: v === value }, text)));
const rowOf = (...fields) => h('div', { class: 'row' }, fields);
const callout = (...kids) => h('p', { class: 'callout' }, ...kids);

function choice({ name, value, title, text, checked = false, disabled = false, onChange, nested }) {
  const input = h('input', { type: 'radio', name, value, checked, disabled, on: onChange ? { change: onChange } : undefined });
  const node = h('label', { class: 'choice' }, input, h('span', { class: 'choice__body' }, h('span', { class: 'choice__title' }, title), text != null && h('span', { class: 'choice__text' }, text), nested));
  return { node, input };
}

function needReason(textarea, what = 'Say why, in a few words.') {
  const reason = norm(textarea.value);
  if (reason.length < 3) { textarea.setAttribute('aria-invalid', 'true'); textarea.focus(); throw new Error(what); }
  textarea.removeAttribute('aria-invalid');
  return reason;
}

// How exactly a place is known. Only the first two are a point; a city or a state is a group, never a pin.
const PRECISION_CHOICES = [
  ['EXACT', 'Exact office', 'The office address, and the point on the map where it is.'],
  ['SUBURB', 'Suburb only', 'The suburb is known, not the office. The pin is drawn as approximate.'],
  ['CITY', 'City only', 'No pin: the company is listed in a group at its city.'],
  ['STATE', 'State only', 'No pin: the company is listed in a group at its state.'],
  ['UNKNOWN', 'Not known', 'Takes the company off the map. It stays in the list and the search.'],
];
const QUALITY_WORDS = { house: 'the building', street: 'only the street', suburb: 'the suburb', city: 'only the city', region: 'only a region' };

// What the geocoder answered, in a few lines a person can judge. `onUse` fills the coordinates in.
function lookupAnswer(r, onUse) {
  if (r.status === 'error') return [h('p', {}, `Could not ask the geocoder: ${r.error ?? 'it did not answer'}.`), h('p', { class: 'sub' }, 'Read the coordinates off a map instead, or try again in a moment.')];
  if (r.status === 'none' || !r.found) return [h('p', {}, 'The geocoder knows nothing of that address.'), h('p', { class: 'sub' }, 'Check how it is written, or read the coordinates off a map.')];
  const where = `${r.found.lat.toFixed(5)}, ${r.found.lng.toFixed(5)}`;
  const verdict = {
    place: 'Nothing is on file to compare it with: this would put the company here.', agrees: 'This is where the record already puts it.',
    confirm: `This is ${n(r.away)} m from the point on file: the same place.`, conflict: `The geocoder disagrees: ${r.reason}.`, skip: `${r.reason ?? 'It does not settle the question'}.`,
  }[r.verdict] ?? '';
  const usable = ['place', 'agrees', 'confirm'].includes(r.verdict) || (r.verdict === 'conflict' && r.found);
  return [
    h('p', {}, h('b', { class: 'num' }, where), ` — found ${QUALITY_WORDS[r.quality] ?? 'a place'}${r.from_cache ? ', from an earlier look-up' : ''}`),
    r.found.display_name && h('p', { class: 'sub' }, clip(r.found.display_name, 170)),
    h('p', { class: r.verdict === 'conflict' ? 'lookup__warn' : '' }, verdict),
    usable && btn('Use these coordinates', { small: true, onClick: () => onUse(r.found) }),
  ];
}

// A place on the map. Nothing here is guessed: how exactly it is known decides what is asked for and what is kept, a
// point is a latitude and a longitude (read off a map, or from the geocoder with "Find on the map"), and a city or a
// state alone has none. read() returns what the API takes; `companyId` lets the look-up compare with the point on file.
function locationFields(init = {}, { companyId = null, allowUnknown = false } = {}) {
  const hasPoint = init.lat != null && init.lat !== '' && init.lng != null && init.lng !== '';
  const first = init.precision ?? (hasPoint ? (init.address ? 'EXACT' : 'SUBURB') : init.address ? 'EXACT' : init.city ? 'CITY' : 'STATE');
  const precision = selectInput(PRECISION_CHOICES.filter(([k]) => allowUnknown || k !== 'UNKNOWN').map(([k, label]) => [k, label]), first);
  const note = h('p', { class: 'field__hint' });
  const city = textInput({ value: init.city ?? '', maxlength: 80 });
  const state = selectInput([['', 'No state'], ...AU_STATES.map((s) => [s, s])], init.state ?? '');
  const address = textInput({ value: init.address ?? '', maxlength: 200 });
  const suburb = textInput({ value: init.suburb ?? '', maxlength: 80 });
  const postcode = textInput({ value: init.postcode ?? '', maxlength: 4, inputmode: 'numeric' });
  const lat = textInput({ inputmode: 'decimal', placeholder: 'e.g. -33.8688', value: hasPoint ? init.lat : '' });
  const lng = textInput({ inputmode: 'decimal', placeholder: 'e.g. 151.2093', value: hasPoint ? init.lng : '' });
  const answer = h('div', { class: 'lookup', hidden: true, role: 'status' });
  const groups = {
    city: rowOf(fieldOf('City', city), fieldOf('State', state, { optional: true })),
    address: fieldOf('Address', address, { optional: true }),
    suburb: rowOf(fieldOf('Suburb', suburb, { optional: true }), fieldOf('Postcode', postcode, { optional: true })),
    point: h('div', {},
      rowOf(fieldOf('Latitude', lat), fieldOf('Longitude', lng)),
      h('p', { class: 'toolbar' }, btn('Find on the map', { small: true, variant: 'primary', onClick: lookup, fk: 'loc:find' }),
        h('span', { class: 'field__hint' }, 'Asks OpenStreetMap, one question a second, and keeps the answer. Or read the coordinates off a map yourself; they must be inside Australia.')),
      answer),
  };
  const sync = () => {
    const p = precision.value;
    const point = p === 'EXACT' || p === 'SUBURB';
    groups.city.hidden = p === 'UNKNOWN';
    city.closest('.field').hidden = p === 'STATE'; // a state alone has no city to ask for, but still needs its state
    for (const key of ['address', 'suburb', 'point']) groups[key].hidden = !point;
    note.textContent = PRECISION_CHOICES.find(([k]) => k === p)?.[2] ?? '';
  };
  async function lookup() {
    answer.hidden = false;
    answer.replaceChildren(h('p', { class: 'sub' }, 'Asking the geocoder…'));
    try {
      const r = await api.post('/api/locations/lookup', {
        company_id: companyId ?? undefined, precision: precision.value, address: norm(address.value) || undefined, suburb: norm(suburb.value) || undefined,
        city: norm(city.value) || undefined, state: state.value || undefined, postcode: norm(postcode.value) || undefined,
      });
      answer.replaceChildren(...lookupAnswer(r, (found) => { lat.value = String(found.lat); lng.value = String(found.lng); toast('Coordinates filled in. Check them, then save.'); }).filter(Boolean));
    } catch (err) { answer.replaceChildren(h('p', { class: 'lookup__warn' }, err.message || 'The look-up did not work.')); }
  }
  precision.addEventListener('change', sync);
  sync();
  const query = init.address || (init.city ? [init.city, init.state, 'Australia'].filter(Boolean).join(' ') : '');
  return {
    node: h('div', {},
      fieldOf('How exactly is it known?', precision), note,
      groups.city, groups.address, groups.suburb, groups.point,
      query && h('p', { class: 'field__hint' }, extLink(`https://www.openstreetmap.org/search?query=${enc(query)}`, 'See it on OpenStreetMap'))),
    read() {
      const p = precision.value;
      if (p === 'UNKNOWN') return { precision: p };
      const out = { precision: p };
      if (p !== 'STATE') { out.city = norm(city.value); if (!out.city) { city.focus(); throw new Error('Say which city.'); } }
      if (state.value) out.state = state.value; else if (p === 'STATE') { state.focus(); throw new Error('Say which state.'); }
      if (p === 'EXACT' || p === 'SUBURB') {
        out.address = norm(address.value) || undefined;
        out.suburb = norm(suburb.value) || undefined;
        out.postcode = norm(postcode.value) || undefined;
        if (p === 'EXACT' && !out.address) { address.focus(); throw new Error('An exact office needs its address.'); }
        if (p === 'SUBURB' && !out.suburb) { suburb.focus(); throw new Error('A suburb-level place needs the suburb.'); }
        const la = Number(lat.value);
        const lo = Number(lng.value);
        if (!lat.value.trim() || !lng.value.trim() || !Number.isFinite(la) || !Number.isFinite(lo)) { lat.focus(); throw new Error('A pin needs a latitude and a longitude: use “Find on the map”, or read them off a map.'); }
        out.lat = la; out.lng = lo;
      }
      return out;
    },
  };
}

// ======================================================================= the eight counts

const TILES = [
  { key: 'total_companies', label: 'Total companies', note: () => 'in the directory', to: 'quality' },
  { key: 'published', label: 'Published', note: (o) => `${n(o.detail.published.on_map)} pins · ${n(o.detail.published.city_level)} city-level · ${n(o.detail.published.unconfirmed)} unconfirmed`, to: 'locations' },
  { key: 'new_candidates', label: 'New candidates', note: (o) => `found in the last 7 days · ${n(o.detail.new_candidates.open_in_total)} open in all`, to: 'discovered', filter: 'new' },
  { key: 'needs_review', label: 'Needs review', note: () => 'waiting for a person to decide', to: 'discovered', filter: 'needs_review', flag: 'warn' },
  { key: 'potential_duplicates', label: 'Potential duplicates', note: (o) => `${plural(o.detail.potential_duplicates.candidates, 'candidate')} · ${plural(o.detail.potential_duplicates.company_pairs, 'company pair')}`, to: 'discovered', filter: 'duplicates', flag: 'warn' },
  { key: 'updated_this_week', label: 'Updated this week', note: () => 'companies edited or re-verified in 7 days', to: 'audit' },
  { key: 'missing_data', label: 'Missing data', note: () => 'lack a website, sector, location, stage or description', to: 'quality' },
  { key: 'failed_imports', label: 'Failed imports', note: (o) => `${plural(o.detail.failed_imports.sources, 'source')} · ${plural(o.detail.failed_imports.enrichment_tasks, 'enrichment task')}`, to: 'imports', flag: 'bad' },
];

function renderTiles() {
  const body = $('#body-overview');
  if (!body) return;
  body.replaceChildren(view('overview', (o) => h('div', {},
    h('div', { class: 'tiles' }, TILES.map((t) => {
      const value = o.tiles[t.key];
      const flagged = t.flag && value > 0;
      return h('a', { class: 'tile', href: `#${t.to}`, on: { click: (e) => { e.preventDefault(); if (t.filter) setFilter(t.filter); goTo(t.to); } } },
        h('span', { class: 'tile__label' }, flagged && h('span', { class: `tile__dot${t.flag === 'bad' ? ' tile__dot--bad' : ''}`, 'aria-hidden': 'true' }), t.label, flagged && h('span', { class: 'sr' }, ' (needs attention)')),
        h('span', { class: 'tile__main' }, h('span', { class: 'tile__value' }, n(value)), h('span', { class: 'tile__note' }, t.note(o))));
    })),
    h('p', { class: 'stamp' }, `Updated ${fmtTime(new Date(S.refreshedAt ?? Date.now()).toISOString())}. ${SECTION_NOTE}`)),
  { skeleton: () => h('div', { class: 'tiles', 'aria-hidden': 'true' }, TILES.map(() => h('div', { class: 'tile' }, h('span', { class: 'skel' }), h('span', { class: 'skel' })))) }));
  const waiting = slotOf('overview')?.tiles.needs_review;
  document.title = waiting ? `(${waiting}) Data Command Center` : 'Data Command Center';
}

// ======================================================================= new startups discovered

const FILTERS = [['open', 'Open'], ['new', 'New this week'], ['needs_review', 'Needs review'], ['duplicates', 'Possible duplicates'], ['all', 'All']];

function setFilter(key) {
  S.ui.filter = key;
  load('candidates', { quiet: true });
  paintDiscoveredToolbar();
}

function discoveredFrame(body) {
  const search = textInput({ type: 'search', id: 'cand-q', placeholder: 'Search name or website', 'aria-label': 'Search new startups by name or website', value: S.ui.query, 'data-fk': 'search:cand' });
  search.addEventListener('input', debounce(() => { S.ui.query = search.value; load('candidates', { quiet: true }); }, 250));
  body.append(
    h('div', { class: 'toolbar' },
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Show', id: 'cand-seg' }, FILTERS.map(([key, text]) => h('button', { type: 'button', 'data-filter': key, 'data-fk': `cand-filter:${key}`, 'aria-pressed': 'false', on: { click: () => setFilter(key) } }, text, h('span', { class: 'n' })))),
      h('div', { class: 'search' }, icon('search', 16), search),
      h('p', { class: 'toolbar__note', id: 'cand-note' })),
    h('div', { id: 'discovered-results' }));
}

function paintDiscoveredToolbar() {
  const counts = slotOf('candidates')?.counts ?? {};
  for (const button of document.querySelectorAll('#cand-seg button')) {
    button.setAttribute('aria-pressed', String(button.dataset.filter === S.ui.filter));
    button.querySelector('.n').textContent = counts[button.dataset.filter] != null ? n(counts[button.dataset.filter]) : '';
  }
  const data = slotOf('candidates');
  const note = $('#cand-note');
  if (note) note.textContent = data ? `${n(data.results.length)} shown${data.total > data.results.length ? ` of ${n(data.total)}` : ''}` : '';
}

function renderDiscovered() {
  const body = $('#body-discovered');
  if (!body) return;
  if (!body.firstChild) discoveredFrame(body);
  paintDiscoveredToolbar();
  const results = $('#discovered-results');
  keepFocus(results, () => results.replaceChildren(view('candidates', (data) => (data.results.length ? candidatesTable(data.results) : emptyCandidates()))));
}

function emptyCandidates() {
  if (S.ui.query) return emptyBox(`No candidate matches “${S.ui.query}”.`, 'Search covers names, aliases and websites. Try fewer letters, or choose All.');
  if (S.ui.filter === 'all') return emptyBox('No candidates yet.', 'Discovery stages what it finds here. Run ', h('code', {}, 'npm run discovery -- run'), ' in ', h('code', {}, 'backend/'), ' to read the configured sources.');
  return emptyBox('Nothing is waiting here.', 'New companies appear when discovery finds them. They stay staging data until an admin publishes them. Choose All to see decided ones.');
}

const ACTION_ORDER = ['distinct', 'approve', 'reject', 'edit', 'merge', 'publish', 'reopen', 'enrich'];
const ACTIONS = {
  approve: { label: 'Approve', perm: 'candidate.approve', run: (row) => approveDialog(row) },
  reject: { label: 'Reject', perm: 'candidate.reject', run: (row) => rejectDialog(row) },
  edit: { label: 'Edit', perm: 'candidate.edit', run: (row) => editDialog(row) },
  merge: { label: 'Merge', perm: 'candidate.merge', run: (row) => mergeDialog(row) },
  publish: { label: 'Publish', perm: 'candidate.publish', run: (row) => publishDialog(row) },
  distinct: { label: 'Not a duplicate', perm: 'candidate.distinct', run: (row) => distinctDialog(row) },
  reopen: { label: 'Reopen', perm: 'candidate.reopen', run: (row) => reopenCandidate(row) },
  enrich: { label: 'Read website', perm: 'enrichment.enqueue', run: (row) => enrichCandidate(row) },
};

function actionButtons(row, { drawer = false } = {}) {
  const wanted = ACTION_ORDER.filter((a) => row.actions.includes(a) && can(ACTIONS[a].perm) && (a !== 'enrich' || row.website));
  const primary = wanted.find((a) => a === 'approve' || a === 'publish');
  return wanted.map((a) => btn(ACTIONS[a].label, {
    small: !drawer, variant: a === primary ? 'primary' : '', fk: `cand:${row.id}:${a}${drawer ? ':d' : ''}`,
    attrs: { 'aria-label': `${ACTIONS[a].label} ${row.name}` }, onClick: () => ACTIONS[a].run(row),
  }));
}

function sourceCell(row) {
  const { source } = row;
  const label = source.title || source.id || 'Unknown source';
  const where = [kindLabel(source.kind), source.id].filter(Boolean).join(' · ');
  return h('div', { class: 'cell-source' },
    safeHref(source.url) ? h('a', { class: 'ext clamp2', href: safeHref(source.url), target: '_blank', rel: 'noopener noreferrer', title: label }, label, h('span', { class: 'sr' }, ' (opens in a new tab)')) : h('span', { class: 'clamp2' }, label),
    h('div', { class: 'sub' }, where, source.count > 1 ? ` · +${source.count - 1} more` : ''));
}

function candidatesTable(rows) {
  return grid({
    caption: 'New startups discovered',
    columns: [{ label: 'Company' }, { label: 'Source' }, { label: 'Location' }, { label: 'Sector' }, { label: 'Confidence' }, { label: 'Date discovered', cls: 'nowrap' }, { label: 'Actions', cls: 'cell-actions' }],
    wide: true,
    rows: rows.map((r) => [
      h('div', { class: 'company' },
        h('button', { type: 'button', class: 'linkbtn', 'data-fk': `cand:${r.id}:open`, on: { click: guard(() => openCandidate(r.id)) } }, r.name),
        r.website && h('div', { class: 'sub' }, extLink(r.website, hostOf(r.website))),
        h('div', { class: 'chips' }, statusChip(r.status), r.match && chip(`${MATCH[r.match.outcome] ?? 'May be'} ${r.match.name}`, 'warn'))),
      sourceCell(r),
      r.location && r.location !== '(unknown)' ? r.location : unknown(),
      r.sector ?? unknown(),
      r.confidence ? h('div', { class: 'conf' }, confidenceChip(r.confidence.label), h('span', { class: 'num sub' }, `${Math.round(r.confidence.score * 100)}%`)) : h('span', { class: 'muted' }, 'Not scored'),
      h('div', {}, h('time', { datetime: r.discovered_at }, fmtDate(r.discovered_at)), h('div', { class: 'sub' }, relative(r.discovered_at))),
      h('div', { class: 'actions' }, btn('Review', { small: true, variant: 'ghost', fk: `cand:${r.id}:review`, attrs: { 'aria-label': `Review ${r.name}` }, onClick: () => openCandidate(r.id) }), actionButtons(r)),
    ]),
  });
}

async function afterCandidateChange(id) {
  await refreshAll();
  if (S.drawer?.id === id) await S.drawer.reload();
}

function approveDialog(row) {
  const note = textArea({ rows: 2, maxlength: 500 });
  modal({
    title: `Approve ${row.name}?`,
    body: [
      callout(h('b', {}, 'Approving does not publish. '), 'It stays staging data, hidden from the public site, until an admin publishes it. Its website is queued to be read for evidence.'),
      fieldOf('Note', note, { optional: true, hint: 'Kept with your name in the audit trail.' }),
    ],
    submitLabel: 'Approve',
    onSubmit: async () => {
      const r = await api.post(`/api/candidates/${row.id}/approve`, { note: note.value });
      toast(`Approved ${row.name}.${r.website_queued ? ' Its website is queued for reading.' : ''}`);
      await afterCandidateChange(row.id);
    },
  });
}

function rejectDialog(row) {
  const reason = textArea({ rows: 3, maxlength: 500, placeholder: 'For example: a hobby project, not a company.' });
  modal({
    title: `Reject ${row.name}?`,
    body: [
      callout('It is kept, with your reason, so discovery does not propose it again. You can reopen it later.'),
      fieldOf('Why', reason, { hint: 'Required. Kept with your name in the audit trail.' }),
    ],
    submitLabel: 'Reject', tone: 'danger',
    onSubmit: async () => {
      await api.post(`/api/candidates/${row.id}/reject`, { reason: needReason(reason) });
      toast(`Rejected ${row.name}.`);
      await afterCandidateChange(row.id);
    },
  });
}

async function reopenCandidate(row) {
  await api.post(`/api/candidates/${row.id}/reopen`, {});
  toast(`Reopened ${row.name} for review.`);
  await afterCandidateChange(row.id);
}

async function enrichCandidate(row) {
  const r = await api.post(`/api/candidates/${row.id}/enrich`, {});
  toast(r.created ? `Queued ${row.name} to have its website read.` : `${row.name} was already waiting; moved up.`);
  await refresh('queue', 'audit');
}

const evidenceValue = (d, field) => d.evidence.filter((e) => e.field === field && e.source?.kind === 'user_supplied').at(-1)?.value ?? null;

async function editDialog(row) {
  const d = await api.get(`/api/candidates/${row.id}`);
  const vocab = slotOf('overview')?.vocab ?? { sectors: [], stages: [] };
  const sectorList = uid('sectors');
  const stageList = uid('stages');
  const initial = { sector: evidenceValue(d, 'sector') ?? '', stage: evidenceValue(d, 'stage') ?? '' };
  const f = {
    name: textInput({ value: d.name, maxlength: 80 }),
    website: textInput({ value: d.website ?? '', placeholder: 'https://…' }),
    city: textInput({ value: d.city ?? '', maxlength: 80 }),
    state: selectInput([['', 'No state'], ...AU_STATES.map((s) => [s, s])], d.state ?? ''),
    address: textInput({ value: d.address ?? '', maxlength: 200 }),
    description: textArea({ value: d.description ?? '', rows: 3, maxlength: 500 }),
    sector: textInput({ value: initial.sector, list: sectorList }),
    stage: textInput({ value: initial.stage, list: stageList }),
    founders: textArea({ value: d.founders.join('\n'), rows: 2 }),
    aliases: textArea({ value: d.aliases.join('\n'), rows: 2 }),
    reason: textArea({ rows: 2, maxlength: 500 }),
  };
  const keepOld = h('input', { type: 'checkbox', id: uid('keep'), checked: true });
  const keepRow = h('div', { class: 'check', hidden: true }, keepOld, h('label', { for: keepOld.id }, 'Keep the old name as an alias. Untick it only if the old name was simply wrong.'));
  f.name.addEventListener('input', () => { keepRow.hidden = norm(f.name.value) === d.name; });
  modal({
    title: `Edit ${d.name}`, size: 'lg',
    lead: 'A correction to what discovery found. Sector and stage are recorded as your own call, at medium confidence.',
    body: [
      h('datalist', { id: sectorList }, vocab.sectors.map((s) => h('option', { value: s }))),
      h('datalist', { id: stageList }, vocab.stages.map((s) => h('option', { value: s }))),
      fieldOf('Name', f.name), keepRow,
      h('div', { class: 'block' }, fieldOf('Website', f.website, { hint: 'The company’s own site. Leave empty to remove it.' })),
      rowOf(fieldOf('City', f.city), fieldOf('State', f.state)),
      fieldOf('Address', f.address),
      fieldOf('Description', f.description),
      rowOf(fieldOf('Sector', f.sector, { hint: 'Pick one the directory already uses.' }), fieldOf('Stage', f.stage)),
      rowOf(fieldOf('Founders', f.founders, { hint: 'One per line, first and last name.' }), fieldOf('Other names', f.aliases, { hint: 'One per line.' })),
      fieldOf('Why', f.reason, { optional: true }),
    ],
    submitLabel: 'Save changes',
    onSubmit: async () => {
      const patch = {};
      const text = (key, current) => { if (norm(f[key].value) !== norm(current)) patch[key] = norm(f[key].value); };
      text('name', d.name); text('website', d.website); text('city', d.city); text('address', d.address); text('description', d.description);
      if (f.state.value !== (d.state ?? '')) patch.state = f.state.value || null;
      if (norm(f.sector.value) !== norm(initial.sector)) patch.sector = norm(f.sector.value) || null;
      if (norm(f.stage.value) !== norm(initial.stage)) patch.stage = norm(f.stage.value) || null;
      if (JSON.stringify(lines(f.founders.value)) !== JSON.stringify(d.founders)) patch.founders = lines(f.founders.value);
      if (JSON.stringify(lines(f.aliases.value)) !== JSON.stringify(d.aliases)) patch.aliases = lines(f.aliases.value);
      if (!Object.keys(patch).length) throw new Error('Nothing was changed.');
      const r = await api.post(`/api/candidates/${row.id}/edit`, { patch, keepOldName: keepOld.checked, reason: norm(f.reason.value) });
      toast(`Saved ${Object.keys(patch).join(', ')}.${r.status !== d.status ? ` It is now “${(STATUS[r.status] ?? [r.status])[0]}”.` : ''}`);
      await afterCandidateChange(row.id);
    },
  });
}

function mergeDialog(row) {
  let chosen = row.match?.kind === 'company' ? { id: row.match.id, name: row.match.name } : null;
  const q = textInput({ type: 'search', placeholder: 'Search companies by name or website', value: chosen?.name ?? '' });
  const list = h('div', { role: 'radiogroup', 'aria-label': 'Companies' });
  const heard = h('p', { class: 'field__hint' }, chosen ? '' : 'Type at least two letters.');
  const paint = (found) => {
    const all = chosen && !found.some((c) => c.id === chosen.id) ? [{ ...chosen, city: null, website: null, on_map: null }, ...found] : found;
    list.replaceChildren(...all.map((c) => {
      const radio = choice({ name: 'merge-into', value: c.id, checked: chosen?.id === c.id, title: c.name, text: [c.city, c.website && hostOf(c.website), c.on_map == null ? null : c.on_map ? 'on the map' : 'unconfirmed location'].filter(Boolean).join(' · ') || 'Suggested match', onChange: () => { chosen = { id: c.id, name: c.name }; } });
      return radio.node;
    }));
  };
  const search = debounce(async () => {
    const term = norm(q.value);
    heard.textContent = term.length < 2 ? 'Type at least two letters.' : '';
    if (term.length < 2) { paint([]); return; }
    try { paint(await api.get(`/api/companies?q=${enc(term)}`)); if (!list.children.length) heard.textContent = 'No company matches.'; } catch (err) { heard.textContent = err.message; }
  }, 250);
  q.addEventListener('input', search);
  paint([]);
  if (chosen) search();
  modal({
    title: `Merge ${row.name} into a company`,
    lead: 'Say this candidate is a company the directory already has.',
    body: [
      callout(h('b', {}, 'This changes the record. '), 'The candidate’s evidence and identifiers move to the company: its names become aliases, and it fills only what the record leaves blank. Nothing is overwritten, and disagreements are flagged as conflicts. The candidate is closed as merged.'),
      fieldOf('Company', q), heard, list,
    ],
    submitLabel: 'Merge',
    onSubmit: async () => {
      if (!chosen) throw new Error('Choose the company this is.');
      const r = await api.post(`/api/candidates/${row.id}/merge`, { into: chosen.id });
      toast(`Merged ${row.name} into ${chosen.name}: ${plural(r.evidence, 'piece')} of evidence${r.filled.length ? `, filled ${r.filled.map((f) => f.split(':')[0]).join(', ')}` : ''}.`);
      await afterCandidateChange(row.id);
    },
  });
}

async function distinctDialog(row) {
  const d = await api.get(`/api/candidates/${row.id}`);
  const note = textArea({ rows: 2, maxlength: 500 });
  let from = d.matches[0]?.id ?? null;
  const options = d.matches.map((m, i) => choice({ name: 'not-same', value: m.id, checked: i === 0, title: `${m.name}`, text: `${MATCH[m.outcome] ?? 'May be'} · ${m.kind}${m.signals?.length ? ` · ${m.signals.map((s) => s.detail).slice(0, 2).join('; ')}` : ''}`, onChange: () => { from = m.id; } }));
  modal({
    title: `${row.name} is not a duplicate`,
    lead: 'Tell the engine which company this is not. It stops proposing that match and checks what is left.',
    body: [h('fieldset', {}, h('legend', {}, 'It is not'), options.map((o) => o.node)), fieldOf('Note', note, { optional: true })],
    submitLabel: 'Confirm: not the same',
    onSubmit: async () => {
      if (!from) throw new Error('Choose the company it is not.');
      await api.post(`/api/candidates/${row.id}/distinct`, { from, note: note.value });
      toast(`${row.name} is a separate company.`);
      await afterCandidateChange(row.id);
    },
  });
}

async function publishDialog(row) {
  const d = await api.get(`/api/candidates/${row.id}`);
  let mode = 'unconfirmed';
  const where = locationFields({ city: d.city, state: d.state, address: d.address });
  const pin = h('div', { class: 'nested', hidden: true }, where.node);
  const sector = d.sector ?? evidenceValue(d, 'sector');
  const stage = evidenceValue(d, 'stage');
  const off = choice({ name: 'where', value: 'unconfirmed', checked: true, title: 'List it without a place', text: 'It appears in the directory with an unconfirmed location and is not on the map. Confirm a place later from Locations, Suggested fills or Conflicts.', onChange: () => { mode = 'unconfirmed'; pin.hidden = true; } });
  const on = choice({ name: 'where', value: 'pin', title: 'Confirm a place now', text: 'You say how exactly it is known. An exact office or a suburb is a pin; a city or a state alone is a group on the map, never a pin.', onChange: () => { mode = 'pin'; pin.hidden = false; }, nested: pin });
  modal({
    title: `Publish ${d.name}`, size: 'lg',
    lead: 'Adds the company to the directory with what is known, and nothing more.',
    body: [
      callout(h('b', {}, 'This is the public record. '), 'It reaches the live site when you commit and push the data files. Sector and stage stay “Unknown” unless a person chose them, and the description is left for a person to write: the candidate’s own text becomes a suggested fill.'),
      h('dl', { class: 'kv' },
        h('dt', {}, 'Name'), h('dd', {}, d.name),
        h('dt', {}, 'Website'), h('dd', {}, d.website ? extLink(d.website, hostOf(d.website)) : unknown()),
        h('dt', {}, 'Sector'), h('dd', {}, sector ?? unknown()),
        h('dt', {}, 'Stage'), h('dd', {}, stage ?? unknown()),
        h('dt', {}, 'Address'), h('dd', {}, d.address || [d.city, d.state].filter(Boolean).join(', ') || unknown())),
      h('fieldset', {}, h('legend', {}, 'Location'), off.node, on.node),
    ],
    submitLabel: 'Publish company',
    onSubmit: async () => {
      const r = await api.post(`/api/candidates/${row.id}/publish`, mode === 'pin' ? { location: where.read() } : {});
      const placed = { EXACT: ' on the map', SUBURB: ' on the map, at its suburb', CITY: ' as a group in its city (no pin)', STATE: ' as a group in its state (no pin)' }[r.precision] ?? ' with an unconfirmed location';
      toast(`Published ${d.name}${placed}.${r.enrichment_queued ? ' Queued for enrichment.' : ''} Commit the data files to make it live.`);
      await afterCandidateChange(row.id);
    },
  });
}

// ---------- one candidate in full ----------

async function openCandidate(id) {
  if (S.drawer) S.drawer.dlg.close();
  const opener = document.activeElement;
  const fk = opener?.dataset?.fk ?? null;
  const title = h('h2', { class: 'dlg__title', id: 'drawer-title' }, 'Loading…');
  const chips = h('div', { class: 'chips' });
  const body = h('div', { class: 'dlg__body' }, skeletonRows(6));
  const foot = h('footer', { class: 'dlg__foot' });
  const dlg = h('dialog', { class: 'dlg dlg--drawer', 'aria-labelledby': 'drawer-title' },
    h('div', { class: 'dlg__form' },
      h('header', { class: 'dlg__head' }, h('div', {}, title, chips), h('button', { type: 'button', class: 'btn btn--ghost btn--sm', 'aria-label': 'Close', on: { click: () => dlg.close() } }, icon('x', 16))),
      body, foot));
  const drawer = { id, dlg, section: 'discovered', async reload() { await fill(); } };
  async function fill() {
    const d = await api.get(`/api/candidates/${id}`);
    title.textContent = d.name;
    chips.replaceChildren(...[
      statusChip(d.status),
      d.match && chip(`${MATCH[d.match.outcome] ?? 'May be'} ${d.match.name}`, 'warn'),
      d.confidence && h('span', { class: 'conf' }, confidenceChip(d.confidence.label), h('span', { class: 'num sub' }, `${Math.round(d.confidence.score * 100)}% confidence`)),
    ].filter(Boolean));
    body.replaceChildren(drawerContent(d, () => fill().catch((e) => toast(e.message, { tone: 'bad' }))));
    foot.replaceChildren(...actionButtons(d, { drawer: true }), btn('Close', { onClick: () => dlg.close() }));
  }
  dlg.addEventListener('close', () => { dlg.remove(); if (S.drawer === drawer) S.drawer = null; restoreFocus(fk, 'discovered'); });
  document.body.append(dlg);
  S.drawer = drawer;
  dlg.showModal();
  try { await fill(); } catch (err) { dlg.close(); throw err; }
}

function kv(label, value) { return [h('dt', {}, label), h('dd', {}, value)]; }
function block(titleText, ...kids) { return h('section', { class: 'block' }, h('h3', { class: 'block__title' }, titleText), ...kids); }

function drawerContent(d, reload) {
  const place = d.address || [d.city, d.state].filter(Boolean).join(', ');
  const ids = Object.entries(d.external_ids ?? {}).filter(([, v]) => v).map(([k, v]) => `${k.toUpperCase()} ${v}`).join(' · ');
  const verdict = (name, v) => v && [
    h('div', { class: 'verdict' }, h('b', {}, name), chip(v.verdict, v.verdict === 'yes' ? 'ok' : v.verdict === 'no' ? 'bad' : 'warn'), h('span', { class: 'muted' }, `score ${Math.round(v.score * 100)}%`)),
    h('div', { class: 'signals' }, (v.signals ?? []).map((s) => h('span', {}, `${s.detail} (${s.code.replace(/_/g, ' ')})`))),
  ];
  const note = textArea({ rows: 2, maxlength: 500, 'aria-label': 'Add a note' });
  return h('div', {},
    block('What we have', h('dl', { class: 'kv' },
      kv('Website', d.website ? extLink(d.website, hostOf(d.website)) : unknown()),
      kv('Location', place || unknown()),
      kv('Description', d.description || unknown()),
      kv('Sector', d.sector ?? unknown()),
      kv('Stage', evidenceValue(d, 'stage') ?? unknown()),
      kv('Founders', d.founders.length ? d.founders.join(', ') : unknown()),
      kv('Other names', d.aliases.length ? d.aliases.join(' · ') : unknown()),
      kv('Identifiers', ids || unknown()),
      kv('Discovered', `${fmtDateTime(d.discovered_at)} (${relative(d.discovered_at)})`))),
    d.matches.length > 0 && block('Possible matches', h('div', { class: 'list' }, d.matches.map((m) => h('div', {},
      h('div', { class: 'list__title' }, `${MATCH[m.outcome] ?? 'May be'} ${m.name}`, ' ', chip(m.kind, 'muted', true)),
      h('div', { class: 'signals' }, (m.signals ?? []).map((s) => h('span', {}, s.detail))))))),
    block('Where it was found', h('div', { class: 'list' }, d.discoveries.map((x) => h('div', {},
      h('div', { class: 'list__title' }, safeHref(x.url) ? extLink(x.url, x.title || x.url) : (x.title || x.key)),
      h('div', { class: 'sub' }, [kindLabel(x.source_kind), x.source_id, x.observed_at ? `published ${fmtDate(x.observed_at)}` : null].filter(Boolean).join(' · ')))))),
    block('Why it qualifies', verdict('Australian', d.australian), verdict('Startup', d.startup),
      d.confidence_breakdown && h('p', { class: 'sub' }, Object.entries(d.confidence_breakdown).filter(([, v]) => typeof v === 'number').map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(' · '))),
    block(`Evidence (${d.evidence.length})`, d.evidence.length ? h('div', { class: 'mini-wrap' }, h('table', { class: 'mini', role: 'table' },
      h('thead', { role: 'rowgroup' }, h('tr', { role: 'row' }, ['Field', 'Value', 'Confidence', 'Source'].map((c) => h('th', { scope: 'col', role: 'columnheader' }, c)))),
      h('tbody', { role: 'rowgroup' }, d.evidence.map((e) => h('tr', { role: 'row' },
        h('td', { role: 'cell' }, fieldLabel(e.field)), h('td', { role: 'cell' }, clip(fmtValue(e.value), 160)), h('td', { role: 'cell' }, confidenceChip(e.confidence)),
        h('td', { role: 'cell' }, safeHref(e.source?.url) ? extLink(e.source.url, e.source.title || kindLabel(e.source.kind)) : (e.source?.title || kindLabel(e.source?.kind)), h('div', { class: 'sub' }, kindLabel(e.source?.kind), e.source?.publisher ? ` · ${e.source.publisher}` : ''))))))) : h('p', { class: 'muted' }, 'No evidence yet.')),
    block('Notes', d.notes.length ? h('div', { class: 'timeline' }, d.notes.map((x) => h('div', {}, h('time', { datetime: x.at }, `${x.by} · ${fmtDateTime(x.at)}`), h('div', {}, x.text)))) : h('p', { class: 'muted' }, 'No notes.'),
      can('candidate.note') && h('div', { class: 'block' }, fieldOf('Add a note', note, { hint: 'Kept with your name. Notes cannot be edited.' }),
        h('p', {}, btn('Add note', { small: true, onClick: async () => { const text = norm(note.value); if (!text) throw new Error('Write the note first.'); await api.post(`/api/candidates/${d.id}/note`, { text }); toast('Note added.'); await refresh('audit'); await reload(); } })))),
    block('History', h('div', { class: 'timeline' }, d.status_history.map((x) => h('div', {}, h('time', { datetime: x.at }, `${fmtDateTime(x.at)} · ${x.by}`), h('div', {}, statusChip(x.status), x.note ? ` ${x.note}` : ''))))),
    d.review && h('p', { class: 'statusline' }, `Last decision: ${d.review.note ?? ''} (${d.review.by}, ${fmtDate(d.review.at)})`));
}

// ======================================================================= data quality

function renderQuality() {
  const body = $('#body-quality');
  if (!body) return;
  keepFocus(body, () => body.replaceChildren(h('div', {},
    view('overview', (o) => h('div', {},
      h('div', { class: 'bars' }, o.quality.map((q) => {
        const track = h('div', { class: 'bar__track', role: 'img', 'aria-label': `${q.label}: ${q.present} of ${q.total} companies, ${q.pct}%` });
        const fill = h('div', { class: 'bar__fill' }); fill.style.width = `${Math.min(100, q.pct)}%`;
        const backed = h('div', { class: 'bar__fill bar__fill--backed' }); backed.style.width = `${q.total ? Math.min(100, (q.backed / q.total) * 100) : 0}%`;
        track.append(fill, backed);
        return h('div', { class: 'bar' },
          h('div', { class: 'bar__top' }, h('span', { class: 'bar__label' }, q.label), h('span', { class: 'bar__pct' }, `${q.pct}%`)),
          track,
          h('p', { class: 'bar__meta' }, `${n(q.present)} of ${n(q.total)} companies · ${n(q.backed)} with a source on file`, q.note ? ` · ${q.note}` : ''));
      })),
      h('div', { class: 'legend' }, h('span', {}, h('i', { class: 'swatch' }), 'has a value'), h('span', {}, h('i', { class: 'swatch swatch--backed' }), 'and a source we can show for it'),
        h('span', {}, `${n(o.provenance.companies_with_sources)} companies have at least one source · ${n(o.provenance.evidence_rows)} pieces of evidence from ${n(o.provenance.sources)} sources`))), { skeleton: () => skeletonRows(5) }),
    missingBlock(),
    duplicatesBlock())));
}

const MISSING_LABEL = { website: 'Website', sector: 'Sector', location: 'Location', stage: 'Stage', description: 'Description' };
const MISSING_FILTERS = [['all', 'Any'], ...Object.entries(MISSING_LABEL)];

function missingBlock() {
  return h('div', {},
    h('div', { class: 'subhead' }, h('h3', {}, 'Companies missing data'), h('p', {}, 'Each lacks a website, sector, location, stage or description. Unknown stays unknown: reading its website may find some of it, as evidence for you to apply.')),
    view('missing', (m) => {
      if (!m.total) return emptyBox('No company is missing a core fact.');
      const f = S.ui.missingField;
      const rows = m.results.filter((r) => f === 'all' || r.missing.includes(f));
      const shown = rows.slice(0, S.ui.missingShown);
      return h('div', {},
        h('div', { class: 'toolbar' }, seg(MISSING_FILTERS.map(([key, text]) => ({ key, text, count: key === 'all' ? m.total : m.counts[key] })), f, (key) => { S.ui.missingField = key; S.ui.missingShown = 12; renderQuality(); }, 'Missing', 'missing-filter')),
        grid({
          caption: 'Companies missing data', wide: false,
          columns: [{ label: 'Company' }, { label: 'Missing' }, { label: 'Location' }, { label: 'Website' }, { label: 'Actions', cls: 'cell-actions' }],
          rows: shown.map((r) => [
            h('b', {}, r.name),
            h('div', { class: 'chips' }, r.missing.map((k) => chip(MISSING_LABEL[k] ?? k, 'warn', true))),
            r.city && r.city !== 'Unknown' ? [r.city, r.on_map ? '' : ['CITY', 'STATE'].includes(r.precision) ? ' (city-level, no pin)' : ' (not on the map)'] : unknown(),
            r.website ? extLink(r.website, hostOf(r.website)) : unknown(),
            r.website
              ? (r.enrichment && ['queued', 'running'].includes(r.enrichment.status) ? chip('Waiting to be read', 'info') : can('enrichment.enqueue') ? btn('Read website', { small: true, fk: `missing:${r.id}`, attrs: { 'aria-label': `Read ${r.name}’s website` }, onClick: async () => { await api.post(`/api/companies/${r.id}/enrich`, {}); toast(`Queued ${r.name} to have its website read.`); await refresh('missing', 'queue', 'audit'); } }) : null)
              : h('span', { class: 'muted' }, 'No website to read'),
          ]),
        }),
        pager(shown.length, rows.length, () => { S.ui.missingShown += 10; renderQuality(); }, 'missing'));
    }, { skeleton: () => skeletonRows(4) }));
}

function duplicatesBlock() {
  const slot = S.data.duplicates;
  if (!slot || slot.state !== 'ready' || !slot.value.length) return null;
  return h('div', {},
    h('div', { class: 'subhead' }, h('h3', {}, `Companies that look alike (${slot.value.length})`), h('p', {}, 'Two published records that share a website or a name. The Command Center cannot merge two published companies: compare them and correct the data files.')),
    grid({ caption: 'Companies that look alike', columns: [{ label: 'Why they look alike' }, { label: 'Companies' }], rows: slot.value.map((g) => [capitalise(g.reason), g.names.join(' · ')]) }));
}
const capitalise = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// ======================================================================= locations

const PRECISION_TILES = [
  ['EXACT', 'Exact locations', 'a pin at the office address'],
  ['SUBURB', 'Suburb locations', 'a pin, drawn as approximate'],
  ['CITY', 'City-only locations', 'a group in its city, no pin'],
  ['STATE', 'State-only locations', 'a group in its state, no pin'],
  ['UNKNOWN', 'Unknown locations', 'listed, not drawn'],
];
const LOCATION_SOURCES = [
  ['manual', 'I checked it myself'], ['company_website', 'The company’s own website'], ['company_document', 'A company document (privacy policy, terms)'],
  ['credible_profile', 'A credible profile (accelerator, press)'], ['ecosystem_source', 'Another ecosystem source'],
];
const coordCell = (v) => (v == null ? h('span', { class: 'muted' }, '—') : h('span', { class: 'num' }, Number(v).toFixed(5)));

function renderLocations() {
  const body = $('#body-locations');
  if (!body) return;
  keepFocus(body, () => body.replaceChildren(h('div', {},
    view('overview', (o) => {
      const where = o.locations;
      return h('div', { class: 'tiles tiles--five' }, PRECISION_TILES.map(([key, label, note]) => h('div', { class: 'tile' },
        h('span', { class: 'tile__label' }, label),
        h('span', { class: 'tile__main' }, h('span', { class: 'tile__value' }, n(where.precision[key])), h('span', { class: 'tile__note' }, `${where.total ? Math.round((where.precision[key] / where.total) * 100) : 0}% · ${note}`)))));
    }, { skeleton: () => skeletonRows(2) }),
    locationQueue())));
}

function locationQueue() {
  return h('div', {},
    h('div', { class: 'subhead' }, h('h3', {}, 'Location review queue'), h('p', {}, 'The companies whose place a person should look at, worst first. Nothing is moved for you: saying where a company is writes it to the data files with your name and your reason.')),
    view('locations', (L) => {
      const f = S.ui.locationFilter;
      const isFlag = L.flags.some((x) => x.key === f);
      const pick = (key) => { S.ui.locationFilter = key; S.ui.locationShown = 12; load('locations', { quiet: true }); };
      const problem = selectInput([['', 'Any problem'], ...L.issues.map((i) => [i.code, `${i.label} (${n(i.count)})`])], isFlag ? '' : f);
      problem.setAttribute('aria-label', 'Show one kind of problem');
      problem.dataset.fk = 'loc:problem';
      problem.addEventListener('change', () => pick(problem.value));
      const shown = L.results.slice(0, S.ui.locationShown);
      return h('div', {},
        h('div', { class: 'toolbar' },
          seg([{ key: '', text: 'All', count: L.queue }, ...L.flags.map((x) => ({ key: x.key, text: x.label, count: x.count }))], isFlag ? f : (f ? null : ''), pick, 'Location flags', 'loc-flag'),
          problem,
          !can('location.set') && h('p', { class: 'toolbar__note' }, 'Setting a location needs the admin role.')),
        L.flags.some((x) => x.key === f) && h('p', { class: 'stamp' }, L.flags.find((x) => x.key === f).note.replace(/^./, (c) => c.toUpperCase()) + '.'),
        L.total === 0 ? emptyBox('Nothing to review here.', 'Every company in this view is located as well as it can be from what is on file.') : h('div', {},
          grid({
            caption: 'Location review queue', wide: true,
            columns: [{ label: 'Company' }, { label: 'City' }, { label: 'Lat', cls: 'r' }, { label: 'Lng', cls: 'r' }, { label: 'Precision' }, { label: 'Source', cls: 'cell-source' }, { label: 'Issue' }, { label: 'Actions', cls: 'cell-actions' }],
            rows: shown.map((r) => {
              const [label, tone] = PRECISION[r.precision] ?? [r.precision, 'muted'];
              const worst = r.issues[0];
              return [
                h('div', { class: 'company' }, h('b', {}, r.name), r.address && h('span', { class: 'sub clamp2', title: r.address }, r.address)),
                [r.city && r.city !== 'Unknown' ? r.city : null, r.state].filter(Boolean).join(', ') || unknown(),
                coordCell(r.lat), coordCell(r.lng),
                chip(label, tone, true),
                h('div', {}, LOCATION_SOURCE[r.source] ?? h('span', { class: 'muted' }, '—'), h('div', { class: 'sub' }, r.verified_at ? `checked ${fmtDate(r.verified_at)}` : 'not checked'), r.source_url && h('div', { class: 'sub' }, extLink(r.source_url, hostOf(r.source_url)))),
                h('div', { class: 'issue' },
                  h('div', { class: 'chips' }, chip(worst.label, SEVERITY_TONE[worst.severity] ?? 'muted', true), r.issues.length > 1 && chip(`+${r.issues.length - 1} more`, 'muted', true)),
                  worst.detail && h('span', { class: 'sub clamp2', title: worst.detail }, worst.detail)),
                h('div', { class: 'actions' }, can('location.set') && btn('Set location', { small: true, fk: `loc:${r.company_id}`, attrs: { 'aria-label': `Set where ${r.name} is` }, onClick: () => setLocationDialog(r) })),
              ];
            }),
          }),
          pager(shown.length, L.results.length, () => { S.ui.locationShown += 10; renderLocations(); }, 'locations')),
        h('p', { class: 'stamp' }, 'From a terminal: ', h('code', {}, 'npm run locations -- review'), ', ', h('code', {}, 'geocode'), ', ', h('code', {}, 'promote'), ' and ', h('code', {}, 'normalize'), ' do the same work in bulk, and write the same audit trail.'));
    }, { skeleton: () => skeletonRows(5) }));
}

function setLocationDialog(row) {
  const pinned = ['EXACT', 'SUBURB'].includes(row.precision);
  const where = locationFields({
    precision: pinned ? row.precision : undefined, city: row.city && row.city !== 'Unknown' ? row.city : '', state: row.state ?? '', address: row.address ?? '',
    suburb: row.suburb ?? '', lat: pinned ? row.lat : null, lng: pinned ? row.lng : null,
  }, { companyId: row.company_id, allowUnknown: true });
  const source = selectInput(LOCATION_SOURCES, 'manual');
  const page = textInput({ placeholder: 'https://…', maxlength: 500 });
  const reason = textArea({ rows: 2, maxlength: 300, placeholder: 'For example: the contact page lists this office; the geocoder found the building.' });
  modal({
    title: `Set where ${row.name} is`, size: 'lg',
    lead: 'Say how exactly its place is known. A pin needs an address (or a suburb) and a point; a city or a state alone is a group on the map, never a pin. Nothing is guessed.',
    body: [
      h('div', { class: 'block' }, h('p', { class: 'field__label' }, 'What is wrong now'),
        h('div', { class: 'list' }, row.issues.map((i) => h('div', {}, h('div', { class: 'list__title' }, i.label, i.detail ? ` — ${i.detail}` : ''), h('div', { class: 'sub' }, i.action))))),
      where.node,
      fieldOf('Where did you find it?', source),
      fieldOf('The page that states it', page, { optional: true, hint: 'Required for a company’s own website or document, so anyone can check it. Never LinkedIn or another personal profile: they say where a person is, not where the company is.' }),
      fieldOf('Why', reason, { hint: 'Required. Kept with your name in the audit trail.' }),
    ],
    submitLabel: 'Save location',
    onSubmit: async () => {
      const location = where.read();
      const why = needReason(reason);
      const payload = { location, reason: why };
      if (location.precision !== 'UNKNOWN') { payload.source = source.value; if (norm(page.value)) payload.source_url = norm(page.value); }
      const r = await api.post(`/api/locations/${row.company_id}`, payload);
      toast(`${row.name} is now ${(PRECISION[r.precision]?.[0] ?? r.precision).toLowerCase()}. Commit the data files to make it live.`);
      await refresh('overview', 'locations', 'missing', 'suggestions', 'conflicts', 'audit');
    },
  });
}

// ======================================================================= investors

// A record's life: new -> checked against its pages (verified) -> published, by a person, on purpose. The buttons follow it.
const INVESTOR_FILTERS = [
  ['open', 'Waiting'], ['candidate', 'New'], ['needs_review', 'Needs review'], ['verified', 'Verified'], ['published', 'Published'], ['inactive', 'Inactive'], ['rejected', 'Rejected'], ['all', 'All'],
];
const BASIS = {
  based_in_australia: 'Based in Australia', invests_in_australian_startups: 'Invests in Australian-founded startups', australian_startup_network: 'Runs a recognised Australian startup network',
};
const PAGE_CHOICES = [
  ['investor_website', 'The investor’s own website'], ['investor_document', 'An investor document (a report or a PDF)'], ['investor_post', 'An investor’s announcement or post'],
  ['press', 'Press'], ['company_website', 'A company’s website'], ['accelerator_profile', 'An accelerator or programme profile'],
];
const typeName = (key) => (slotOf('investors')?.vocab.types.find(([k]) => k === key)?.[1]) ?? (key ? String(key).replace(/_/g, ' ') : null);
const issueNote = (code) => slotOf('investors')?.summary.issues.find((i) => i.code === code)?.note ?? '';
const audMoney = (v, currency = 'AUD') => { try { return new Intl.NumberFormat('en-AU', { style: 'currency', currency, maximumFractionDigits: 0 }).format(v); } catch { return `${currency} ${n(v)}`; } };

// A claim's value the way a person reads it (the cheque is one claim of three fields).
function fmtClaim(field, v) {
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return 'Unknown';
  if (field === 'typical_cheque' && typeof v === 'object') {
    const cur = v.currency ?? 'AUD';
    if (v.min != null && v.max != null) return `${audMoney(v.min, cur)} to ${audMoney(v.max, cur)}`;
    return v.min != null ? `from ${audMoney(v.min, cur)}` : `up to ${audMoney(v.max, cur)}`;
  }
  if (field === 'investor_type') return typeName(v) ?? String(v);
  if (field === 'inclusion_basis') return BASIS[v] ?? String(v);
  if (field === 'active_status') return v === 'inactive' ? 'No longer investing' : 'Investing';
  if (field === 'lead_or_follow') return capitalise(String(v));
  return fmtValue(v);
}

function setInvestorView({ status = S.ui.investorStatus, issue = '' } = {}) {
  Object.assign(S.ui, { investorStatus: status, investorIssue: issue, investorQuery: '', investorShown: 12 });
  load('investors', { quiet: true });
}

function investorsFrame(body) {
  const search = textInput({ type: 'search', id: 'inv-q', placeholder: 'Search name, other name or website', 'aria-label': 'Search investors by name or website', value: S.ui.investorQuery, 'data-fk': 'search:inv' });
  search.addEventListener('input', debounce(() => { S.ui.investorQuery = norm(search.value); S.ui.investorShown = 12; load('investors', { quiet: true }); }, 250));
  const issue = h('select', { class: 'select', id: 'inv-issue', 'aria-label': 'Show one kind of problem', 'data-fk': 'inv:issue' });
  issue.addEventListener('change', () => { S.ui.investorIssue = issue.value; S.ui.investorShown = 12; load('investors', { quiet: true }); });
  body.append(
    h('div', { id: 'inv-tiles' }),
    h('div', { class: 'toolbar' },
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Show', id: 'inv-seg' }, INVESTOR_FILTERS.map(([key, text]) => h('button', { type: 'button', 'data-filter': key, 'data-fk': `inv-filter:${key}`, 'aria-pressed': 'false', on: { click: () => setInvestorView({ status: key, issue: S.ui.investorIssue }) } }, text, h('span', { class: 'n' })))),
      issue,
      h('div', { class: 'search' }, icon('search', 16), search),
      h('p', { class: 'toolbar__note', id: 'inv-note' })),
    h('div', { id: 'inv-results' }),
    h('div', { id: 'inv-blocks' }));
}

function paintInvestorToolbar() {
  const data = slotOf('investors');
  const counts = data?.counts ?? {};
  for (const button of document.querySelectorAll('#inv-seg button')) {
    button.setAttribute('aria-pressed', String(button.dataset.filter === S.ui.investorStatus));
    button.querySelector('.n').textContent = counts[button.dataset.filter] != null ? n(counts[button.dataset.filter]) : '';
  }
  const issue = $('#inv-issue');
  if (issue && data) {
    issue.replaceChildren(h('option', { value: '' }, 'Any problem'), ...data.summary.issues.filter((i) => i.count > 0).map((i) => h('option', { value: i.code, selected: i.code === S.ui.investorIssue }, `${i.label} (${n(i.count)})`)));
    issue.value = S.ui.investorIssue;
  }
  const search = $('#inv-q');
  if (search && document.activeElement !== search && search.value !== S.ui.investorQuery) search.value = S.ui.investorQuery;
  const note = $('#inv-note');
  if (note) note.textContent = data ? `${n(data.results.length)} shown${data.total > data.results.length ? ` of ${n(data.total)}` : ''}` : '';
}

function renderInvestors() {
  const body = $('#body-investors');
  if (!body) return;
  if (!body.firstChild) investorsFrame(body);
  paintInvestorToolbar();
  // The list says if it could not load; the counts above it and the lists below it stay quiet instead of saying it three times.
  const slot = S.data.investors;
  const settled = slot?.state === 'ready';
  const put = (el, node) => el.replaceChildren(...(node ? [node] : []));
  put($('#inv-tiles'), settled ? investorTiles(slot.value)
    : slot?.state === 'error' ? null : h('div', { class: 'tiles', 'aria-hidden': 'true' }, Array.from({ length: 8 }, () => h('div', { class: 'tile' }, h('span', { class: 'skel' }), h('span', { class: 'skel' })))));
  const results = $('#inv-results');
  keepFocus(results, () => results.replaceChildren(view('investors', (L) => (L.results.length ? investorsTable(L) : emptyInvestors()))));
  const blocks = $('#inv-blocks');
  keepFocus(blocks, () => put(blocks, settled ? h('div', {}, investorConflicts(slot.value), duplicateFirms(slot.value), staleTeam(slot.value), investorsFooter()) : null));
}

function investorTiles(L) {
  const s = L.summary;
  const gap = (code) => s.issues.find((i) => i.code === code)?.count ?? 0;
  const tiles = [
    { label: 'In the directory', value: s.public, note: `${n(s.by_status.published)} published · ${n(s.by_status.inactive)} inactive`, status: 'published' },
    { label: 'Verified, not published', value: s.by_status.verified, note: 'checked against pages; a person publishes', status: 'verified' },
    { label: 'New candidates', value: s.by_status.candidate, note: 'not yet checked against a page', status: 'candidate' },
    { label: 'Needs review', value: s.by_status.needs_review, note: 'flagged for a person to look at', status: 'needs_review', flag: 'warn' },
    { label: 'Sources disagree', value: s.conflicts, note: 'a person settles which page is right', issue: 'evidence_conflict', flag: 'bad' },
    { label: 'Possible duplicates', value: s.duplicates.firms + s.duplicates.people, note: `${plural(s.duplicates.firms, 'firm')} · ${plural(s.duplicates.people, 'person', 'people')}`, issue: 'possible_duplicate_firm', flag: 'warn' },
    { label: 'Backs, no page', value: s.relationships.unsourced, note: `of ${plural(s.relationships.links, 'company link')}, ${n(s.relationships.sourced)} have a page`, issue: 'unverified_relationships', flag: 'warn' },
    { label: 'Team not checked in a year', value: s.team.stale, note: `of ${plural(s.team.records, 'team record')}`, anchor: 'inv-stale', flag: 'warn' },
  ];
  const missing = [['missing_stages', 'No stages'], ['missing_sectors', 'No sectors'], ['missing_location', 'No location'], ['missing_type', 'No type'], ['missing_website', 'No website']];
  const tile = (t) => {
    const flagged = t.flag && t.value > 0;
    const inside = [
      h('span', { class: 'tile__label' }, flagged && h('span', { class: `tile__dot${t.flag === 'bad' ? ' tile__dot--bad' : ''}`, 'aria-hidden': 'true' }), t.label, flagged && h('span', { class: 'sr' }, ' (needs attention)')),
      h('span', { class: 'tile__main' }, h('span', { class: 'tile__value' }, n(t.value)), h('span', { class: 'tile__note' }, t.note)),
    ];
    return h('a', { class: 'tile', href: '#investors', on: { click: (e) => { e.preventDefault(); if (t.anchor) { document.getElementById(t.anchor)?.scrollIntoView(); return; } setInvestorView({ status: t.status ?? 'all', issue: t.issue ?? '' }); } } }, inside);
  };
  return h('div', {},
    h('div', { class: 'tiles' }, tiles.map(tile)),
    h('div', { class: 'subhead' }, h('h3', {}, 'What the records are missing'), h('p', {}, 'A blank stays blank until a page states it. Nothing is guessed to fill a gap.')),
    h('div', { class: 'tiles tiles--five' }, missing.map(([code, label]) => tile({ label, value: gap(code), note: `of ${plural(s.total, 'record')}`, issue: code }))));
}

function emptyInvestors() {
  if (S.ui.investorQuery) return emptyBox(`No investor matches “${S.ui.investorQuery}”.`, 'Search covers names, other names and websites. Try fewer letters, or choose All.');
  if (S.ui.investorIssue) return emptyBox('No record has this problem here.', 'Choose another kind of problem, or Any problem.');
  return emptyBox('Nothing is waiting here.', 'New investors are staged by ', h('code', {}, 'npm run investors -- import'), ' in ', h('code', {}, 'backend/'), '. Choose All to see the decided ones.');
}

const INVESTOR_ACTION_ORDER = ['approve', 'publish', 'edit', 'flag', 'unpublish', 'inactive', 'merge', 'reject', 'reopen'];
const INVESTOR_ACTIONS = {
  approve: { label: 'Approve', perm: 'investor.approve', run: (r) => approveInvestorDialog(r) },
  publish: { label: 'Publish', perm: 'investor.publish', run: (r) => publishInvestorDialog(r) },
  edit: { label: 'Edit', perm: 'investor.edit', run: (r) => editInvestorDialog(r) },
  flag: { label: 'Send for review', perm: 'investor.flag', run: (r) => flagInvestorDialog(r) },
  unpublish: { label: 'Unpublish', perm: 'investor.unpublish', run: (r) => unpublishInvestorDialog(r) },
  inactive: { label: 'Mark inactive', perm: 'investor.inactive', run: (r) => inactiveInvestorDialog(r) },
  merge: { label: 'Merge', perm: 'investor.merge', run: (r) => mergeInvestorDialog(r) },
  reject: { label: 'Reject', perm: 'investor.reject', run: (r) => rejectInvestorDialog(r) },
  reopen: { label: 'Reopen', perm: 'investor.reopen', run: (r) => reopenInvestor(r) },
};

// A row shows the one step that moves it along; the full set is in its drawer.
function investorButtons(row, { drawer = false } = {}) {
  let wanted = INVESTOR_ACTION_ORDER.filter((a) => row.actions.includes(a) && can(INVESTOR_ACTIONS[a].perm));
  if (!drawer) wanted = wanted.filter((a) => ['approve', 'publish', 'unpublish', 'reopen'].includes(a)).slice(0, 1);
  const primary = wanted.find((a) => a === 'approve' || a === 'publish');
  return wanted.map((a) => btn(INVESTOR_ACTIONS[a].label, {
    small: !drawer, variant: a === primary ? 'primary' : '', fk: `inv:${row.id}:${a}${drawer ? ':d' : ''}`,
    attrs: { 'aria-label': `${INVESTOR_ACTIONS[a].label} ${row.name}` }, onClick: () => INVESTOR_ACTIONS[a].run(row),
  }));
}

const portfolioCell = (p) => h('div', {},
  p.verified > 0 ? h('b', {}, `${plural(p.verified, 'company', 'companies')} backed`) : h('span', { class: 'muted' }, 'None with a page'),
  p.unverified > 0 && h('div', { class: 'sub' }, `${n(p.unverified)} not yet verified`),
  p.unsourced > 0 && h('div', { class: 'sub' }, `${plural(p.unsourced, 'company', 'companies')} name it, no page`));

function investorsTable(L) {
  const shown = L.results.slice(0, S.ui.investorShown);
  return h('div', {},
    grid({
      caption: 'Investors', wide: true,
      columns: [{ label: 'Investor' }, { label: 'Type' }, { label: 'Where' }, { label: 'Stages and sectors' }, { label: 'Portfolio' }, { label: 'Needs attention' }, { label: 'Actions', cls: 'cell-actions' }],
      rows: shown.map((r) => {
        const worst = r.issues[0];
        return [
          h('div', { class: 'company' },
            h('button', { type: 'button', class: 'linkbtn', 'data-fk': `inv:${r.id}:open`, on: { click: guard(() => openInvestor(r.id)) } }, r.name),
            r.website && h('div', { class: 'sub' }, extLink(r.website, hostOf(r.website))),
            h('div', { class: 'chips' }, statusChip(r.status), r.active_status === 'inactive' && r.status !== 'inactive' && chip('No longer investing', 'muted'))),
          r.type_label ?? unknown(),
          r.location ?? unknown(),
          r.stages || r.sectors ? `${plural(r.stages, 'stage')} · ${plural(r.sectors, 'sector')}` : h('span', { class: 'muted' }, 'None recorded'),
          portfolioCell(r.portfolio),
          worst
            ? h('div', { class: 'issue' }, h('div', { class: 'chips' }, chip(worst.label, SEVERITY_TONE[worst.severity] ?? 'muted', true), r.issues.length > 1 && chip(`+${r.issues.length - 1} more`, 'muted', true)), worst.detail && h('span', { class: 'sub clamp2', title: worst.detail }, worst.detail))
            : h('span', { class: 'muted' }, 'Nothing'),
          h('div', { class: 'actions' }, btn('Review', { small: true, variant: 'ghost', fk: `inv:${r.id}:review`, attrs: { 'aria-label': `Review ${r.name}` }, onClick: () => openInvestor(r.id) }), investorButtons(r)),
        ];
      }),
    }),
    pager(shown.length, L.results.length, () => { S.ui.investorShown += 10; renderInvestors(); }, 'investors'));
}

// ---------- what is to be settled across the whole list ----------

function investorConflicts(L) {
  if (!L.conflicts.length) return null;
  const shown = L.conflicts.slice(0, S.ui.investorConflictShown);
  return h('div', {},
    h('div', { class: 'subhead' }, h('h3', {}, `Sources disagree (${L.conflicts.length})`), h('p', {}, 'Two pages give different answers for one investor. Nothing changes until a person says which page is right.')),
    shown.map((c) => investorConflict(c)),
    pager(shown.length, L.conflicts.length, () => { S.ui.investorConflictShown += 10; renderInvestors(); }, 'investor-conflicts'));
}

function evidenceLines(evidence) {
  return evidence.slice(0, 3).map((e) => h('p', { class: 'side__meta' },
    e.source && safeHref(e.source.url) ? extLink(e.source.url, e.source.title || hostOf(e.source.url)) : (e.source?.title ?? 'A page'),
    e.source ? ` · ${kindLabel(e.source.kind).toLowerCase()}${e.verified_at ? ` · read ${fmtDate(e.verified_at)}` : ''}` : '',
    e.note ? h('span', { class: 'sub' }, ` “${clip(e.note, 200)}”`) : null));
}

function investorConflict(c, { inDrawer = false } = {}) {
  const settle = (i) => (can('investor.resolve')
    ? btn('This one is right', { small: true, fk: `invc:${c.subject_id}:${c.field}:${i}`, attrs: { 'aria-label': `Source ${String.fromCharCode(65 + i)} is right for ${c.name}’s ${fieldLabel(c.field).toLowerCase()}` }, onClick: () => resolveInvestorConflictDialog(c, i) })
    : null);
  return h('article', { class: 'conflict', 'aria-label': `${c.name}: ${fieldLabel(c.field)}` },
    h('div', { class: 'conflict__head' },
      inDrawer ? h('span', { class: 'conflict__title' }, fieldLabel(c.field))
        : h('button', { type: 'button', class: 'linkbtn conflict__title', 'data-fk': `invc:${c.subject_id}:open`, on: { click: guard(() => openInvestor(c.subject_id)) } }, c.name),
      !inDrawer && chip(fieldLabel(c.field), 'muted', true),
      chip(c.kind === 'sources_disagree' ? 'Pages disagree' : 'A page disagrees with our record', 'warn')),
    h('div', { class: 'sides' },
      c.stored != null && !c.values.some((v) => v.matches_stored) && h('div', { class: 'side' }, h('span', { class: 'side__label' }, 'Our record'), h('span', { class: 'side__value' }, fmtClaim(c.field, c.stored)),
        h('p', { class: 'side__meta' }, 'To keep this, edit the record with the page that states it; then both pages agree.')),
      c.values.map((v, i) => h('div', { class: 'side' },
        h('span', { class: 'side__label' }, `Source ${String.fromCharCode(65 + i)}`),
        h('span', { class: 'side__value' }, fmtClaim(c.field, v.value)),
        v.matches_stored && h('div', { class: 'chips' }, chip('Matches our record', 'ok')),
        evidenceLines(v.evidence),
        h('div', { class: 'side__act' }, settle(i))))));
}

function duplicateFirms(L) {
  const groups = L.duplicates.firms;
  if (!groups.length && !L.duplicates.people.length) return null;
  return h('div', {},
    groups.length > 0 && h('div', {},
      h('div', { class: 'subhead' }, h('h3', {}, `Records that look like one firm (${groups.length})`), h('p', {}, 'The same name, the same website, or a name that starts the way another does. Merge two that are one firm; leave two that are not.')),
      grid({
        caption: 'Possible duplicate firms',
        columns: [{ label: 'Why they look alike' }, { label: 'Records' }, { label: 'Actions', cls: 'cell-actions' }],
        rows: groups.map((g) => [
          capitalise(g.reason),
          h('div', { class: 'chips' }, g.members.map((m) => h('span', { class: 'chips' }, h('button', { type: 'button', class: 'linkbtn', 'data-fk': `invd:${m.id}:open`, on: { click: guard(() => openInvestor(m.id)) } }, m.name), statusChip(m.status)))),
          can('investor.merge') ? btn('Merge…', { small: true, fk: `invd:${g.ids.join('|')}`, attrs: { 'aria-label': `Merge ${g.names.join(' and ')}` }, onClick: () => mergeGroupDialog(g) }) : null,
        ]),
      })),
    L.duplicates.people.length > 0 && h('div', {},
      h('div', { class: 'subhead' }, h('h3', {}, `People who look like one person (${L.duplicates.people.length})`), h('p', {}, 'The same name or the same public page. Merging two people is done in the data files; nothing is merged for you.')),
      grid({ caption: 'Possible duplicate people', columns: [{ label: 'Why they look alike' }, { label: 'People' }], rows: L.duplicates.people.map((g) => [capitalise(g.reason), g.names.join(' · ')]) })));
}

function staleTeam(L) {
  if (!L.stale_team.length) return h('span', { id: 'inv-stale' });
  return h('div', { id: 'inv-stale' },
    h('div', { class: 'subhead' }, h('h3', {}, `Team records not checked in a year (${L.stale_team.length})`), h('p', {}, 'People move firms. A role nobody has looked at for a year is shown with its last check, never silently kept.')),
    grid({
      caption: 'Team records not checked in a year', columns: [{ label: 'Person' }, { label: 'Firm' }, { label: 'Role' }, { label: 'Last checked' }],
      rows: L.stale_team.map((t) => [h('b', {}, t.person), t.organisation, t.role, t.verified_at ? fmtDate(t.verified_at) : h('span', { class: 'muted' }, 'Never')]),
    }));
}

// ---------- the page that states a claim ----------

// The address of a page, what kind of page it is, and the words on it that say the thing. A reader checks the claim
// against those words, so they are required wherever a claim is set.
function pageFields({ optional = false, title = 'The page that states it' } = {}) {
  const url = textInput({ placeholder: 'https://…', maxlength: 500 });
  const kind = selectInput(PAGE_CHOICES, 'investor_website');
  const quote = textArea({ rows: 3, maxlength: 600, placeholder: 'For example: “We invest in pre-seed and seed Australian startups.”' });
  return {
    node: h('div', { class: 'block' },
      fieldOf(title, url, { optional, hint: 'The page itself, not a search result. Never LinkedIn or another personal profile.' }),
      fieldOf('What kind of page it is', kind),
      fieldOf('What the page says', quote, { optional, hint: 'Its own words, copied. This is what anyone checking the claim reads.' })),
    read({ required = false } = {}) {
      const address = norm(url.value);
      const words = norm(quote.value);
      if (!address && !words) { if (required) { url.focus(); throw new Error('Name the page that says it.'); } return null; }
      if (!address) { url.focus(); throw new Error('Name the page that says it.'); }
      if (words.length < 8) { quote.focus(); throw new Error('Copy what the page says, in its own words.'); }
      return { url: address, kind: kind.value, quote: words };
    },
  };
}

async function afterInvestorChange(id, { gone = false } = {}) {
  await refreshAll();
  if (S.drawer?.kind === 'investor' && S.drawer.id === id) { if (gone) S.drawer.dlg.close(); else await S.drawer.reload(); }
}

// ---------- the steps a record takes ----------

function approveInvestorDialog(row) {
  const note = textArea({ rows: 2, maxlength: 500 });
  modal({
    title: `Approve ${row.name}?`,
    body: [
      callout(h('b', {}, 'Approving does not publish. '), 'It says every claim on the record has a page behind it, and moves it to Verified. It is refused if one does not. It stays hidden from the public site until a person publishes it.'),
      fieldOf('Note', note, { optional: true, hint: 'Kept with your name in the audit trail.' }),
    ],
    submitLabel: 'Approve',
    onSubmit: async () => {
      await api.post(`/api/investors/${row.id}/approve`, { note: note.value });
      toast(`Approved ${row.name}. It is not public until it is published.`);
      await afterInvestorChange(row.id);
    },
  });
}

function rejectInvestorDialog(row) {
  const reason = textArea({ rows: 3, maxlength: 500, placeholder: 'For example: it invests in listed shares, not startups.' });
  modal({
    title: `Reject ${row.name}?`,
    body: [
      callout('It is kept, with your reason, so the same name is not proposed again. You can reopen it later.'),
      fieldOf('Why', reason, { hint: 'Required. Kept with your name in the audit trail.' }),
    ],
    submitLabel: 'Reject', tone: 'danger',
    onSubmit: async () => {
      await api.post(`/api/investors/${row.id}/reject`, { reason: needReason(reason) });
      toast(`Rejected ${row.name}.`);
      await afterInvestorChange(row.id);
    },
  });
}

function flagInvestorDialog(row) {
  const reason = textArea({ rows: 3, maxlength: 500, placeholder: 'For example: its website now says it has stopped investing.' });
  modal({
    title: `Send ${row.name} for review?`,
    body: [callout('It moves to “Needs review” so a person looks at it again. Nothing about the public site changes.'), fieldOf('What looks wrong', reason, { hint: 'Required. Kept with your name in the audit trail.' })],
    submitLabel: 'Send for review',
    onSubmit: async () => {
      await api.post(`/api/investors/${row.id}/flag`, { reason: needReason(reason) });
      toast(`${row.name} is waiting for review.`);
      await afterInvestorChange(row.id);
    },
  });
}

async function reopenInvestor(row) {
  await api.post(`/api/investors/${row.id}/reopen`, {});
  toast(`Reopened ${row.name} for review.`);
  await afterInvestorChange(row.id);
}

async function publishInvestorDialog(row) {
  const d = await api.get(`/api/investors/${row.id}`);
  const lines$ = [
    ['Name', d.name], ['Type', d.type_label], ['Where', d.location], ['Stages', d.stages.length ? d.stages.join(', ') : null], ['Sectors', d.sectors.length ? d.sectors.join(', ') : null],
    ['Cheque size', fmtClaim('typical_cheque', d.typical_cheque_min == null && d.typical_cheque_max == null ? null : { min: d.typical_cheque_min, max: d.typical_cheque_max, currency: d.cheque_currency })],
  ];
  modal({
    title: `Publish ${d.name}`, size: 'lg',
    lead: d.active_status === 'inactive' ? 'It says it has stopped investing, so it is published as inactive: listed, and labelled, never shown as active.' : 'Adds the investor to the public directory with what is on this record.',
    body: [
      callout(h('b', {}, 'This is the public record. '), 'It reaches the live site when you commit and push the data files. Only what a page backs is shown: a blank stays blank.'),
      h('dl', { class: 'kv' }, lines$.map(([label, value]) => kv(label, value ? (value === 'Unknown' ? unknown() : value) : unknown()))),
      h('p', { class: 'sub' }, `${plural(d.portfolio.verified, 'portfolio company', 'portfolio companies')} with a page that says so · ${plural(d.team.length, 'team record')} · ${plural(d.funds.length, 'fund')}`),
    ],
    submitLabel: 'Publish investor',
    onSubmit: async () => {
      const r = await api.post(`/api/investors/${row.id}/publish`, {});
      toast(`Published ${d.name}${r.status === 'inactive' ? ' as inactive' : ''}. Commit the data files to make it live.`);
      await afterInvestorChange(row.id);
    },
  });
}

function unpublishInvestorDialog(row) {
  const reason = textArea({ rows: 3, maxlength: 500, placeholder: 'For example: the fund has closed and its page is gone.' });
  modal({
    title: `Take ${row.name} off the public directory?`,
    body: [callout('It goes back to Verified: kept, checked, and hidden from the public site until it is published again. The live site drops it when you commit and push the data files.'), fieldOf('Why', reason, { hint: 'Required. Kept with your name in the audit trail.' })],
    submitLabel: 'Unpublish', tone: 'danger',
    onSubmit: async () => {
      await api.post(`/api/investors/${row.id}/unpublish`, { reason: needReason(reason) });
      toast(`${row.name} is off the public directory. Commit the data files to make it so on the live site.`);
      await afterInvestorChange(row.id);
    },
  });
}

function inactiveInvestorDialog(row) {
  const checked = ['verified', 'published', 'inactive'].includes(row.status);
  const page = pageFields({ optional: !checked, title: 'The page that says it has stopped investing' });
  const reason = textArea({ rows: 2, maxlength: 500, placeholder: 'For example: its website says the fund is closed to new investments.' });
  modal({
    title: `Mark ${row.name} as no longer investing`, size: 'lg',
    body: [
      callout(row.status === 'published' ? 'It stays in the directory, labelled as inactive: a fund that has stopped is still part of the record, and is never shown as active.' : 'It is recorded as no longer investing, and is never published as active.'),
      page.node,
      fieldOf('Why', reason, { hint: 'Required. Kept with your name in the audit trail.' }),
    ],
    submitLabel: 'Mark inactive', tone: 'danger',
    onSubmit: async () => {
      const source = page.read({ required: checked });
      await api.post(`/api/investors/${row.id}/inactive`, { reason: needReason(reason), source });
      toast(`${row.name} is marked as no longer investing.`);
      await afterInvestorChange(row.id);
    },
  });
}

// ---------- edit ----------

async function editInvestorDialog(row) {
  const d = await api.get(`/api/investors/${row.id}`);
  const vocab = slotOf('investors')?.vocab ?? { types: [], stages: [], bases: [], lead_or_follow: [] };
  const stageBoxes = vocab.stages.map((s) => { const input = h('input', { type: 'checkbox', id: uid('stage'), value: s, checked: d.stages.includes(s) }); return { s, input, node: h('div', { class: 'check' }, input, h('label', { for: input.id }, s)) }; });
  const cheque = { min: d.typical_cheque_min, max: d.typical_cheque_max };
  const f = {
    name: textInput({ value: d.name, maxlength: 120 }),
    website: textInput({ value: d.website ?? '', placeholder: 'https://…' }),
    investor_type: selectInput([['', 'Not known'], ...vocab.types], d.investor_type ?? ''),
    inclusion_basis: selectInput([['', 'Not known'], ...vocab.bases.map((b) => [b, BASIS[b] ?? b])], d.inclusion_basis ?? ''),
    headquarters_city: textInput({ value: d.headquarters_city ?? '', maxlength: 120 }),
    state: selectInput([['', 'No state'], ...AU_STATES.map((s) => [s, s])], d.state ?? ''),
    country: textInput({ value: d.country ?? '', maxlength: 120, placeholder: 'For example: Australia' }),
    other_offices: textArea({ value: d.other_offices.join('\n'), rows: 2 }),
    sectors: textArea({ value: d.sectors.join('\n'), rows: 2 }),
    geographies: textArea({ value: d.geographies.join('\n'), rows: 2 }),
    cheque_min: textInput({ inputmode: 'numeric', value: cheque.min ?? '', placeholder: 'For example: 250000' }),
    cheque_max: textInput({ inputmode: 'numeric', value: cheque.max ?? '', placeholder: 'For example: 1000000' }),
    cheque_currency: textInput({ value: d.cheque_currency ?? '', maxlength: 3, placeholder: 'AUD' }),
    lead_or_follow: selectInput([['', 'Not known'], ...vocab.lead_or_follow.map((v) => [v, capitalise(v)])], d.lead_or_follow ?? ''),
    active_status: selectInput([['', 'Not known'], ['active', 'Investing'], ['inactive', 'No longer investing']], d.active_status ?? ''),
    application_url: textInput({ value: d.application_url ?? '', placeholder: 'https://…' }),
    jobs_url: textInput({ value: d.jobs_url ?? '', placeholder: 'https://…' }),
    description: textArea({ value: d.description ?? '', rows: 3, maxlength: 1200 }),
    investment_thesis: textArea({ value: d.investment_thesis ?? '', rows: 3, maxlength: 1200 }),
    reason: textArea({ rows: 2, maxlength: 500 }),
  };
  const page = pageFields({ optional: true });
  modal({
    title: `Edit ${d.name}`, size: 'lg',
    lead: 'Each claim you set or change needs the page that states it, and the words on that page. Clearing one needs none. Leave a field empty when no page says it: nothing is guessed.',
    body: [
      h('div', { class: 'block' }, fieldOf('Name', f.name, { hint: 'A new name keeps the old one as another name, so companies that use it still find this record.' }), fieldOf('Website', f.website, { hint: 'Its own site. Leave empty to remove it.' })),
      rowOf(fieldOf('Type of investor', f.investor_type), fieldOf('Why it is listed', f.inclusion_basis)),
      rowOf(fieldOf('Headquarters city', f.headquarters_city), fieldOf('State', f.state), fieldOf('Country', f.country)),
      fieldOf('Other offices', f.other_offices, { hint: 'One per line.' }),
      h('fieldset', {}, h('legend', {}, 'Stages it invests at'), h('div', { class: 'checks' }, stageBoxes.map((b) => b.node))),
      rowOf(fieldOf('Sectors', f.sectors, { hint: 'One per line, as the page words them.' }), fieldOf('Where it invests', f.geographies, { hint: 'One per line.' })),
      h('div', { class: 'block' }, h('p', { class: 'field__label' }, 'Cheque size'), h('p', { class: 'field__hint' }, 'Only an amount a page states. It is shown on the site only for a stated Australian-dollar range.'),
        rowOf(fieldOf('From', f.cheque_min, { optional: true }), fieldOf('To', f.cheque_max, { optional: true }), fieldOf('Currency', f.cheque_currency, { optional: true }))),
      rowOf(fieldOf('Leads or follows', f.lead_or_follow), fieldOf('Investing now', f.active_status)),
      rowOf(fieldOf('How to apply', f.application_url, { optional: true }), fieldOf('Its jobs page', f.jobs_url, { optional: true })),
      fieldOf('About', f.description),
      fieldOf('Investment thesis', f.investment_thesis, { hint: 'What it says it looks for, in its own words.' }),
      page.node,
      fieldOf('Why', f.reason, { optional: true }),
    ],
    submitLabel: 'Save changes',
    onSubmit: async () => {
      const patch = {};
      const text = (key, current) => { const next = norm(f[key].value); if (next !== norm(current ?? '')) patch[key] = next || null; };
      const pick = (key, current) => { if (f[key].value !== (current ?? '')) patch[key] = f[key].value || null; };
      const list = (key, current) => { if (JSON.stringify(lines(f[key].value)) !== JSON.stringify(current)) patch[key] = lines(f[key].value); };
      const amount = (key, current) => {
        const raw = norm(f[key].value);
        const next = raw === '' ? null : Number(raw.replace(/[, ]/g, ''));
        if (next != null && (!Number.isFinite(next) || next < 0)) { f[key].focus(); throw new Error('A cheque size is a number of dollars: 250000, not “250k”.'); }
        if (next !== (current ?? null)) patch[key === 'cheque_min' ? 'typical_cheque_min' : 'typical_cheque_max'] = next;
      };
      if (!norm(f.name.value)) { f.name.focus(); throw new Error('The name cannot be empty.'); }
      text('name', d.name); text('website', d.website); pick('investor_type', d.investor_type); pick('inclusion_basis', d.inclusion_basis);
      text('headquarters_city', d.headquarters_city); pick('state', d.state); text('country', d.country);
      list('other_offices', d.other_offices); list('sectors', d.sectors); list('geographies', d.geographies);
      const chosen = stageBoxes.filter((b) => b.input.checked).map((b) => b.s);
      if (JSON.stringify(chosen) !== JSON.stringify(vocab.stages.filter((s) => d.stages.includes(s)))) patch.stages = chosen;
      amount('cheque_min', cheque.min); amount('cheque_max', cheque.max);
      const currency = norm(f.cheque_currency.value).toUpperCase();
      if (currency !== (d.cheque_currency ?? '')) patch.cheque_currency = currency || null;
      pick('lead_or_follow', d.lead_or_follow); pick('active_status', d.active_status);
      text('application_url', d.application_url); text('jobs_url', d.jobs_url); text('description', d.description); text('investment_thesis', d.investment_thesis);
      if (!Object.keys(patch).length) throw new Error('Nothing was changed.');
      const r = await api.post(`/api/investors/${row.id}/edit`, { patch, source: page.read(), reason: norm(f.reason.value) });
      toast(`Saved ${r.changed.map((c) => fieldLabel(c).toLowerCase()).join(', ')}.${r.status !== d.status ? ` It is now “${(STATUS[r.status] ?? [r.status])[0]}”.` : ''}`);
      await afterInvestorChange(row.id);
    },
  });
}

// A value the record holds that no page backs: say which page states it. The value stays as it is; the page, and the words copied
// from it, are recorded as its source, so the record can be checked and published.
function backClaimDialog(d, fields) {
  const page = pageFields({ title: 'The page that states it' });
  const reason = textArea({ rows: 2, maxlength: 500 });
  const names = fields.map(([f]) => fieldLabel(f).toLowerCase()).join(', ');
  modal({
    title: `Add the page that states ${d.name}’s ${names}`, size: 'lg',
    lead: 'The record keeps what it says. The page is recorded as what backs it, with the words you copy from it, so anyone can check it.',
    body: [
      h('dl', { class: 'kv' }, fields.map(([f, v]) => kv(fieldLabel(f), fmtClaim(f, v)))),
      page.node,
      fieldOf('Why', reason, { optional: true }),
    ],
    submitLabel: 'Record the page',
    onSubmit: async () => {
      const source = page.read({ required: true });
      await api.post(`/api/investors/${d.id}/edit`, { patch: Object.fromEntries(fields), source, reason: norm(reason.value) });
      toast(`Recorded the page that states ${names}.`);
      await afterInvestorChange(d.id);
    },
  });
}

// ---------- merge ----------

const STATUS_RANK = { published: 0, inactive: 1, verified: 2, needs_review: 3, candidate: 4, rejected: 5 };

function mergeInvestorDialog(row) {
  let chosen = null;
  const q = textInput({ type: 'search', placeholder: 'Search investors by name or website', maxlength: 80 });
  const list = h('div', { role: 'radiogroup', 'aria-label': 'Investors' });
  const heard = h('p', { class: 'field__hint' }, 'Type at least two letters.');
  const reason = textArea({ rows: 2, maxlength: 500, placeholder: 'For example: the same firm; one record is its legal name.' });
  const paint = (found) => {
    list.replaceChildren(...found.map((c) => choice({
      name: 'merge-investor-into', value: c.id, checked: chosen?.id === c.id, title: c.name,
      text: [c.type_label, c.location, c.website && hostOf(c.website), (STATUS[c.status] ?? [c.status])[0]].filter(Boolean).join(' · '), onChange: () => { chosen = { id: c.id, name: c.name }; },
    }).node));
  };
  const search = debounce(async () => {
    const term = norm(q.value);
    heard.textContent = term.length < 2 ? 'Type at least two letters.' : '';
    if (term.length < 2) { paint([]); return; }
    try {
      const r = await api.get(`/api/investors?status=all&q=${enc(term)}&limit=8`);
      paint(r.results.filter((c) => c.id !== row.id && c.status !== 'rejected'));
      if (!list.children.length) heard.textContent = 'No other investor matches.';
    } catch (err) { heard.textContent = err.message; }
  }, 250);
  q.addEventListener('input', search);
  modal({
    title: `Merge ${row.name} into another investor`,
    lead: 'Say two records are one firm. The one you pick is kept.',
    body: [
      callout(h('b', {}, 'This changes the record. '), `${row.name} is deleted: its name and other names become other names of the one you keep, and its funds, investments, team records and the pages behind its claims move across. What the kept record says stays; a disagreement shows up as a conflict for a person to settle.`),
      fieldOf('Keep this investor', q), heard, list,
      fieldOf('Why', reason, { hint: 'Required. Kept with your name in the audit trail.' }),
    ],
    submitLabel: 'Merge',
    onSubmit: async () => {
      if (!chosen) throw new Error('Choose the investor to keep.');
      const r = await api.post(`/api/investors/${row.id}/merge`, { into: chosen.id, reason: needReason(reason) });
      toast(`Merged ${row.name} into ${chosen.name}: ${plural(r.moved.investments, 'investment')}, ${plural(r.moved.team, 'team record')} and ${plural(r.moved.records, 'page record')} moved.`);
      await afterInvestorChange(row.id, { gone: true });
    },
  });
}

// Several records that look like one firm: pick the one to keep, and the others are merged into it, one after the other.
function mergeGroupDialog(group) {
  const rank = (m) => STATUS_RANK[m.status] ?? 9;
  let keep = [...group.members].sort((a, b) => rank(a) - rank(b))[0].id;
  const name = uid('keep');
  const reason = textArea({ rows: 2, maxlength: 500, placeholder: 'For example: the same firm under two names.' });
  const options = group.members.map((m) => choice({ name, value: m.id, checked: m.id === keep, title: m.name, text: [(STATUS[m.status] ?? [m.status])[0], m.website && hostOf(m.website)].filter(Boolean).join(' · '), onChange: () => { keep = m.id; } }));
  modal({
    title: `Merge ${group.names.join(' and ')}`,
    lead: `They look alike: ${group.reason}.`,
    body: [
      callout(h('b', {}, 'This changes the record. '), 'The records you do not keep are deleted. Their names become other names of the one you keep, and their funds, investments, team records and the pages behind their claims move across.'),
      h('fieldset', {}, h('legend', {}, 'Keep'), options.map((o) => o.node)),
      fieldOf('Why', reason, { hint: 'Required. Kept with your name in the audit trail.' }),
    ],
    submitLabel: 'Merge',
    onSubmit: async () => {
      const why = needReason(reason);
      const kept = group.members.find((m) => m.id === keep);
      if (kept.status === 'rejected') throw new Error('Keep a record that is not rejected.');
      let merged = 0;
      try {
        for (const m of group.members.filter((x) => x.id !== keep)) {
          await api.post(`/api/investors/${m.id}/merge`, { into: keep, reason: why });
          merged += 1;
        }
      } finally { if (merged) await refreshAll(); }
      toast(`Merged ${plural(merged, 'record')} into ${kept.name}.`);
    },
  });
}

// ---------- what two pages disagree about ----------

function resolveInvestorConflictDialog(c, start) {
  let picked = start;
  const group = uid('winner');
  const reason = textArea({ rows: 2, maxlength: 500, placeholder: 'For example: the fund’s own site is newer than the press piece.' });
  const options = c.values.map((v, i) => choice({
    name: group, value: String(i), checked: i === picked, title: `Source ${String.fromCharCode(65 + i)}: ${fmtClaim(c.field, v.value)}`,
    text: v.evidence.map((e) => `${e.source?.title ?? 'A page'}${e.note ? ` — “${clip(e.note, 120)}”` : ''}`).join(' · ') || 'A page on record', onChange: () => { picked = i; },
  }));
  modal({
    title: `${c.name}: ${fieldLabel(c.field).toLowerCase()}`, size: 'lg',
    lead: c.kind === 'sources_disagree' ? 'Two pages give different answers.' : 'A page disagrees with what the record says.',
    body: [
      h('fieldset', {}, h('legend', {}, 'Which is right?'), options.map((o) => o.node)),
      callout('The other claims are turned down and kept with your reason, so they are not added again. The record then says what the page you chose says.'),
      fieldOf('Why', reason, { hint: 'Required. Kept with your name in the audit trail.' }),
    ],
    submitLabel: 'Settle conflict',
    onSubmit: async () => {
      const why = needReason(reason);
      const r = await api.post('/api/investors/resolve', { subject_id: c.subject_id, field: c.field, value: c.values[picked].value, reason: why });
      toast(`Settled ${c.name}’s ${fieldLabel(c.field).toLowerCase()}.${r.turned_down ? ` ${plural(r.turned_down, 'claim')} turned down.` : ''}`);
      await afterInvestorChange(c.subject_id);
    },
  });
}

// ---------- who it backed ----------

// A company the investor backed, with the page that says so. Every such link has one; none is added without.
function addInvestmentDialog(d, company = null) {
  let chosen = company;
  const q = textInput({ type: 'search', placeholder: 'Search companies by name or website', value: company?.name ?? '' });
  const list = h('div', { role: 'radiogroup', 'aria-label': 'Companies' });
  const heard = h('p', { class: 'field__hint' }, company ? '' : 'Type at least two letters.');
  const round = textInput({ maxlength: 80, placeholder: 'For example: Seed' });
  const when = textInput({ maxlength: 10, placeholder: 'YYYY, YYYY-MM or YYYY-MM-DD' });
  const amount = textInput({ inputmode: 'numeric', placeholder: 'Only if the page states it' });
  const currency = textInput({ maxlength: 3, placeholder: 'AUD' });
  const lead = selectInput([['', 'Not stated'], ...(slotOf('investors')?.vocab.lead_status ?? []).map((v) => [v, capitalise(v)])], '');
  const page = pageFields({ title: 'The page that says it backed the company' });
  const reason = textArea({ rows: 2, maxlength: 500 });
  const paint = (found) => {
    list.replaceChildren(...found.map((c) => choice({ name: 'invest-company', value: c.id, checked: chosen?.id === c.id, title: c.name, text: [c.city, c.website && hostOf(c.website)].filter(Boolean).join(' · ') || 'Company', onChange: () => { chosen = { id: c.id, name: c.name }; } }).node));
  };
  const search = debounce(async () => {
    const term = norm(q.value);
    heard.textContent = term.length < 2 ? 'Type at least two letters.' : '';
    if (term.length < 2) { paint([]); return; }
    try { paint(await api.get(`/api/companies?q=${enc(term)}`)); if (!list.children.length) heard.textContent = 'No company matches.'; } catch (err) { heard.textContent = err.message; }
  }, 250);
  q.addEventListener('input', search);
  if (company) search();
  modal({
    title: `Record a company ${d.name} backed`, size: 'lg',
    lead: 'The company must already be in the directory: the existing duplicate checks decide that, not this form.',
    body: [
      fieldOf('Company', q), heard, list,
      rowOf(fieldOf('Round', round, { optional: true }), fieldOf('When', when, { optional: true })),
      rowOf(fieldOf('Amount', amount, { optional: true }), fieldOf('Currency', currency, { optional: true }), fieldOf('Led or joined', lead, { optional: true })),
      page.node,
      fieldOf('Why', reason, { optional: true }),
    ],
    submitLabel: 'Record investment',
    onSubmit: async () => {
      if (!chosen) throw new Error('Choose the company.');
      const source = page.read({ required: true });
      const r = await api.post('/api/investments', {
        investor_id: d.id, company_id: chosen.id, round: norm(round.value) || null, investment_date: norm(when.value) || null,
        amount: norm(amount.value) ? Number(norm(amount.value).replace(/[, ]/g, '')) : null, currency: norm(currency.value).toUpperCase() || null,
        lead_status: lead.value || null, source, reason: norm(reason.value),
      });
      toast(`Recorded that ${d.name} backed ${chosen.name}.`);
      await afterInvestorChange(d.id);
      return r;
    },
  });
}

function rejectInvestmentDialog(d, inv) {
  const reason = textArea({ rows: 3, maxlength: 500, placeholder: 'For example: the page names a different company with the same name.' });
  modal({
    title: `Turn down ${d.name} → ${inv.company}?`,
    body: [callout('It is kept, with your reason, and is no longer shown as portfolio. A page that is later found can record it again.'), fieldOf('Why', reason, { hint: 'Required. Kept with your name in the audit trail.' })],
    submitLabel: 'Turn down', tone: 'danger',
    onSubmit: async () => {
      await api.post(`/api/investments/${inv.id}/reject`, { reason: needReason(reason) });
      toast(`Turned down the link to ${inv.company}.`);
      await afterInvestorChange(d.id);
    },
  });
}

// ---------- people ----------

function personRejectDialog(d, m) {
  const reason = textArea({ rows: 3, maxlength: 500, placeholder: 'For example: not at this firm.' });
  modal({
    title: `Reject ${m.person}?`,
    body: [callout('The person is kept, with your reason, and is not published.'), fieldOf('Why', reason, { hint: 'Required. Kept with your name in the audit trail.' })],
    submitLabel: 'Reject', tone: 'danger',
    onSubmit: async () => {
      await api.post(`/api/investor-people/${m.person_id}/reject`, { reason: needReason(reason) });
      toast(`Rejected ${m.person}.`);
      await afterInvestorChange(d.id);
    },
  });
}

async function personStep(d, m, action) {
  await api.post(`/api/investor-people/${m.person_id}/${action}`, {});
  toast({ approve: `Approved ${m.person}. Not public until published.`, publish: `Published ${m.person}. Commit the data files to make it live.`, unpublish: `${m.person} is off the public directory.` }[action]);
  await afterInvestorChange(d.id);
}

// ---------- one investor in full ----------

async function openInvestor(id) {
  if (S.drawer) S.drawer.dlg.close();
  const opener = document.activeElement;
  const fk = opener?.dataset?.fk ?? null;
  const title = h('h2', { class: 'dlg__title', id: 'drawer-title' }, 'Loading…');
  const chips = h('div', { class: 'chips' });
  const body = h('div', { class: 'dlg__body' }, skeletonRows(6));
  const foot = h('footer', { class: 'dlg__foot' });
  const dlg = h('dialog', { class: 'dlg dlg--drawer', 'aria-labelledby': 'drawer-title' },
    h('div', { class: 'dlg__form' },
      h('header', { class: 'dlg__head' }, h('div', {}, title, chips), h('button', { type: 'button', class: 'btn btn--ghost btn--sm', 'aria-label': 'Close', on: { click: () => dlg.close() } }, icon('x', 16))),
      body, foot));
  const drawer = { id, kind: 'investor', dlg, section: 'investors', async reload() { await fill(); } };
  async function fill() {
    const d = await api.get(`/api/investors/${id}`);
    title.textContent = d.name;
    chips.replaceChildren(...[statusChip(d.status), d.type_label && chip(d.type_label, 'muted', true), d.active_status === 'inactive' && d.status !== 'inactive' && chip('No longer investing', 'muted')].filter(Boolean));
    body.replaceChildren(investorDrawerContent(d));
    foot.replaceChildren(...investorButtons(d, { drawer: true }), btn('Close', { onClick: () => dlg.close() }));
  }
  dlg.addEventListener('close', () => { dlg.remove(); if (S.drawer === drawer) S.drawer = null; restoreFocus(fk, 'investors'); });
  document.body.append(dlg);
  S.drawer = drawer;
  dlg.showModal();
  try { await fill(); } catch (err) { dlg.close(); throw err; }
}

function investorDrawerContent(d) {
  const backed = new Set(d.records.filter((r) => r.status === 'active').map((r) => r.field));
  const cheque = d.typical_cheque_min == null && d.typical_cheque_max == null ? null : { min: d.typical_cheque_min, max: d.typical_cheque_max, currency: d.cheque_currency };
  // A claim's row: what it says, or Unknown. When no page backs it, a plain warning and a way to say which page does (the value
  // stays as it is: the page is recorded as its source). `patch` is the fields that make the claim, as the edit form sends them.
  const claimOf = (f) => (['typical_cheque_min', 'typical_cheque_max', 'cheque_currency'].includes(f) ? 'typical_cheque' : f);
  const claim = (field, value, node = null, patch = [[field, value]], label = fieldLabel(field)) => {
    const has = value != null && value !== '' && !(Array.isArray(value) && !value.length);
    if (!has) return kv(label, unknown());
    const lacking = patch.filter(([f]) => !backed.has(claimOf(f)));
    return kv(label, [node ?? fmtClaim(field, value), lacking.length > 0 && [' ', chip('No page backs this', 'warn', true),
      can('investor.edit') && [' ', btn('Add the page', { small: true, variant: 'ghost', fk: `inv:${d.id}:back:${field}`, attrs: { 'aria-label': `Add the page that states ${label.toLowerCase()}` }, onClick: () => backClaimDialog(d, lacking) })]]]);
  };
  const link = (url) => (url ? extLink(url, hostOf(url)) : null);
  const placed = [['headquarters_city', d.headquarters_city], ['state', d.state], ['country', d.country]].filter(([, v]) => v);
  const place = placed.map(([, v]) => v).join(', ');
  const records = d.records.filter((r) => r.status === 'active');
  const earlier = d.records.filter((r) => r.status !== 'active');
  const recordsTable = (rows, caption) => h('div', { class: 'mini-wrap' }, h('table', { class: 'mini', role: 'table' },
    h('caption', { class: 'sr' }, caption),
    h('thead', { role: 'rowgroup' }, h('tr', { role: 'row' }, ['Claim', 'Says', 'Page', 'Checked'].map((c) => h('th', { scope: 'col', role: 'columnheader' }, c)))),
    h('tbody', { role: 'rowgroup' }, rows.map((r) => h('tr', { role: 'row' },
      h('td', { role: 'cell' }, fieldLabel(r.field), r.status !== 'active' && h('div', { class: 'sub' }, r.status === 'superseded' ? 'Replaced' : 'Turned down')),
      h('td', { role: 'cell' }, clip(fmtClaim(r.field, r.value), 160)),
      h('td', { role: 'cell' }, r.source && safeHref(r.source.url) ? extLink(r.source.url, r.source.title || hostOf(r.source.url)) : (r.source?.title ?? 'A page'),
        h('div', { class: 'sub' }, [kindLabel(r.source?.kind), r.confidence && `${r.confidence} confidence`].filter(Boolean).join(' · ')),
        r.note && h('div', { class: 'sub' }, `“${clip(r.note, 220)}”`)),
      h('td', { role: 'cell', class: 'nowrap' }, r.verified_at ? fmtDate(r.verified_at) : '—'))))));
  const live = d.investments.filter((i) => i.status !== 'rejected');
  const turnedDown = d.investments.filter((i) => i.status === 'rejected');
  return h('div', {},
    d.check_problems.length > 0 && callout(h('b', {}, 'It says things no page backs. '), d.check_problems.join('; '), '. It cannot stay verified or published until each has a page.'),
    block('What the record says', h('dl', { class: 'kv' },
      claim('name', d.name),
      claim('website', d.website, d.website ? extLink(d.website, hostOf(d.website)) : null),
      claim('investor_type', d.investor_type),
      claim('inclusion_basis', d.inclusion_basis),
      claim('headquarters_city', place || null, place, placed, 'Headquarters'),
      claim('other_offices', d.other_offices),
      claim('stages', d.stages),
      claim('sectors', d.sectors),
      claim('geographies', d.geographies),
      claim('typical_cheque', cheque, null, [['typical_cheque_min', d.typical_cheque_min], ['typical_cheque_max', d.typical_cheque_max], ['cheque_currency', d.cheque_currency]].filter(([, v]) => v != null)),
      claim('lead_or_follow', d.lead_or_follow),
      claim('active_status', d.active_status),
      claim('application_url', d.application_url, link(d.application_url)),
      claim('jobs_url', d.jobs_url, link(d.jobs_url)),
      claim('description', d.description),
      claim('investment_thesis', d.investment_thesis),
      kv('Other names', d.aliases.length ? d.aliases.join(' · ') : unknown()),
      kv('Last checked', d.last_verified_at ? `${fmtDate(d.last_verified_at)} (${relative(d.last_verified_at)})` : h('span', { class: 'muted' }, 'Never')))),
    d.issues.length > 0 && block('What needs a person', h('div', { class: 'list' }, d.issues.map((i) => h('div', {},
      h('div', { class: 'list__title' }, chip(i.label, SEVERITY_TONE[i.severity] ?? 'muted', true), i.detail ? ` ${i.detail}` : ''),
      h('div', { class: 'sub' }, issueNote(i.code)))))),
    d.conflicts.length > 0 && block(`Sources disagree (${d.conflicts.length})`, d.conflicts.map((c) => investorConflict(c, { inDrawer: true }))),
    d.duplicates.length > 0 && block('Looks like another record', h('div', { class: 'list' }, d.duplicates.map((g) => h('div', {}, h('div', { class: 'list__title' }, capitalise(g.reason)), h('div', { class: 'sub' }, g.names.join(' · ')))))),
    block(`What the pages say (${records.length})`, records.length ? recordsTable(records, 'Claims and the pages that state them') : h('p', { class: 'muted' }, 'No page is on record for any claim yet. Add one by editing the record, naming the page and what it says.'),
      earlier.length > 0 && h('details', { class: 'fold' }, h('summary', {}, `Replaced and turned-down claims (${earlier.length})`), h('div', { class: 'fold__body' }, recordsTable(earlier, 'Replaced and turned-down claims')))),
    block(`Companies it backed (${live.length})`,
      live.length ? h('div', { class: 'mini-wrap' }, h('table', { class: 'mini', role: 'table' },
        h('caption', { class: 'sr' }, 'Companies backed'),
        h('thead', { role: 'rowgroup' }, h('tr', { role: 'row' }, ['Company', 'Round', 'When', 'Page', 'Status', ''].map((c) => h('th', { scope: 'col', role: 'columnheader' }, c)))),
        h('tbody', { role: 'rowgroup' }, live.map((i) => h('tr', { role: 'row' },
          h('td', { role: 'cell' }, h('b', {}, i.company), i.lead_status && h('div', { class: 'sub' }, capitalise(i.lead_status)), i.amount != null && h('div', { class: 'sub' }, audMoney(i.amount, i.currency ?? 'AUD'))),
          h('td', { role: 'cell' }, i.round ?? '—'), h('td', { role: 'cell', class: 'nowrap' }, i.investment_date ?? '—'),
          h('td', { role: 'cell' }, i.source && safeHref(i.source.url) ? extLink(i.source.url, i.source.title || hostOf(i.source.url)) : (i.source?.title ?? 'A page'), i.note && h('div', { class: 'sub' }, `“${clip(i.note, 200)}”`)),
          h('td', { role: 'cell' }, statusChip(i.status)),
          h('td', { role: 'cell' }, can('investment.reject') && btn('Turn down', { small: true, variant: 'ghost', fk: `inv:${d.id}:rej:${i.id}`, attrs: { 'aria-label': `Turn down the link to ${i.company}` }, onClick: () => rejectInvestmentDialog(d, i) })))))))
      : h('p', { class: 'muted' }, 'No company is linked to it with a page that says so.'),
      turnedDown.length > 0 && h('p', { class: 'sub' }, `${plural(turnedDown.length, 'link')} turned down: ${turnedDown.map((i) => i.company).join(', ')}.`),
      can('investment.add') && h('p', {}, btn('Record a company it backed', { small: true, icon: 'plus', fk: `inv:${d.id}:addinv`, onClick: () => addInvestmentDialog(d) }))),
    d.unsourced_companies.length > 0 && block(`Companies that name it, with no page (${d.unsourced_companies.length})`,
      h('p', { class: 'sub' }, 'These company records list it as an investor, and no page that states it is on record. They are not shown as its portfolio until one is.'),
      h('div', { class: 'list' }, d.unsourced_companies.map((u) => h('div', {}, h('div', { class: 'list__title' }, u.name),
        can('investment.add') && h('div', {}, btn('Add the page', { small: true, fk: `inv:${d.id}:src:${u.company_id}`, attrs: { 'aria-label': `Add the page that says ${d.name} backed ${u.name}` }, onClick: () => addInvestmentDialog(d, { id: u.company_id, name: u.name }) })))))),
    d.team.length > 0 && block(`Team (${d.team.length})`, h('div', { class: 'mini-wrap' }, h('table', { class: 'mini', role: 'table' },
      h('caption', { class: 'sr' }, 'Team'),
      h('thead', { role: 'rowgroup' }, h('tr', { role: 'row' }, ['Person', 'Role', 'Page', 'Status', ''].map((c) => h('th', { scope: 'col', role: 'columnheader' }, c)))),
      h('tbody', { role: 'rowgroup' }, d.team.map((m) => h('tr', { role: 'row' },
        h('td', { role: 'cell' }, h('b', {}, m.person)), h('td', { role: 'cell' }, m.role, m.is_current === false && h('div', { class: 'sub' }, 'Former')),
        h('td', { role: 'cell' }, m.source && safeHref(m.source.url) ? extLink(m.source.url, m.source.title || hostOf(m.source.url)) : (m.source?.title ?? '—'), m.verified_at && h('div', { class: 'sub' }, `checked ${fmtDate(m.verified_at)}`)),
        h('td', { role: 'cell' }, statusChip(m.person_status ?? m.status)),
        h('td', { role: 'cell' }, h('div', { class: 'actions' }, personButtons(d, m))))))))),
    d.funds.length > 0 && block(`Funds (${d.funds.length})`, h('div', { class: 'list' }, d.funds.map((f) => h('div', {}, h('div', { class: 'list__title' }, f.name, f.vintage_year ? ` · ${f.vintage_year}` : ''), h('div', { class: 'sub' }, (STATUS[f.status] ?? [f.status])[0]))))));
}

function personButtons(d, m) {
  const steps = {
    candidate: ['approve', 'reject'], needs_review: ['approve', 'reject'], verified: ['publish', 'reject'], published: ['unpublish'], inactive: ['unpublish'],
  }[m.person_status] ?? [];
  const perm = { approve: 'person.approve', reject: 'person.reject', publish: 'person.publish', unpublish: 'person.unpublish' };
  return steps.filter((a) => can(perm[a])).map((a) => btn(capitalise(a), {
    small: true, variant: a === 'approve' || a === 'publish' ? 'primary' : 'ghost', fk: `inv:${d.id}:p:${m.person_id}:${a}`, attrs: { 'aria-label': `${capitalise(a)} ${m.person}` },
    onClick: () => (a === 'reject' ? personRejectDialog(d, m) : personStep(d, m, a)),
  }));
}

function investorsFooter() {
  return h('p', { class: 'stamp' }, 'From a terminal: ', h('code', {}, 'npm run investors -- status'), ', ', h('code', {}, 'review'), ', ', h('code', {}, 'import'), ' and ', h('code', {}, 'publish'),
    ' do the same work, under the same rules and the same audit trail. Corrections visitors suggest are listed by ', h('code', {}, 'GET /api/investors/corrections'), ' on the live API, with the admin key.');
}

// ======================================================================= conflicts

function renderConflicts() {
  const body = $('#body-conflicts');
  if (!body) return;
  keepFocus(body, () => body.replaceChildren(view('conflicts', (list) => {
    if (!list.length) return emptyBox('No open conflicts.', 'When two sources disagree about a fact, or a source disagrees with our record, it appears here for a person to settle.');
    const fields = [...new Set(list.map((c) => c.field))];
    const f = fields.includes(S.ui.conflictField) ? S.ui.conflictField : 'all';
    const rows = list.filter((c) => f === 'all' || c.field === f);
    const shown = rows.slice(0, S.ui.conflictShown);
    return h('div', {},
      h('div', { class: 'toolbar' },
        seg([{ key: 'all', text: 'All', count: list.length }, ...fields.map((k) => ({ key: k, text: fieldLabel(k), count: list.filter((c) => c.field === k).length }))], f, (key) => { S.ui.conflictField = key; S.ui.conflictShown = 8; renderConflicts(); }, 'Field', 'conflict-field'),
        !can('conflict.resolve') && h('p', { class: 'toolbar__note' }, 'Settling a conflict needs the admin role.')),
      shown.map((c) => conflictItem(c)),
      pager(shown.length, rows.length, () => { S.ui.conflictShown += 10; renderConflicts(); }, 'conflicts'));
  }, { skeleton: () => skeletonRows(5) })));
}

function sourceLines(evidence) {
  const lines$ = evidence.slice(0, 3).map((e) => h('p', { class: 'side__meta' },
    safeHref(e.source.url) ? extLink(e.source.url, e.source.title || kindLabel(e.source.kind)) : (e.source.title || kindLabel(e.source.kind)),
    ` · ${kindLabel(e.source.kind).toLowerCase()}${e.source.retrieved_at ? ` · read ${fmtDate(e.source.retrieved_at)}` : ''}`));
  if (evidence.length > 3) lines$.push(h('p', { class: 'side__meta' }, `+${evidence.length - 3} more sources`));
  return lines$;
}

function conflictItem(c) {
  const showStored = c.stored != null && !c.sides.some((s) => s.matches_stored);
  const settle = (winner) => (can('conflict.resolve') ? btn(winner === 'stored' ? 'Keep our record' : 'This one is right', { small: true, fk: `conflict:${c.company_id}:${c.field}:${typeof winner === 'string' ? winner : winner.index}`, attrs: { 'aria-label': `${winner === 'stored' ? 'Keep our record' : `Source ${String.fromCharCode(65 + winner.index)} is right`} for ${c.company_name}’s ${fieldLabel(c.field).toLowerCase()}` }, onClick: () => resolveDialog(c, winner) }) : null);
  return h('article', { class: 'conflict', 'aria-label': `${c.company_name}: ${fieldLabel(c.field)}` },
    h('div', { class: 'conflict__head' },
      h('span', { class: 'conflict__title' }, c.company_name), chip(fieldLabel(c.field), 'muted', true),
      chip(c.kind === 'sources_disagree' ? 'Sources disagree' : 'A source disagrees with our record', 'warn'),
      c.location && c.pinned && chip('On the public map', 'info', true)),
    h('div', { class: 'sides' },
      showStored && h('div', { class: 'side' }, h('span', { class: 'side__label' }, 'Our record'), h('span', { class: 'side__value' }, fmtValue(c.stored)), h('div', { class: 'side__act' }, settle('stored'))),
      c.sides.map((s, i) => h('div', { class: 'side' },
        h('span', { class: 'side__label' }, c.kind === 'stored_differs' && c.sides.length === 1 ? 'Source A' : `Source ${String.fromCharCode(65 + i)}`),
        h('span', { class: 'side__value' }, fmtValue(s.value)),
        h('div', { class: 'chips' }, confidenceChip(s.confidence), s.matches_stored && chip('Matches our record', 'ok')),
        sourceLines(s.evidence),
        h('div', { class: 'side__act' }, settle({ index: i }))))));
}

function resolveDialog(c, start) {
  let winner = start === 'stored' ? 'stored' : start.index;
  let record = null;
  const group = uid('winner');
  const where = locationFields({ city: c.city ?? '' }, { companyId: c.company_id });
  const confirmBox = h('div', { class: 'nested', hidden: true }, where.node);
  const recordGroup = h('fieldset', { hidden: true });
  const reason = textArea({ rows: 2, maxlength: 500, placeholder: 'For example: the privacy policy lists the registered office, not the HQ.' });

  const options = [];
  if (c.stored != null) options.push({ key: 'stored', title: 'Our record', value: c.stored, text: c.sides.some((s) => s.matches_stored) ? 'Matches one of the sources.' : 'What the directory says now.' });
  c.sides.forEach((s, i) => options.push({ key: i, title: c.kind === 'stored_differs' && c.sides.length === 1 ? 'Source A' : `Source ${String.fromCharCode(65 + i)}`, value: s.value, text: `${s.evidence[0]?.source.title || kindLabel(s.evidence[0]?.source.kind)}${s.evidence.length > 1 ? ` and ${s.evidence.length - 1} more` : ''} · ${s.confidence} confidence${s.matches_stored ? ' · matches our record' : ''}` }));

  const sideOf = () => (winner === 'stored' ? null : c.sides[winner]);
  const changesRecord = () => (winner === 'stored' ? false : !sideOf().matches_stored && c.stored != null);
  const explain = h('p', { class: 'callout' });
  const paint = () => {
    const w = winner === 'stored' ? c.stored : sideOf().value;
    explain.replaceChildren(h('b', {}, `${fmtValue(w)} will be treated as right. `), 'The other claims are turned down and kept with your reason, so they are not added again.', !c.location && changesRecord() ? ` The record will change from ${fmtValue(c.stored)} to ${fmtValue(w)}.` : '');
    if (!c.location) return;
    recordGroup.hidden = false;
    const mustChoose = changesRecord();
    keepChoice.input.disabled = mustChoose;
    if (mustChoose && record === 'keep') { record = null; keepChoice.input.checked = false; }
    if (!mustChoose && record == null) { record = 'keep'; keepChoice.input.checked = true; }
    keepChoice.node.querySelector('.choice__text').replaceChildren(mustChoose ? 'Not possible: the record would still disagree with the claim you chose.' : 'The record already says this.');
  };
  const keepChoice = choice({ name: uid('record'), value: 'keep', title: 'Leave the record as it is', text: '', onChange: () => { record = 'keep'; confirmBox.hidden = true; } });
  const recordName = keepChoice.input.name;
  const confirmChoice = choice({ name: recordName, value: 'confirm', title: 'Confirm a place', text: 'Say how exactly it is known: an office, a suburb, only the city or the state.', nested: confirmBox, onChange: () => { record = 'confirm'; confirmBox.hidden = false; } });
  const offChoice = choice({ name: recordName, value: 'unconfirm', title: 'Take the company off the map', text: 'Its location becomes “Unconfirmed”: still listed, not pinned.', onChange: () => { record = 'unconfirm'; confirmBox.hidden = true; } });
  recordGroup.append(h('legend', {}, 'What should the record do?'), h('p', { class: 'field__hint' }, 'A pin on the map is public, so moving a company needs a confirmed place, or taking it off the map.'), keepChoice.node, confirmChoice.node, offChoice.node);

  const winners = options.map((o) => choice({ name: group, value: String(o.key), checked: o.key === winner, title: `${o.title}: ${fmtValue(o.value)}`, text: o.text, onChange: () => { winner = o.key; paint(); } }));
  paint();
  modal({
    title: `${c.company_name}: ${fieldLabel(c.field).toLowerCase()}`, size: 'lg',
    lead: c.kind === 'sources_disagree' ? 'Two sources give different answers.' : 'A source disagrees with what the directory says.',
    body: [h('fieldset', {}, h('legend', {}, 'Which is right?'), winners.map((w) => w.node)), explain, recordGroup, fieldOf('Why', reason, { hint: 'Required. Kept with your name in the audit trail.' })],
    submitLabel: 'Settle conflict',
    onSubmit: async () => {
      const why = needReason(reason);
      const payload = { company_id: c.company_id, field: c.field, winner: winner === 'stored' ? 'stored' : { value: c.sides[winner].value }, reason: why };
      if (c.location) {
        if (!record) throw new Error('Choose what the record should do about the location.');
        payload.record = record === 'confirm' ? { type: 'confirm', location: where.read() } : { type: record };
      }
      const r = await api.post('/api/conflicts/resolve', payload);
      toast(`Settled ${c.company_name}’s ${fieldLabel(c.field).toLowerCase()}.${r.turned_down ? ` ${plural(r.turned_down, 'claim')} turned down.` : ''}`);
      await refreshAll();
    },
  });
}

// ======================================================================= suggested fills

function renderSuggestions() {
  const body = $('#body-suggestions');
  if (!body) return;
  keepFocus(body, () => body.replaceChildren(view('suggestions', (list) => {
    if (!list.length) return emptyBox('Nothing to suggest.', 'When reading a website finds a fact the record does not have, it waits here for a person to apply or dismiss.');
    const fields = [...new Set(list.map((s) => s.field))];
    const f = fields.includes(S.ui.suggestionField) ? S.ui.suggestionField : 'all';
    const rows = list.filter((s) => f === 'all' || s.field === f);
    const shown = rows.slice(0, S.ui.suggestionShown);
    return h('div', {},
      h('div', { class: 'toolbar' },
        seg([{ key: 'all', text: 'All', count: list.length }, ...fields.map((k) => ({ key: k, text: fieldLabel(k), count: list.filter((s) => s.field === k).length }))], f, (key) => { S.ui.suggestionField = key; S.ui.suggestionShown = 10; renderSuggestions(); }, 'Field', 'sugg-field'),
        !can('suggestion.apply') && h('p', { class: 'toolbar__note' }, 'Applying a suggestion needs the admin role.')),
      grid({
        caption: 'Suggested fills', wide: true,
        columns: [{ label: 'Company' }, { label: 'Field' }, { label: 'Suggested' }, { label: 'Confidence' }, { label: 'Evidence' }, { label: 'Actions', cls: 'cell-actions' }],
        rows: shown.map((s) => {
          const key = `${s.company_id}:${s.field}:${clip(String(s.value), 40)}`;
          const first = s.evidence[0];
          return [
            h('div', { class: 'company' }, h('b', {}, s.company_name), s.location && s.pinned && h('div', { class: 'chips' }, chip('On the public map', 'info', true))),
            fieldLabel(s.field),
            h('span', { class: 'clamp2', title: String(s.value) }, fmtValue(s.value)),
            confidenceChip(s.confidence),
            h('div', {}, first && (safeHref(first.source.url) ? extLink(first.source.url, first.source.title || kindLabel(first.source.kind)) : (first.source.title || kindLabel(first.source.kind))), h('div', { class: 'sub' }, `${kindLabel(first?.source.kind)}${s.evidence.length > 1 ? ` · +${s.evidence.length - 1} more` : ''}${first?.source.retrieved_at ? ` · read ${fmtDate(first.source.retrieved_at)}` : ''}`)),
            h('div', { class: 'actions' },
              can('suggestion.apply') && btn('Apply', { small: true, variant: 'primary', fk: `sugg:apply:${key}`, attrs: { 'aria-label': `Apply ${fieldLabel(s.field).toLowerCase()} to ${s.company_name}` }, onClick: () => applyDialog(s) }),
              can('suggestion.dismiss') && btn('Dismiss', { small: true, fk: `sugg:dismiss:${key}`, attrs: { 'aria-label': `Dismiss ${fieldLabel(s.field).toLowerCase()} for ${s.company_name}` }, onClick: () => dismissDialog(s) })),
          ];
        }),
      }),
      pager(shown.length, rows.length, () => { S.ui.suggestionShown += 10; renderSuggestions(); }, 'suggestions'));
  }, { skeleton: () => skeletonRows(5) })));
}

function evidenceList(evidence) {
  return h('div', { class: 'list' }, evidence.map((e) => h('div', {},
    h('div', { class: 'list__title' }, safeHref(e.source.url) ? extLink(e.source.url, e.source.title || kindLabel(e.source.kind)) : (e.source.title || kindLabel(e.source.kind))),
    h('div', { class: 'sub' }, [kindLabel(e.source.kind), e.source.publisher, e.note, e.source.retrieved_at ? `read ${fmtDate(e.source.retrieved_at)}` : null].filter(Boolean).join(' · ')))));
}

function applyDialog(s) {
  let mode = s.location ? (s.field === 'address' ? 'address_only' : 'confirm') : 'plain';
  const where = locationFields({ city: s.field === 'city' ? String(s.value) : '', state: s.field === 'state' ? String(s.value) : '', address: s.field === 'address' ? String(s.value) : '' }, { companyId: s.company_id });
  const confirmBox = h('div', { class: 'nested', hidden: mode !== 'confirm' }, where.node);
  const parts = [];
  if (s.location) {
    const group = uid('apply');
    const only = s.field === 'address' ? choice({ name: group, value: 'address_only', checked: true, title: 'Record the address text only', text: 'The map pin does not move.', onChange: () => { mode = 'address_only'; confirmBox.hidden = true; } }) : null;
    const confirm = choice({ name: group, value: 'confirm', checked: !only, title: 'Confirm a place', text: 'Say how exactly it is known: an office, a suburb, only the city or the state.', nested: confirmBox, onChange: () => { mode = 'confirm'; confirmBox.hidden = false; } });
    parts.push(h('fieldset', {}, h('legend', {}, 'How should the record take it?'), only?.node, confirm.node));
  }
  modal({
    title: `Apply the ${fieldLabel(s.field).toLowerCase()} to ${s.company_name}?`, size: s.location ? 'lg' : 'md',
    body: [
      callout(h('b', {}, `${fmtValue(s.value)} `), 'will go on the public record. It was found on the sources below; nothing is overwritten.'),
      h('div', { class: 'block' }, evidenceList(s.evidence)), ...parts,
    ],
    submitLabel: 'Apply to the record',
    onSubmit: async () => {
      const payload = { company_id: s.company_id, field: s.field, value: s.value };
      if (s.location) payload.record = mode === 'confirm' ? { type: 'confirm', location: where.read() } : { type: 'address_only' };
      await api.post('/api/suggestions/apply', payload);
      toast(`Applied the ${fieldLabel(s.field).toLowerCase()} to ${s.company_name}.`);
      await refreshAll();
    },
  });
}

function dismissDialog(s) {
  const reason = textArea({ rows: 2, maxlength: 500, placeholder: 'For example: that is the registered office, not the HQ.' });
  modal({
    title: `Dismiss the ${fieldLabel(s.field).toLowerCase()} for ${s.company_name}?`,
    body: [callout(h('b', {}, `${fmtValue(s.value)} `), 'is turned down and kept with your reason, so reading the site again does not suggest it twice.'), fieldOf('Why', reason, { hint: 'Required.' })],
    submitLabel: 'Dismiss', tone: 'danger',
    onSubmit: async () => {
      await api.post('/api/suggestions/dismiss', { company_id: s.company_id, field: s.field, value: s.value, reason: needReason(reason) });
      toast(`Dismissed the ${fieldLabel(s.field).toLowerCase()} for ${s.company_name}.`);
      await refreshAll();
    },
  });
}

// ======================================================================= enrichment queue

function renderQueue() {
  const body = $('#body-queue');
  if (!body) return;
  keepFocus(body, () => body.replaceChildren(view('queue', (q) => h('div', {}, controls(q), jobPanel(), attentionTable(q), declinedFold(q), recentFold(q), q.no_website ? h('p', { class: 'fold__note' }, `${plural(q.no_website, 'company', 'companies')} have no website, so there is nothing to read. Add one by hand.`) : null), { skeleton: () => skeletonRows(4) })));
  if (slotOf('job')?.state === 'running') startPolling(); else stopPolling();
}

function controls(q) {
  const c = q.summary.counts;
  const job = slotOf('job');
  const running = job?.state === 'running';
  const mode = h('select', { class: 'select', id: 'run-mode', 'data-fk': 'run-mode' }, [['suggest', 'Suggest: record evidence, change no company'], ['fill', 'Fill: also fill blank fields from reliable evidence']].map(([v, text]) => h('option', { value: v, selected: v === S.ui.runMode }, text)));
  const hint = h('p', { class: 'runbar__hint' });
  const paintHint = () => { hint.textContent = mode.value === 'fill' ? 'Fill mode writes to company records: blank fields only, from high-confidence evidence, and conflicts are still flagged. Suggest is the safe default.' : 'Suggest mode records what each website says as evidence and changes no company. You apply what you trust from Suggested fills.'; };
  mode.addEventListener('change', () => { S.ui.runMode = mode.value; paintHint(); });
  paintHint();
  return h('div', { class: 'panel' },
    h('div', { class: 'chips' },
      chip(`Queued ${n(c.queued)}`, 'info', true), chip(`Running ${n(c.running)}`, 'info', true), chip(`Done ${n(c.done)}`, 'ok', true),
      chip(`Skipped ${n(c.skipped)}`, 'muted', true), chip(`Failed ${n(c.failed)}`, c.failed ? 'bad' : 'muted', true),
      h('span', { class: 'muted' }, `${n(q.summary.ready)} ready now · ${n(q.summary.backing_off)} waiting to retry`)),
    can('enrichment.run')
      ? h('div', { class: 'runbar' }, fieldOf('Mode', mode), btn(running ? 'Running…' : 'Run the queue', { variant: 'primary', icon: 'play', fk: 'queue:run', attrs: running ? { disabled: true } : {}, onClick: async () => { const j = await api.post('/api/queue/run', { mode: mode.value }); S.data.job = { state: 'ready', value: j, error: null, seq: 0 }; toast(`Reading websites in ${mode.value} mode.`); startPolling(); renderQueue(); } }),
        running && btn('Stop', { icon: 'stop', fk: 'queue:stop', onClick: async () => { await api.post('/api/queue/stop', {}); toast('Stopping after the current website.'); await load('job', { quiet: true }); } }),
        btn('Add companies to the queue', { icon: 'plus', fk: 'queue:seed', title: 'Queue every company that has something a website could tell us, ranked by how much it needs', onClick: async () => { const r = await api.post('/api/queue/seed', {}); toast(`Queued ${plural(r.queued, 'company', 'companies')}: ${n(r.no_website)} without a website, ${n(r.fresh)} checked recently.`); await refresh('queue', 'overview', 'audit'); } }),
        hint)
      : h('p', { class: 'runbar__hint' }, 'Seeding and running the queue need the admin role. Suggest mode records evidence only.'));
}

function jobPanel() {
  const job = slotOf('job');
  if (!job) return null;
  const tone = { running: 'info', done: 'ok', stopped: 'warn', failed: 'bad' }[job.state] ?? 'muted';
  const p = job.progress ?? {};
  return h('div', { class: 'panel' },
    h('div', { class: 'panel__head' }, h('span', { class: 'panel__title' }, job.state === 'running' ? (job.stopping ? 'Stopping…' : 'Reading websites…') : 'Last run'), chip(job.state, tone), h('span', { class: 'muted' }, `started by ${job.by} ${relative(job.started_at)}`, job.finished_at ? `, finished ${relative(job.finished_at)}` : '')),
    h('div', { class: 'job__nums' }, [['read', p.done], ['skipped', p.skipped], ['failed', p.failed], ['to retry', p.retried], ['evidence added', p.evidence_added], ['fields filled', p.applied]].filter(([, v]) => v != null).map(([k, v]) => h('span', {}, h('b', {}, n(v)), ` ${k}`))),
    job.error && h('p', { class: 'form-error', role: 'alert' }, job.error),
    job.log?.length > 0 && h('pre', { class: 'log', tabindex: '0', 'aria-label': 'Run log' }, job.log.join('\n')));
}

function startPolling() {
  if (S.poll) return;
  let tick = 0;
  S.poll = setInterval(async () => {
    tick += 1;
    await load('job', { quiet: true });
    if (slotOf('job')?.state !== 'running') { stopPolling(); await refreshAll(); toast('The run finished.'); } else if (tick % 4 === 0) await refresh('queue', 'overview');
  }, 1500);
}
function stopPolling() { if (S.poll) { clearInterval(S.poll); S.poll = null; } }

const OUTCOME = {
  mismatch: ['Wrong site', 'The website does not look like this company’s. Check the website on the record.'],
  blocked: ['Blocked', 'The site served a bot check instead of its own content, so nothing was recorded.'],
  unreachable: ['Unreachable', 'The site could not be reached.'],
};

function attentionTable(q) {
  if (!q.attention.length) return h('div', { class: 'panel' }, h('p', {}, h('b', {}, 'Nothing needs attention. '), 'Failed, blocked or mismatched reads appear here.'));
  const rows = q.attention.map((t) => {
    const [label, why] = t.status === 'failed' ? ['Failed', t.last_error] : t.status === 'queued' ? ['Will retry', t.last_error] : (OUTCOME[t.outcome] ?? [t.outcome, '']);
    const tone = t.status === 'failed' ? 'bad' : 'warn';
    const detail = t.result?.warnings?.[0] ?? why;
    const act = [];
    if (t.status === 'failed' && can('enrichment.retry')) act.push(btn('Retry', { small: true, fk: `queue:retry:${t.id}`, attrs: { 'aria-label': `Retry ${t.name}` }, onClick: async () => { await api.post(`/api/queue/${t.id}/retry`, {}); toast(`Retrying ${t.name}.`); await refresh('queue', 'overview', 'audit'); } }));
    if (t.status === 'queued' && can('enrichment.cancel')) act.push(btn('Cancel', { small: true, fk: `queue:cancel:${t.id}`, attrs: { 'aria-label': `Cancel ${t.name}` }, onClick: async () => { await api.post(`/api/queue/${t.id}/cancel`, {}); toast(`Cancelled ${t.name}.`); await refresh('queue', 'overview', 'audit'); } }));
    if (t.status === 'done' && can('enrichment.enqueue')) act.push(btn('Read again', { small: true, fk: `queue:again:${t.id}`, attrs: { 'aria-label': `Read ${t.name} again` }, onClick: async () => { await api.post(t.kind === 'company' ? `/api/companies/${t.target_id}/enrich` : `/api/candidates/${t.target_id}/enrich`, {}); toast(`Queued ${t.name} to be read again.`); await refresh('queue', 'overview', 'audit'); } }));
    return [h('b', {}, t.name), chip(label, tone), h('span', { class: 'clamp2', title: detail ?? '' }, detail || '—'), h('span', { class: 'num' }, n(t.attempts)), t.not_before && valid(t.not_before) && Date.parse(t.not_before) > Date.now() ? h('time', { datetime: t.not_before }, relative(t.not_before)) : h('span', { class: 'muted' }, '—'), h('div', { class: 'actions' }, act)];
  });
  return h('div', {}, h('div', { class: 'subhead' }, h('h3', {}, `Needs attention (${q.attention.length})`), h('p', {}, 'A site that will not answer is retried with a pause, three times at most.')),
    grid({ caption: 'Enrichment tasks that need attention', wide: true, columns: [{ label: 'Company' }, { label: 'State' }, { label: 'What happened' }, { label: 'Tries' }, { label: 'Next try' }, { label: 'Actions', cls: 'cell-actions' }], rows }));
}

function declinedFold(q) {
  if (!q.declined.length) return null;
  return h('details', { class: 'fold' },
    h('summary', {}, `Sites that refused automated reading (${q.declined.length})`),
    h('div', { class: 'fold__body' },
      h('p', { class: 'fold__note' }, 'These sites tell automated readers to stay out (robots.txt) or are access-controlled. That is respected, so they are not retried: add their facts by hand if you need them.'),
      grid({ caption: 'Sites that refused automated reading', columns: [{ label: 'Company' }, { label: 'Why' }], rows: q.declined.map((t) => [h('b', {}, t.name), (t.last_error ?? t.result?.code ?? '').replace(/_/g, ' ')]) })));
}

function recentFold(q) {
  if (!q.recent.length) return null;
  return h('details', { class: 'fold' },
    h('summary', {}, `Recently read (${q.recent.length})`),
    h('div', { class: 'fold__body' }, grid({
      caption: 'Recently read websites', columns: [{ label: 'Company' }, { label: 'Pages' }, { label: 'Evidence added' }, { label: 'Jobs found' }, { label: 'Finished' }],
      rows: q.recent.map((t) => [h('b', {}, t.name), n(t.result?.pages), n(t.result?.evidence_added), n((t.result?.jobs?.added ?? 0) + (t.result?.jobs?.updated ?? 0)), h('time', { datetime: t.finished_at }, relative(t.finished_at))]),
    })));
}

// ======================================================================= failed imports

function renderImports() {
  const body = $('#body-imports');
  if (!body) return;
  keepFocus(body, () => body.replaceChildren(view('imports', (im) => {
    const tasks = slotOf('overview')?.detail.failed_imports.enrichment_tasks ?? 0;
    return h('div', {},
      im.failures.length
        ? grid({
          caption: 'Failed imports', wide: false,
          columns: [{ label: 'Source' }, { label: 'What went wrong' }, { label: 'When' }, { label: 'Actions', cls: 'cell-actions' }],
          rows: im.failures.map((f) => [h('b', { class: 'mono' }, f.source_id), f.error, h('time', { datetime: f.at }, fmtDateTime(f.at)),
            can('import.dismiss') ? btn('Acknowledge', { small: true, fk: `import:${f.run_id}:${f.source_id}`, attrs: { 'aria-label': `Acknowledge the failure of ${f.source_id}` }, onClick: () => acknowledgeDialog(f) }) : null]),
        })
        : emptyBox('No failed imports.', 'Each source is checked the last time discovery ran. Run ', h('code', {}, 'npm run discovery -- run'), ' in ', h('code', {}, 'backend/'), ' to import.'),
      tasks > 0 && h('p', { class: 'fold__note' }, `${plural(tasks, 'enrichment task')} also failed. They are listed under `, h('a', { href: '#queue', on: { click: (e) => { e.preventDefault(); goTo('queue'); } } }, 'Enrichment queue'), '.'),
      im.runs.length > 0 && h('details', { class: 'fold' },
        h('summary', {}, `Recent import runs (${im.runs.length})`),
        h('div', { class: 'fold__body' }, grid({
          caption: 'Recent import runs', columns: [{ label: 'Finished' }, { label: 'By' }, { label: 'Status' }, { label: 'New' }, { label: 'Attached' }, { label: 'Failed sources' }],
          rows: im.runs.map((r) => [fmtDateTime(r.finished_at), `${r.by ?? 'unknown'} (${r.trigger})`, chip(r.status, r.status === 'ok' ? 'ok' : r.status === 'partial' ? 'warn' : 'bad'), n(r.totals?.new), n(r.totals?.attached), r.failed_sources.length ? r.failed_sources.join(', ') : '—']),
        }))));
  })));
}

function acknowledgeDialog(f) {
  const note = textArea({ rows: 2, maxlength: 500, placeholder: 'For example: the feed was down for maintenance.' });
  modal({
    title: `Acknowledge ${f.source_id}`,
    body: [callout(f.error), fieldOf('What did you find?', note, { hint: 'Required. The failure leaves this list; the import run keeps its record.' })],
    submitLabel: 'Acknowledge',
    onSubmit: async () => {
      await api.post('/api/imports/dismiss', { run_id: f.run_id, source_id: f.source_id, note: needReason(note) });
      toast(`Acknowledged the failure of ${f.source_id}.`);
      await refresh('imports', 'overview', 'audit');
    },
  });
}

// ======================================================================= scheduled refresh

const JOB_LABEL = { discovery: 'Discovery', funding: 'Funding', hiring: 'Hiring', status: 'Company status', enrichment: 'Enrichment', quality: 'Data quality' };
const JOB_WHAT = {
  discovery: 'Finds companies we do not have, into candidates for review', funding: 'Funding stories about companies we have, as evidence',
  hiring: 'Open roles and the hiring flag', status: 'Acquired, closed or renamed', enrichment: 'Description, address, founders, investors, founded year',
  quality: 'Stale and conflicting records, brought forward to be looked at again',
};
const RUN_TONE = { ok: 'ok', partial: 'warn', failed: 'bad', idle: 'muted', skipped: 'muted', running: 'info' };
const SIGNAL = {
  acquired_notice: 'Says it was acquired', subsidiary_notice: 'Says it is a subsidiary', closed_notice: 'Says it has closed',
  moved_domain: 'Website moved to another domain', site_mismatch: 'Website is now someone else’s', parked_domain: 'Domain looks parked or for sale',
  renamed_notice: 'Says it was renamed', unreachable: 'Website has gone quiet',
};
const whenCell = (iso) => (valid(iso) ? h('time', { datetime: iso, title: fmtDateTime(iso) }, relative(iso)) : h('span', { class: 'muted' }, '—'));
const dueCell = (iso, dueNow) => (dueNow > 0 || (valid(iso) && Date.parse(iso) <= Date.now()) ? h('span', {}, 'now') : whenCell(iso));

function renderScheduler() {
  const body = $('#body-scheduler');
  if (!body) return;
  keepFocus(body, () => body.replaceChildren(view('scheduler', (s) => h('div', {},
    schedulerJobs(s), schedulerFacets(s), schedulerWatch(s), schedulerSources(s), schedulerRuns(s),
    h('p', { class: 'fold__note' }, 'Run it with ', h('code', {}, 'npm run scheduler -- tick'), ' in ', h('code', {}, 'backend/'), ', or let a schedule do it (docs/scheduler.md). It never runs inside the public site.')))));
}

function schedulerJobs(s) {
  return grid({
    caption: 'Scheduled jobs', wide: true,
    columns: [{ label: 'Job' }, { label: 'Last run' }, { label: 'What it did' }, { label: 'Due now', cls: 'num' }, { label: 'Next due' }],
    rows: s.jobs.map((j) => [
      h('div', {}, h('b', {}, JOB_LABEL[j.job] ?? j.job), h('div', { class: 'sub' }, JOB_WHAT[j.job] ?? '')),
      j.last_run ? h('div', {}, chip(j.last_run.status, RUN_TONE[j.last_run.status] ?? 'muted'), ' ', whenCell(j.last_run.started_at)) : h('span', { class: 'muted' }, 'Never run'),
      h('span', { class: 'clamp2', title: j.last_run?.summary ?? '' }, j.last_run ? (j.last_run.error ?? j.last_run.summary ?? '—') || '—' : '—'),
      h('span', { class: 'num' }, n(j.due_now)),
      dueCell(j.next_due, j.due_now),
    ]),
  });
}

function schedulerFacets(s) {
  return h('div', {},
    h('div', { class: 'subhead' }, h('h3', {}, 'Company facts, each on its own clock'), h('p', {}, 'A fact that changes fast is looked at often, one that hardly ever changes rarely. A check that finds nothing new makes the next wait longer.')),
    grid({
      caption: 'Company facts and how often they are looked at', wide: true,
      columns: [{ label: 'Fact' }, { label: 'Looked at' }, { label: 'Checked', cls: 'num' }, { label: 'Never checked', cls: 'num' }, { label: 'Due now', cls: 'num' }, { label: 'Failing', cls: 'num' }, { label: 'Last check' }],
      rows: Object.values(s.facets).map((f) => [h('b', {}, f.label), `${f.pace}: about every ${plural(f.every_days, 'day')}`, h('span', { class: 'num' }, n(f.checked)), h('span', { class: 'num' }, n(f.never_checked)), h('span', { class: 'num' }, n(f.due_now)), h('span', { class: 'num' }, f.failing ? chip(n(f.failing), 'bad', true) : '0'), whenCell(f.last_checked)]),
    }));
}

function schedulerWatch(s) {
  if (!s.watch.length) return h('div', { class: 'panel' }, h('p', {}, h('b', {}, 'Nothing is on the status watch. '), 'A company whose website moves to another domain, says it was acquired or has closed, calls itself something else, or has gone quiet appears here.'));
  return h('div', {},
    h('div', { class: 'subhead' }, h('h3', {}, `Status watch (${s.watch.length})`), h('p', {}, 'These are signals, not decisions: nothing about the company was changed. Where a site says in so many words that it was acquired or has closed, the sentence is also evidence under Conflicts or Suggested fills.')),
    grid({
      caption: 'Companies on the status watch', wide: true,
      columns: [{ label: 'Company' }, { label: 'What changed' }, { label: 'Since' }],
      rows: s.watch.map((w) => [h('b', {}, w.name),
        h('div', {}, w.signals.map((x) => h('div', {}, chip(SIGNAL[x.code] ?? x.code, 'warn', true), ' ', h('span', { class: 'sub' }, clip(x.detail, 140))))),
        whenCell(w.signals.map((x) => x.since).filter(Boolean).sort()[0])]),
    }));
}

function schedulerSources(s) {
  const hosts = s.hosts.length ? h('p', { class: 'fold__note' }, `Websites that asked us to slow down, and are being left alone for now: ${s.hosts.map((x) => `${x.host} (until ${fmtDateTime(x.until)})`).join(', ')}.`) : null;
  if (!s.sources.length && !hosts) return null;
  return h('details', { class: 'fold' },
    h('summary', {}, `Sources and websites that asked for time (${s.sources.length + s.hosts.length})`),
    h('div', { class: 'fold__body' },
      s.sources.length > 0 && grid({
        caption: 'Sources the discovery and funding jobs read', columns: [{ label: 'Source' }, { label: 'Discovery last read' }, { label: 'Next' }, { label: 'Funding last read' }, { label: 'Problem' }],
        rows: s.sources.map((src) => [h('b', { class: 'mono' }, src.id), whenCell(src.discovery?.last_checked_at), whenCell(src.discovery?.next_check_at), src.is_funding_feed ? whenCell(src.funding?.last_checked_at) : h('span', { class: 'muted' }, 'not a funding feed'),
          (src.discovery?.failures || src.funding?.failures) ? chip(clip(src.discovery?.last_error ?? src.funding?.last_error ?? 'failing', 80), 'bad', true) : h('span', { class: 'muted' }, '—')]),
      }),
      hosts));
}

function schedulerRuns(s) {
  if (!s.recent.length) return emptyBox('No runs logged yet.', 'Every run of every job is written down here, including the ones that found nothing due. Start one with ', h('code', {}, 'npm run scheduler -- tick'), '.');
  return h('details', { class: 'fold', open: true },
    h('summary', {}, `Recent runs (${s.recent.length})`),
    h('div', { class: 'fold__body' }, grid({
      caption: 'Recent scheduler runs', wide: true,
      columns: [{ label: 'When' }, { label: 'Job' }, { label: 'Result' }, { label: 'Due', cls: 'num' }, { label: 'Read', cls: 'num' }, { label: 'New', cls: 'num' }, { label: 'Failed', cls: 'num' }, { label: 'Requests', cls: 'num' }, { label: 'Summary' }],
      rows: s.recent.map((r) => [whenCell(r.started_at), h('b', {}, JOB_LABEL[r.job] ?? r.job), h('div', {}, chip(r.status, RUN_TONE[r.status] ?? 'muted'), r.stopped_for ? h('div', { class: 'sub' }, `stopped: ${r.stopped_for} limit`) : null),
        h('span', { class: 'num' }, n(r.due)), h('span', { class: 'num' }, n(r.processed)), h('span', { class: 'num' }, n(r.changed)), h('span', { class: 'num' }, n(r.failed)), h('span', { class: 'num' }, n(r.requests)),
        h('span', { class: 'clamp2', title: r.error ?? r.summary }, r.error ?? (r.summary || '—'))]),
    })));
}

// ======================================================================= audit trail

const AUDIT_GROUPS = [['', 'Everything'], ['candidate', 'Candidates'], ['conflict', 'Conflicts'], ['suggestion', 'Suggestions'], ['enrichment', 'Enrichment'], ['import', 'Imports'], ['scheduler', 'Scheduled jobs'], ['company', 'Companies'], ['investor', 'Investors'], ['investment', 'Investments'], ['person', 'People']];

function auditFrame(body) {
  const group = h('select', { class: 'select', id: 'audit-action', 'aria-label': 'Show actions', 'data-fk': 'audit-action', on: { change: () => { S.ui.auditAction = group.value; S.ui.auditLimit = 50; load('audit', { quiet: true }); } } }, AUDIT_GROUPS.map(([v, text]) => h('option', { value: v, selected: v === S.ui.auditAction }, text)));
  const target = textInput({ id: 'audit-target', placeholder: 'Filter by id, e.g. cand-medcast', 'aria-label': 'Filter by the id of what was acted on', value: S.ui.auditTarget, 'data-fk': 'audit-target' });
  target.addEventListener('input', debounce(() => { S.ui.auditTarget = norm(target.value); S.ui.auditLimit = 50; load('audit', { quiet: true }); }, 300));
  body.append(h('div', { class: 'toolbar' }, h('div', {}, group), h('div', { class: 'search' }, icon('search', 16), target), h('p', { class: 'toolbar__note', id: 'audit-note' })), h('div', { id: 'audit-results' }));
}

function renderAudit() {
  const body = $('#body-audit');
  if (!body) return;
  if (!body.firstChild) auditFrame(body);
  const results = $('#audit-results');
  keepFocus(results, () => results.replaceChildren(view('audit', (a) => {
    const note = $('#audit-note');
    if (note) note.textContent = `${n(Math.min(a.results.length, a.total))} of ${n(a.total)}`;
    if (!a.results.length) return emptyBox('Nothing recorded yet.', 'Every approval, rejection, edit, merge, publish, settled conflict and website read is written here with who did it and why.');
    return h('div', {},
      grid({
        caption: 'Audit trail', wide: true,
        columns: [{ label: 'When', cls: 'nowrap' }, { label: 'Who' }, { label: 'Action' }, { label: 'What it was done to' }, { label: 'Summary' }],
        rows: a.results.map((r) => [
          h('div', {}, h('time', { datetime: r.at }, fmtDate(r.at)), h('div', { class: 'sub' }, fmtTime(r.at))),
          h('div', {}, h('b', {}, r.actor), h('div', { class: 'sub' }, `${r.role} · ${r.via}`)),
          ACTION_LABEL[r.action] ?? r.action,
          h('div', {}, r.target.type, h('div', { class: 'sub mono' }, r.target.id)),
          h('div', {}, r.summary, r.reason || r.changes?.length ? h('details', { class: 'more' }, h('summary', {}, 'Details'),
            r.reason && h('p', { class: 'sub' }, h('b', {}, 'Reason: '), r.reason),
            r.changes?.length > 0 && h('div', { class: 'changes' }, r.changes.map((c) => h('span', {}, h('b', {}, `${fieldLabel(c.field)}: `), c.from != null && h('span', { class: 'from' }, clip(fmtValue(c.from), 90)), c.from != null && ' → ', clip(fmtValue(c.to), 90))))) : null),
        ]),
      }),
      pager(a.results.length, Math.min(a.total, 500), () => { S.ui.auditLimit = Math.min(500, S.ui.auditLimit + 100); load('audit', { quiet: true }); }, 'audit'));
  })));
}

// ======================================================================= wiring it together

const RENDER = {
  overview: () => { renderTiles(); renderNav(); renderQuality(); renderLocations(); },
  candidates: () => { renderDiscovered(); renderNav(); },
  conflicts: renderConflicts, suggestions: renderSuggestions, missing: renderQuality, duplicates: renderQuality, locations: renderLocations, investors: renderInvestors,
  queue: renderQueue, job: renderQueue, imports: renderImports, scheduler: () => { renderScheduler(); renderNav(); }, audit: renderAudit,
};
function render(name) { if (S.me && !S.signedOut) RENDER[name]?.(); }

function renderLogin(notice) {
  stopPolling();
  document.title = 'Sign in · Data Command Center';
  const input = h('input', { class: 'input', id: 'token', type: 'password', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-describedby': 'token-help', 'aria-required': 'true' });
  const error = h('p', { class: 'form-error', role: 'alert', hidden: !notice }, notice ?? '');
  const submit = h('button', { type: 'submit', class: 'btn btn--primary' }, 'Sign in');
  const form = h('form', { novalidate: true },
    fieldOf('Access token', input, { hint: 'Starts with aus_. It was shown once, when your user was made.' }), error, submit);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const token = input.value.trim();
    if (!token) { error.textContent = 'Paste your access token.'; error.hidden = false; input.focus(); return; }
    error.hidden = true; submit.setAttribute('aria-busy', 'true'); submit.disabled = true;
    try {
      S.token = token;
      S.me = await api.call('/api/login', { method: 'POST', body: { token } });
      session.set(TOKEN_KEY, token);
      S.signedOut = false;
      start();
    } catch (err) {
      S.token = null; S.me = null;
      error.textContent = err.message; error.hidden = false; input.select();
    } finally { submit.removeAttribute('aria-busy'); submit.disabled = false; }
  });
  $('#app').replaceChildren(h('div', { class: 'login' }, h('div', { class: 'login__box' },
    h('h1', { class: 'login__title' }, 'Data Command Center'),
    h('p', { class: 'login__lead' }, 'AU Startup Map. Private to this computer.'),
    form,
    h('div', { class: 'login__help', id: 'token-help' },
      h('p', {}, 'No token yet? In a terminal, in ', h('code', {}, 'backend/'), ', run ', h('code', {}, 'npm run admin -- init --name "Your name"'), '. It prints a token once.'),
      h('p', {}, 'Nothing here is public: this page answers only on this machine, and every action is recorded with your name.')))));
  input.focus();
}

function signOut(notice) {
  if (S.signedOut) return; // several requests can fail together: one sign-in screen is enough
  S.signedOut = true; S.token = null; S.me = null; S.data = {}; S.drawer = null;
  session.remove(TOKEN_KEY);
  for (const el of document.querySelectorAll('dialog')) el.remove();
  renderLogin(notice);
}

let watching = false;
function start() {
  buildShell();
  for (const name of ['overview', 'candidates', 'conflicts', 'suggestions', 'missing', 'locations', 'investors', 'duplicates', 'queue', 'imports', 'scheduler', 'audit', 'job']) load(name);
  if (!watching) {
    watching = true; // coming back to the tab after a while shows what changed meanwhile
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.me && !S.signedOut && Date.now() - (S.refreshedAt ?? 0) > 120000) refreshAll(); });
  }
  if (location.hash && document.getElementById(location.hash.slice(1))) setTimeout(() => goTo(location.hash.slice(1)), 60);
}

async function boot() {
  const saved = prefs.get(THEME_KEY);
  applyTheme(THEMES.includes(saved) ? saved : 'auto');
  const token = session.get(TOKEN_KEY);
  if (!token) { renderLogin(); return; }
  S.token = token;
  try {
    S.me = await api.get('/api/me');
    start();
  } catch (err) {
    if (err.status !== 401) { S.token = null; renderLogin(err.message); }
  }
}

boot();
