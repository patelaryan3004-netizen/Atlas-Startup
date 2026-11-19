// What a click on a pin opens: a small card, not the whole company. For a company: its name, one sentence, its sector and place, and one way in. Built as elements, never as an
// HTML string: a company's name and a firm's address are data. These are plain DOM functions (no map in them), so they can be tested, and so the same card is the same wherever it opens.
import { isBlank } from './freshness.js';
import { oneSentence, cardSector, cardPlace } from './popupText.js';

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

// A company's card, for a map that has no card of its own: the logo's place is left to the page, so it is the name, one plain sentence on what the company does, its sector and where it is
// (the suburb and the city), and the one way on, "View company". A part that is not known is left out. Where the facts came from, the website, the dates they were checked and how well
// the place is known are on the company's own page, not here. `tuple` is what the pin knows at once ([slug, name, lat, lng, sector, city, hiring, domain, precision, place, checked, logo, metro,
// sectorGroup, suburb]); `fill(record)` adds the sentence (and a sector or suburb the pin lacked) when the full record arrives. onOpen() opens the company's own page.
export function companyPopup(tuple, { onOpen }) {
  const [, name, , , sector, city] = tuple;
  const pin = { sector, sectorGroup: tuple[13], city, suburb: tuple[14] };
  const box = node('div', 'pin-pop');
  const title = node('h3', 'pin-pop-name', name);
  const blurb = node('p', 'pin-pop-blurb');
  blurb.hidden = true;
  const facts = node('p', 'pin-pop-facts');
  const say = (record) => {
    const line = [cardSector(record, pin), cardPlace(record, pin)].filter(Boolean).join(' · ');
    facts.textContent = line;
    facts.hidden = !line;
  };
  say(null);
  const cta = node('button', 'pin-pop-cta', 'View company');
  cta.type = 'button';
  cta.addEventListener('click', () => onOpen());
  box.append(title, blurb, facts, cta);
  return {
    element: box,
    fill(record) {
      if (!record) return;
      const sentence = oneSentence(record.blurb);
      if (sentence) { blurb.textContent = sentence; blurb.hidden = false; }
      say(record);
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
