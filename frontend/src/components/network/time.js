// How a moment is written on the pages of the community: a short "3h ago" for a post, with the full date for anyone who points at it; and an event's own
// day and time in the event's own time zone (never the visitor's, which would move it).
const MIN = 60000;
const HOUR = 3600000;
const DAY = 86400000;

export function timeAgo(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const age = Math.max(0, now - t);
  if (age < MIN) return 'just now';
  if (age < HOUR) return `${Math.floor(age / MIN)}m ago`;
  if (age < DAY) return `${Math.floor(age / HOUR)}h ago`;
  if (age < 7 * DAY) return `${Math.floor(age / DAY)}d ago`;
  return new Date(t).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: new Date(t).getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric' });
}

export const fullDate = (iso) => { const t = Date.parse(iso); return Number.isNaN(t) ? '' : new Date(t).toLocaleString('en-AU', { dateStyle: 'full', timeStyle: 'short' }); };

// "Wed 11 Nov, 5:30pm AEDT" for a timed event; "Tue 16 Feb 2027" (or "Tue 16 to Wed 17 Feb 2027") for one with only days. `event.starts` is the organiser's local
// day or day and time in `event.timezone`.
export function eventWhen(event) {
  const zone = event.timezone;
  const part = (iso, opts) => new Date(iso).toLocaleString('en-AU', { timeZone: zone, ...opts });
  const day = (iso, extra = {}) => part(iso, { weekday: 'short', day: 'numeric', month: 'short', ...extra });
  const time = (iso) => part(iso, { hour: 'numeric', minute: '2-digit', hour12: true }).replace(' ', '').toLowerCase();
  const zoneName = (iso) => new Intl.DateTimeFormat('en-AU', { timeZone: zone, timeZoneName: 'short' }).formatToParts(new Date(iso)).find((p) => p.type === 'timeZoneName')?.value ?? '';
  if (!event.time_confirmed) {
    const first = `${event.starts}T12:00:00Z`;
    const last = event.ends ? `${event.ends.slice(0, 10)}T12:00:00Z` : null;
    const dayOnly = (iso, extra = {}) => new Date(iso).toLocaleDateString('en-AU', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', ...extra });
    if (last && last !== first) return { date: `${dayOnly(first)} to ${dayOnly(last, { year: 'numeric' })}`, time: 'Times not yet announced' };
    return { date: dayOnly(first, { year: 'numeric' }), time: 'Time not yet announced' };
  }
  const sameYear = new Date(event.starts_at).getUTCFullYear() === new Date().getUTCFullYear();
  const date = day(event.starts_at, sameYear ? {} : { year: 'numeric' });
  const end = event.ends_at ? ` to ${time(event.ends_at)}` : '';
  return { date, time: `${time(event.starts_at)}${end} ${zoneName(event.starts_at)}`.trim() };
}

// The day a page was last read, as a visitor reads it ("27 Oct 2026").
export const dayLabel = (day) => { const t = Date.parse(`${String(day).slice(0, 10)}T12:00:00Z`); return Number.isNaN(t) ? '' : new Date(t).toLocaleDateString('en-AU', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }); };
