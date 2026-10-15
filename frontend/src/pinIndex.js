import Supercluster from 'supercluster';
import { CLUSTER_MAX_ZOOM } from './mapPins.js';

// The grouping itself, kept apart from the map's other helpers (mapPins.js): the app's shell reads those for the list and the panels, and
// only the map needs Supercluster, so only the map's file carries it.
const STACK_PLACES = 4; // at the deepest zoom, pins within about 10 metres are one stack: their points cannot be told apart

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
