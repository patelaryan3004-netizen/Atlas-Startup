import { describe, it, expect } from 'vitest';
import { citiesOfPin, cityBadges, cityBounds, layoutBadges, labelWidth, METRO_AT } from '../src/atlas/cities.js';
import { LAND, STATE_LINES } from '../src/atlas/geo.js';
import { NATIONAL_BOUNDS, ATLAS_ZOOM, PINS_ZOOM, TILES_LOAD_ZOOM } from '../src/atlas/zoomModes.js';

// A pin as the server sends it: [slug, name, lat, lng, sector, city, hiring, domain, precision, place, checked, logo, metro].
const pin = (slug, lat, lng, city = 'Melbourne', metro = city, precision = 'EXACT') => [slug, slug, lat, lng, 'SaaS', city, 0, `${slug}.com`, precision, '', 0, null, metro];

describe('which of the ten cities a pin belongs to', () => {
  it('is what the server says: the metro the pin carries, not where it stands', () => {
    expect(METRO_AT).toBe(12);
    expect(citiesOfPin(pin('a', -33.7506, 150.6942, 'Penrith', 'Sydney'))).toEqual(['Sydney']); // a suburban office 45 km out of Sydney: the postcode says Sydney
    expect(citiesOfPin(pin('b', -37.7974, 144.971, 'Carlton', 'Melbourne'))).toEqual(['Melbourne']);
  });

  it('is none for a regional pin that the server puts in no metro, wherever it stands', () => {
    expect(citiesOfPin(pin('c', -33.2839, 149.1012, 'Orange', null))).toEqual([]);
    expect(citiesOfPin(pin('d', -35.3922, 149.367, 'Carwoola', null))).toEqual([]); // 25 km from Canberra, and the city filter does not count it as Canberra
  });

  it('also takes a pin by its own city when that is one of the ten, as the city filter does', () => {
    expect(citiesOfPin(pin('e', -37.5, 144.0, 'Melbourne', null))).toEqual(['Melbourne']);
    expect(citiesOfPin(pin('f', -37.5, 144.0, 'Melbourne', 'Sydney')).sort()).toEqual(['Melbourne', 'Sydney']); // (it is in both cities' lists, so in both counts)
  });

  it("counts only the pin's own city name from a server that does not send the metro yet: never a guess from the point", () => {
    const old = ['g', 'g', -37.8, 144.96, 'SaaS', 'Carlton', 0, 'g.com', 'EXACT', '', 0, null]; // twelve fields
    expect(citiesOfPin(old)).toEqual([]);
    expect(citiesOfPin([...old.slice(0, 5), 'Melbourne', ...old.slice(6)])).toEqual(['Melbourne']);
  });
});

describe('the city badges', () => {
  const markers = [
    pin('a', -37.81, 144.96), pin('b', -37.82, 144.99, 'Cremorne', 'Melbourne'), pin('c', -37.79, 144.97, 'Carlton', 'Melbourne'),
    pin('d', -33.87, 151.2, 'Sydney'), pin('p', -33.7506, 150.6942, 'Penrith', 'Sydney'), pin('e', -31.95, 115.86, 'Perth'),
    pin('f', -23.83, 148.31, 'Gindie (nr Emerald)', null),
  ];

  it('counts the distinct organisations with a pin in each city, busiest first, and leaves a regional pin under no badge', () => {
    const badges = cityBadges({ markers });
    expect(badges.map((b) => [b.city, b.count])).toEqual([['Melbourne', 3], ['Sydney', 2], ['Perth', 1]]);
  });

  it('puts each badge on its city (the point the map goes to for it), not on a pin', () => {
    const [melbourne] = cityBadges({ markers });
    expect([melbourne.lat, melbourne.lng]).toEqual([-37.8136, 144.9631]);
    expect(melbourne.points).toHaveLength(3);
  });

  it('counts an organisation once, however many times it is in the list', () => {
    expect(cityBadges({ markers: [...markers, pin('a', -37.81, 144.96)] }).find((b) => b.city === 'Melbourne').count).toBe(3);
  });

  it('follows the markers it is given (the filters have already narrowed them): none, no badge', () => {
    expect(cityBadges({ markers: [] })).toEqual([]);
    expect(cityBadges({ markers: markers.filter((m) => m[5] === 'Perth') }).map((b) => b.city)).toEqual(['Perth']);
  });

  it('counts the investors only when asked for them, and counts the companies only when they are shown', () => {
    const vcPins = [{ id: 'x:Sydney', slug: 'x', name: 'X', lat: -33.87, lng: 151.2, city: 'Sydney' }, { id: 'x:Perth', slug: 'x', name: 'X', lat: -31.95, lng: 115.86, city: 'Perth' }];
    expect(cityBadges({ markers, vcPins }).find((b) => b.city === 'Sydney').count).toBe(2);
    expect(cityBadges({ markers, vcPins, showVcs: true }).find((b) => b.city === 'Sydney').count).toBe(3);
    expect(cityBadges({ markers, vcPins, showCompanies: false, showVcs: true }).map((b) => [b.city, b.count])).toEqual([['Perth', 1], ['Sydney', 1]]);
  });
});

describe('where the map goes for a city', () => {
  it('fits the pins, leaving out the few far ones (they stay on the map, in the clusters)', () => {
    const near = Array.from({ length: 20 }, (_, i) => [-37.8 + (i % 5) * 0.01, 144.95 + Math.floor(i / 5) * 0.01]);
    const far = [[-38.4, 144.4]]; // about 80 km out
    const [[south, west], [north, east]] = cityBounds([...near, ...far]);
    expect(south).toBeGreaterThan(-37.9);
    expect(north).toBeLessThan(-37.7);
    expect(west).toBeGreaterThan(144.9);
    expect(east).toBeLessThan(145.1);
  });

  it('gives a city with one pin the box of a district, so the map shows streets', () => {
    const [[south, west], [north, east]] = cityBounds([[-34.93, 138.64]]);
    expect(north - south).toBeGreaterThanOrEqual(0.06 - 1e-9);
    expect(east - west).toBeGreaterThanOrEqual(0.06 - 1e-9);
  });

  it('has nothing to fit for a city with no pins', () => {
    expect(cityBounds([])).toBeNull();
  });
});

describe('keeping the badges apart', () => {
  const size = { x: 1000, y: 800 };
  const at = (city, x, y, count = 10) => ({ city, x, y, w: labelWidth(city, count) });
  const overlap = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
  const box = (spot, anchor) => {
    const l = spot.side === 'right' ? anchor.x + 10 : anchor.x - 10 - anchor.w;
    return { l, r: l + anchor.w, t: anchor.y + spot.dy - 15, b: anchor.y + spot.dy + 15 };
  };

  it('puts a lone badge to the right of its anchor', () => {
    expect(layoutBadges([at('Melbourne', 500, 400)], size)).toEqual([{ city: 'Melbourne', side: 'right', dy: 0, hidden: false }]);
  });

  it('puts a badge on the left when it is asked to (the west coast) and when the right has no room', () => {
    expect(layoutBadges([at('Perth', 400, 400)], size, { prefer: { Perth: 'left' } })[0]).toMatchObject({ side: 'left', dy: 0 });
    expect(layoutBadges([at('Sydney', 950, 400)], size)[0]).toMatchObject({ side: 'left' });
  });

  it('moves a badge off its neighbour so that no two labels overlap', () => {
    const anchors = [at('Sydney', 500, 400, 200), at('Newcastle', 506, 381, 1), at('Canberra', 482, 427, 1), at('Gold Coast', 530, 300, 2), at('Brisbane', 528, 312, 15)];
    const spots = layoutBadges(anchors, size);
    const shown = spots.map((spot, i) => ({ spot, anchor: anchors[i] })).filter(({ spot }) => !spot.hidden);
    expect(shown.length).toBeGreaterThanOrEqual(4);
    for (let i = 0; i < shown.length; i += 1) for (let j = i + 1; j < shown.length; j += 1) expect(overlap(box(shown[i].spot, shown[i].anchor), box(shown[j].spot, shown[j].anchor))).toBe(false);
  });

  it('leaves out a label that has nowhere to go rather than lay it over another', () => {
    const crowd = Array.from({ length: 30 }, (_, i) => at(`City${i}`, 500 + (i % 3), 400 + (i % 2), 10));
    const spots = layoutBadges(crowd, size);
    expect(spots.some((s) => s.hidden)).toBe(true);
  });
});

describe('the drawn country', () => {
  it('has the mainland and Tasmania, and draws only what is in the national view', () => {
    expect(LAND.length).toBeGreaterThan(5);
    const [[south, west], [north, east]] = NATIONAL_BOUNDS;
    for (const ring of LAND) for (const [lat, lng] of ring) {
      expect(lat).toBeGreaterThanOrEqual(south);
      expect(lat).toBeLessThanOrEqual(north);
      expect(lng).toBeGreaterThanOrEqual(west);
      expect(lng).toBeLessThanOrEqual(east);
    }
    const mainland = LAND[0];
    expect(Math.min(...mainland.map((p) => p[0]))).toBeLessThan(-38);
    expect(Math.max(...mainland.map((p) => p[0]))).toBeGreaterThan(-11);
    expect(LAND.some((ring) => ring.some(([lat]) => lat < -43))).toBe(true); // Tasmania
  });

  it('has state borders that run along the lines they follow', () => {
    expect(STATE_LINES.length).toBeGreaterThanOrEqual(5);
    const wa = STATE_LINES[0];
    expect(new Set(wa.map((p) => p[1]))).toEqual(new Set([129])); // WA's eastern border is the 129th meridian
  });

  it('fades from the drawn country to the street map in order: tiles load, pins come in, then the drawn country goes', () => {
    expect(TILES_LOAD_ZOOM).toBeLessThan(PINS_ZOOM);
    expect(PINS_ZOOM).toBeLessThan(ATLAS_ZOOM);
  });
});
