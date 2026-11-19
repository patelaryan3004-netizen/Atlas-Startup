import { describe, it, expect } from 'vitest';
import {
  paddedWindow, pinPayload, clusterSize, locationQuality, areaLabel, areaFilters, areaMember, scopeText, CLUSTER_MAX_ZOOM, AREA_CHIP_ZOOM,
  labelsVisible, labelWidth, chooseLabels, LABEL_ZOOM, LABEL_ZOOM_NARROW, MAX_LABELS, vcTuple, vcMarks, vcFirms, vcQuality, isVc, isVcGroup, spreadVcPins, SPREAD_EXACT_M,
} from '../src/mapPins.js';
import { createPinIndex, createPlainPinIndex, pinSpacing, PIN_TILE, DOT_UNDER, DOT_APART } from '../src/pinIndex.js';
import { PINS_ZOOM, PIN_FOCUS_ZOOM } from '../src/atlas/zoomModes.js';

// [slug, name, lat, lng, sector, city, hiring, domain]
const pin = (slug, lat, lng, extra = {}) => [slug, extra.name ?? slug.toUpperCase(), lat, lng, extra.sector ?? 'AI', extra.city ?? 'Sydney', extra.hiring ?? 0, extra.domain ?? ''];
const AUSTRALIA = { west: 110, south: -45, east: 156, north: -9 };

const SYDNEY = [-33.8688, 151.2093];
const NEAR_SYDNEY = [-33.8679, 151.2093]; // about 100 metres north
const MELBOURNE = [-37.8136, 144.9631];

describe('the pins of the map page: spaced by zoom, no grouping and no count', () => {
  // A point `dx` pixels east and `dy` pixels south of (lat, lng) at a zoom (the map's own projection: 256-pixel tiles).
  const at = (lat, lng, dx, dy, zoom) => {
    const size = 256 * 2 ** zoom;
    const worldY = (la) => (0.5 - Math.log((1 + Math.sin((la * Math.PI) / 180)) / (1 - Math.sin((la * Math.PI) / 180))) / (4 * Math.PI)) * size;
    const y = worldY(lat) + dy;
    const la = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / size))) * 180) / Math.PI;
    return [la, lng + (dx * 360) / size];
  };
  const classify = (tuples, zoom, options) => {
    const out = { pin: [], dot: [] };
    for (const f of createPlainPinIndex(tuples).view(AUSTRALIA, zoom, options)) out[f.type].push(tuples[f.i][0]);
    return { tiles: out.pin.sort(), dots: out.dot.sort() };
  };
  const Z = 12;
  const centre = [-33.87, 151.2];
  const near = (slug, dx, dy, extra) => pin(slug, ...at(centre[0], centre[1], dx, dy, Z), extra);

  it('draws nothing nearer the whole country than a city\'s scale: the map is the street map and the names of the cities', () => {
    const tuples = [pin('a', ...SYDNEY), pin('m', ...MELBOURNE)];
    expect(createPlainPinIndex(tuples).view(AUSTRALIA, PINS_ZOOM - 0.25)).toEqual([]);
    expect(createPlainPinIndex(tuples).view(AUSTRALIA, 4)).toEqual([]);
    expect(createPlainPinIndex(tuples).view(AUSTRALIA, PINS_ZOOM).map((f) => f.type)).toEqual(['pin', 'pin']); // two cities: each has room
  });

  it('is wide while the map is far away and narrows as it comes closer, never below the width of a logo', () => {
    expect(pinSpacing(8)).toBe(pinSpacing(9));
    expect(pinSpacing(9)).toBe(PIN_TILE + 18);
    expect(pinSpacing(14)).toBe(PIN_TILE + 4);
    expect(pinSpacing(18)).toBe(PIN_TILE + 4);
    for (let z = 9; z < 14; z += 1) expect(pinSpacing(z + 1)).toBeLessThan(pinSpacing(z));
    expect(Math.min(...[8, 10, 12, 14, 16].map(pinSpacing))).toBeGreaterThan(PIN_TILE);
  });

  it('gives a logo to the company that has room, and to no other that is closer than the spacing: the other is a plain dot beside it, or nothing', () => {
    const tuples = [near('a', 0, 0), near('b', 20, 0), near('c', 46, 0), near('d', 60, 0), near('e', 400, 0)];
    const { tiles, dots } = classify(tuples, Z);
    expect(pinSpacing(Z)).toBeGreaterThan(46); // 49.6 here: 46 px is too near for a second logo
    const slugs = new Set([...tiles, ...dots]);
    expect(tiles).toContain('e'); // alone: a logo
    // among a, b, c, d: logos are at least the spacing apart, and nothing is both
    const px = { a: 0, b: 20, c: 46, d: 60 };
    for (const x of tiles.filter((s) => s !== 'e')) for (const y of tiles.filter((s) => s !== 'e' && s !== x)) expect(Math.abs(px[x] - px[y])).toBeGreaterThanOrEqual(pinSpacing(Z));
    expect(tiles.filter((s) => s !== 'e').length).toBeGreaterThanOrEqual(1);
    expect(tiles.filter((s) => dots.includes(s))).toEqual([]);
    // a pin under a logo (20 px from its centre, inside the 24 that it covers) is not drawn at all: it would be hidden
    if (tiles.includes('a')) expect(slugs.has('b')).toBe(false);
  });

  it('draws a dot only where it can be seen: beside a logo (not under it) and not on top of another dot', () => {
    const tuples = [near('a', 0, 0, { hiring: 1 }), near('b', 5, 0), near('c', 36, 0), near('d', 38, 3)];
    const { tiles, dots } = classify(tuples, Z);
    expect(tiles).toEqual(['a']); // the one hiring has the room
    expect(dots).toHaveLength(1); // c and d are 2 px apart: one dot; b is under the logo: none
    expect(['c', 'd']).toContain(dots[0]);
    expect(createPlainPinIndex(tuples).view(AUSTRALIA, Z).filter((f) => f.type === 'dot').every((f) => f.i !== 1)).toBe(true);
  });

  it('gives the room first to a company that is hiring, then to an investor, then to a company with a picture of its own, then the rest by a fixed order: the investor leans ahead of the startups, a little', () => {
    const company = near('company', 0, 0);
    const hiring = near('hiring', 10, 0, { hiring: 1 });
    const logo = near('logo', 20, 0, { domain: 'logo.test' }); // a website to take its logo from
    expect(classify([company, hiring], Z).tiles).toEqual(['hiring']);
    expect(classify([company, logo], Z).tiles).toEqual(['logo']);
    expect(classify([hiring, logo], Z).tiles).toEqual(['hiring']);
    const firm = (domain) => [`vc:1`, 'Firm', ...at(centre[0], centre[1], 25, 0, Z), '', 'Sydney', 0, domain, 'CITY', '', 0, null, 'vc', 'firm', 'headquarters'];
    expect(classify([hiring, firm('firm.test')], Z).tiles).toEqual(['hiring']); // the same order as for a startup: hiring first...
    expect(classify([company, firm('firm.test')], Z).tiles).toEqual(['vc:1']);
    expect(classify([logo, firm('')], Z).tiles).toEqual(['vc:1']); // ...an investor goes before a startup that has a picture of its own, and so before the rest (a lean, not first: a startup that is hiring goes before it)
    expect(classify([company, firm('')], Z).tiles).toEqual(['vc:1']);
    expect(classify([company, firm('firm.test')], Z).dots).toEqual(['company']); // the one that lost is a dot beside the firm's logo (25 px away: clear of it)
    // the same two, in either order of the file, give the same answer (a fixed order, not the file's)
    const a = near('a', 0, 0);
    const b = near('b', 10, 0);
    expect(classify([a, b], Z).tiles).toEqual(classify([b, a], Z).tiles);
  });

  it('always gives a logo to the ones it is told to keep (the open company, the saved ones), without taking a logo from another', () => {
    const tuples = [near('a', 0, 0, { hiring: 1 }), near('b', 10, 0), near('far', 300, 0)];
    expect(classify(tuples, Z).tiles).toEqual(['a', 'far']);
    expect(classify(tuples, Z, { keep: (i) => tuples[i][0] === 'b' }).tiles).toEqual(['a', 'b', 'far']);
    expect(classify(tuples, Z).tiles).toEqual(['a', 'far']); // (and the answer for the others did not change)
  });

  it('is the same for a pin however the window is moved: the spacing is worked out over every pin, not over what is in view', () => {
    const tuples = [near('a', 0, 0), near('b', 20, 0), near('c', 46, 0), near('d', 90, 0), near('e', 134, 0)];
    const index = createPlainPinIndex(tuples);
    const all = index.view(AUSTRALIA, Z).map((f) => [tuples[f.i][0], f.type]);
    const lat = centre[0];
    const narrow = { west: centre[1] - 0.0001, east: centre[1] + 0.0001, south: lat - 0.001, north: lat + 0.001 }; // only a is in this window
    expect(index.view(narrow, Z).map((f) => [tuples[f.i][0], f.type])).toEqual(all.filter(([s]) => s === 'a'));
  });

  it('shows more logos at each zoom as the map comes closer, and at street scale every company that is not on top of another has its own', () => {
    // a grid of companies 80 px apart at zoom 14, with a second one a few pixels from each
    const tuples = [];
    for (let gx = 0; gx < 6; gx += 1) for (let gy = 0; gy < 6; gy += 1) { tuples.push(pin(`g${gx}-${gy}`, ...at(-33.87, 151.2, gx * 80, gy * 80, 14))); tuples.push(pin(`h${gx}-${gy}`, ...at(-33.87, 151.2, gx * 80 + 5, gy * 80 + 2, 14))); }
    const counts = [8, 9, 10, 11, 12, 13, 14, 15, 16].map((z) => classify(tuples, z).tiles.length);
    for (let n = 1; n < counts.length; n += 1) expect(counts[n]).toBeGreaterThanOrEqual(counts[n - 1]);
    expect(counts[0]).toBeLessThan(counts[counts.length - 1]);
    expect(counts.at(-1)).toBe(36); // 36 places, each with one logo (its neighbour 5 px away is under it)
    expect(classify(tuples, 14).dots).toEqual([]); // and no dot beside a logo that has its twin under it
  });

  it('keeps logos clear of one another by at least the spacing, and dots clear of logos and of each other, for any spread of companies', () => {
    let seed = 7;
    const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const tuples = Array.from({ length: 300 }, (_, n) => pin(`r${n}`, -33.9 + rand() * 0.12, 151.1 + rand() * 0.15));
    for (const z of [9, 11, 13, 15]) {
      const px = (lat, lng) => at(lat, lng, 0, 0, z).length && [((lng + 180) / 360) * 256 * 2 ** z, (0.5 - Math.log((1 + Math.sin((lat * Math.PI) / 180)) / (1 - Math.sin((lat * Math.PI) / 180))) / (4 * Math.PI)) * 256 * 2 ** z];
      const features = createPlainPinIndex(tuples).view(AUSTRALIA, z);
      const place = (f) => px(tuples[f.i][2], tuples[f.i][3]);
      const tiles = features.filter((f) => f.type === 'pin').map(place);
      const dots = features.filter((f) => f.type === 'dot').map(place);
      const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
      for (let i = 0; i < tiles.length; i += 1) for (let j = i + 1; j < tiles.length; j += 1) expect(dist(tiles[i], tiles[j])).toBeGreaterThanOrEqual(pinSpacing(z) - 1e-6);
      for (const d of dots) for (const t of tiles) expect(dist(d, t)).toBeGreaterThanOrEqual(DOT_UNDER - 1e-6);
      for (let i = 0; i < dots.length; i += 1) for (let j = i + 1; j < dots.length; j += 1) expect(dist(dots[i], dots[j])).toBeGreaterThanOrEqual(DOT_APART - 1e-6);
      expect(tiles.length + dots.length).toBeLessThanOrEqual(tuples.length);
    }
  });

  it('draws only what is in the window', () => {
    const tuples = [pin('a', ...SYDNEY), pin('m', ...MELBOURNE)];
    const sydney = { west: 150, south: -35, east: 152, north: -33 };
    expect(createPlainPinIndex(tuples).view(sydney, 12).map((f) => tuples[f.i][0])).toEqual(['a']);
  });

  it('says a pin is on its own where pins are drawn, and otherwise how close the map goes to bring it into view', () => {
    const index = createPlainPinIndex([pin('a', ...SYDNEY)]);
    expect(index.aloneZoom(0, 10)).toBe(10); // already drawn: the map stays where it is
    expect(index.aloneZoom(0, 4)).toBe(PIN_FOCUS_ZOOM);
    expect(PIN_FOCUS_ZOOM).toBeGreaterThanOrEqual(PINS_ZOOM);
    expect(index.leaves()).toEqual([]);
  });
});

describe('the investors of the map page: a logo for each at a verified street address, none for one known only to its city', () => {
  const pin = (id, over = {}) => ({ id, slug: id.split('@')[0], name: id, lat: -33.8688, lng: 151.2093, city: 'Sydney', precision: 'EXACT', place: '1 George Street, Sydney', role: 'office', domain: `${id.split('@')[0]}.vc`, logo: null, sectors: [], ...over });
  const city = (id, over = {}) => pin(id, { precision: 'CITY', place: 'Sydney, NSW', role: 'headquarters', ...over });
  const metres = (a, b) => Math.hypot((a.lat - b.lat) * 111320, (a.lng - b.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180));

  it('makes a mark for each investor at a verified street address with \'grouped: false\', and none for one known only to its city, which stays a numbered mark per spot without it (the older map)', () => {
    const pins = [pin('a@Sydney', { lat: -33.87, lng: 151.2 }), city('b@Sydney'), city('c@Sydney'), pin('d@Perth', { lat: -31.95, lng: 115.86, city: 'Perth' })];
    expect(vcMarks(pins, { grouped: false }).map((t) => [t[0], isVc(t), isVcGroup(t), t[8]])).toEqual([['a@Sydney', true, false, 'EXACT'], ['d@Perth', true, false, 'EXACT']]);
    expect(vcMarks([city('b@Sydney'), city('c@Sydney')], { grouped: false })).toEqual([]); // a city is not a place a logo can stand
    const grouped = vcMarks(pins);
    expect(grouped.map((t) => [isVc(t), isVcGroup(t)])).toEqual([[true, false], [false, true], [true, false]]); // the older map: as it was, the two in Sydney one numbered mark
  });

  it('moves no firm known only to its city: it is not drawn, so nothing is made up for it', () => {
    const pins = Array.from({ length: 8 }, (_, n) => city(`f${n}@Sydney`));
    const out = spreadVcPins(pins);
    expect(out).toEqual(pins);
    expect(out.every((p, i) => p === pins[i])).toBe(true); // not even copied
    expect(out.every((p) => p.lat === -33.8688 && p.lng === 151.2093)).toBe(true); // all on the city's reference point, as the record has them
  });

  it('leaves a firm at a verified address where it is, and keeps the first of the firms in one building on the building', () => {
    const pins = [pin('only@Perth', { lat: -31.95, lng: 115.86 }), pin('a@Sydney'), pin('b@Sydney'), pin('c@Sydney')];
    const out = spreadVcPins(pins);
    expect(out[0]).toBe(pins[0]); // not even copied
    expect(out[1]).toBe(pins[1]); // the first by address stays on the spot
    expect(out.map((p) => p.id)).toEqual(pins.map((p) => p.id)); // same order, same investors
    expect(out[2]).not.toBe(pins[2]);
  });

  it('spreads the firms of one building a few paces (SPREAD_EXACT_M a step), never two on one place, and not a firm of a city that happens to be on the same point', () => {
    const pins = [pin('a@Sydney'), pin('b@Sydney'), pin('c@Sydney'), pin('d@Sydney')];
    const out = spreadVcPins(pins);
    expect(new Set(out.map((p) => `${p.lat},${p.lng}`)).size).toBe(4);
    for (let i = 1; i < 4; i += 1) expect(metres(out[i], pins[i])).toBeLessThanOrEqual(SPREAD_EXACT_M * Math.sqrt(3) + 0.5);
    expect(out.every((p, i) => p.precision === 'EXACT' && p.id === pins[i].id)).toBe(true);
    // a firm known only to its city, on the same point as a firm in a building, leaves that spot alone
    const mixed = spreadVcPins([pin('a@Sydney'), city('b@Sydney')]);
    expect(mixed[1].lat).toBe(-33.8688);
  });

  it('gives the same places however the pins come in the list', () => {
    const pins = ['d', 'a', 'c', 'b'].map((x) => pin(`${x}@Sydney`));
    const forward = new Map(spreadVcPins(pins).map((p) => [p.id, [p.lat, p.lng]]));
    const backward = new Map(spreadVcPins([...pins].reverse()).map((p) => [p.id, [p.lat, p.lng]]));
    expect(forward).toEqual(backward);
  });

  it('shows the investors of one building as logos once the map is close, one then each, by the same reveal as the companies', () => {
    const pins = spreadVcPins(Array.from({ length: 4 }, (_, n) => pin(`f${n}@Sydney`)));
    const tuples = vcMarks(pins, { grouped: false });
    const logos = (z) => createPlainPinIndex(tuples).view(AUSTRALIA, z).filter((f) => f.type === 'pin').length;
    expect(logos(9)).toBe(1); // far away they are one logo on one place
    const counts = [9, 12, 14, 16, 18].map(logos);
    for (let n = 1; n < counts.length; n += 1) expect(counts[n]).toBeGreaterThanOrEqual(counts[n - 1]);
    expect(logos(18)).toBe(4); // and each is its own once there is room
  });

  it('keeps a firm known only to its city in the rows beside the map: one row for a firm, with the mark of a verified office as the one the row picks, else its city mark', () => {
    const rows = vcFirms([city('blackbird@Brisbane', { city: 'Brisbane' }), pin('blackbird@Sydney'), city('blackbird@Perth', { city: 'Perth' }), city('antler@Sydney')]);
    expect(rows.map((r) => r.slug)).toEqual(['antler', 'blackbird']);
    expect(rows.find((r) => r.slug === 'blackbird').pin.id).toBe('blackbird@Sydney'); // its verified office, which is on the map
    expect(rows.find((r) => r.slug === 'blackbird').places).toEqual(['Brisbane', 'Sydney', 'Perth']);
    expect(rows.find((r) => r.slug === 'antler').pin.precision).toBe('CITY'); // no mark: the row opens its page
  });
});

describe('grouping pins for what the map shows', () => {
  const tuples = [pin('a', ...SYDNEY), pin('b', ...NEAR_SYDNEY), pin('m', ...MELBOURNE)];

  it('groups pins that are close together when zoomed out, and leaves the distant one on its own', () => {
    const features = createPinIndex(tuples).view(AUSTRALIA, 5);
    const clusters = features.filter((f) => f.type === 'cluster');
    const pins = features.filter((f) => f.type === 'pin');
    expect(clusters).toHaveLength(1);
    expect(clusters[0].count).toBe(2);
    expect(pins.map((p) => tuples[p.i][0])).toEqual(['m']);
  });

  it('groups marks that are closer than the width of a mark on the SCREEN (64px on Leaflet\'s 256px tiles), so two tiles never overlap', () => {
    // at zoom 10 a pixel is 360 / (256 * 1024) degrees of longitude at the equator, so 0.06 degrees is about 44px and 0.12 about 87px
    const close = [pin('p', -33.8, 151.2), pin('q', -33.8, 151.26)];
    const apart = [pin('p', -33.8, 151.2), pin('q', -33.8, 151.32)];
    const here = { west: 150, south: -35, east: 153, north: -32 };
    expect(createPinIndex(close).view(here, 10).map((f) => f.type)).toEqual(['cluster']);
    expect(createPinIndex(apart).view(here, 10).map((f) => f.type)).toEqual(['pin', 'pin']);
    expect(createPinIndex(close).view(here, 11).map((f) => f.type)).toEqual(['pin', 'pin']);
  });

  it('groups for the whole zoom below the one the map is at, never the one above, so a map between two zooms does not put marks on each other', () => {
    const close = [pin('p', -33.8, 151.2), pin('q', -33.8, 151.26)];
    const here = { west: 150, south: -35, east: 153, north: -32 };
    expect(createPinIndex(close).view(here, 10.9).map((f) => f.type)).toEqual(['cluster']); // as at zoom 10, not at 11
    expect(createPinIndex(close).view(here, 11).map((f) => f.type)).toEqual(['pin', 'pin']);
  });

  it('opens a cluster into its pins as the map zooms in', () => {
    const index = createPinIndex(tuples);
    const [cluster] = index.view(AUSTRALIA, 5).filter((f) => f.type === 'cluster');
    const zoom = index.expansionZoom(cluster.id);
    expect(zoom).toBeGreaterThan(5);
    expect(zoom).toBeLessThanOrEqual(CLUSTER_MAX_ZOOM + 1);
    const opened = index.view(AUSTRALIA, zoom);
    expect(opened.filter((f) => f.type === 'pin').map((p) => tuples[p.i][0]).sort()).toEqual(['a', 'b', 'm']);
  });

  it('says at which zoom a pin stands on its own: where it already does, where a cluster has to open, and never for a stack', () => {
    const index = createPinIndex(tuples);
    expect(index.aloneZoom(2, 5)).toBe(5); // Melbourne is alone at once
    const zoom = index.aloneZoom(0, 5); // Sydney's pin is inside a cluster at zoom 5
    expect(zoom).toBeGreaterThan(5);
    expect(zoom).toBeLessThanOrEqual(CLUSTER_MAX_ZOOM + 1);
    expect(index.view({ west: 151, south: -34, east: 152, north: -33.5 }, zoom).some((f) => f.type === 'pin' && f.i === 0)).toBe(true);
    const stacked = [pin('x', ...SYDNEY), pin('y', ...SYDNEY)];
    expect(createPinIndex(stacked).aloneZoom(0, 5)).toBe(CLUSTER_MAX_ZOOM + 1); // the deepest zoom is the answer when it never is
  });

  it('gives only what is inside the window it is asked about', () => {
    const index = createPinIndex(tuples);
    const sydneyOnly = { west: 150, south: -35, east: 152, north: -33 };
    const features = index.view(sydneyOnly, CLUSTER_MAX_ZOOM + 1);
    expect(features.every((f) => f.lng >= 150 && f.lng <= 152)).toBe(true);
    expect(features.filter((f) => f.type === 'pin').map((p) => tuples[p.i][0]).sort()).toEqual(['a', 'b']);
  });

  it('puts companies at one place into a stack at the deepest zoom, since a map cannot tell them apart', () => {
    const stacked = [pin('x', ...SYDNEY), pin('y', ...SYDNEY), pin('z', SYDNEY[0] + 0.00002, SYDNEY[1]), pin('far', ...MELBOURNE)];
    const features = createPinIndex(stacked).view(AUSTRALIA, CLUSTER_MAX_ZOOM + 1);
    const stack = features.find((f) => f.type === 'stack');
    expect(stack.members.map((i) => stacked[i][0]).sort()).toEqual(['x', 'y', 'z']); // within a couple of metres
    expect(features.filter((f) => f.type === 'pin').map((p) => stacked[p.i][0])).toEqual(['far']);
  });

  it('keeps pins that are a street apart as separate pins at the deepest zoom', () => {
    const apart = [pin('p', ...SYDNEY), pin('q', SYDNEY[0] + 0.0008, SYDNEY[1])]; // about 90 metres
    const features = createPinIndex(apart).view(AUSTRALIA, CLUSTER_MAX_ZOOM + 1);
    expect(features.filter((f) => f.type === 'pin')).toHaveLength(2);
    expect(features.some((f) => f.type === 'stack')).toBe(false);
  });

  it('copes with a zoom the map reports as a fraction, or beyond what it groups at', () => {
    const index = createPinIndex(tuples);
    expect(() => index.view(AUSTRALIA, 5.4)).not.toThrow();
    expect(index.view(AUSTRALIA, 25).filter((f) => f.type === 'pin')).toHaveLength(3);
    expect(index.view(AUSTRALIA, -2).length).toBeGreaterThan(0);
  });

  it('has nothing to show for no pins', () => {
    const index = createPinIndex([]);
    expect(index.size).toBe(0);
    expect(index.view(AUSTRALIA, 5)).toEqual([]);
  });

  it('groups ten thousand pins in a few tens of milliseconds, and shows only a few dozen at a time', () => {
    const many = Array.from({ length: 10000 }, (_, i) => pin(`p${i}`, -33.8 - ((i * 7919) % 1000) / 5000, 151 + ((i * 104729) % 1000) / 4000));
    const t0 = performance.now();
    const index = createPinIndex(many);
    const built = performance.now() - t0;
    const t1 = performance.now();
    const features = index.view(AUSTRALIA, 5);
    const viewed = performance.now() - t1;
    expect(built).toBeLessThan(1500); // measured near 30 ms; the margin is for a loaded machine
    expect(viewed).toBeLessThan(200);
    expect(features.length).toBeLessThan(60);
    expect(features.reduce((n, f) => n + (f.count ?? 1), 0)).toBe(10000);
  });
});

describe('what a pin looks like', () => {
  it('turns a tuple into the company the page reads, with a website from the domain', () => {
    expect(pinPayload(pin('canva', -33.88, 151.21, { name: 'Canva', sector: 'SaaS', city: 'Sydney', hiring: 1, domain: 'canva.com' })))
      .toEqual({ slug: 'canva', name: 'Canva', lat: -33.88, lng: 151.21, sector: 'SaaS', city: 'Sydney', hiring: true, verified: true, website: 'https://canva.com', sectorGroup: null, suburb: null });
    expect(pinPayload(pin('a', 1, 2))).toMatchObject({ hiring: false, website: '' });
  });

  it('sizes a cluster by how many it holds', () => {
    expect([1, 9, 10, 49, 50, 4000].map(clusterSize)).toEqual(['small', 'small', 'medium', 'medium', 'large', 'large']);
  });

  it('writes the name of a city-level group only from zoom 8, so the names of a dozen cities do not crowd the clusters of the whole country', () => {
    expect(AREA_CHIP_ZOOM).toBe(8);
  });
});

// An item of /api/investors/pins: a city's reference point, never an office.
const vc = (slug, city, extra = {}) => ({
  id: `${slug}@${city}`, slug, name: extra.name ?? slug.toUpperCase(), type: 'venture_capital', type_label: 'Venture Capital', domain: `${slug}.vc`, logo: null,
  lat: extra.lat ?? -33.8688, lng: extra.lng ?? 151.2093, city, state: 'NSW', place: `${city}, NSW`, role: extra.role ?? 'headquarters', precision: 'CITY',
  stages: extra.stages ?? ['Seed'], sectors: extra.sectors ?? ['Software'], portfolio_count: 0,
});

describe('investors on the map', () => {
  it('makes a tuple that reads like a company\'s, with its kind, its address and the kind of place it is', () => {
    const tuple = vcTuple(vc('oif', 'Sydney', { name: 'OIF Ventures' }));
    expect(tuple.slice(0, 12)).toEqual(['oif@Sydney', 'OIF Ventures', -33.8688, 151.2093, 'Software', 'Sydney', 0, 'oif.vc', 'CITY', 'Sydney, NSW', 0, null]);
    expect(tuple.slice(12)).toEqual(['vc', 'oif', 'headquarters']);
    expect(isVc(tuple)).toBe(true);
    expect(isVc(pin('a', 1, 2))).toBe(false);
  });

  it('is opened as an investor, never as a company, and says that its place is a city and not an address', () => {
    const payload = pinPayload(vcTuple(vc('oif', 'Sydney', { name: 'OIF Ventures' })));
    expect(payload).toMatchObject({ kind: 'vc', slug: 'oif', id: 'oif@Sydney', name: 'OIF Ventures', city: 'Sydney', website: 'https://oif.vc', verified: true });
    expect(payload.location).toEqual({ precision: 'CITY', place: 'Sydney, NSW', quality: vcQuality('headquarters') });
    expect(payload.hiring).toBeUndefined(); // an investor is never said to be hiring
    expect(vcQuality('headquarters')).toMatch(/headquarters city, no address on file/);
    expect(vcQuality('office')).toMatch(/office in this city, no address on file/);
  });

  it('draws an office at the street address its own page gives as an exact place, in the address\'s words, and says where the address is from', () => {
    const office = vc('blackbird', 'Melbourne', { name: 'Blackbird', lat: -37.8294, lng: 144.9922 });
    const exact = { ...office, id: 'blackbird@Melbourne#1', precision: 'EXACT', place: '15 Dover St, Cremorne VIC 3121', address: '15 Dover St, Cremorne VIC 3121' };
    const tuple = vcTuple(exact);
    expect(tuple[8]).toBe('EXACT');
    expect(tuple[9]).toBe('15 Dover St, Cremorne VIC 3121');
    const payload = pinPayload(tuple);
    expect(payload.location).toEqual({ precision: 'EXACT', place: '15 Dover St, Cremorne VIC 3121', quality: 'Office address from its own website' });
    expect(vcQuality('office', 'EXACT')).toBe('Office address from its own website');
    expect(vcQuality('headquarters', 'EXACT')).toBe(vcQuality('office', 'EXACT')); // an address is an address, whichever office it is
    // anything that is not exactly EXACT stays a city, so a stray value can never claim an office
    expect(vcTuple({ ...exact, precision: 'SUBURB' })[8]).toBe('CITY');
    expect(vcTuple({ ...exact, precision: undefined })[8]).toBe('CITY');
    expect(vcQuality('headquarters', 'SUBURB')).toMatch(/no address on file/);
  });

  it('keeps an office at its address apart from a city\'s mark, and groups firms only when they stand at one point', () => {
    const exact = (slug, extra = {}) => ({ ...vc(slug, 'Melbourne', { lat: -37.8294, lng: 144.9922 }), id: `${slug}@Melbourne#1`, precision: 'EXACT', place: '15 Dover St, Cremorne VIC 3121', ...extra });
    const city = vc('tidal', 'Melbourne', { lat: -37.8136, lng: 144.9631 });
    const marks = vcMarks([exact('blackbird'), exact('other', { lat: -37.83, lng: 144.99, place: '1 Elsewhere St, Cremorne VIC 3121' }), city]);
    expect(marks).toHaveLength(3); // an exact office and the city mark in one city never merge
    expect(marks.filter(isVc).map((m) => m[8]).sort()).toEqual(['CITY', 'EXACT', 'EXACT']);
    // two firms in one building: a group of an address, not of a city
    const pair = vcMarks([exact('blackbird'), exact('rampersand')]);
    expect(pair).toHaveLength(1);
    expect(pair[0][1]).toBe('2 VCs at one address');
    expect(pair[0][8]).toBe('EXACT');
    expect(pair[0][9]).toBe('15 Dover St, Cremorne VIC 3121');
    // an address that falls on the city's point shares the group, and the group then says only what all of it supports: a city
    const mixed = vcMarks([exact('blackbird', { lat: -37.8136, lng: 144.9631 }), city]);
    expect(mixed).toHaveLength(1);
    expect(mixed[0][8]).toBe('CITY');
    expect(mixed[0][1]).toBe('2 VCs in Melbourne');
  });

  it('makes one mark of the investors that stand at one point (a city), and a mark of its own for a city with one', () => {
    const marks = vcMarks([vc('a', 'Sydney'), vc('b', 'Sydney'), vc('c', 'Melbourne', { lat: -37.8136, lng: 144.9631 })]);
    expect(marks).toHaveLength(2);
    const group = marks.find(isVcGroup);
    expect(group[1]).toBe('2 VCs in Sydney');
    expect(group[2]).toBe(-33.8688);
    expect(group[13].map((p) => p.slug)).toEqual(['a', 'b']);
    expect(group[8]).toBe('CITY');
    const single = marks.find(isVc);
    expect(single[13]).toBe('c');
    expect(vcMarks([])).toEqual([]);
  });

  it('lists the firms behind the marks once each, in name order, with every city they are in', () => {
    const firms = vcFirms([vc('b', 'Sydney', { name: 'Beta' }), vc('a', 'Sydney', { name: 'Alpha' }), vc('b', 'Melbourne', { name: 'Beta', lat: -37.8, lng: 144.9 })]);
    expect(firms.map((f) => f.name)).toEqual(['Alpha', 'Beta']);
    expect(firms[1].places).toEqual(['Sydney', 'Melbourne']);
    expect(firms[1].pin.id).toBe('b@Sydney');
  });

  it('opens a cluster to its pins, and says whether they are all at one place', () => {
    const tuples = [pin('a', ...SYDNEY), pin('b', ...NEAR_SYDNEY), pin('m', ...MELBOURNE)];
    const index = createPinIndex(tuples);
    const [cluster] = index.view(AUSTRALIA, 5).filter((f) => f.type === 'cluster');
    expect(index.leaves(cluster.id).sort()).toEqual([0, 1]);
  });
});

describe('how well a place is known', () => {
  it('is said in the words the site uses everywhere, and an address that was only on file is not called verified', () => {
    expect(locationQuality('EXACT', true)).toBe('Verified office');
    expect(locationQuality('EXACT', false)).toBe('Office address on file');
    expect(locationQuality('EXACT')).toBe('Office address on file');
    expect(locationQuality('SUBURB')).toBe('Location: suburb-level');
    expect(locationQuality('CITY')).toBe('Exact location not published'); // a company known to its city only is in the directory, not at a made-up point
    expect(locationQuality('STATE')).toBe('Location: state-level');
    expect(locationQuality('UNKNOWN')).toBe('Location unknown');
    expect(locationQuality(undefined)).toBe('Location unknown');
  });

  it('goes with a company opened from its pin, so the panel can say it before the full record arrives', () => {
    const tuple = ['acme', 'Acme', -33.88, 151.21, 'AI', 'Sydney', 0, 'acme.test', 'EXACT', '110 Kippax Street, Surry Hills, Sydney', 1];
    expect(pinPayload(tuple)).toEqual({
      slug: 'acme', name: 'Acme', lat: -33.88, lng: 151.21, sector: 'AI', city: 'Sydney', hiring: false, verified: true, website: 'https://acme.test', sectorGroup: null, suburb: null,
      location_precision: 'EXACT', location: { precision: 'EXACT', place: '110 Kippax Street, Surry Hills, Sydney', quality: 'Verified office' },
    });
    expect(pinPayload(['a', 'A', 1, 2, 'AI', 'Perth', 0, '', 'SUBURB', '', 0]).location).toEqual({ precision: 'SUBURB', place: 'Perth', quality: 'Location: suburb-level' }); // no place: the city
  });

  it('carries the display sector and the suburb a pin has after the fields it always had, and nothing made up where it has none', () => {
    const tuple = ['acme', 'Acme', -33.88, 151.21, 'HealthTech', 'Sydney', 0, 'acme.test', 'EXACT', '110 Kippax Street, Surry Hills, Sydney', 1, null, 'Sydney', 'Health & Biotech', 'Surry Hills'];
    expect(pinPayload(tuple)).toMatchObject({ sector: 'HealthTech', sectorGroup: 'Health & Biotech', suburb: 'Surry Hills' });
    expect(pinPayload(tuple.slice(0, 13))).toMatchObject({ sectorGroup: null, suburb: null }); // a server that does not send them yet
  });

  it('is left out of a pin from a server that does not say it, rather than guessed', () => {
    expect(pinPayload(pin('a', 1, 2))).not.toHaveProperty('location');
    expect(pinPayload(pin('a', 1, 2))).not.toHaveProperty('location_precision');
  });
});

describe('companies known only to a city or a state', () => {
  const sydney = { kind: 'CITY', label: 'Sydney', city: 'Sydney', state: 'NSW', count: 42, sample: [] };
  const victoria = { kind: 'STATE', label: 'Victoria', city: null, state: 'VIC', count: 3, sample: [] };

  it('is labelled by its place, how many are in it and how they are known', () => {
    expect(areaLabel(sydney)).toBe('Sydney — 42 startups with city-level locations');
    expect(areaLabel(victoria)).toBe('Victoria — 3 startups with state-level locations');
    expect(areaLabel({ ...sydney, count: 1 })).toBe('Sydney — 1 startup with a city-level location');
  });

  it('is opened as a list by the filters that name exactly its companies', () => {
    expect(areaFilters(sydney)).toEqual({ precision: 'CITY', city: 'Sydney' });
    expect(areaFilters(victoria)).toEqual({ precision: 'STATE', state: 'VIC' });
  });

  it('names a company in it as much as the group knows of it', () => {
    expect(areaMember(sydney, { slug: 'trace', name: 'Trace' })).toEqual({
      slug: 'trace', name: 'Trace', city: 'Sydney', verified: true, location_precision: 'CITY',
      location: { precision: 'CITY', place: 'Sydney, NSW', quality: 'Exact location not published' },
    });
    expect(areaMember(victoria, { slug: 'x', name: 'X' })).toMatchObject({ city: '', location: { precision: 'STATE', place: 'VIC', quality: 'Location: state-level' } });
  });

  it('says what a list is narrowed to, and nothing when it is not', () => {
    expect(scopeText({ precision: 'CITY', city: 'Sydney' })).toBe('City-level locations in Sydney');
    expect(scopeText({ precision: 'STATE', state: 'VIC' })).toBe('State-level locations in VIC');
    expect(scopeText({ precision: 'STATE', city: 'Sydney', state: 'VIC' })).toBe('State-level locations in VIC');
    expect(scopeText({ precision: 'SUBURB' })).toBe('Suburb-level locations');
    expect(scopeText({ precision: 'EXACT', city: 'Perth' })).toBe('Exact office locations in Perth');
    expect(scopeText({ state: 'WA' })).toBe('Companies in WA');
    expect(scopeText({ precision: 'city', city: 'Perth' })).toBe('City-level locations in Perth');
    expect(scopeText({ city: 'Perth', sector: 'AI' })).toBe('');
    expect(scopeText({})).toBe('');
    expect(scopeText()).toBe('');
  });
});

describe('the window', () => {
  const bounds = (west, south, east, north) => ({ getWest: () => west, getSouth: () => south, getEast: () => east, getNorth: () => north });

  it('is a little larger than the screen, so a pin at the edge is already there', () => {
    expect(paddedWindow(bounds(100, -40, 110, -30))).toEqual({ west: 98.5, south: -41.5, east: 111.5, north: -28.5 });
  });

  it('stays inside the world', () => {
    expect(paddedWindow(bounds(-179, -84, 179, 84))).toEqual({ west: -180, south: -85, east: 180, north: 85 });
  });
});

describe('the name under a pin', () => {
  const pin = (id, x, y, over = {}) => ({ id, x, y, text: id, rank: 3, ...over });

  it('appears from zoom 7, from zoom 9 on a phone, and not below: the map is circles only until then', () => {
    expect([LABEL_ZOOM, LABEL_ZOOM_NARROW]).toEqual([7, 9]);
    expect([labelsVisible(5), labelsVisible(6.9), labelsVisible(7), labelsVisible(12)]).toEqual([false, false, true, true]);
    expect([labelsVisible(7, true), labelsVisible(8.9, true), labelsVisible(9, true), labelsVisible(14, true)]).toEqual([false, false, true, true]);
  });

  it('is as wide as the name, up to a limit', () => {
    expect(labelWidth('Ab')).toBeLessThan(labelWidth('Abcdefghij'));
    expect(labelWidth('x'.repeat(200))).toBe(170);
  });

  it('names every pin that has room', () => {
    const named = chooseLabels([pin('a', 100, 100), pin('b', 500, 100), pin('c', 100, 400)]);
    expect([...named].sort()).toEqual(['a', 'b', 'c']);
  });

  it('names the more important of two pins whose names would run into each other, and leaves the other bare', () => {
    expect([...chooseLabels([pin('plain', 100, 100), pin('hiring', 156, 100, { rank: 1 })])]).toEqual(['hiring']);
    expect([...chooseLabels([pin('hiring', 100, 100, { rank: 1 }), pin('plain', 156, 100)])]).toEqual(['hiring']);
  });

  it('takes pins of one rank in the order given', () => {
    expect([...chooseLabels([pin('first', 100, 100), pin('second', 156, 100)])]).toEqual(['first']);
    expect([...chooseLabels([pin('second', 156, 100), pin('first', 100, 100)])]).toEqual(['second']);
  });

  it('writes no name over another pin: a pin close under another takes the name above it away, and not its own', () => {
    expect([...chooseLabels([pin('above', 100, 100), pin('below', 100, 130)])]).toEqual(['below']);
  });

  it('lets a name stand beside a pin that is clear of it, and clear of other names', () => {
    expect([...chooseLabels([pin('left', 100, 100), pin('right', 300, 100)])].sort()).toEqual(['left', 'right']);
  });

  it('writes no name over a cluster either, and names the pin again once the cluster is clear of it', () => {
    // the name sits 20-44px under the pin; a cluster is a 40px circle
    expect([...chooseLabels([pin('a', 100, 100)], { blockers: [{ x: 100, y: 150 }] })]).toEqual([]);
    expect([...chooseLabels([pin('a', 100, 100)], { blockers: [{ x: 100, y: 220 }] })]).toEqual(['a']);
    expect([...chooseLabels([pin('a', 100, 100)], { blockers: [] })]).toEqual(['a']);
  });

  it('names at most the limit, the most important first, whatever is on screen', () => {
    const many = Array.from({ length: 400 }, (_, i) => pin(`p${i}`, 200 * (i % 20), 100 * Math.floor(i / 20), { rank: i % 2 === 0 ? 1 : 3 }));
    const named = chooseLabels(many);
    expect(named.size).toBe(MAX_LABELS);
    expect(chooseLabels(many, { limit: 5 }).size).toBe(5);
    expect([...chooseLabels(many, { limit: 5 })].every((id) => Number(id.slice(1)) % 2 === 0)).toBe(true);
  });

  it('is the same every time, and leaves the pins it was given as they were', () => {
    const pins = [pin('a', 100, 100), pin('b', 156, 100, { rank: 1 }), pin('c', 400, 400)];
    const copy = structuredClone(pins);
    expect([...chooseLabels(pins)]).toEqual([...chooseLabels(pins)]);
    expect(pins).toEqual(copy);
    expect(chooseLabels([]).size).toBe(0);
  });
});
