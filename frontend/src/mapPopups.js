// What a click on a pin opens: a small card, not the whole company. The name, one line about it, whether it is hiring, one way in, and
// the rest folded under "More". Built as elements, never as an HTML string: a company's name and a firm's address are data. These
// are plain DOM functions (no map in them), so they can be tested, and so the same card is the same wherever it opens.
import { hiringLabel, verifiedLabel, isBlank } from './freshness.js';
import { locationQuality } from './mapPins.js';

function node(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

// "Label: value" rows, a row with nothing behind it left out.
function rows(items) {
  const list = node('dl', 'pin-pop-rows');
  for (const [label, value] of items) {
    if (isBlank(value)) continue;
    const row = node('div');
    row.append(node('dt', null, label), typeof value === 'string' ? node('dd', null, value) : (() => { const dd = node('dd'); dd.append(value); return dd; })());
    list.append(row);
  }
  return list;
}

const externalLink = (href, text, className) => {
  const a = node('a', className, text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
};

// A company's card. `tuple` is what the pin knows at once ([slug, name, lat, lng, sector, city, hiring, domain, precision, place, checked]);
// `fill(record)` adds what the full record says when it arrives (its one line, its hiring state, its stage, when it was checked, its website).
// onOpen() opens the company's own page: the card's one call to action.
// onReport() is the small "Report: role closed" link under it, for a company the card says is hiring (it is left out when there is no
// onReport, and stays hidden while the card says nothing about hiring); it opens the same prefilled edit form as the company's own page.
export function companyPopup(tuple, { onOpen, onReport }) {
  const [, name, , , sector, city, hiring, , precision, place, checked] = tuple;
  const box = node('div', 'pin-pop');
  const title = node('h3', 'pin-pop-name', name);
  const blurb = node('p', 'pin-pop-blurb');
  blurb.hidden = true;
  const status = node('p', 'pin-pop-status');
  const badge = node('span', 'hiring-badge hiring-badge-off', 'Roles unverified');
  // What the pin itself says is "hiring now" or nothing; the full record says which of the other states it is.
  if (hiring === 1 || hiring === true) { badge.className = 'hiring-badge'; badge.textContent = '● Hiring now'; }
  else status.hidden = true;
  // What only the full record knows: that nobody has verified the company yet, that it is a concept preview, and when it was last checked.
  const unverified = node('span', 'badge-unverified', 'Unverified');
  unverified.hidden = true;
  const concept = node('span', 'concept-label', 'Concept preview');
  concept.title = 'Task-gated applications are a concept preview, not a live product';
  concept.hidden = true;
  status.append(badge, unverified, concept);
  const fresh = node('p', 'pin-pop-fresh');
  fresh.hidden = true;
  const cta = node('button', 'pin-pop-cta', 'View company');
  cta.type = 'button';
  cta.addEventListener('click', () => onOpen());
  const report = node('button', 'pin-pop-report', 'Report: role closed');
  report.type = 'button';
  report.hidden = !onReport || !(hiring === 1 || hiring === true);
  if (onReport) report.addEventListener('click', () => onReport());
  const more = node('details', 'pin-pop-more');
  more.append(node('summary', null, 'More'));
  const body = node('div', 'pin-pop-more-body');
  more.append(body);
  const known = [['Sector', sector], ['Place', place || city], ['Location', precision ? locationQuality(precision, checked === 1 || checked === true) : null]];
  const paint = (record) => {
    const site = record?.website && record.website_status !== 'unavailable' ? externalLink(record.website, record.website.replace(/^https?:\/\//, ''), 'pin-pop-site') : null;
    const unavailable = record?.website && record.website_status === 'unavailable' ? 'Website unavailable' : null;
    body.replaceChildren(rows([known[0], ['Stage', record?.stage], known[1], known[2], ['Website', site ?? unavailable]]));
  };
  paint(null);
  box.append(title, blurb, status, fresh, cta, report, more);
  return {
    element: box,
    fill(record) {
      if (!record) return;
      if (record.blurb) { blurb.textContent = record.blurb; blurb.hidden = false; }
      const label = hiringLabel(record);
      badge.className = label.state === 'hiring' ? 'hiring-badge' : 'hiring-badge hiring-badge-off';
      badge.textContent = label.state === 'hiring' ? `● ${label.text}` : label.text;
      unverified.hidden = record.verified !== false;
      concept.hidden = record.taskGate?.optedIn !== true;
      status.hidden = false;
      report.hidden = !onReport || (label.state !== 'hiring' && label.state !== 'checked');
      const note = verifiedLabel(record.last_verified_at);
      if (note) {
        fresh.textContent = note.text;
        fresh.className = note.stale ? 'pin-pop-fresh pin-pop-fresh-stale' : 'pin-pop-fresh';
        fresh.hidden = false;
      }
      paint(record);
    },
  };
}

// A firm's card: its name, where this office is, one way in (its page here when it has one, else its own website), and the rest under "More".
// onOpen(href) opens the firm's page in the app.
export function institutionPopup(pin, { onOpen }) {
  const box = node('div', 'pin-pop pin-pop-firm');
  box.append(node('h3', 'pin-pop-name', pin.name));
  const line = [pin.office, pin.city].filter((v) => !isBlank(v)).join(' · ');
  if (line) box.append(node('p', 'pin-pop-blurb', line));
  let cta = null;
  if (pin.href) {
    cta = node('a', 'pin-pop-cta', 'View investor');
    cta.href = pin.href;
    cta.addEventListener('click', (event) => {
      if (!onOpen || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      onOpen(pin.href);
    });
  } else if (pin.website) {
    cta = externalLink(pin.website, 'Visit website', 'pin-pop-cta');
  }
  if (cta) box.append(cta);
  const more = node('details', 'pin-pop-more');
  more.append(node('summary', null, 'More'));
  const body = node('div', 'pin-pop-more-body');
  const site = pin.website && pin.href ? externalLink(pin.website, pin.website.replace(/^https?:\/\//, ''), 'pin-pop-site') : null;
  body.append(rows([['Office', pin.place], ['Website', site]]));
  more.append(body);
  box.append(more);
  return { element: box };
}
