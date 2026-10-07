// Australia drawn in dots, and where the directory's startups fall on it, for the picture beside the landing headline.
//
// It is a drawing, not a map. The coast is coarse (gulfs and capes, no bays) and one dot stands for a square of about
// 90 km, so nothing here says where a company is. A dot is lit, and sized, by how many startups with a known place
// (an office or a suburb, the pins of the real map) fall in it. A company known only to its city has no pin and so
// lights nothing; it is counted at its city, as on the map, and never drawn as a point.

const RAD = Math.PI / 180;

// Clockwise from Cape York: [latitude, longitude].
const MAINLAND = [
  [-10.7, 142.53], [-11.9, 143.25], [-13.0, 143.55], [-14.15, 144.5], [-15.45, 145.3], [-16.5, 145.65],
  [-17.1, 146.05], [-18.3, 146.5], [-19.2, 147.1], [-20.3, 148.75], [-21.15, 149.3], [-22.4, 150.6], [-23.85, 151.3],
  [-24.9, 152.4], [-25.6, 153.05], [-27.0, 153.25], [-28.2, 153.6], [-29.4, 153.4], [-30.35, 153.15],
  [-31.45, 152.95], [-32.7, 152.2], [-33.6, 151.5], [-34.1, 151.3], [-35.1, 150.8], [-36.3, 150.15],
  [-37.5, 149.98], [-37.75, 148.5], [-38.05, 147.4], [-38.7, 146.4], [-39.13, 146.37], [-38.5, 145.65],
  [-38.35, 144.7], [-38.85, 143.52], [-38.4, 142.5], [-38.3, 141.6], [-38.06, 140.65], [-37.2, 139.75],
  [-36.45, 139.8], [-35.55, 138.95], [-35.55, 138.62], [-35.6, 138.1], [-35.0, 138.4], [-34.55, 138.3],
  [-34.18, 138.16], [-34.43, 137.92], [-35.08, 137.74], [-35.29, 136.88], [-34.9, 137.0], [-33.93, 137.63],
  [-33.18, 137.99], [-32.5, 137.77], [-33.03, 137.58], [-33.69, 136.92], [-34.37, 136.1], [-34.73, 135.85],
  [-34.97, 136.0], [-34.6, 135.45], [-33.65, 134.9], [-32.8, 134.2], [-32.1, 133.65], [-31.98, 132.5],
  [-31.47, 131.15], [-31.7, 128.9], [-32.27, 126.0], [-33.6, 123.85], [-33.86, 121.9], [-33.95, 120.13],
  [-34.4, 119.37], [-35.02, 117.88], [-35.0, 116.7], [-34.37, 115.14], [-33.53, 115.02], [-33.33, 115.64],
  [-32.53, 115.72], [-32.05, 115.74], [-31.0, 115.32], [-30.3, 115.0], [-28.77, 114.6], [-27.7, 114.15],
  [-26.15, 113.15], [-24.88, 113.65], [-23.5, 113.6], [-21.8, 114.15], [-21.65, 115.1], [-20.65, 116.7],
  [-20.3, 118.6], [-19.4, 121.0], [-17.95, 122.2], [-16.4, 122.9], [-15.8, 124.2], [-14.9, 125.2],
  [-13.75, 126.95], [-14.5, 127.8], [-15.45, 128.1], [-14.6, 128.9], [-14.25, 129.55], [-13.4, 130.0],
  [-12.25, 130.85], [-11.15, 132.15], [-11.9, 133.0], [-12.2, 134.3], [-11.7, 135.4], [-10.95, 136.8],
  [-12.25, 136.9], [-13.6, 135.9], [-14.9, 135.4], [-15.6, 135.2], [-15.8, 136.6], [-17.75, 139.55],
  [-17.5, 140.8], [-16.7, 141.25], [-14.9, 141.6], [-12.65, 141.9], [-11.4, 142.1],
];

const TASMANIA = [
  [-40.7, 144.7], [-40.85, 145.5], [-40.95, 146.5], [-40.8, 147.4], [-40.9, 148.3], [-41.6, 148.3],
  [-42.45, 148.3], [-43.1, 147.95], [-43.62, 146.95], [-43.4, 146.05], [-42.55, 145.4], [-41.5, 144.8],
];

// The drawing's own units. 640 wide; the country sits to the left so the east coast has sea beside it for labels.
export const VIEW = { width: 640, height: 530 };
const WEST = 112.9;
const NORTH = -10.6;
const SCALE = 14.66; // units per degree of latitude
const COS = Math.cos(27 * RAD); // the country's middle latitude: a degree of longitude is drawn as wide as it is
const MARGIN_LEFT = 14;
const MARGIN_TOP = 22;

export function project(lat, lng) {
  return { x: MARGIN_LEFT + (lng - WEST) * COS * SCALE, y: MARGIN_TOP + (NORTH - lat) * SCALE };
}

const OUTLINES = [MAINLAND, TASMANIA].map((ring) => ring.map(([lat, lng]) => project(lat, lng)));

function insideOutline(x, y) {
  let inside = false;
  for (const ring of OUTLINES) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
  }
  return inside;
}

export const onLand = (lat, lng) => {
  const { x, y } = project(lat, lng);
  return insideOutline(x, y);
};

export const SPACING = 12;
export const DOT_SIZE = 3.1;
const ROW = (SPACING * Math.sqrt(3)) / 2;

// Rows of dots, every other row half a step along, kept where they fall inside the outline.
export const DOTS = (() => {
  const dots = [];
  for (let row = 0; MARGIN_TOP + row * ROW < VIEW.height; row += 1) {
    const y = MARGIN_TOP + row * ROW;
    for (let x = MARGIN_LEFT + (row % 2 ? SPACING / 2 : 0); x < VIEW.width; x += SPACING) {
      if (insideOutline(x, y)) dots.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
    }
  }
  return dots;
})();

// Every dot in one path: a zero-length stroke with a round cap is a dot.
export const GRID_PATH = DOTS.map((d) => `M${d.x} ${d.y}h.01`).join('');

// The capitals the picture labels. A place is shown only when the directory has companies near it.
const NEAR_KM = 60;
export const HUBS = [
  { id: 'sydney', name: 'Sydney', lat: -33.8688, lng: 151.2093, label: 'right', chip: { dx: -70, dy: -40, side: 'left' } },
  { id: 'melbourne', name: 'Melbourne', lat: -37.8136, lng: 144.9631, label: 'right', chip: { dx: -62, dy: 50, side: 'left' } },
  { id: 'brisbane', name: 'Brisbane', lat: -27.4698, lng: 153.0251, label: 'right', chip: { dx: -74, dy: -34, side: 'left' } },
  { id: 'adelaide', name: 'Adelaide', lat: -34.9285, lng: 138.6007, label: 'below', chip: { dx: -70, dy: 40, side: 'left' } },
  { id: 'perth', name: 'Perth', lat: -31.9505, lng: 115.8605, label: 'right', chip: { dx: 70, dy: -44, side: 'right' } },
  { id: 'canberra', name: 'Canberra', lat: -35.2809, lng: 149.13, label: 'right', crowded: true },
  { id: 'hobart', name: 'Hobart', lat: -42.8821, lng: 147.3272, label: 'right' },
  { id: 'darwin', name: 'Darwin', lat: -12.4634, lng: 130.8456, label: 'right' },
];

// Which capitals are joined: the country's long routes, not every pair (Canberra sits between two cities that are
// already joined). A drawn route says "connected ecosystem", not that any two companies are.
const LINKS = [
  ['brisbane', 'sydney'], ['sydney', 'melbourne'], ['melbourne', 'adelaide'], ['adelaide', 'perth'],
  ['melbourne', 'hobart'], ['adelaide', 'darwin'],
];

// A chip is a short label. A company whose name is longer is left out of the picture rather than cut.
export const LONGEST_CHIP_NAME = 18;

function kmBetween(aLat, aLng, bLat, bLng) {
  const h = Math.sin(((bLat - aLat) * RAD) / 2) ** 2
    + Math.cos(aLat * RAD) * Math.cos(bLat * RAD) * Math.sin(((bLng - aLng) * RAD) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

function hubNear(lat, lng) {
  let best = null;
  for (const hub of HUBS) {
    const km = kmBetween(lat, lng, hub.lat, hub.lng);
    if (km <= NEAR_KM && (!best || km < best.km)) best = { hub, km };
  }
  return best?.hub ?? null;
}

function nearestDot(point) {
  let best = -1;
  let bestSquared = (SPACING * 1.5) ** 2;
  for (let i = 0; i < DOTS.length; i += 1) {
    const squared = (DOTS[i].x - point.x) ** 2 + (DOTS[i].y - point.y) ** 2;
    if (squared < bestSquared) { best = i; bestSquared = squared; }
  }
  return best;
}

// Area, not width, grows with the count; a dot never grows past a few of its neighbours.
export const litRadius = (count) => Math.min(1.7 + Math.sqrt(count) * 1.05, 10.5);

const fixed = (n) => n.toFixed(1);

// A route bowed toward the top of the picture, the way one is drawn across a map.
function arc(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  let nx = -dy / length;
  let ny = dx / length;
  if (ny > 0) { nx = -nx; ny = -ny; }
  const bow = length * 0.16;
  const cx = (a.x + b.x) / 2 + nx * bow;
  const cy = (a.y + b.y) / 2 + ny * bow;
  return `M${fixed(a.x)} ${fixed(a.y)}Q${fixed(cx)} ${fixed(cy)} ${fixed(b.x)} ${fixed(b.y)}`;
}

const sameWords = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

// What to draw, from what the server sent:
//   pins       the map's pins ([slug, name, lat, lng, ...]), only companies whose place is a point
//   areas      the map's city-level groups ({ lat, lng, count }), counted and never drawn as points
//   companies  cards of companies to name in the picture (the page passes ones that are hiring)
// Returns the lit dots, the capitals that have companies, the routes between them and one named company per capital.
export function layoutEcosystem({ pins = [], areas = [], companies = [] } = {}) {
  const cells = new Map();
  const counts = new Map(HUBS.map((hub) => [hub.id, 0]));
  let placed = 0;

  for (const pin of pins) {
    const lat = Number(pin?.[2]);
    const lng = Number(pin?.[3]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const index = nearestDot(project(lat, lng));
    if (index < 0) continue;
    placed += 1;
    cells.set(index, (cells.get(index) ?? 0) + 1);
    const hub = hubNear(lat, lng);
    if (hub) counts.set(hub.id, counts.get(hub.id) + 1);
  }
  for (const area of areas) {
    const hub = hubNear(Number(area?.lat), Number(area?.lng));
    if (hub) counts.set(hub.id, counts.get(hub.id) + (Number(area.count) || 0));
  }

  const lit = [...cells]
    .map(([index, count]) => ({ ...DOTS[index], count, r: litRadius(count) }))
    .sort((a, b) => b.count - a.count || a.y - b.y || a.x - b.x);

  const hubs = HUBS.filter((hub) => counts.get(hub.id) > 0).map((hub) => {
    const point = project(hub.lat, hub.lng);
    // The routes and labels hang off the biggest lit dot beside the city, so they meet the dot and not its edge.
    const beside = lit.find((dot) => Math.hypot(dot.x - point.x, dot.y - point.y) <= SPACING * 1.6);
    return {
      ...hub,
      count: counts.get(hub.id),
      x: beside ? beside.x : point.x,
      y: beside ? beside.y : point.y,
      r: beside ? beside.r : 0,
      // No pin beside it: the city has companies known only to the city, drawn as a ring, as on the map.
      cityOnly: !beside,
    };
  });
  const byId = new Map(hubs.map((hub) => [hub.id, hub]));

  const links = LINKS
    .filter(([a, b]) => byId.has(a) && byId.has(b))
    .map(([a, b]) => ({ id: `${a}-${b}`, d: arc(byId.get(a), byId.get(b)) }));

  const chips = [];
  for (const hub of hubs) {
    if (!hub.chip) continue;
    const company = companies.find((c) => c?.name && c.name.length <= LONGEST_CHIP_NAME && sameWords(c.city, hub.name));
    if (!company) continue;
    chips.push({
      hubId: hub.id,
      company,
      hiring: company.hiring === true,
      x: hub.x + hub.chip.dx,
      y: hub.y + hub.chip.dy,
      fromX: hub.x,
      fromY: hub.y,
      side: hub.chip.side,
    });
  }

  return { lit, hubs, links, chips, placed };
}
