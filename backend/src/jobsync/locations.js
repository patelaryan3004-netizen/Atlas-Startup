// Where a role can be worked, from the words the employer used for it: never from where the company has its head office.
//
// A posting names one place ("Melbourne, Victoria, Australia"), several in one string ("Melbourne / Sydney"), or a list of them (Lever's allLocations). Each place is read on
// its own, because one role can be open in two cities and must then belong to both. Only what the words say counts:
//   - a place is Australian when it says so (Australia, AU, a state's name or its NSW/VIC/QLD/TAS abbreviation), or when it is one of the capitals whose name is not also a
//     well-known place elsewhere and nothing next to it says it is elsewhere ("Melbourne, FL", "Perth, Scotland" are not ours);
//   - a role is Remote AU only when the employer's words say that someone in Australia can do it remotely: "remote" and an Australian place in the same place, or a
//     "remote" workplace type with an Australian place. "Remote", "Remote - Global", "Remote - US", "Remote - APAC" are not evidence about Australia, so they are not Remote AU;
//   - the arrangement (remote, hybrid, on-site) is stated only if the posting states it.
// This is the one place that decides these things, so the board, its counts and the tests agree.
export const CITIES = ['Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide', 'Canberra', 'Gold Coast', 'Newcastle', 'Hobart', 'Darwin'];

// The capitals that are Australian when named alone. Newcastle and the Gold Coast need a state or the country (Newcastle upon Tyne is not ours).
const BARE = { Sydney: /\bSydney\b/i, Melbourne: /\bMelbourne\b/i, Brisbane: /\bBrisbane\b/i, Perth: /\bPerth\b/i, Adelaide: /\bAdelaide\b/i, Canberra: /\bCanberra\b/i, Hobart: /\bHobart\b/i, Darwin: /\bDarwin\b/i };
const NEEDS_STATE = { Newcastle: /\bNewcastle\b/i, 'Gold Coast': /\bGold Coast\b/i };

// Well-known suburbs and business districts, read only when the place also says it is in Australia or the right state (a "Richmond" or a "Collingwood" alone is not enough).
const SUBURBS = {
  Melbourne: ['Collingwood', 'Fitzroy', 'Richmond', 'Cremorne', 'South Yarra', 'Southbank', 'Docklands', 'Carlton', 'Abbotsford', 'Hawthorn', 'St Kilda', 'Brunswick', 'Northcote', 'Prahran', 'Port Melbourne', 'Footscray', 'Box Hill', 'Burwood', 'Clayton', 'Windsor', 'Kensington', 'Notting Hill'],
  Sydney: ['Surry Hills', 'Pyrmont', 'Barangaroo', 'Ultimo', 'Parramatta', 'Chatswood', 'North Sydney', 'Redfern', 'Alexandria', 'Darlinghurst', 'Chippendale', 'Haymarket', 'Macquarie Park', 'Bondi Junction', 'Manly', 'Newtown', 'Mascot', 'St Leonards', 'Rhodes', 'Milsons Point'],
  Perth: ['Subiaco', 'West Perth', 'East Perth', 'Northbridge', 'Fremantle', 'Osborne Park', 'Leederville', 'Claremont', 'Nedlands', 'Joondalup', 'Welshpool'],
  Brisbane: ['Fortitude Valley', 'South Brisbane', 'Newstead', 'Milton', 'Toowong', 'West End', 'Spring Hill', 'Bowen Hills', 'Kangaroo Point', 'Teneriffe', 'Herston', 'Eagle Farm'],
  Adelaide: ['Glenelg', 'Norwood', 'Thebarton', 'Mawson Lakes', 'Mile End'],
  Canberra: ['Barton', 'Braddon', 'Fyshwick', 'Kingston', 'Civic'],
};

// What says a place is Australian: the country or a state spelled out, or a state's abbreviation in capitals. (WA, SA and NT also name places overseas, so they do not count
// alone: "Perth, WA" is read by its city.)
const AU_WORDS = /\baustralia(?:n)?\b|\bnew south wales\b|\bqueensland\b|\bwestern australia\b|\bsouth australia\b|\btasmania\b|\bnorthern territory\b|\bvictoria,\s*(?:au|australia)\b/i;
const AU_CODES = /\b(?:AU|AUS|NSW|VIC|QLD|TAS|ACT)\b/;
// What next to a city name says it is the other one: "Melbourne, FL", "Sydney, Nova Scotia", "Perth, Scotland", "Newcastle upon Tyne".
const ELSEWHERE = /,\s*(?:FL|Florida|NS|Nova Scotia|UK|United Kingdom|England|Scotland|Wales|Canada|USA|US|United States|Ontario|Indiana|IN)\b|\bupon tyne\b|\b(?:UK|U\.K\.|United Kingdom)\b/i;

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

// One advertised place, read: { label, au, city }.
export function readPlace(label) {
  const text = clean(label);
  if (!text) return null;
  const says = AU_WORDS.test(text) || AU_CODES.test(text);
  const away = ELSEWHERE.test(text) && !/\baustralia\b/i.test(text);
  let city = null;
  if (!away) {
    for (const name of CITIES) {
      if (BARE[name]?.test(text)) { city = name; break; }
      if (NEEDS_STATE[name]?.test(text) && says) { city = name; break; }
    }
    if (!city && says) {
      for (const [name, suburbs] of Object.entries(SUBURBS)) {
        if (suburbs.some((s) => new RegExp(`\\b${s}\\b`, 'i').test(text))) { city = name; break; }
      }
    }
  }
  return { label: text, au: Boolean(city) || (says && !away), city };
}

const split = (label) => clean(label).split(/\s*(?:;|\||\/|\bor\b)\s*/i).map(clean).filter(Boolean);

// The arrangement the posting states. `workplaceType` is the provider's own field (Lever); the words of a place count too ("Hybrid", "On-site", "Remote").
export function arrangementOf(workplaceType, labels = []) {
  const t = clean(workplaceType).toLowerCase().replace(/[_\s]+/g, '-');
  if (t === 'remote') return 'remote';
  if (t === 'hybrid') return 'hybrid';
  if (t === 'on-site' || t === 'onsite') return 'on_site';
  const words = labels.join(' ');
  if (/\bhybrid\b/i.test(words)) return 'hybrid';
  if (/\bremote\b/i.test(words)) return 'remote';
  if (/\bon-?site\b/i.test(words)) return 'on_site';
  return null;
}

// Everything the board needs about where a role is, from the labels the employer gave and its workplace type.
//   places   each advertised place, read
//   cities   the Australian capitals among them, once each
//   au       at least one place is Australian
//   remoteAu the employer's words say it can be worked remotely from Australia, with `evidence` (the words)
export function workPlaces(labels, { workplaceType = null } = {}) {
  const raw = [].concat(labels ?? []).map(clean).filter(Boolean);
  const places = [];
  // A part that is only a word about how the role is worked ("Remote", "Hybrid") names no place.
  const names = (part) => part.replace(/\b(?:remote|hybrid|on-?site)\b/gi, ' ').replace(/[()\-–—,:]+/g, ' ').trim();
  for (const label of raw) for (const part of split(label)) { const p = names(part) ? readPlace(part) : null; if (p) places.push({ ...p, remote: /\bremote\b/i.test(part) }); }
  const cities = [...new Set(places.map((p) => p.city).filter(Boolean))];
  const arrangement = arrangementOf(workplaceType, raw);
  let evidence = null;
  // "Remote" and an Australian place said together ("Remote - Australia", "Australia (Remote)"): the whole label is read, since splitting would separate the two.
  for (const label of raw) {
    if (!/\bremote\b/i.test(label)) continue;
    const whole = readPlace(label);
    if (whole?.au || places.some((p) => p.au && p.remote)) { evidence = label; break; }
  }
  // The provider says the workplace is remote and the place it gives is Australian: that is the employer saying so.
  if (!evidence && arrangement === 'remote' && places.some((p) => p.au)) evidence = `Workplace type "remote"; place: ${raw.join(' / ')}`;
  return { places, cities, au: places.some((p) => p.au), remoteAu: Boolean(evidence), evidence, arrangement, labels: raw };
}
