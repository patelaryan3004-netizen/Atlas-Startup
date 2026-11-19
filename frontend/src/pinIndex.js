import Supercluster from 'supercluster';
import { CLUSTER_MAX_ZOOM } from './mapPins.js';
import { PINS_ZOOM, PIN_FOCUS_ZOOM } from './atlas/zoomModes.js';

// The grouping itself, kept apart from the map's other helpers (mapPins.js): the app's shell reads those for the list and the panels, and
// only the map needs Supercluster, so only the map's file carries it.
const STACK_PLACES = 4; // at the deepest zoom, pins within about 10 metres are one stack: their points cannot be told apart

// ---------- the map page's pins: spaced by zoom, revealed as the map comes closer ----------

// A company's pin is a logo tile of PIN_TILE pixels. There is no grouping and no count: instead the tiles are SPACED. At a given zoom the companies are taken in a fixed order and each gets
// its tile only if it keeps pinSpacing(zoom) pixels clear of the tiles already given (so no two logos are on top of each other); the others are, where there is room, a small plain dot at
// their place (no number, no ring), and where there is none (under a tile, or beside another dot) nothing is drawn. The spacing is wide while the map is far away and narrows as it comes
// closer, and the pins that fit are the same ones however the map is panned (the spacing is worked out over every pin in the world's own pixels at that zoom, not over the window), so
// zooming in adds logos (the odd one is swapped for a neighbour that ranks higher): each zoom level shows more of them until every company that is not on top of another has its own. Nothing is lost by it: the list beside the map has every
// company (a row lights its pin, drawn as a tile whether or not it fits, and brings it into view).
export const PIN_TILE = 40;
const SPACING_FAR = 18; // pixels of air between two tiles while the map is far away (zoom 9 and under)...
const SPACING_NEAR = 4; // ...and at street scale (zoom 14 and over)
export const pinSpacing = (zoom) => PIN_TILE + Math.max(SPACING_NEAR, Math.min(SPACING_FAR, SPACING_FAR - (zoom - 9) * ((SPACING_FAR - SPACING_NEAR) / 5)));
export const DOT_UNDER = 24; // a dot nearer than this to a tile's centre is under the tile
export const DOT_APART = 14; // and dots nearer than this to each other are drawn as one

// A place in the world's pixels at a zoom (the map's own projection: Leaflet's tiles are 256 pixels).
function worldPixels(lat, lng, zoom) {
  const size = 256 * 2 ** zoom;
  const sin = Math.sin((lat * Math.PI) / 180);
  return [((lng + 180) / 360) * size, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size];
}
// A stable number from a name, so the order of companies that have nothing to set them apart is fixed (not the order of the file, or of the window).
function hashOf(text) {
  let h = 2166136261;
  for (let n = 0; n < text.length; n += 1) { h ^= text.charCodeAt(n); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Same shape as createPinIndex, so the map draws either. `view(window, zoom, { keep })` returns the pins in the window: { type: 'pin', i, lat, lng } for a logo tile and
// { type: 'dot', i, lat, lng } for a plain dot; `keep(i)` says which are always a tile (the open company, and the ones the visitor saved).
export function createPlainPinIndex(tuples, { fromZoom = PINS_ZOOM, focusZoom = PIN_FOCUS_ZOOM } = {}) {
  const points = tuples.map((t, i) => ({ i, lat: t[2], lng: t[3] }));
  // The order companies and investors are given room in: those hiring now first; then the investors, who lean a little ahead of the startups (a startup that is hiring still goes before an investor,
  // and the rest after it: in the middle of a city, where the startups are many, no investor would otherwise have a logo until the map was very close); then those with a picture of their own (a logo or a
  // website to take one from), then the rest; each band by a fixed number from the name.
  const order = tuples.map((t, i) => i).sort((a, b) => {
    const rank = (i) => (tuples[i][6] ? 0 : tuples[i][12] === 'vc' ? 1 : tuples[i][11] || tuples[i][7] ? 2 : 3);
    return rank(a) - rank(b) || hashOf(String(tuples[a][0])) - hashOf(String(tuples[b][0])) || a - b;
  });
  const cache = new Map();
  const reveal = (zoom) => {
    const key = Math.round(zoom * 4);
    const found = cache.get(key);
    if (found) return found;
    const z = key / 4;
    const spacing = pinSpacing(z);
    const at = points.map((p) => worldPixels(p.lat, p.lng, z));
    const cellOf = (x, y, size) => `${Math.floor(x / size)},${Math.floor(y / size)}`;
    const near = (grid, size, x, y, within) => {
      const cx = Math.floor(x / size);
      const cy = Math.floor(y / size);
      for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) {
        for (const [px, py] of grid.get(`${cx + dx},${cy + dy}`) ?? []) if ((px - x) ** 2 + (py - y) ** 2 < within * within) return true;
      }
      return false;
    };
    const put = (grid, size, x, y) => { const k = cellOf(x, y, size); if (grid.has(k)) grid.get(k).push([x, y]); else grid.set(k, [[x, y]]); };
    const tileGrid = new Map();
    const tiles = new Set();
    for (const i of order) {
      const [x, y] = at[i];
      if (near(tileGrid, spacing, x, y, spacing)) continue;
      tiles.add(i);
      put(tileGrid, spacing, x, y);
    }
    const dotGrid = new Map();
    const dots = new Set();
    for (const i of order) {
      if (tiles.has(i)) continue;
      const [x, y] = at[i];
      if (near(tileGrid, spacing, x, y, DOT_UNDER) || near(dotGrid, DOT_APART * 2, x, y, DOT_APART)) continue;
      dots.add(i);
      put(dotGrid, DOT_APART * 2, x, y);
    }
    const made = { tiles, dots };
    cache.set(key, made);
    return made;
  };
  return {
    size: tuples.length,
    view({ west, south, east, north }, zoom, { keep } = {}) {
      if (zoom < fromZoom) return [];
      const { tiles, dots } = reveal(zoom);
      const out = [];
      for (const p of points) {
        if (p.lat < south || p.lat > north || p.lng < west || p.lng > east) continue;
        if (tiles.has(p.i) || keep?.(p.i)) out.push({ type: 'pin', i: p.i, lat: p.lat, lng: p.lng });
        else if (dots.has(p.i)) out.push({ type: 'dot', i: p.i, lat: p.lat, lng: p.lng });
      }
      return out;
    },
    expansionZoom: () => fromZoom,
    leaves: () => [],
    // The zoom a pin is drawn at, from `from`: where pins are already drawn, that one; otherwise a neighbourhood's.
    aloneZoom: (i, from = 0) => (from >= fromZoom ? from : Math.max(fromZoom, focusZoom)),
  };
}

export function createPinIndex(tuples) {
  // The radius is in screen pixels only when the extent is the size of a tile: Leaflet's tiles are 256, Supercluster's default extent is 512 (which
  // made 56 mean 28 on screen, fine for dots and not for 40px tiles). Marks closer than the radius are one cluster, so two never overlap: a tile is
  // 40px and the biggest ring 58px (two rings can have their centres a little nearer than the radius, so it is a little more than two rings' radii).
  const index = new Supercluster({ radius: 64, extent: 256, maxZoom: CLUSTER_MAX_ZOOM, minPoints: 2 });
  index.load(tuples.map((t, i) => ({ type: 'Feature', properties: { i }, geometry: { type: 'Point', coordinates: [t[3], t[2]] } })));

  const api = {
    size: tuples.length,

    // Clusters, stacks and single pins inside a window at a zoom. Each is { type, lat, lng, ... }:
    //   cluster  { id, count }          zoom in to open it
    //   stack    { members: [number] }  several companies at one place: list them
    //   pin      { i }                  one company
    view({ west, south, east, north }, zoom) {
      // The grouping is for a whole zoom, and the map may be between two (a city fitted to the window): the one below, whose pins are at least as far
      // apart on screen at the map's own zoom, so two marks never land on each other. (Rounding to the nearest let them, at the upper half.)
      const z = Math.min(CLUSTER_MAX_ZOOM + 1, Math.max(0, Math.floor(zoom)));
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

    // What a cluster holds: the numbers of its pins (an index into the tuples), up to `limit`.
    leaves: (id, limit = 200) => index.getLeaves(id, limit).map((f) => f.properties.i),

    // The lowest zoom, from `from` up, at which pin number i is drawn on its own: not inside a cluster, not in a stack. The deepest zoom is the answer when it
    // never is (several companies at one place are a stack at any zoom).
    aloneZoom(i, from = 0) {
      const [lat, lng] = [tuples[i][2], tuples[i][3]];
      const box = { west: lng - 0.0005, east: lng + 0.0005, south: lat - 0.0005, north: lat + 0.0005 };
      for (let z = Math.max(0, Math.floor(from)); z <= CLUSTER_MAX_ZOOM + 1; z += 1) {
        if (api.view(box, z).some((f) => f.type === 'pin' && f.i === i)) return z;
      }
      return CLUSTER_MAX_ZOOM + 1;
    },
  };
  return api;
}
