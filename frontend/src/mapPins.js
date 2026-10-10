import Supercluster from 'supercluster';

// What the map draws, worked out without a map. The server sends one compact tuple per pin
// ([slug, name, lat, lng, sector, city, hiring, domain]); this groups them for a zoom level and a window, so the
// page only ever creates elements for what is in view: a few dozen clusters and pins, however many companies
// there are. (Creating an element per company is what made 5,000 pins slow before.)
export const CLUSTER_MAX_ZOOM = 16; // up to here pins that are close together are grouped; one zoom deeper they are all single
export const LOGO_ZOOM = 13; // from this zoom a pin may show the company's logo...
export const MAX_LOGOS = 60; // ...but only while few pins are on screen, so the page does not fetch hundreds of images

const STACK_PLACES = 4; // at the deepest zoom, pins within about 10 metres are one stack: their points cannot be told apart

export const CLUSTER_MEDIUM = 10; // a cluster of this many companies is drawn amber...
export const CLUSTER_LARGE = 50; // ...and of this many orange (the map's key says so)
export const clusterSize = (count) => (count < CLUSTER_MEDIUM ? 'small' : count < CLUSTER_LARGE ? 'medium' : 'large');

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

// A pin's tuple as the object the rest of the page reads. The tuple is
// [slug, name, lat, lng, sector, city, hiring, domain, precision, place, checked]; a tuple from a server that does not
// yet say how well the place is known stops after the domain, and the company then carries no `location`.
export function pinPayload(tuple) {
  const [slug, name, lat, lng, sector, city, hiring, domain, precision, place, checked] = tuple;
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

export function createPinIndex(tuples) {
  const index = new Supercluster({ radius: 56, maxZoom: CLUSTER_MAX_ZOOM, minPoints: 2 });
  index.load(tuples.map((t, i) => ({ type: 'Feature', properties: { i }, geometry: { type: 'Point', coordinates: [t[3], t[2]] } })));

  return {
    size: tuples.length,

    // Clusters, stacks and single pins inside a window at a zoom. Each is { type, lat, lng, ... }:
    //   cluster  { id, count }          zoom in to open it
    //   stack    { members: [number] }  several companies at one place: list them
    //   pin      { i }                  one company
    view({ west, south, east, north }, zoom) {
      const z = Math.min(CLUSTER_MAX_ZOOM + 1, Math.max(0, Math.round(zoom)));
      const out = [];
      const stacks = new Map();
      for (const f of index.getClusters([west, south, east, north], z)) {
        const [lng, lat] = f.geometry.coordinates;
        if (f.properties.cluster) { out.push({ type: 'cluster', id: f.properties.cluster_id, count: f.properties.point_count, lat, lng }); continue; }
        if (z <= CLUSTER_MAX_ZOOM) { out.push({ type: 'pin', i: f.properties.i, lat, lng }); continue; }
        const key = `${lat.toFixed(STACK_PLACES)},${lng.toFixed(STACK_PLACES)}`;
        const stack = stacks.get(key);
        if (stack) stack.members.push(f.properties.i); else stacks.set(key, { type: 'pin', i: f.properties.i, members: [f.properties.i], lat, lng });
      }
      for (const s of stacks.values()) out.push(s.members.length > 1 ? { type: 'stack', members: s.members, lat: s.lat, lng: s.lng } : { type: 'pin', i: s.i, lat: s.lat, lng: s.lng });
      return out;
    },

    // The zoom at which a cluster opens into smaller ones.
    expansionZoom: (id) => index.getClusterExpansionZoom(id),
  };
}

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

// Whether pins in this view may carry logos.
export const showLogos = (zoom, pinCount) => zoom >= LOGO_ZOOM && pinCount <= MAX_LOGOS;

// ---------- the name under a pin ----------

// A company's name is written under its pin once the map is close enough that pins stand apart: from zoom 7, and from zoom 9
// on a phone, where a label is a larger part of the screen. Below that the map is circles only.
export const LABEL_ZOOM = 7;
export const LABEL_ZOOM_NARROW = 9;
export const labelsVisible = (zoom, narrow = false) => zoom >= (narrow ? LABEL_ZOOM_NARROW : LABEL_ZOOM);

// The room a label takes, in pixels, from the centre of its pin. (The styles set a 24px-tall chip, at most 160px wide, that
// hangs 20px under the centre: the page works out where labels fit without measuring a single element.)
const PIN_RADIUS = 18;
const LABEL_TOP = 20;
const LABEL_HEIGHT = 24;
const LABEL_MAX_WIDTH = 160;
const CLUSTER_RADIUS = 20; // a cluster's circle is 40px across
const LABEL_GAP = 2; // clear air between a label and whatever is beside it
export const MAX_LABELS = 150; // however many pins are on screen, the page names at most this many
export const labelWidth = (text) => Math.min(LABEL_MAX_WIDTH, Math.round(String(text).length * 6.8) + 20);

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
