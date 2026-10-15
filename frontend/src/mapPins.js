// What the map draws, worked out without a map. The server sends one compact tuple per pin
// ([slug, name, lat, lng, sector, city, hiring, domain]); pinIndex.js groups them for a zoom level and a window, so the
// page only ever creates elements for what is in view: a few dozen clusters and pins, however many companies
// there are. (Creating an element per company is what made 5,000 pins slow before.)
export const CLUSTER_MAX_ZOOM = 16; // up to here pins that are close together are grouped; one zoom deeper they are all single

// A cluster is a ring like a pin's, in the same dark fill with the one accent for its number; its size says how many it holds: a cluster of
// this many companies is drawn a size up...
export const CLUSTER_MEDIUM = 10;
export const CLUSTER_LARGE = 50; // ...and of this many a size up again (the map's key says so)
export const clusterSize = (count) => (count < CLUSTER_MEDIUM ? 'small' : count < CLUSTER_LARGE ? 'medium' : 'large');
// How wide each size is on screen, in pixels (the pin's box is 44, its square 40).
export const CLUSTER_PX = { small: 40, medium: 48, large: 58 };

// How well a company's place is known, in the words the site uses for it. The server says the same (models/location.js):
// a pin carries only the precision and whether the address was checked, and the words are made here.
export function locationQuality(precision, checked = false) {
  switch (precision) {
    case 'EXACT': return checked ? 'Verified office' : 'Office address on file';
    case 'SUBURB': return 'Location: suburb-level';
    case 'CITY': return 'Location: city-level';
    case 'STATE': return 'Location: state-level';
    default: return 'Location unknown';
  }
}

// ---------- investors on the map ----------

// An investor's record states the cities of its offices and, for the offices whose own page gives one, a street address. An office with an address
// the geocoder has placed is drawn there (precision EXACT: a solid edge, the address in its words); every other is drawn at the reference point of its
// city (precision CITY) and says so: a dashed edge, "VC" on the tile, and these words wherever its place is told.
export const KIND_VC = 'vc';
export function vcQuality(role, precision = 'CITY') {
  if (precision === 'EXACT') return 'Office address from its own website';
  return role === 'office' ? 'City-level: it has an office in this city, no address on file' : 'City-level: its headquarters city, no address on file';
}

// An investor's mark (an item of /api/investors/pins) as a tuple that reads like a company's, with the kind and the address of its page after it:
// [id, name, lat, lng, sector, city, hiring, domain, precision, place, checked, logo, 'vc', slug, role]. The id is the investor's address and the
// city (an investor with an office in two cities is two marks), the sector the first one it states, and hiring is never claimed.
export function vcTuple(pin) {
  return [pin.id, pin.name, pin.lat, pin.lng, pin.sectors?.[0] ?? '', pin.city, 0, pin.domain ?? '', pin.precision === 'EXACT' ? 'EXACT' : 'CITY', pin.place, 0, pin.logo ?? null, KIND_VC, pin.slug, pin.role ?? 'headquarters'];
}
export const isVc = (tuple) => tuple[12] === KIND_VC;

// Investors in one city all stand at that city's one reference point, so on a map they would be a pile of marks on the same spot: it is drawn as ONE
// mark, a group that says how many firms it holds and lists them when it is pressed. A city with one investor is that investor's own mark. The marks
// the map's index is given are these: [id, name, lat, lng, '', city, 0, '', 'CITY', place, 0, null, 'vcgroup', pins].
export const KIND_VC_GROUP = 'vcgroup';
export const isVcGroup = (tuple) => tuple[12] === KIND_VC_GROUP;
export function vcMarks(pins) {
  const byPoint = new Map();
  for (const pin of pins) {
    const key = `${pin.lat},${pin.lng}`;
    if (byPoint.has(key)) byPoint.get(key).push(pin); else byPoint.set(key, [pin]);
  }
  const marks = [];
  for (const group of byPoint.values()) {
    if (group.length === 1) { marks.push(vcTuple(group[0])); continue; }
    const first = group[0];
    // firms at one street address (the same building) are a group too, but a group of an address, not of a city
    const atAddress = group.every((p) => p.precision === 'EXACT');
    marks.push([`vcgroup:${atAddress ? first.id : first.city}`, `${group.length} VCs ${atAddress ? 'at one address' : `in ${first.city}`}`, first.lat, first.lng, '', first.city, 0, '', atAddress ? 'EXACT' : 'CITY', first.place, 0, null, KIND_VC_GROUP, group]);
  }
  return marks;
}

// A pin's tuple as the object the rest of the page reads. The tuple is
// [slug, name, lat, lng, sector, city, hiring, domain, precision, place, checked]; a tuple from a server that does not
// yet say how well the place is known stops after the domain, and the company then carries no `location`. An investor's (vcTuple) is
// { kind: 'vc', slug, id, ... } with the same `location`, worded for a city.
export function pinPayload(tuple) {
  const [slug, name, lat, lng, sector, city, hiring, domain, precision, place, checked] = tuple;
  if (isVc(tuple)) {
    return {
      kind: KIND_VC, slug: tuple[13], id: slug, name, lat, lng, city, sector, role: tuple[14], verified: true, website: domain ? `https://${domain}` : '',
      location: { precision: precision === 'EXACT' ? 'EXACT' : 'CITY', place: place || city, quality: vcQuality(tuple[14], precision) },
    };
  }
  const company = { slug, name, lat, lng, sector, city, hiring: hiring === 1 || hiring === true, verified: true, website: domain ? `https://${domain}` : '' };
  if (!precision) return company;
  return { ...company, location_precision: precision, location: { precision, place: place || city, quality: locationQuality(precision, checked === 1 || checked === true) } };
}

// ---------- groups: companies known only to a city or a state ----------

// What a group says it is, e.g. "Sydney — 42 startups with city-level locations". A group is never a company's own place.
export function areaLabel(area) {
  const level = area.kind === 'STATE' ? 'state' : 'city';
  return `${area.label} — ${area.count} ${area.count === 1 ? `startup with a ${level}-level location` : `startups with ${level}-level locations`}`;
}

// The filters that list a group's companies, on top of whatever the visitor already filtered by.
export const areaFilters = (area) => (area.kind === 'STATE' ? { precision: 'STATE', state: area.state } : { precision: 'CITY', city: area.city });

// What the list is narrowed to, when it is narrowed by how well a place is known or by state (a group opened as a list);
// '' when it is not.
export function scopeText({ precision, city, state } = {}) {
  const level = { EXACT: 'Exact office locations', SUBURB: 'Suburb-level locations', CITY: 'City-level locations', STATE: 'State-level locations' }[String(precision ?? '').toUpperCase()];
  if (!level && !state) return '';
  const where = precision === 'STATE' || !city ? state : city;
  if (!level) return `Companies in ${state}`;
  return where ? `${level} in ${where}` : level;
}

// A company named in a group, as much as the group knows of it, for the panel to open at once (the full record follows).
export function areaMember(area, member) {
  const place = [area.city, area.state].filter(Boolean).join(', ') || area.label;
  return { slug: member.slug, name: member.name, city: area.city ?? '', verified: true, location_precision: area.kind, location: { precision: area.kind, place, quality: locationQuality(area.kind) } };
}

// (The grouping itself, createPinIndex, is in pinIndex.js: it needs Supercluster, which only the map should carry.)

// A window slightly larger than the screen, so a pin at the edge is already there when the map is nudged,
// kept inside the world.
export function paddedWindow(bounds, by = 0.15) {
  const w = bounds.getWest();
  const e = bounds.getEast();
  const s = bounds.getSouth();
  const n = bounds.getNorth();
  const dx = (e - w) * by;
  const dy = (n - s) * by;
  return { west: Math.max(-180, w - dx), south: Math.max(-85, s - dy), east: Math.min(180, e + dx), north: Math.min(85, n + dy) };
}

// ---------- the name under a pin ----------

// A company's name is written under its pin once the map is close enough that pins stand apart: from zoom 7, and from zoom 9
// on a phone, where a label is a larger part of the screen. Below that the map is tiles and clusters only.
export const LABEL_ZOOM = 7;
export const LABEL_ZOOM_NARROW = 9;
export const labelsVisible = (zoom, narrow = false) => zoom >= (narrow ? LABEL_ZOOM_NARROW : LABEL_ZOOM);
// The label of a city-level group ("Sydney 44 city-level") is written from this zoom; further out the group is its ring alone (its name is in its tooltip), so
// the names of a dozen cities do not crowd the clusters of a map of the whole country.
export const AREA_CHIP_ZOOM = 8;

// The room a label takes, in pixels, from the centre of its pin. (The styles set a 24px-tall chip, at most 160px wide, that
// hangs 20px under the centre: the page works out where labels fit without measuring a single element.)
const PIN_RADIUS = 22; // the pin's box is 44px across
const LABEL_TOP = 22; // the name card starts just under the square (explore.css .pin-label)
const LABEL_HEIGHT = 26;
const LABEL_MAX_WIDTH = 170;
const CLUSTER_RADIUS = 26; // a cluster's circle is 40 to 58px across: room is kept for the middle size
const LABEL_GAP = 2; // clear air between a label and whatever is beside it
export const MAX_LABELS = 150; // however many pins are on screen, the page names at most this many
export const labelWidth = (text) => Math.min(LABEL_MAX_WIDTH, Math.round(String(text).length * 7.2) + 22);

const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

// Which pins get their name written. pins: [{ id, x, y, text, rank }] with x and y the pin's centre on screen and a lower
// rank worth naming first (the one that is open, then those hiring, then the rest, each in the order given). A label is
// written only where it covers no label already written and no other pin, so a crowded place shows a few names clearly and
// not all of them on top of each other; zoom in and more of them fit. blockers: [{ x, y }] the centres of the clusters on
// screen, which a name must not cover either. Returns the set of ids that are named.
export function chooseLabels(pins, { limit = MAX_LABELS, blockers = [] } = {}) {
  const circles = pins.map((p) => ({ id: p.id, left: p.x - PIN_RADIUS, right: p.x + PIN_RADIUS, top: p.y - PIN_RADIUS, bottom: p.y + PIN_RADIUS }));
  for (const b of blockers) circles.push({ id: null, left: b.x - CLUSTER_RADIUS, right: b.x + CLUSTER_RADIUS, top: b.y - CLUSTER_RADIUS, bottom: b.y + CLUSTER_RADIUS });
  const order = pins.map((p, n) => n).sort((a, b) => pins[a].rank - pins[b].rank || a - b);
  const written = []; // the room each name takes, with clear air round it
  const named = new Set();
  for (const n of order) {
    if (named.size >= limit) break;
    const p = pins[n];
    const half = labelWidth(p.text) / 2;
    const box = { left: p.x - half, right: p.x + half, top: p.y + LABEL_TOP, bottom: p.y + LABEL_TOP + LABEL_HEIGHT };
    const roomy = { left: box.left - LABEL_GAP, right: box.right + LABEL_GAP, top: box.top - LABEL_GAP, bottom: box.bottom + LABEL_GAP };
    if (written.some((w) => overlaps(roomy, w))) continue;
    if (circles.some((c) => c.id !== p.id && overlaps(box, c))) continue;
    written.push(roomy);
    named.add(p.id);
  }
  return named;
}

// ---------- the investors as a list ----------

// The investors behind a set of marks (/api/investors/pins items), one row for each, in name order: an investor with marks in two cities is one firm
// in two places. `pin` is its first mark, for what opens it.
export function vcFirms(pins) {
  const firms = new Map();
  for (const pin of pins) {
    const firm = firms.get(pin.slug);
    if (firm) firm.places.push(pin.city); else firms.set(pin.slug, { slug: pin.slug, name: pin.name, domain: pin.domain, stages: pin.stages ?? [], sectors: pin.sectors ?? [], places: [pin.city], pin });
  }
  return [...firms.values()].sort((a, b) => a.name.localeCompare(b.name));
}
