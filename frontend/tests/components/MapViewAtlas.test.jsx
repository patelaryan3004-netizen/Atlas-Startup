import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

// The map page's map (`atlas`): where it opens (exactly where it was left, when it comes back), and the pins it draws (logos where there is room, plain dots beside them).
const listeners = {};
const bounds = { getWest: () => 150, getEast: () => 152, getSouth: () => -35, getNorth: () => -33, contains: () => true };
let zoom = 12;
const mapInstance = {
  options: {},
  setView: vi.fn(function () { return this; }),
  remove: vi.fn(),
  closePopup: vi.fn(),
  on: vi.fn((event, fn) => { (listeners[event] ??= []).push(fn); }),
  off: vi.fn(),
  getZoom: vi.fn(() => zoom),
  getMinZoom: vi.fn(() => 2.5),
  getBounds: vi.fn(() => bounds),
  getContainer: vi.fn(() => document.createElement('div')),
  hasLayer: vi.fn(() => true),
  attributionControl: { addAttribution: vi.fn() },
  latLngToContainerPoint: vi.fn(([lat, lng]) => ({ x: (lng - 150) * 2000, y: (-33 - lat) * 2000 })),
  createPane: vi.fn(() => ({ style: {} })),
  getCenter: vi.fn(() => ({ lat: -33.87, lng: 151.2 })),
  getSize: vi.fn(() => ({ x: 1000, y: 700 })),
  fitBounds: vi.fn(),
  flyTo: vi.fn(),
  flyToBounds: vi.fn(),
};
const tileLayerInstance = { addTo: vi.fn(function () { return this; }), remove: vi.fn() };
const zoomControlInstance = { addTo: vi.fn(function () { return this; }), getContainer: vi.fn(() => document.createElement('div')) };
const layerGroups = [];

vi.mock('../../src/api.js', () => ({ fetchStartup: vi.fn(() => Promise.reject(new Error('offline'))) }));
vi.mock('../../src/atlas/atlasLayer.js', () => ({ createAtlas: vi.fn(() => ({ setBadges: vi.fn(), relayout: vi.fn(), destroy: vi.fn() })) }));
vi.mock('leaflet/dist/leaflet.css', () => ({}));

vi.mock('leaflet', () => {
  const marker = vi.fn((latlng, opts) => ({ latlng, opts, bindTooltip: vi.fn(), on: vi.fn(), addTo: vi.fn(), getElement: vi.fn() }));
  const popup = vi.fn(() => { const p = { setLatLng: vi.fn(() => p), setContent: vi.fn(() => p), openOn: vi.fn(() => p), update: vi.fn() }; return p; });
  const layerGroup = vi.fn(() => { const g = { addTo: vi.fn(function () { return this; }), clearLayers: vi.fn(), removeLayer: vi.fn() }; layerGroups.push(g); return g; });
  return {
    default: {
      map: vi.fn(() => mapInstance),
      tileLayer: vi.fn(() => tileLayerInstance),
      control: { zoom: vi.fn(() => zoomControlInstance), attribution: vi.fn(() => ({ addTo: vi.fn() })) },
      DomUtil: { create: vi.fn((tag) => document.createElement(tag)) },
      DomEvent: { on: vi.fn(), stop: vi.fn() },
      latLngBounds: vi.fn((points) => ({ points })),
      point: vi.fn((p) => ({ x: p[0], y: p[1], add: vi.fn(), subtract: vi.fn() })),
      layerGroup,
      marker,
      popup,
      divIcon: vi.fn((opts) => ({ opts })),
    },
  };
});

import L from 'leaflet';
import MapView from '../../src/components/MapView.jsx';
import { NATIONAL_BOUNDS } from '../../src/atlas/zoomModes.js';
import { pinSpacing } from '../../src/pinIndex.js';

// [slug, name, lat, lng, sector, city, hiring, domain]
const pin = (slug, lat, lng, hiring = 0) => [slug, slug.toUpperCase(), lat, lng, 'AI', 'Sydney', hiring, `${slug}.test`];
const markerIcons = () => L.divIcon.mock.calls.map((c) => c[0]).filter((o) => o.className === 'custom-leaflet-marker' || o.className === 'pin-dot-icon');

describe('the map page\'s map: where it opens', () => {
  beforeEach(() => { for (const k of Object.keys(listeners)) delete listeners[k]; vi.clearAllMocks(); layerGroups.length = 0; zoom = 12; });
  afterEach(cleanup);

  it('opens exactly where it was left when it comes back (from a company\'s page or the list): the same centre and zoom, not the city\'s view and not the country\'s', () => {
    render(<MapView atlas markers={[]} scope="Melbourne" restoreView={{ lat: -37.79123, lng: 144.97456, zoom: 13 }} />);
    const views = mapInstance.setView.mock.calls;
    expect(views.at(-1)).toEqual([[-37.79123, 144.97456], 13, { animate: false }]);
    expect(mapInstance.fitBounds).not.toHaveBeenCalled(); // not the country...
    expect(views.some(([center, z]) => center[0] === -37.8136 && z !== 13)).toBe(false); // ...and not Melbourne's own view
  });

  it('opens on the country with nothing to restore, and on the city a link names', () => {
    render(<MapView atlas markers={[]} />);
    expect(mapInstance.fitBounds).toHaveBeenCalledWith(NATIONAL_BOUNDS, expect.objectContaining({ animate: false }));
    cleanup();
    mapInstance.fitBounds.mockClear();
    mapInstance.setView.mockClear();
    render(<MapView atlas markers={[]} scope="Melbourne" />);
    expect(mapInstance.fitBounds).not.toHaveBeenCalled();
    expect(mapInstance.setView.mock.calls.at(-1)[0][0]).toBeCloseTo(-37.8, 0); // Melbourne
  });

  it('ignores a view it cannot read, and takes none for a map that is not the map page\'s', () => {
    render(<MapView atlas markers={[]} restoreView={{ lat: NaN, lng: 1, zoom: 4 }} />);
    expect(mapInstance.fitBounds).toHaveBeenCalledWith(NATIONAL_BOUNDS, expect.anything());
    cleanup();
    mapInstance.setView.mockClear();
    render(<MapView markers={[]} restoreView={{ lat: -37.8, lng: 145, zoom: 13 }} />);
    expect(mapInstance.setView.mock.calls.some(([, z]) => z === 13)).toBe(false);
  });
});

describe('the map page\'s pins: logos where there is room, plain dots beside them', () => {
  beforeEach(() => { for (const k of Object.keys(listeners)) delete listeners[k]; vi.clearAllMocks(); layerGroups.length = 0; zoom = 12; });
  afterEach(cleanup);

  it('draws a logo for the company with room and a plain dot (no number, no letter) for the one beside it, and nothing for the one under a logo', () => {
    const size = 256 * 2 ** 12; // (the spacing is in screen pixels: these are tens of pixels apart at zoom 12)
    const lng = (px) => 151.2 + (px * 360) / size;
    const markers = [pin('a', -33.87, lng(0), 1), pin('b', -33.87, lng(5)), pin('c', -33.87, lng(pinSpacing(12) - 6)), pin('d', -33.87, lng(400))];
    render(<MapView atlas markers={markers} />);
    const icons = markerIcons();
    const tiles = icons.filter((o) => o.className === 'custom-leaflet-marker');
    const dots = icons.filter((o) => o.className === 'pin-dot-icon');
    expect(tiles).toHaveLength(2); // a (hiring: first) and d (alone)
    expect(dots).toHaveLength(1); // c: beside a's logo, not under it; b is under it: not drawn
    expect(dots[0].html.className).toBe('pin-dot');
    expect(dots[0].html.textContent).toBe(''); // no number
    expect(tiles.every((o) => o.html.querySelector('.pin-face'))).toBe(true);
    // the dot opens the same card as a logo, is not a tab stop (the company is in the list beside the map) and sits under the logos
    const dotMarker = L.marker.mock.calls.find(([, opts]) => opts.icon.opts.className === 'pin-dot-icon');
    expect(dotMarker[1]).toMatchObject({ keyboard: false, zIndexOffset: -1000 });
  });

  it('draws logos only, as it always did, for a map that is not the map page\'s', () => {
    render(<MapView markers={[pin('a', -33.87, 151.2), pin('b', -33.87, 151.2001)]} />);
    expect(markerIcons().some((o) => o.className === 'pin-dot-icon')).toBe(false);
  });

  it('gives a logo to the open company even where there is no room for it', () => {
    const size = 256 * 2 ** 12;
    const lng = (px) => 151.2 + (px * 360) / size;
    const markers = [pin('a', -33.87, lng(0), 1), pin('b', -33.87, lng(10))];
    render(<MapView atlas markers={markers} selectedName="B" />);
    const tiles = markerIcons().filter((o) => o.className === 'custom-leaflet-marker');
    expect(tiles).toHaveLength(2);
    expect(tiles.map((o) => o.html.querySelector('.pin-fallback').textContent).sort()).toEqual(['A', 'B']);
  });

  it('draws no pin at all while the map is nearer the whole country than a city\'s scale', () => {
    zoom = 6;
    render(<MapView atlas markers={[pin('a', -33.87, 151.2)]} />);
    expect(markerIcons()).toEqual([]);
  });
});

describe('the map page\'s investors: a logo for each at a verified street address, by the same reveal as the companies', () => {
  beforeEach(() => { for (const k of Object.keys(listeners)) delete listeners[k]; vi.clearAllMocks(); layerGroups.length = 0; zoom = 12; });
  afterEach(cleanup);
  const size = 256 * 2 ** 12;
  const lng = (px) => 151.2 + (px * 360) / size;
  const firm = (slug, px, extra = {}) => ({ id: `${slug}@Sydney`, slug, name: slug.toUpperCase(), lat: -33.87, lng: lng(px), city: 'Sydney', state: 'NSW', place: '1 George Street, Sydney', role: 'office', precision: 'EXACT', domain: `${slug}.vc`, logo: null, sectors: [], stages: [], ...extra });
  const cityFirm = (slug, px = 0) => firm(slug, px, { precision: 'CITY', role: 'headquarters', place: 'Sydney, NSW' });
  const tiles = () => markerIcons().filter((o) => o.className === 'custom-leaflet-marker');
  const dots = () => markerIcons().filter((o) => o.className === 'pin-dot-icon');

  it('draws each investor at a verified address as its own logo with the VC badge and a solid edge (an office), and no numbered tile', () => {
    render(<MapView atlas markers={[]} vcPins={[firm('airtree', 0), firm('blackbird', 400), firm('carthona', 800)]} showVcs />);
    expect(tiles()).toHaveLength(3);
    for (const o of tiles()) {
      expect(o.html.classList.contains('pin-vc')).toBe(true);
      expect(o.html.classList.contains('pin-vcgroup')).toBe(false);
      expect(o.html.querySelector('.pin-vc-badge').textContent).toBe('VC');
      expect(o.html.classList.contains('pin-approx')).toBe(false); // an office
    }
    expect(tiles().map((o) => o.html.querySelector('.pin-fallback').textContent).sort()).toEqual(['A', 'B', 'C']); // each its own initial, not a number
  });

  it('gives the logo to the investor with room, and a small yellow dot to one beside it', () => {
    render(<MapView atlas markers={[]} vcPins={[firm('airtree', 0), firm('blackbird', 40), firm('carthona', 800)]} showVcs />);
    expect(tiles()).toHaveLength(2);
    expect(dots()).toHaveLength(1);
    expect(dots()[0].html.className).toBe('pin-dot pin-dot-vc');
    const dot = L.marker.mock.calls.find(([, opts]) => opts.icon.opts.className === 'pin-dot-icon');
    expect(dot[1]).toMatchObject({ keyboard: false });
  });

  it('draws no mark for an investor known only to its city, however many there are: it is in the list beside the map, and the map invents no place for it', () => {
    render(<MapView atlas markers={[]} vcPins={[cityFirm('airtree'), cityFirm('blackbird'), cityFirm('carthona', 600), firm('rampersand', 1200)]} showVcs />);
    expect(tiles()).toHaveLength(1);
    expect(tiles()[0].html.querySelector('.pin-fallback').textContent).toBe('R');
    expect(dots()).toHaveLength(0);
    expect(markerIcons().some((o) => o.html?.classList?.contains('pin-vcgroup'))).toBe(false);
  });

  it('gives an investor the room before a startup that is not hiring (a lean ahead), and a startup that is hiring the room before the investor', () => {
    const quiet = ['s', 'S', -33.87, lng(0), 'AI', 'Sydney', 0, 's.test'];
    render(<MapView atlas markers={[quiet]} vcPins={[firm('airtree', 10)]} showVcs />);
    expect(tiles().map((o) => o.html.classList.contains('pin-vc'))).toEqual([true]); // the firm has the logo; the startup, 10 px away, is under it
    cleanup();
    vi.clearAllMocks();
    const hiring = ['s', 'S', -33.87, lng(0), 'AI', 'Sydney', 1, 's.test'];
    render(<MapView atlas markers={[hiring]} vcPins={[firm('airtree', 10)]} showVcs />);
    expect(tiles().map((o) => o.html.classList.contains('pin-vc'))).toEqual([false]); // the startup is hiring: it goes first
  });

  it('opens an investor from its logo as it always did, and from its dot', () => {
    const onSelectPin = vi.fn();
    render(<MapView atlas markers={[]} vcPins={[firm('airtree', 0), firm('blackbird', 40)]} showVcs onSelectPin={onSelectPin} />);
    const marks = L.marker.mock.results.map((r) => r.value);
    for (const m of marks) m.on.mock.calls.find(([event]) => event === 'click')[1]();
    expect(onSelectPin).toHaveBeenCalledTimes(2);
    expect(onSelectPin.mock.calls.map(([p]) => p.kind).sort()).toEqual(['vc', 'vc']);
    expect(onSelectPin.mock.calls.map(([p]) => p.slug).sort()).toEqual(['airtree', 'blackbird']);
  });

  it('keeps the numbered tile on the map that is not the map page\'s, as it was', () => {
    render(<MapView markers={[]} vcPins={[firm('airtree', 0), { ...firm('blackbird', 0) }]} showVcs />);
    const group = markerIcons().filter((o) => o.className === 'custom-leaflet-marker').map((o) => o.html).find((h) => h.classList.contains('pin-vcgroup'));
    expect(group).toBeTruthy();
    expect(group).toBeTruthy();
    expect(group.querySelector('.pin-fallback').textContent).toBe('2');
  });
});
