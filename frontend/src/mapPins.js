import Supercluster from 'supercluster';

// What the map draws, worked out without a map. The server sends one compact tuple per pin
// ([slug, name, lat, lng, sector, city, hiring, domain]); this groups them for a zoom level and a window, so the
// page only ever creates elements for what is in view: a few dozen clusters and pins, however many companies
// there are. (Creating an element per company is what made 5,000 pins slow before.)
export const CLUSTER_MAX_ZOOM = 16; // up to here pins that are close together are grouped; one zoom deeper they are all single
export const LOGO_ZOOM = 13; // from this zoom a pin may show the company's logo...
export const MAX_LOGOS = 60; // ...but only while few pins are on screen, so the page does not fetch hundreds of images

const STACK_PLACES = 4; // at the deepest zoom, pins within about 10 metres are one stack: their points cannot be told apart

export const clusterSize = (count) => (count < 10 ? 'small' : count < 50 ? 'medium' : 'large');

// A pin's tuple as the object the rest of the page reads.
export function pinPayload(tuple) {
  const [slug, name, lat, lng, sector, city, hiring, domain] = tuple;
  return { slug, name, lat, lng, sector, city, hiring: hiring === 1 || hiring === true, verified: true, website: domain ? `https://${domain}` : '' };
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
