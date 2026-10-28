// Events: founder gatherings, demo days, workshops, pitch nights and conferences in Australia.
//
// Each one is read from the organiser's own page, with that page's address and the day it was last looked at. Nothing is invented: a time that has
// not been announced is not shown, a price that has not been confirmed says so, and an event that is over disappears by itself.
//
// An event's start and end are written the way its page gives them: a day ("2026-11-12") when no time is announced, or a day and time
// ("2026-11-12T18:00") in the event's own time zone (an IANA name such as Australia/Melbourne). Everything that needs a moment in time (hiding past events,
// the calendar file) is worked out from those two.
import { cleanText, httpsUrl, oneOf, bad } from './validate.js';

export const EVENT_TYPES = ['founder_meetup', 'demo_day', 'workshop', 'pitch_night', 'conference', 'other'];
export const EVENT_TYPE_LABELS = { founder_meetup: 'Founder gathering', demo_day: 'Demo day', workshop: 'Workshop', pitch_night: 'Pitch night', conference: 'Conference', other: 'Other' };
export const FORMATS = ['in_person', 'online', 'hybrid'];
export const COST_STATUSES = ['free', 'paid', 'unconfirmed'];
export const AU_ZONES = ['Australia/Sydney', 'Australia/Melbourne', 'Australia/Brisbane', 'Australia/Adelaide', 'Australia/Perth', 'Australia/Hobart', 'Australia/Darwin', 'Australia/Canberra'];

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

const validDay = (s) => { const d = new Date(`${s.slice(0, 10)}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s.slice(0, 10); };
const validZone = (tz) => { try { new Intl.DateTimeFormat('en-AU', { timeZone: tz }); return true; } catch (e) { return false; } };

function offsetMinutes(tz, utcMs) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]));
  return Math.round((Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - utcMs) / 60000);
}

// A local day (and time) in a zone, as a moment: milliseconds since 1970 in UTC.
export function zonedToUtcMs(local, tz) {
  const [day, time = '00:00'] = local.split('T');
  const [y, mo, d] = day.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const first = offsetMinutes(tz, guess);
  let ms = guess - first * 60000;
  const second = offsetMinutes(tz, ms);
  if (second !== first) ms = guess - second * 60000;
  return ms;
}

const nextDay = (day) => new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

// When an event starts and ends, as moments. With no time announced it runs from the start of its first day to the end of its last.
export function span(event) {
  const timed = DAY_TIME.test(event.starts);
  const start = zonedToUtcMs(event.starts, event.timezone);
  let end;
  if (event.ends) end = DAY_TIME.test(event.ends) ? zonedToUtcMs(event.ends, event.timezone) : zonedToUtcMs(`${nextDay(event.ends)}T00:00`, event.timezone);
  else end = timed ? start : zonedToUtcMs(`${nextDay(event.starts.slice(0, 10))}T00:00`, event.timezone);
  return { start, end, timed };
}

// What is wrong with an event record, in words ([] when nothing is). A record with a problem is never shown.
export function eventProblems(e) {
  const out = [];
  const need = (cond, msg) => { if (!cond) out.push(msg); };
  need(typeof e?.id === 'string' && /^[a-z0-9][a-z0-9-]{2,80}$/.test(e.id), 'id: lower-case letters, numbers and dashes');
  need(typeof e?.name === 'string' && e.name.trim().length >= 3, 'name');
  need(typeof e?.organiser === 'string' && e.organiser.trim().length >= 2, 'organiser');
  need(EVENT_TYPES.includes(e?.type), `type: one of ${EVENT_TYPES.join(', ')}`);
  need(FORMATS.includes(e?.format), `format: one of ${FORMATS.join(', ')}`);
  need(typeof e?.timezone === 'string' && validZone(e.timezone), 'timezone: an IANA name such as Australia/Melbourne');
  need(typeof e?.starts === 'string' && (DAY.test(e.starts) || DAY_TIME.test(e.starts)) && validDay(e.starts), 'starts: a day (2026-11-12) or a day and time (2026-11-12T18:00)');
  if (e?.ends) need(typeof e.ends === 'string' && (DAY.test(e.ends) || DAY_TIME.test(e.ends)) && validDay(e.ends) && e.ends >= e.starts, 'ends: a day or a day and time, not before it starts');
  if (e?.format !== 'online') need(typeof e?.city === 'string' && e.city.trim().length >= 2, 'city: an in-person or hybrid event has one');
  if (e?.format !== 'in_person') need(!e?.online_url || /^https:\/\//.test(e.online_url), 'online_url: https');
  need(COST_STATUSES.includes(e?.cost?.status), `cost.status: one of ${COST_STATUSES.join(', ')}`);
  if (e?.cost?.status === 'paid') need(e.cost.note || e.cost.amount != null, 'cost: a paid event says what it costs, or where to see the price');
  need(typeof e?.audience === 'string' && e.audience.trim().length >= 5, 'audience: who it is useful for');
  need(typeof e?.why_selected === 'string' && e.why_selected.trim().length >= 10, 'why_selected: why it is listed');
  need(typeof e?.registration_url === 'string' && /^https:\/\/\S+$/.test(e.registration_url), 'registration_url: the organiser\'s page, https');
  need(typeof e?.source_url === 'string' && /^https:\/\/\S+$/.test(e.source_url), 'source_url: the page the details were read from, https');
  need(typeof e?.source_checked_at === 'string' && DAY.test(e.source_checked_at) && validDay(e.source_checked_at), 'source_checked_at: the day the page was read (2026-10-28)');
  if (e?.note) need(typeof e.note === 'string' && e.note.length <= 220, 'note: at most 220 characters');
  need(['published', 'cancelled'].includes(e?.status), 'status: published or cancelled');
  if (!out.length && span(e).end < span(e).start) out.push('ends: before it starts');
  return out;
}

// The events a visitor may see, soonest first. A cancelled event is shown only until it would have ended, marked cancelled; an event that is over is gone.
export function upcomingEvents(events, now = Date.now()) {
  return events
    .filter((e) => eventProblems(e).length === 0)
    .map((e) => ({ e, s: span(e) }))
    .filter(({ s }) => s.end > now || (s.timed && s.end === s.start && s.start + 3 * 3600000 > now)) // an event with no end time is over three hours after it starts
    .sort((a, b) => a.s.start - b.s.start || a.e.name.localeCompare(b.e.name))
    .map(({ e, s }) => present(e, s));
}

export function present(e, s = span(e)) {
  return {
    id: e.id, name: e.name, organiser: e.organiser, type: e.type, type_label: EVENT_TYPE_LABELS[e.type], format: e.format, city: e.city ?? '', venue: e.venue ?? '',
    online_url: e.online_url ?? '', timezone: e.timezone, starts: e.starts, ends: e.ends ?? null, time_confirmed: s.timed,
    starts_at: new Date(s.start).toISOString(), ends_at: e.ends || !s.timed ? new Date(s.end).toISOString() : null,
    cost: e.cost, audience: e.audience, why_selected: e.why_selected, note: e.note ?? '', registration_url: e.registration_url, source_url: e.source_url,
    source_checked_at: e.source_checked_at, status: e.status, origin: e.origin ?? 'curated',
  };
}

export function filterEvents(list, { city = '', type = '', format = '', search = '' } = {}) {
  const q = search.trim().toLowerCase();
  return list.filter((e) => (!city || e.city.toLowerCase() === city.toLowerCase())
    && (!type || e.type === type) && (!format || e.format === format)
    && (!q || [e.name, e.organiser, e.city, e.venue, e.audience].join(' ').toLowerCase().includes(q)));
}

export function eventFacets(list) {
  const count = (pick) => { const m = new Map(); for (const e of list) { const v = pick(e); if (v) m.set(v, (m.get(v) ?? 0) + 1); } return [...m].map(([value, n]) => ({ value, count: n })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)); };
  return { cities: count((e) => e.city), types: count((e) => e.type).map((t) => ({ ...t, label: EVENT_TYPE_LABELS[t.value] })), formats: count((e) => e.format) };
}

// ---------- the calendar file ----------

const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const stamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const dayStamp = (day) => day.slice(0, 10).replace(/-/g, '');
// Lines are folded at 75 characters, as the format asks.
const fold = (line) => { const out = []; let rest = line; while (rest.length > 74) { out.push(rest.slice(0, 74)); rest = ` ${rest.slice(74)}`; } out.push(rest); return out.join('\r\n'); };

// An iCalendar file for one event, with a reminder the day before. A day with no time is an all-day entry.
export function toIcs(e, { now = Date.now(), siteUrl = 'https://stillearly-au.vercel.app' } = {}) {
  const s = span(e);
  const place = e.format === 'online' ? (e.online_url || 'Online') : [e.venue, e.city].filter(Boolean).join(', ') + (e.format === 'hybrid' && e.online_url ? ` (also online: ${e.online_url})` : '');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Still Early//Events//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    `UID:${e.id}@stillearly`, `DTSTAMP:${stamp(now)}`,
  ];
  if (s.timed) {
    lines.push(`DTSTART:${stamp(s.start)}`, `DTEND:${stamp(Math.max(s.end, s.start + 3600000))}`);
  } else {
    lines.push(`DTSTART;VALUE=DATE:${dayStamp(e.starts)}`, `DTEND;VALUE=DATE:${dayStamp(nextDay((e.ends ?? e.starts).slice(0, 10)))}`);
  }
  lines.push(
    `SUMMARY:${esc(e.name)}`, `LOCATION:${esc(place)}`,
    `DESCRIPTION:${esc(`${e.name}, run by ${e.organiser}.\nRegister: ${e.registration_url}\nDetails last checked ${e.source_checked_at} at ${e.source_url}\nListed on Still Early (${siteUrl}). Check the organiser's page before you go: details can change.`)}`,
    `URL:${e.registration_url}`, 'STATUS:' + (e.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'),
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(`Tomorrow: ${e.name}`)}`, 'TRIGGER:-P1D', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR',
  );
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

// ---------- a suggestion's fields, checked ----------

// What a visitor may say about an event they would like listed. It is a suggestion: it is read by a person, checked against the organiser's page and
// completed (a time zone, why it is listed) before anything is shown.
export function eventSuggestion(input) {
  const o = input ?? {};
  const starts = cleanText(o.starts, { name: 'Start date', required: true, max: 20 });
  if (!(DAY.test(starts) || DAY_TIME.test(starts)) || !validDay(starts)) throw bad('Start date must look like 2026-11-12 (add the time as 2026-11-12T18:00 if you know it).');
  const ends = cleanText(o.ends, { name: 'End date', max: 20 });
  if (ends && (!(DAY.test(ends) || DAY_TIME.test(ends)) || !validDay(ends) || ends < starts)) throw bad('End date must look like 2026-11-13 and not be before the start.');
  return {
    name: cleanText(o.name, { name: 'Event name', min: 3, max: 120, required: true }),
    organiser: cleanText(o.organiser, { name: 'Organiser', min: 2, max: 100, required: true }),
    type: o.type ? oneOf(o.type, EVENT_TYPES, 'Type') : 'other',
    format: o.format ? oneOf(o.format, FORMATS, 'Format') : 'in_person',
    city: cleanText(o.city, { name: 'City', max: 60 }),
    venue: cleanText(o.venue, { name: 'Venue', max: 120 }),
    starts, ends,
    registration_url: httpsUrl(o.registration_url, { name: 'Registration link', required: true }),
    note: cleanText(o.note, { name: 'Note', max: 400, multiline: true }),
  };
}
