// Rebuilds src/atlas/australia-land.json, the coastline the map page's national view draws: Australia cut out of Natural Earth's 1:10m countries (public domain),
// simplified to about 2 km. It is a build step done once, not part of the app, and it needs two packages the app does not depend on, so install them somewhere
// outside the project (never into frontend/):
//
//   mkdir /tmp/atlas-geo && cd /tmp/atlas-geo && npm init -y && npm install --ignore-scripts world-atlas@2 topojson-client@3
//   node <this file> /tmp/atlas-geo src/atlas/australia-land.json        (from frontend/; TOL=0.02 is the tolerance in degrees)
//
// The state borders are not in this file (Natural Earth's states are a separate, larger download): they are drawn by hand in src/atlas/geo.js.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const [, , packages, out] = process.argv;
if (!packages || !out) throw new Error('usage: node build-australia-land.mjs <folder with world-atlas and topojson-client installed> <out.json>');
const require = createRequire(path.resolve(packages, 'noop.js'));
const { feature } = require('topojson-client');
const topo = JSON.parse(readFileSync(path.resolve(packages, 'node_modules', 'world-atlas', 'countries-10m.json'), 'utf8'));
const countries = feature(topo, topo.objects.countries);
const au = countries.features.find((f) => f.properties.name === 'Australia');
if (!au) throw new Error('no Australia in the file');

const polygons = au.geometry.type === 'MultiPolygon' ? au.geometry.coordinates : [au.geometry.coordinates];
const TOLERANCE = Number(process.env.TOL || 0.02); // degrees, about 2 km: finer than a pixel of the national view

// Douglas-Peucker on a ring of [lng, lat].
function simplify(points, tol) {
  if (points.length <= 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1; keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  const sq = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop();
    let worst = -1; let at = -1;
    const [ax, ay] = points[a]; const [bx, by] = points[b];
    const dx = bx - ax; const dy = by - ay; const len = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      let t = len ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
      t = Math.max(0, Math.min(1, t));
      const ex = ax + t * dx - px; const ey = ay + t * dy - py;
      const d = ex * ex + ey * ey;
      if (d > worst) { worst = d; at = i; }
    }
    if (worst > sq) { keep[at] = 1; stack.push([a, at], [at, b]); }
  }
  return points.filter((p, i) => keep[i]);
}

const areaOf = (ring) => { let s = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]); return Math.abs(s / 2); };

const rings = [];
for (const poly of polygons) {
  const outer = poly[0];
  const [lng, lat] = outer[0];
  if (lat < -45 || lat > -8.5 || lng < 111 || lng > 155) continue; // Macquarie, Heard and the like are not on this map
  const area = areaOf(outer);
  if (area < 0.012) continue; // specks smaller than a few km across
  const simple = simplify(outer, TOLERANCE);
  if (simple.length < 4) continue;
  rings.push({ area, ring: simple.map(([x, y]) => [Math.round(y * 100) / 100, Math.round(x * 100) / 100]) });
}
rings.sort((a, b) => b.area - a.area);
const out_ = { source: 'Natural Earth 1:10m admin-0 countries (public domain), via the world-atlas package, simplified to about 2 km', land: rings.map((r) => r.ring) };
writeFileSync(out, JSON.stringify(out_));
console.log('rings', rings.length, 'points', rings.reduce((n, r) => n + r.ring.length, 0), 'biggest', rings[0].ring.length, 'bytes', JSON.stringify(out_).length);
