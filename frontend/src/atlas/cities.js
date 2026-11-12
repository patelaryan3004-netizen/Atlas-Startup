// The city badges of the national view ("Melbourne 234"), worked out from the pins the map already has. Nothing here is typed in: a badge's number is the count
// of distinct organisations whose published pin is in that city, under whatever filters are on, and the badge sits on the city's own reference point
// (cityViews.js), which is also where the map goes when the city is picked. A company known only to its city has no pin, so it is not counted here and is
// never drawn as a point.
import { MAP_CITIES, cityView } from '../cityViews.js';

const RAD = Math.PI / 180;
export function kmBetween(aLat, aLng, bLat, bLng) {
  const h = Math.sin(((bLat - aLat) * RAD) / 2) ** 2 + Math.cos(aLat * RAD) * Math.cos(bLat * RAD) * Math.sin(((bLng - aLng) * RAD) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

const BIG = new Set(MAP_CITIES);

// The ten cities a company's pin belongs to, by the server's own assignment and nothing of ours: the pin carries its `metro` (the big city its postcode is in,
// geo/metro.js, the field after the logo; null for a company that belongs to none of the ten, a regional town), and the city filter also takes a company whose own
// city is one of the ten. A pin that is in none stays on the map (it is a pin like the rest) and under no badge. An answer from a server that does not send the
// metro yet has no such field, so only the pin's own city name counts then: never a guess from where it stands.
export const METRO_AT = 12;
export function citiesOfPin(tuple) {
  const found = [];
  const metro = tuple[METRO_AT];
  if (typeof metro === 'string' && BIG.has(metro)) found.push(metro);
  if (BIG.has(tuple[5]) && !found.includes(tuple[5])) found.push(tuple[5]);
  return found;
}

// The badges: [{ city, count, lat, lng, points }] for the cities that have at least one published pin, busiest first. `markers` are the map's company tuples
// ([slug, name, lat, lng, sector, city, ..., metro]); `vcPins` the investors' marks (/api/investors/pins items), counted only when `showVcs`, in the city they name, and
// a firm with offices in two cities is counted once in each. `points` are the pins' own coordinates, for fitting the map to the city.
export function cityBadges({ markers = [], vcPins = [], showCompanies = true, showVcs = false } = {}) {
  const found = new Map();
  const add = (city, key, lat, lng) => {
    let entry = found.get(city);
    if (!entry) { entry = { keys: new Set(), points: [] }; found.set(city, entry); }
    if (entry.keys.has(key)) return;
    entry.keys.add(key);
    entry.points.push([lat, lng]);
  };
  if (showCompanies) for (const t of markers) for (const city of citiesOfPin(t)) add(city, `c:${t[0]}`, t[2], t[3]);
  if (showVcs) for (const p of vcPins) if (BIG.has(p.city)) add(p.city, `v:${p.slug ?? p.id}`, p.lat, p.lng);
  return [...found]
    .map(([city, { keys, points }]) => ({ city, count: keys.size, lat: cityView(city).lat, lng: cityView(city).lng, points }))
    .sort((a, b) => b.count - a.count || a.city.localeCompare(b.city));
}

// Where the map goes for a city: the box round its pins, with the few far-out ones left to the clusters (one company 60 km out would turn a view of a city into
// a view of a state). The box holds the pins within a distance of the middle of the pins: a quarter more than nine in ten of them are from it, at least CITY_FIT_MIN_KM
// and at most CITY_FIT_KM. A city with one pin, or pins on one spot, gets a box of a district, so the map shows streets and not a point.
export const CITY_FIT_KM = 35;
export const CITY_FIT_MIN_KM = 8;
const median = (values) => { const s = [...values].sort((a, b) => a - b); return s[s.length >> 1]; };
export function cityBounds(points, { minSpan = 0.06 } = {}) {
  if (!points.length) return null;
  const mid = [median(points.map((p) => p[0])), median(points.map((p) => p[1]))];
  const away = points.map((p) => kmBetween(mid[0], mid[1], p[0], p[1]));
  const ninetieth = [...away].sort((a, b) => a - b)[Math.min(away.length - 1, Math.floor(away.length * 0.9))];
  const limit = Math.min(CITY_FIT_KM, Math.max(CITY_FIT_MIN_KM, ninetieth * 1.25));
  const near = points.filter((p, i) => away[i] <= limit);
  const use = near.length ? near : points;
  let south = Math.min(...use.map((p) => p[0]));
  let north = Math.max(...use.map((p) => p[0]));
  let west = Math.min(...use.map((p) => p[1]));
  let east = Math.max(...use.map((p) => p[1]));
  const grow = (lo, hi) => (hi - lo < minSpan ? [(lo + hi) / 2 - minSpan / 2, (lo + hi) / 2 + minSpan / 2] : [lo, hi]);
  [south, north] = grow(south, north);
  [west, east] = grow(west, east);
  return [[south, west], [north, east]];
}

// ---------- keeping the badges apart ----------

// A badge is a label (the city and its number) hung beside a small anchor on the city. Cities close together on a national map (Sydney, Newcastle and Canberra;
// Brisbane and the Gold Coast) would put their labels on top of one another, so each label is tried in a few places beside its anchor, nearest first, and the
// first that clears the labels already placed and the other anchors is used. A label moved off its anchor's level is joined to it by a thin line.
// `at` is where each anchor is on screen: [{ city, x, y, w }] with w the label's width; `size` the map's { x, y }.
const LABEL_H = 30;
const GAP = 10; // from the anchor to its label
const SLOTS = [
  ['right', 0], ['left', 0], ['right', -1], ['right', 1], ['left', -1], ['left', 1], ['right', -2], ['right', 2], ['left', -2], ['left', 2],
];
const STEP = 27;
const hit = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
export const labelWidth = (city, count) => Math.round(city.length * 7.6 + String(count).length * 7.6 + 40);

export function layoutBadges(at, size, { prefer = {} } = {}) {
  const anchors = at.map((a) => ({ l: a.x - 7, r: a.x + 7, t: a.y - 7, b: a.y + 7 }));
  const placed = [];
  return at.map((a, i) => {
    const wanted = prefer[a.city];
    const order = wanted ? [...SLOTS].sort((x, y) => (y[0] === wanted ? 1 : 0) - (x[0] === wanted ? 1 : 0)) : SLOTS;
    let pick = null;
    for (const [side, row] of order) {
      const y = a.y + row * STEP;
      const l = side === 'right' ? a.x + GAP : a.x - GAP - a.w;
      const rect = { l, r: l + a.w, t: y - LABEL_H / 2, b: y + LABEL_H / 2 };
      if (rect.l < 6 || rect.r > size.x - 6 || rect.t < 6 || rect.b > size.y - 6) continue;
      if (placed.some((p) => hit(rect, p))) continue;
      if (anchors.some((r, j) => j !== i && hit(rect, r))) continue;
      pick = { side, row, rect };
      break;
    }
    if (!pick) return { city: a.city, hidden: true };
    placed.push(pick.rect);
    return { city: a.city, side: pick.side, dy: pick.row * STEP, hidden: false };
  });
}
