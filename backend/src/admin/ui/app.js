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
};
const MATCH = { EXACT_MATCH: 'Same as', LIKELY_MATCH: 'Likely the same as', POSSIBLE_MATCH: 'May be' };
const CONFIDENCE = { high: ['High', 'ok'], medium: ['Medium', 'info'], low: ['Low', 'warn'] };
const FIELD = {
  website: 'Website', sector: 'Sector', city: 'City', state: 'State', address: 'Address', description: 'Description', founders: 'Founders',
  founded_year: 'Founded year', investors: 'Investors', hiring_status: 'Hiring', stage: 'Stage', last_funding_round: 'Last round',
  last_funding_date: 'Last round date', funding_total: 'Funding total', abn: 'ABN', acn: 'ACN',
};
const KIND = {
  company_website: 'Company website', company_document: 'Company document', press: 'Press', investor_post: 'Investor post',
  accelerator_profile: 'Accelerator profile', directory_listing: 'Directory listing', aggregator: 'Aggregator', user_supplied: 'Supplied by a person',
  licensed_dataset: 'Licensed dataset', open_dataset: 'Open dataset',
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
};
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
const refreshAll = () => refresh('overview', 'candidates', 'conflicts', 'suggestions', 'missing', 'duplicates', 'queue', 'imports', 'scheduler', 'audit');
const slotOf = (name) => S.data[name]?.value ?? null;

// ======================================================================= the page frame

const SECTIONS = [
  { id: 'overview', nav: 'Overview', title: null },
  { id: 'discovered', nav: 'Discovered', title: 'New startups discovered', def: 'Companies discovery found that nobody has decided on yet. They are staging data: hidden from the public site until an admin publishes them.' },
  { id: 'quality', nav: 'Quality', title: 'Data quality', def: 'How much of the directory has each fact. A fact counts only when the record holds a real value, never “Unknown”.' },
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

// A place on the map: a city and coordinates. Nothing here is guessed; the person reads them off a map.
function locationFields(init = {}) {
  const city = textInput({ value: init.city ?? '', maxlength: 80 });
  const state = selectInput([['', 'No state'], ...AU_STATES.map((s) => [s, s])], init.state ?? '');
  const address = textInput({ value: init.address ?? '', maxlength: 200 });
  const lat = textInput({ inputmode: 'decimal', placeholder: 'e.g. -33.8688' });
  const lng = textInput({ inputmode: 'decimal', placeholder: 'e.g. 151.2093' });
  const query = init.address || (init.city ? [init.city, init.state, 'Australia'].filter(Boolean).join(' ') : '');
  return {
    node: h('div', {},
      rowOf(fieldOf('City', city), fieldOf('State', state, { optional: true })),
      fieldOf('Address', address, { optional: true }),
      rowOf(fieldOf('Latitude', lat), fieldOf('Longitude', lng)),
      query && h('p', { class: 'field__hint' }, extLink(`https://www.openstreetmap.org/search?query=${enc(query)}`, 'Find it on OpenStreetMap'), ' and copy the coordinates from the place it shows. They must be inside Australia.')),
    read() {
      const place = norm(city.value);
      const la = Number(lat.value);
      const lo = Number(lng.value);
      if (!place) { city.focus(); throw new Error('Say which city.'); }
      if (!lat.value.trim() || !lng.value.trim() || !Number.isFinite(la) || !Number.isFinite(lo)) { lat.focus(); throw new Error('A place on the map needs a latitude and a longitude.'); }
      return { city: place, state: state.value || undefined, address: norm(address.value) || undefined, lat: la, lng: lo };
    },
  };
}

// ======================================================================= the eight counts

const TILES = [
  { key: 'total_companies', label: 'Total companies', note: () => 'in the directory', to: 'quality' },
  { key: 'published', label: 'Published', note: (o) => `${n(o.detail.published.on_map)} on the map · ${n(o.detail.published.unconfirmed)} unconfirmed`, to: 'quality' },
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
  const off = choice({ name: 'where', value: 'unconfirmed', checked: true, title: 'List it without a map pin', text: 'It appears in the directory with an unconfirmed location and is not on the map. Confirm a place later from Suggested fills or Conflicts.', onChange: () => { mode = 'unconfirmed'; pin.hidden = true; } });
  const on = choice({ name: 'where', value: 'pin', title: 'Put it on the map now', text: 'You confirm the place: a city and coordinates inside Australia.', onChange: () => { mode = 'pin'; pin.hidden = false; }, nested: pin });
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
      toast(`Published ${d.name}${r.on_map ? ' on the map' : ' with an unconfirmed location'}.${r.enrichment_queued ? ' Queued for enrichment.' : ''} Commit the data files to make it live.`);
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
            r.city && r.city !== 'Unknown' ? [r.city, r.on_map ? '' : ' (not on the map)'] : unknown(),
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
  const where = locationFields({ city: c.city ?? '' });
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
  const confirmChoice = choice({ name: recordName, value: 'confirm', title: 'Confirm a place on the map', text: 'A city and coordinates inside Australia.', nested: confirmBox, onChange: () => { record = 'confirm'; confirmBox.hidden = false; } });
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
  const where = locationFields({ city: s.field === 'city' ? String(s.value) : '', state: s.field === 'state' ? String(s.value) : '', address: s.field === 'address' ? String(s.value) : '' });
  const confirmBox = h('div', { class: 'nested', hidden: mode !== 'confirm' }, where.node);
  const parts = [];
  if (s.location) {
    const group = uid('apply');
    const only = s.field === 'address' ? choice({ name: group, value: 'address_only', checked: true, title: 'Record the address text only', text: 'The map pin does not move.', onChange: () => { mode = 'address_only'; confirmBox.hidden = true; } }) : null;
    const confirm = choice({ name: group, value: 'confirm', checked: !only, title: 'Confirm a place on the map', text: 'A city and coordinates inside Australia.', nested: confirmBox, onChange: () => { mode = 'confirm'; confirmBox.hidden = false; } });
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

const AUDIT_GROUPS = [['', 'Everything'], ['candidate', 'Candidates'], ['conflict', 'Conflicts'], ['suggestion', 'Suggestions'], ['enrichment', 'Enrichment'], ['import', 'Imports'], ['scheduler', 'Scheduled jobs'], ['company', 'Companies']];

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
  overview: () => { renderTiles(); renderNav(); renderQuality(); },
  candidates: () => { renderDiscovered(); renderNav(); },
  conflicts: renderConflicts, suggestions: renderSuggestions, missing: renderQuality, duplicates: renderQuality,
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
  for (const name of ['overview', 'candidates', 'conflicts', 'suggestions', 'missing', 'duplicates', 'queue', 'imports', 'scheduler', 'audit', 'job']) load(name);
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
