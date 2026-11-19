// The words of a pin's card (the map's preview of a company): one plain sentence, the sector, and where it is. Plain functions, so the three places a card is drawn say the same
// thing (the compact card beside a pin, the phone's sheet, the map's own popup) and so they can be tested.

const blank = (value) => value == null || String(value).trim() === '' || /^unknown$/i.test(String(value).trim());

// The first sentence of what a company says it does, as a card's one line: not cut in the middle of a word, and with an ellipsis only where it was cut. A text with no full stop is
// one sentence. Nothing is added, so a company that says nothing has no line.
export function oneSentence(text, max = 170) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const first = t.match(/^.*?[.!?](?=\s+[A-Z0-9"“(]|$)/)?.[0] ?? t;
  if (first.length <= max) return first;
  const cut = first.slice(0, max - 1);
  const at = cut.lastIndexOf(' ');
  return `${cut.slice(0, at > 40 ? at : cut.length).replace(/[,;:\s]+$/, '')}…`;
}

// The sector as the menus name it (the display sector, from the server), else what the source said unless that is "Unknown": a company with no sector has none to show.
export function cardSector(...sources) {
  for (const s of sources) {
    if (!s) continue;
    if (!blank(s.sectorGroup)) return s.sectorGroup;
  }
  for (const s of sources) {
    if (s && !blank(s.sector)) return s.sector;
  }
  return '';
}

// "Surry Hills, Sydney", or "Sydney" where no suburb is known: never a street address, never how well the place is known. A suburb that is the city is said once.
export function cardPlace(...sources) {
  const pick = (key) => sources.map((s) => s?.[key]).find((v) => !blank(v)) ?? '';
  const suburb = pick('suburb');
  const city = pick('city');
  return [suburb && suburb !== city ? suburb : '', city].filter(Boolean).join(', ');
}
