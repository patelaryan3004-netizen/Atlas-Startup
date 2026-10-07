// Where things are, as far as this project needs to know it: the Australian states and territories, the cities
// the directory uses, and how far apart two points are. Pure data and arithmetic, no network.
//
// What this is for, and what it is not for. A city's centre is a reference point, not a company's address. It is
// used for three things only: placing the label of a city-level group on the map ("Sydney: 42 startups with
// city-level locations"), recognising a company pin that is really just a city centre, and noticing a pin that is
// nowhere near the city or state the record names. It is never written to a company as where the company is.
//
// The points are well-known city-centre coordinates, good to a kilometre or two, which is all a label needs. They
// are checked against a geocoder by `npm run locations -- places` (see scripts/locations.js), which reports any that
// differ from it by more than a few kilometres, so a slip in this file does not go unnoticed.

export const AU_STATES = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'];

// bounds: a rough box around the state, to tell a pin that is plainly in the wrong state. Boxes overlap near a
// border (Queanbeyan is in both NSW's and the ACT's), so a point is "in" a state when it is in that state's box,
// and "wrong" only when it is in none of the boxes of the state a record names. centre: roughly the middle of the
// state, where its label goes.
export const STATES = {
  NSW: { name: 'New South Wales', centre: [-32.2, 147.0], bounds: { south: -37.55, north: -28.1, west: 140.95, east: 153.7 } },
  VIC: { name: 'Victoria', centre: [-36.9, 144.3], bounds: { south: -39.2, north: -33.95, west: 140.9, east: 150.05 } },
  QLD: { name: 'Queensland', centre: [-22.5, 144.5], bounds: { south: -29.2, north: -9.1, west: 137.95, east: 153.6 } },
  SA: { name: 'South Australia', centre: [-30.0, 135.8], bounds: { south: -38.1, north: -25.95, west: 128.95, east: 141.05 } },
  WA: { name: 'Western Australia', centre: [-25.3, 122.3], bounds: { south: -35.2, north: -13.65, west: 112.85, east: 129.05 } },
  TAS: { name: 'Tasmania', centre: [-42.0, 146.6], bounds: { south: -43.75, north: -39.15, west: 143.7, east: 148.6 } },
  NT: { name: 'Northern Territory', centre: [-19.4, 133.4], bounds: { south: -26.05, north: -10.9, west: 128.95, east: 138.05 } },
  ACT: { name: 'Australian Capital Territory', centre: [-35.47, 149.0], bounds: { south: -35.95, north: -35.1, west: 148.7, east: 149.45 } },
};

// [city, state, lat, lng, [alternative points that mean the same city centre]]. An alternative is a point this
// directory's own data has used for the city that is further from the reference point than the tolerance, so a pin
// sitting on it is recognised as a city centre too.
//
// Checked against the geocoder on 2026-10-06: every point is within about a kilometre of the geocoder's centre except
// Canberra (3 km: the geocoder's label sits at the Parliamentary Triangle, which is the alternative point below), the
// Gold Coast and Sunshine Coast (2-3 km: they are regions, with no single centre) and Noosa (18 km: the geocoder
// answers with the whole shire; the point here is Noosa Heads, which is where the businesses are).
const CITY_ROWS = [
  ['Sydney', 'NSW', -33.8688, 151.2093, [[-33.86984, 151.20828]]], // the point 46 city-only companies shared before they were cleared
  ['Melbourne', 'VIC', -37.8136, 144.9631, []],
  ['Brisbane', 'QLD', -27.4698, 153.0251, []],
  ['Perth', 'WA', -31.9523, 115.8613, []],
  ['Adelaide', 'SA', -34.9285, 138.6007, []],
  ['Hobart', 'TAS', -42.8821, 147.3272, []],
  ['Darwin', 'NT', -12.4634, 130.8456, []],
  ['Canberra', 'ACT', -35.2809, 149.13, [[-35.29759, 149.10127]]],
  ['Newcastle', 'NSW', -32.9283, 151.7817, [[-32.9193, 151.77953]]],
  ['Wollongong', 'NSW', -34.4278, 150.8931, []],
  ['Gold Coast', 'QLD', -28.0167, 153.4, []],
  ['Sunshine Coast', 'QLD', -26.65, 153.0667, []],
  ['Geelong', 'VIC', -38.1499, 144.3617, []],
  ['Townsville', 'QLD', -19.259, 146.8169, []],
  ['Cairns', 'QLD', -16.9186, 145.7781, []],
  ['Toowoomba', 'QLD', -27.5598, 151.9507, []],
  ['Ballarat', 'VIC', -37.5622, 143.8503, []],
  ['Bendigo', 'VIC', -36.757, 144.2794, []],
  ['Launceston', 'TAS', -41.4332, 147.1441, []],
  ['Noosa', 'QLD', -26.3977, 153.09, []],
  ['Orange', 'NSW', -33.2835, 149.1012, []],
  ['Wagga Wagga', 'NSW', -35.1082, 147.3598, []],
  ['Albury', 'NSW', -36.0737, 146.9135, []],
  ['Port Macquarie', 'NSW', -31.4333, 152.9, []],
  ['Queanbeyan', 'NSW', -35.353, 149.232, []],
];

const keyOf = (city, state) => `${String(city ?? '').toLowerCase().replace(/\s*\([^)]*\)/g, '').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim()}|${state ?? ''}`;

export const CITIES = CITY_ROWS.map(([name, state, lat, lng, alternatives]) => ({ name, state, lat, lng, alternatives, key: keyOf(name, state) }));
const BY_KEY = new Map(CITIES.map((c) => [c.key, c]));

// The reference point for a city in a state, or null when this file does not know the city. A state is needed because
// the same name is in more than one place (Richmond is in four states).
export function cityCentre(city, state) {
  return BY_KEY.get(keyOf(city, state)) ?? null;
}

export function stateCentre(state) {
  const s = STATES[state];
  return s ? { lat: s.centre[0], lng: s.centre[1], name: s.name } : null;
}

export const stateName = (state) => STATES[state]?.name ?? null;

const rad = (d) => (d * Math.PI) / 180;

// Great-circle distance in metres.
export function distanceMetres(aLat, aLng, bLat, bLng) {
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(h));
}

const inBox = (lat, lng, b) => lat >= b.south && lat <= b.north && lng >= b.west && lng <= b.east;

// The states whose boxes hold a point (none for a point at sea or outside Australia).
export function statesAt(lat, lng) {
  return Object.entries(STATES).filter(([, s]) => inBox(lat, lng, s.bounds)).map(([code]) => code);
}

// Is a point plausibly in the state named? A point in none of the boxes is not in Australia at all (a different
// problem, found elsewhere), so it is not called a conflict here.
export function conflictsWithState(lat, lng, state) {
  const at = statesAt(lat, lng);
  return at.length > 0 && !at.includes(state);
}

// A pin this close to a city centre, and unbacked by any source, is taken to be the centre itself: a fallback somebody
// used when the office was not known, not an office.
export const CENTRE_METRES = 120;
// How far from the centre of the city a record names a point may be before it is called wrong (greater Sydney is about
// 60 km across).
export const MAX_KM_FROM_CITY = 100;

// The city centre a point sits on (within toleranceMetres of the reference point or one of its alternatives), or null.
export function centreAt(lat, lng, toleranceMetres = 250) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  let best = null;
  for (const c of CITIES) {
    for (const [pLat, pLng] of [[c.lat, c.lng], ...c.alternatives]) {
      const d = distanceMetres(lat, lng, pLat, pLng);
      if (d <= toleranceMetres && (!best || d < best.distance)) best = { city: c.name, state: c.state, distance: Math.round(d) };
    }
  }
  return best;
}

// How far a point is from the centre of the city a record names, or null when the city is not on file.
export function kmFromCity(lat, lng, city, state) {
  const c = cityCentre(city, state);
  return c ? distanceMetres(lat, lng, c.lat, c.lng) / 1000 : null;
}
