import { describe, it, expect } from 'vitest';
import {
  paddedWindow, pinPayload, clusterSize, locationQuality, areaLabel, areaFilters, areaMember, scopeText, CLUSTER_MAX_ZOOM, AREA_CHIP_ZOOM,
  labelsVisible, labelWidth, chooseLabels, LABEL_ZOOM, LABEL_ZOOM_NARROW, MAX_LABELS, vcTuple, vcMarks, vcFirms, vcQuality, isVc, isVcGroup,
} from '../src/mapPins.js';
import { createPinIndex } from '../src/pinIndex.js';

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
      .toEqual({ slug: 'canva', name: 'Canva', lat: -33.88, lng: 151.21, sector: 'SaaS', city: 'Sydney', hiring: true, verified: true, website: 'https://canva.com' });
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
