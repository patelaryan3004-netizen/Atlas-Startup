// The drawing under the national view of the map page: Australia's land, its state borders, the lines of latitude and longitude, and the names written on the
// sea and the states. It is a backdrop, not data: nothing here says where a company is. A company is only ever drawn from its own stored coordinates (MapView).
//
// The coastline (australia-land.json) is Natural Earth's 1:10m countries (public domain), cut to Australia and simplified to about 2 km. The state borders are
// drawn by hand from the lines they follow (129°E, 138°E, 141°E, 26°S, 29°S, the Murray), so they are right to a few kilometres, which is all a national
// overview needs; they are not survey lines.
import land from './australia-land.json';

export const LAND = land.land; // rings of [lat, lng], the mainland first
export const LAND_CREDIT = 'Coastline: Natural Earth';

export const STATE_LINES = [
  // WA | NT, WA | SA (129°E), NT | SA (26°S)
  [[-14.88, 129.0], [-26.0, 129.0], [-31.7, 129.0]],
  [[-26.0, 129.0], [-26.0, 138.0]],
  // NT | QLD (138°E), SA | QLD (26°S, then 141°E), SA | NSW and SA | VIC (141°E)
  [[-16.55, 138.0], [-26.0, 138.0]],
  [[-26.0, 138.0], [-26.0, 141.0], [-29.0, 141.0], [-34.0, 141.0], [-38.06, 141.0]],
  // QLD | NSW: 29°S, then the rivers and the ranges to Point Danger
  [[-29.0, 141.0], [-29.0, 148.0], [-29.0, 149.0], [-28.8, 150.0], [-28.85, 151.2], [-28.93, 151.95], [-28.5, 152.5], [-28.3, 152.9], [-28.17, 153.55]],
  // NSW | VIC: Cape Howe to the Murray, and the Murray to 141°E
  [[-37.51, 149.97], [-36.75, 148.2], [-36.1, 147.0], [-36.0, 146.0], [-35.95, 145.3], [-36.1, 144.75], [-35.6, 143.9], [-35.1, 143.3], [-34.6, 142.75], [-34.2, 142.1], [-34.0, 141.0]],
];

export const STATE_LABELS = [
  { name: 'Western Australia', lat: -25.6, lng: 121.5 },
  { name: 'Northern Territory', lat: -19.6, lng: 133.4 },
  { name: 'Queensland', lat: -22.6, lng: 144.4 },
  { name: 'South Australia', lat: -29.6, lng: 134.4 },
  { name: 'New South Wales', lat: -32.0, lng: 146.7 },
  { name: 'Victoria', lat: -36.9, lng: 143.4 },
];

export const SEA_LABELS = [{ name: 'Southern Ocean', lat: -43.2, lng: 128.5 }];

// Lines of latitude and longitude, every ten degrees, and where each is named on the edge of the map.
export const PARALLELS = [-10, -20, -30, -40];
export const MERIDIANS = [110, 120, 130, 140, 150];
export const GRATICULE_LINES = [
  ...PARALLELS.map((lat) => [[lat, 100], [lat, 165]]),
  ...MERIDIANS.map((lng) => [[-55, lng], [0, lng]]),
];
export const tickText = { lat: (v) => `${Math.abs(v)}°${v < 0 ? 'S' : 'N'}`, lng: (v) => `${v}°${v < 0 ? 'W' : 'E'}` };
