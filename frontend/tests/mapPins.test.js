import { describe, it, expect } from 'vitest';
import { createPinIndex, paddedWindow, pinPayload, clusterSize, showLogos, locationQuality, areaLabel, areaFilters, areaMember, scopeText, CLUSTER_MAX_ZOOM, LOGO_ZOOM, MAX_LOGOS } from '../src/mapPins.js';

// [slug, name, lat, lng, sector, city, hiring, domain]
const pin = (slug, lat, lng, extra = {}) => [slug, extra.name ?? slug.toUpperCase(), lat, lng, extra.sector ?? 'AI', extra.city ?? 'Sydney', extra.hiring ?? 0, extra.domain ?? ''];
const AUSTRALIA = { west: 110, south: -45, east: 156, north: -9 };

const SYDNEY = [-33.8688, 151.2093];
const NEAR_SYDNEY = [-33.8679, 151.2093]; // about 100 metres north
const MELBOURNE = [-37.8136, 144.9631];

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

  it('opens a cluster into its pins as the map zooms in', () => {
    const index = createPinIndex(tuples);
    const [cluster] = index.view(AUSTRALIA, 5).filter((f) => f.type === 'cluster');
    const zoom = index.expansionZoom(cluster.id);
    expect(zoom).toBeGreaterThan(5);
    expect(zoom).toBeLessThanOrEqual(CLUSTER_MAX_ZOOM + 1);
    const opened = index.view(AUSTRALIA, zoom);
    expect(opened.filter((f) => f.type === 'pin').map((p) => tuples[p.i][0]).sort()).toEqual(['a', 'b', 'm']);
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
      .toEqual({ slug: 'canva', name: 'Canva', lat: -33.88, lng: 151.21, sector: 'SaaS', city: 'Sydney', hiring: true, verified: true, website: 'https://canva.com' });
    expect(pinPayload(pin('a', 1, 2))).toMatchObject({ hiring: false, website: '' });
  });

  it('sizes a cluster by how many it holds', () => {
    expect([1, 9, 10, 49, 50, 4000].map(clusterSize)).toEqual(['small', 'small', 'medium', 'medium', 'large', 'large']);
  });

  it('shows logos only when zoomed in and few pins are on screen, so the page does not fetch hundreds of images', () => {
    expect(showLogos(LOGO_ZOOM, 10)).toBe(true);
    expect(showLogos(LOGO_ZOOM, MAX_LOGOS)).toBe(true);
    expect(showLogos(LOGO_ZOOM, MAX_LOGOS + 1)).toBe(false);
    expect(showLogos(LOGO_ZOOM - 1, 3)).toBe(false);
  });
});

describe('how well a place is known', () => {
  it('is said in the words the site uses everywhere, and an address that was only on file is not called verified', () => {
    expect(locationQuality('EXACT', true)).toBe('Verified office');
    expect(locationQuality('EXACT', false)).toBe('Office address on file');
    expect(locationQuality('EXACT')).toBe('Office address on file');
    expect(locationQuality('SUBURB')).toBe('Location: suburb-level');
    expect(locationQuality('CITY')).toBe('Location: city-level');
    expect(locationQuality('STATE')).toBe('Location: state-level');
    expect(locationQuality('UNKNOWN')).toBe('Location unknown');
    expect(locationQuality(undefined)).toBe('Location unknown');
  });

  it('goes with a company opened from its pin, so the panel can say it before the full record arrives', () => {
    const tuple = ['acme', 'Acme', -33.88, 151.21, 'AI', 'Sydney', 0, 'acme.test', 'EXACT', '110 Kippax Street, Surry Hills, Sydney', 1];
    expect(pinPayload(tuple)).toEqual({
      slug: 'acme', name: 'Acme', lat: -33.88, lng: 151.21, sector: 'AI', city: 'Sydney', hiring: false, verified: true, website: 'https://acme.test',
      location_precision: 'EXACT', location: { precision: 'EXACT', place: '110 Kippax Street, Surry Hills, Sydney', quality: 'Verified office' },
    });
    expect(pinPayload(['a', 'A', 1, 2, 'AI', 'Perth', 0, '', 'SUBURB', '', 0]).location).toEqual({ precision: 'SUBURB', place: 'Perth', quality: 'Location: suburb-level' }); // no place: the city
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
      location: { precision: 'CITY', place: 'Sydney, NSW', quality: 'Location: city-level' },
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
