// How fresh a company's facts are, in the words the cards and the popup use. A date that is missing or not a date says nothing
// (null), so a card never shows a placeholder.
const DAY = 86400000;
export const RECHECK_AFTER_DAYS = 60;
export const EVENT_WINDOW_DAYS = 14;

const when = (iso) => { const t = Date.parse(iso); return Number.isNaN(t) ? null : t; };

// { text: 'Verified 3 days ago', stale: false }, or { text: 'Needs re-check', stale: true } once the check is over 60 days old.
export function verifiedLabel(iso, now = Date.now()) {
  const t = when(iso);
  if (t === null) return null;
  const days = Math.max(0, Math.floor((now - t) / DAY));
  if (days > RECHECK_AFTER_DAYS) return { text: 'Needs re-check', stale: true };
  if (days === 0) return { text: 'Verified today', stale: false };
  if (days === 1) return { text: 'Verified yesterday', stale: false };
  if (days < 14) return { text: `Verified ${days} days ago`, stale: false };
  return { text: `Verified ${Math.floor(days / 7)} weeks ago`, stale: false };
}

// '13 Oct 2026', for "Updated <date>".
export function shortDate(iso) {
  const t = when(iso);
  return t === null ? null : new Date(t).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Australia/Sydney' });
}

// The first event from today to 14 days on ({ title, date, url }), or null: the card's date badge. Dates are plain days (YYYY-MM-DD).
export function nextEvent(events, now = Date.now()) {
  if (!Array.isArray(events)) return null;
  const d = new Date(now);
  const start = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const end = start + (EVENT_WINDOW_DAYS + 1) * DAY;
  const soon = events.filter((e) => { const t = when(e?.date); return t !== null && t >= start && t < end; });
  soon.sort((a, b) => when(a.date) - when(b.date));
  return soon[0] ?? null;
}

export const eventDay = (e) => new Date(`${e.date}T00:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' });

// A field that holds nothing worth showing: empty, or one of the placeholders the data uses for "not known".
export const isBlank = (v) => v == null || (typeof v === 'string' && (v.trim() === '' || /^(unknown|n\/a|null|undefined|-)$/i.test(v.trim())));
export const present = (...values) => values.filter((v) => !isBlank(v));
