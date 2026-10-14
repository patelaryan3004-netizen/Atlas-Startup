import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

// The map's events: `handlers.moveend()` runs every listener the page added to it (it adds more than one).
const listeners = {};
const handlers = new Proxy({}, { get: (_, event) => (...args) => (listeners[event] ?? []).forEach((fn) => fn(...args)) });
const bounds = { getWest: () => 110, getEast: () => 156, getSouth: () => -45, getNorth: () => -9, contains: ([lat, lng]) => lng >= 110 && lng <= 156 && lat >= -45 && lat <= -9 };
const mapInstance = {
  setView: vi.fn(function () { return this; }),
  remove: vi.fn(),
  closePopup: vi.fn(),
  on: vi.fn((event, fn) => { (listeners[event] ??= []).push(fn); }),
  getZoom: vi.fn(() => 17),
  getBounds: vi.fn(() => bounds),
  latLngToContainerPoint: vi.fn(([lat, lng]) => ({ x: (lng - 150) * 2000, y: (-33 - lat) * 2000 })),
  createPane: vi.fn(() => ({ style: {} })),
  getCenter: vi.fn(() => ({ lat: -33, lng: 145 })),
  getSize: vi.fn(() => ({ x: 1000, y: 700 })),
  project: vi.fn(([lat, lng]) => ({ x: lng * 100, y: -lat * 100, add(p) { return { x: this.x + p[0], y: this.y + p[1] }; } })),
  unproject: vi.fn((p) => ({ lat: -p.y / 100, lng: p.x / 100 })),
  fitBounds: vi.fn(),
  flyTo: vi.fn(),
};
const tileLayerInstance = { addTo: vi.fn(function () { return this; }), setUrl: vi.fn() };
const zoomControlInstance = { addTo: vi.fn() };
const attributionInstance = { addTo: vi.fn() };
// Three layer groups are made each time the map is: the groups (cities and states) first, the pins second, the firms' offices third.
const areaLayerInstance = { addTo: vi.fn(function () { return this; }), clearLayers: vi.fn(), removeLayer: vi.fn() };
const layerInstance = { addTo: vi.fn(function () { return this; }), clearLayers: vi.fn(), removeLayer: vi.fn() };
const instLayerInstance = { addTo: vi.fn(function () { return this; }), clearLayers: vi.fn(), removeLayer: vi.fn() };

vi.mock('../../src/api.js', () => ({ fetchStartup: vi.fn() }));

vi.mock('leaflet', () => {
  const marker = vi.fn((latlng, opts) => ({ latlng, opts, bindTooltip: vi.fn(), on: vi.fn(), addTo: vi.fn() }));
  const popup = vi.fn(() => {
    const p = { setLatLng: vi.fn(() => p), setContent: vi.fn(() => p), openOn: vi.fn(() => p), update: vi.fn() };
    return p;
  });
  const layerGroup = vi.fn(() => { const n = layerGroup.mock.calls.length % 3; return n === 1 ? areaLayerInstance : n === 2 ? layerInstance : instLayerInstance; });
  return {
    default: {
      map: vi.fn(() => mapInstance),
      tileLayer: vi.fn(() => tileLayerInstance),
      control: { zoom: vi.fn(() => zoomControlInstance), attribution: vi.fn(() => attributionInstance) },
      latLngBounds: vi.fn((points) => ({ points })),
      layerGroup,
      marker,
      popup,
      divIcon: vi.fn((opts) => ({ opts })),
    },
  };
});

import L from 'leaflet';
import { fetchStartup } from '../../src/api.js';
import MapView from '../../src/components/MapView.jsx';

// [slug, name, lat, lng, sector, city, hiring, domain] and, from a server that says how well a place is known, [precision, place, checked, logo]
const pin = (slug, name, lat = -33.87, lng = 151.21, extra = {}) => [slug, name, lat, lng, extra.sector ?? 'AI', extra.city ?? 'Sydney', extra.hiring ?? 0, extra.domain ?? '',
  ...(extra.precision || extra.logo ? [extra.precision ?? '', extra.place ?? '', extra.checked ?? 0, extra.logo ?? null] : [])];
const firm = (id, name, lat = -33.87, lng = 151.21, extra = {}) => ({ id: `${id}#0`, institution: id, name, lat, lng, city: 'Sydney', state: 'NSW', place: 'Level 2, 12 Example Street, Sydney NSW 2000', office: 'Sydney', website: 'https://firm.example', href: null, ...extra });
const SYDNEY_GROUP = { kind: 'CITY', key: 'CITY|Sydney|NSW', label: 'Sydney', city: 'Sydney', state: 'NSW', lat: -33.8688, lng: 151.2093, count: 42, sample: [{ slug: 'trace', name: 'Trace' }, { slug: 'truestate', name: 'TrueState' }] };
const noop = () => {};
const icons = () => L.divIcon.mock.calls.map((c) => c[0]);
const lastMarker = () => L.marker.mock.results.at(-1).value;

// Pins are made a few at a time over several animation frames when a view is crowded. The frames are the test's own, so
// a test says when they run: flushFrames() runs every frame that is waiting (and any it asks for) until none is.
let frames;
let frameCount;
function flushFrames() {
  for (let guard = 0; frames.size && guard < 1000; guard += 1) {
    const [id, fn] = frames.entries().next().value;
    frames.delete(id);
    fn();
  }
}
// n pins spread out so each stays a pin at the deepest zoom
const spread = (n) => Array.from({ length: n }, (_, i) => pin(`p${i}`, `P${i}`, -33.0 - i * 0.01, 151.0 + (i % 7) * 0.01));

describe('MapView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cleanup();
    for (const event of Object.keys(listeners)) delete listeners[event];
    mapInstance.getZoom.mockReturnValue(17);
    fetchStartup.mockResolvedValue(null);
    frames = new Map();
    frameCount = 0;
    vi.stubGlobal('requestAnimationFrame', (fn) => { frameCount += 1; frames.set(frameCount, fn); return frameCount; });
    vi.stubGlobal('cancelAnimationFrame', (id) => { frames.delete(id); });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('initializes the map, tile layer, zoom control, a layer for pins, a pane and layer for groups and a layer for the firms once on mount', () => {
    render(<MapView markers={[]} onSelectStartup={noop} />);
    expect(L.map).toHaveBeenCalledTimes(1);
    expect(L.tileLayer).toHaveBeenCalledTimes(1);
    expect(tileLayerInstance.addTo).toHaveBeenCalledWith(mapInstance);
    expect(zoomControlInstance.addTo).toHaveBeenCalledWith(mapInstance);
    expect(L.layerGroup).toHaveBeenCalledTimes(3); // the groups of cities, the pins, and the firms' offices
    expect(layerInstance.addTo).toHaveBeenCalledWith(mapInstance);
    expect(areaLayerInstance.addTo).toHaveBeenCalledWith(mapInstance);
    expect(instLayerInstance.addTo).toHaveBeenCalledWith(mapInstance);
    expect(mapInstance.createPane).toHaveBeenCalledWith('areas');
    expect(mapInstance.on).toHaveBeenCalledWith('moveend', expect.any(Function));
  });

  it('puts a pin on the map for each company in view when zoomed in', () => {
    render(<MapView markers={[pin('a', 'A'), pin('b', 'B', -37.81, 144.96)]} onSelectStartup={noop} />);
    expect(L.marker).toHaveBeenCalledTimes(2);
    expect(L.marker).toHaveBeenCalledWith([-33.87, 151.21], expect.any(Object));
    expect(L.marker).toHaveBeenCalledWith([-37.81, 144.96], expect.any(Object));
    expect(lastMarker().addTo).toHaveBeenCalledWith(layerInstance);
  });

  it('builds each pin as elements: a small dot, with the company\'s name ready to write under it', () => {
    render(<MapView markers={[pin('a', 'Acme', -33.87, 151.21, { sector: 'AI' })]} onSelectStartup={noop} />);
    const { html, className } = icons().at(-1);
    expect(className).toBe('custom-leaflet-marker');
    expect(html).toBeInstanceOf(HTMLElement);
    expect(html.className).toBe('custom-pin-badge pin-dot');
    expect(html.querySelector('.pin-face')).not.toBeNull();
    expect(html.querySelector('.pin-fallback')).toBeNull(); // a dot has no letter, and no colour of a sector: every company is the same dot
    expect(html.querySelector('.pin-label').textContent).toBe('Acme');
  });

  it('draws a white tile with the first letter for the companies worth seeing from afar: one that is hiring, one that is saved, the open one', () => {
    const markers = [pin('a', 'Acme', -33.87, 151.21, { hiring: 1 }), pin('b', 'Beta', -37.81, 144.96), pin('c', 'Cora', -27.47, 153.02), pin('d', 'Delta', -34.9, 138.6)];
    render(<MapView markers={markers} onSelectStartup={noop} selectedName="Beta" trackedNames={new Set(['Cora'])} />);
    const byName = Object.fromEntries(icons().map((i) => [i.html.querySelector('.pin-label').textContent, i.html]));
    for (const name of ['Acme', 'Beta', 'Cora']) {
      expect(byName[name].classList.contains('pin-tile')).toBe(true);
      expect(byName[name].querySelector('.pin-fallback').textContent).toBe(name[0]);
    }
    expect(byName.Delta.classList.contains('pin-dot')).toBe(true);
  });

  it('draws the open company over its neighbours, and one that is hiring over those that are not', () => {
    const markers = [pin('a', 'Acme', -33.87, 151.21, { hiring: 1 }), pin('b', 'Beta', -37.81, 144.96), pin('c', 'Cora', -27.47, 153.02)];
    render(<MapView markers={markers} onSelectStartup={noop} selectedName="Beta" />);
    const offsets = Object.fromEntries(L.marker.mock.calls.map(([, opts]) => [opts.icon.opts.html.querySelector('.pin-label').textContent, opts.zIndexOffset]));
    expect(offsets.Beta).toBeGreaterThan(offsets.Acme);
    expect(offsets.Acme).toBeGreaterThan(offsets.Cora);
    expect(offsets.Cora).toBe(0);
  });

  it('draws the company\'s OWN logo when it has one, and asks no third party for any: not for a company that has only a website', () => {
    render(<MapView markers={[pin('a', 'A', -33.87, 151.21, { domain: 'canva.com', logo: 'https://canva.example/logo.png' })]} onSelectStartup={noop} />);
    const img = icons().at(-1).html.querySelector('img');
    expect(img.src).toBe('https://canva.example/logo.png');
    expect(img.decoding).toBe('async');
    expect(img.alt).toBe('');
    cleanup();
    vi.clearAllMocks();

    // a website is not a logo: no favicon service, no other service, is asked for one
    render(<MapView markers={[pin('b', 'B', -33.87, 151.21, { domain: 'canva.com' })]} onSelectStartup={noop} />);
    expect(icons().at(-1).html.querySelector('img')).toBeNull();
    expect(icons().at(-1).html.classList.contains('pin-dot')).toBe(true);
    const src = JSON.stringify(L.divIcon.mock.calls.map((c) => c[0].html.outerHTML));
    expect(src).not.toMatch(/gstatic|favicon|clearbit|google/i);
  });

  it('falls back to the first letter when the company\'s own logo cannot be loaded', () => {
    render(<MapView markers={[pin('a', 'A', -33.87, 151.21, { logo: 'https://canva.example/gone.png' })]} onSelectStartup={noop} />);
    const html = icons().at(-1).html;
    const img = html.querySelector('img');
    img.onerror();
    expect(img.style.display).toBe('none');
    expect(html.querySelector('.pin-fallback').textContent).toBe('A'); // the letter was underneath all along
  });

  it('shows the logo only once it has loaded: the letter shows until a picture has arrived', () => {
    render(<MapView markers={[pin('a', 'A', -33.87, 151.21, { logo: 'https://canva.example/logo.png' })]} onSelectStartup={noop} />);
    const img = icons().at(-1).html.querySelector('img');
    expect(img.classList.contains('pin-logo-ready')).toBe(false);
    Object.defineProperty(img, 'naturalWidth', { value: 96, configurable: true });
    img.onload();
    expect(img.classList.contains('pin-logo-ready')).toBe(true);

    render(<MapView markers={[pin('b', 'B', -37.81, 144.96, { logo: 'https://b.example/empty.png' })]} onSelectStartup={noop} />);
    const empty = icons().at(-1).html.querySelector('img');
    Object.defineProperty(empty, 'naturalWidth', { value: 0, configurable: true });
    empty.onload(); // loaded, but with nothing in it
    expect(empty.style.display).toBe('none');
    expect(empty.classList.contains('pin-logo-ready')).toBe(false);
  });

  it('draws no logo for a company that has none: a dot, or, when it is hiring, a tile with its first letter', () => {
    render(<MapView markers={[pin('z', 'Zeta'), pin('y', 'Yarra', -37.81, 144.96, { hiring: 1 })]} onSelectStartup={noop} />);
    const [zeta, yarra] = icons().map((i) => i.html);
    expect(zeta.querySelector('img')).toBeNull();
    expect(zeta.querySelector('.pin-fallback')).toBeNull();
    expect(yarra.querySelector('img')).toBeNull();
    expect(yarra.querySelector('.pin-fallback').textContent).toBe('Y');
  });

  it('draws no logos when zoomed out, or when too many pins are on screen, so the page does not fetch hundreds of images', () => {
    const own = (i) => ({ logo: `https://p${i}.example/logo.png` });
    mapInstance.getZoom.mockReturnValue(12);
    render(<MapView markers={[pin('a', 'A', -33.87, 151.21, own(0))]} onSelectStartup={noop} />);
    expect(icons().at(-1).html.querySelector('img')).toBeNull();
    cleanup();
    vi.clearAllMocks();

    mapInstance.getZoom.mockReturnValue(13);
    const few = Array.from({ length: 10 }, (_, i) => pin(`p${i}`, `P${i}`, -33.8 + i * 0.02, 151.2, own(i)));
    render(<MapView markers={few} onSelectStartup={noop} />);
    expect(icons().every((i) => i.html.querySelector('img'))).toBe(true);
    cleanup();
    vi.clearAllMocks();

    const many = Array.from({ length: 61 }, (_, i) => pin(`p${i}`, `P${i}`, -33.0 + i * 0.02, 151.2, own(i)));
    render(<MapView markers={many} onSelectStartup={noop} />);
    flushFrames();
    expect(icons()).toHaveLength(61);
    expect(icons().some((i) => i.html.querySelector('img'))).toBe(false);
  });

  it('marks a hiring company with a hiring-dot badge, and omits it when not hiring', () => {
    render(<MapView markers={[pin('a', 'A', -33.87, 151.21, { hiring: 1 }), pin('b', 'B', -37.81, 144.96, { hiring: 0 })]} onSelectStartup={noop} />);
    const [a, b] = icons().map((i) => i.html);
    expect(a.querySelector('.pin-hiring-dot')).not.toBeNull();
    expect(b.querySelector('.pin-hiring-dot')).toBeNull();
  });

  it('marks the selected company with a selected class, and no other', () => {
    render(<MapView markers={[pin('a', 'A'), pin('b', 'B', -37.81, 144.96)]} onSelectStartup={noop} selectedName="B" />);
    const [a, b] = icons().map((i) => i.html);
    expect(a.classList.contains('pin-selected')).toBe(false);
    expect(b.classList.contains('pin-selected')).toBe(true);
  });

  it('marks a tracked company with a star, and omits it for the others', () => {
    render(<MapView markers={[pin('a', 'A'), pin('b', 'B', -37.81, 144.96)]} onSelectStartup={noop} trackedNames={new Set(['A'])} />);
    const [a, b] = icons().map((i) => i.html);
    expect(a.querySelector('.pin-tracked-star')).not.toBeNull();
    expect(b.querySelector('.pin-tracked-star')).toBeNull();
  });

  describe('what a click on a pin opens', () => {
    const open = (extra = {}, props = {}) => {
      render(<MapView markers={[pin('acme-ai', 'Acme AI', -33.87, 151.21, { sector: 'AI', city: 'Sydney', hiring: 1, domain: 'acme.ai', ...extra })]} onSelectStartup={vi.fn()} {...props} />);
      const [event, handler] = lastMarker().on.mock.calls[0];
      expect(event).toBe('click');
      handler();
      const popup = L.popup.mock.results.at(-1).value;
      return { popup, card: popup.setContent.mock.calls[0][0] };
    };

    it('is a small card, not the whole company: its name, whether it is hiring, one way in, and the rest under "More"', () => {
      const { popup, card } = open();
      expect(L.popup).toHaveBeenCalledWith(expect.objectContaining({ className: 'pin-popup' }));
      expect(popup.setLatLng).toHaveBeenCalledWith([-33.87, 151.21]);
      expect(popup.openOn).toHaveBeenCalledWith(mapInstance);
      expect(card.querySelector('.pin-pop-name').textContent).toBe('Acme AI');
      expect(card.querySelector('.hiring-badge').textContent).toBe('● Hiring now');
      expect([...card.querySelectorAll('button.pin-pop-cta')].map((b) => b.textContent)).toEqual(['View company']); // one call to action
      const more = card.querySelector('details.pin-pop-more');
      expect(more.querySelector('summary').textContent).toBe('More');
      expect(more.open).toBe(false); // folded until asked for
      expect(more.textContent).toContain('AI'); // the sector is in there
    });

    it('opens the company, with what the pin knows, from its one call to action, and shuts the card', () => {
      const onSelectStartup = vi.fn();
      const { card } = open({ precision: 'EXACT', place: '1 George Street, Sydney', checked: 1 }, { onSelectStartup });
      expect(onSelectStartup).not.toHaveBeenCalled(); // a click on the pin alone opens the card, not the company
      card.querySelector('.pin-pop-cta').click();
      expect(mapInstance.closePopup).toHaveBeenCalled();
      expect(onSelectStartup).toHaveBeenCalledWith(expect.objectContaining({ slug: 'acme-ai', name: 'Acme AI', hiring: true, website: 'https://acme.ai', location_precision: 'EXACT' }));
    });

    it('asks the server for the company\'s record and fills in its one line, its hiring state and the rest when it arrives', async () => {
      fetchStartup.mockResolvedValue({ slug: 'acme-ai', name: 'Acme AI', blurb: 'Makes things for people.', stage: 'Seed', hiringState: 'checked', hiring_checked_at: '2026-10-05T03:59:04.292Z', last_verified_at: new Date().toISOString(), website: 'https://acme.ai' });
      const { card } = open({ hiring: 0 });
      expect(fetchStartup).toHaveBeenCalledWith('acme-ai');
      expect(card.querySelector('.pin-pop-blurb').hidden).toBe(true); // nothing is written for a company until its record says it
      await Promise.resolve();
      await Promise.resolve();
      expect(card.querySelector('.pin-pop-blurb').textContent).toBe('Makes things for people.');
      expect(card.querySelector('.pin-pop-blurb').hidden).toBe(false);
      expect(card.querySelector('.hiring-badge').textContent).toBe('Hiring (checked 5 Oct)');
      expect(card.querySelector('.hiring-badge').className).toContain('hiring-badge-off');
      const more = card.querySelector('.pin-pop-more').textContent;
      expect(more).toContain('Seed');
      expect(more).toContain('acme.ai');
    });

    it('asks the map to keep the card clear of the search box again when it grows: when the record arrives, and when "More" is unfolded', async () => {
      fetchStartup.mockResolvedValue({ slug: 'acme-ai', name: 'Acme AI', blurb: 'Makes things for people.', stage: 'Seed' });
      const { popup, card } = open({ hiring: 0 });
      expect(popup.update).not.toHaveBeenCalled();
      expect(L.popup).toHaveBeenCalledWith(expect.objectContaining({ autoPanPaddingTopLeft: [24, 64], autoPanPaddingBottomRight: [24, 96] }));
      await Promise.resolve();
      await Promise.resolve();
      expect(popup.update).toHaveBeenCalledTimes(1); // the record
      document.body.append(card);
      card.querySelector('.pin-pop-more').dispatchEvent(new Event('toggle')); // does not bubble: caught on the way down
      expect(popup.update).toHaveBeenCalledTimes(2);
      card.remove();
    });

    it('says what the pin knows and nothing it does not when the record cannot be fetched', async () => {
      fetchStartup.mockRejectedValue(new Error('down'));
      const { card } = open({ hiring: 0 });
      await Promise.resolve();
      await Promise.resolve();
      expect(card.querySelector('.pin-pop-name').textContent).toBe('Acme AI');
      expect(card.querySelector('.pin-pop-blurb').hidden).toBe(true);
      expect(card.querySelector('.pin-pop-status').hidden).toBe(true); // it is not said to be hiring, or not, of a company nobody has read
    });

    it('does not fail when the card is opened and nobody is listening (the landing page map)', () => {
      render(<MapView markers={[pin('a', 'A')]} />);
      expect(() => lastMarker().on.mock.calls[0][1]()).not.toThrow();
      const card = L.popup.mock.results.at(-1).value.setContent.mock.calls[0][0];
      expect(() => card.querySelector('.pin-pop-cta').click()).not.toThrow();
    });

    it('builds the card as text, whatever the company is called', () => {
      const evil = '<img src=x onerror=alert(1)>';
      render(<MapView markers={[pin('e', evil)]} onSelectStartup={noop} />);
      lastMarker().on.mock.calls[0][1]();
      const bad = L.popup.mock.results.at(-1).value.setContent.mock.calls[0][0];
      expect(bad.querySelector('img')).toBeNull();
      expect(bad.querySelector('.pin-pop-name').textContent).toBe(evil);
    });
  });

  it('binds a lightweight hover tooltip with name, sector and city, built as text and never as HTML', () => {
    const evil = '<img src=x onerror=alert(1)>';
    render(<MapView markers={[pin('a', evil, -33.87, 151.21, { sector: 'AI', city: 'Sydney' })]} onSelectStartup={noop} />);
    const marker = lastMarker();
    const [content] = marker.bindTooltip.mock.calls[0];
    expect(content).toBeInstanceOf(HTMLElement);
    expect(content.textContent).toBe(`${evil}AI · Sydney`);
    expect(content.querySelector('img')).toBeNull();
    expect(icons().at(-1).html.querySelector('img')).toBeNull();
    expect(marker.bindPopup).toBeUndefined();
  });

  describe('zoomed out', () => {
    const near = [pin('a', 'A', -33.8688, 151.2093), pin('b', 'B', -33.8679, 151.2093), pin('m', 'M', -37.8136, 144.9631)];

    it('groups companies that are close together into a cluster with their number, and leaves a distant one alone', () => {
      mapInstance.getZoom.mockReturnValue(5);
      render(<MapView markers={near} onSelectStartup={noop} />);
      expect(L.marker).toHaveBeenCalledTimes(2);
      const cluster = icons().find((i) => i.className === 'marker-cluster-custom');
      expect(cluster.html.className).toBe('marker-cluster-inner cluster-small');
      expect(cluster.html.textContent).toBe('2');
      expect(cluster.iconSize).toEqual([44, 44]); // the same width as a pin
    });

    it('zooms in on a cluster when it is clicked', () => {
      mapInstance.getZoom.mockReturnValue(5);
      render(<MapView markers={near} onSelectStartup={noop} />);
      const clusterMarker = L.marker.mock.results.map((r) => r.value).find((m) => m.opts.icon.opts.className === 'marker-cluster-custom');
      clusterMarker.on.mock.calls[0][1]();
      const [latlng, zoom] = mapInstance.setView.mock.calls.at(-1);
      expect(latlng[0]).toBeCloseTo(-33.868, 2);
      expect(zoom).toBeGreaterThan(5);
    });

    it('sizes a cluster by how many companies it holds', () => {
      mapInstance.getZoom.mockReturnValue(3);
      const crowd = Array.from({ length: 60 }, (_, i) => pin(`p${i}`, `P${i}`, -33.87 + (i % 10) * 0.001, 151.2 + Math.floor(i / 10) * 0.001));
      render(<MapView markers={crowd} onSelectStartup={noop} />);
      const large = icons().find((i) => i.className === 'marker-cluster-custom');
      expect(large.html.className).toContain('cluster-large');
      expect(large.iconSize).toEqual([62, 62]); // a bigger ring, not another colour
    });

    it('draws every size in the one accent: a number in a ring, never an amber or orange fill', () => {
      mapInstance.getZoom.mockReturnValue(3);
      const crowd = Array.from({ length: 60 }, (_, i) => pin(`p${i}`, `P${i}`, -33.87 + (i % 10) * 0.001, 151.2 + Math.floor(i / 10) * 0.001));
      render(<MapView markers={crowd} onSelectStartup={noop} />);
      for (const { html } of icons().filter((i) => i.className === 'marker-cluster-custom')) expect(html.style.background).toBe('');
    });

    it('draws only what is in view: a handful of elements however many companies there are', () => {
      mapInstance.getZoom.mockReturnValue(5);
      const thousands = Array.from({ length: 5000 }, (_, i) => pin(`p${i}`, `P${i}`, -33.7 - ((i * 7919) % 1000) / 5000, 151 + ((i * 104729) % 1000) / 4000));
      render(<MapView markers={thousands} onSelectStartup={noop} />);
      flushFrames();
      expect(L.marker.mock.calls.length).toBeLessThan(40);
    });
  });

  describe('a crowded view', () => {
    it('makes the first few pins at once and the rest over the next frames, so a slow phone keeps answering touches', () => {
      render(<MapView markers={spread(60)} onSelectStartup={noop} />);
      expect(L.marker).toHaveBeenCalledTimes(12); // the first batch, in the same frame as the move
      expect(frames.size).toBe(1); // and the rest is waiting for a frame
      flushFrames();
      expect(L.marker).toHaveBeenCalledTimes(60);
      expect(new Set(L.marker.mock.calls.map((c) => c[0][0])).size).toBe(60); // each pin once
    });

    it('makes a view of a dozen or fewer in one go, with no frame waiting', () => {
      render(<MapView markers={spread(12)} onSelectStartup={noop} />);
      expect(L.marker).toHaveBeenCalledTimes(12);
      expect(frames.size).toBe(0);
    });

    it('makes bigger batches while they are quick and smaller ones while they are slow', () => {
      let clock = 0;
      vi.spyOn(performance, 'now').mockImplementation(() => { clock += 1; return clock; }); // every batch takes 1 ms
      render(<MapView markers={spread(150)} onSelectStartup={noop} />);
      flushFrames();
      const quickFrames = frameCount;
      expect(L.marker).toHaveBeenCalledTimes(150);
      expect(quickFrames).toBeLessThanOrEqual(4); // 12, 24, 48, 96

      cleanup();
      vi.clearAllMocks();
      frames = new Map();
      frameCount = 0;
      vi.spyOn(performance, 'now').mockImplementation(() => { clock += 50; return clock; }); // every batch takes 50 ms
      render(<MapView markers={spread(150)} onSelectStartup={noop} />);
      flushFrames();
      expect(L.marker).toHaveBeenCalledTimes(150);
      expect(frameCount).toBeGreaterThan(quickFrames * 5); // 12, 6, 4, 4, ...
    });

    it('drops what was still waiting when the map moves on: a newer view replaces the last one\'s leftovers', () => {
      render(<MapView markers={spread(60)} onSelectStartup={noop} />);
      expect(frames.size).toBe(1);
      mapInstance.getZoom.mockReturnValue(5);
      handlers.moveend();
      flushFrames();
      expect(L.marker.mock.calls.length).toBeLessThan(25); // the 12 already made, and the few clusters of the new view; not 60 more
    });

    it('stops making pins when the map is taken away', () => {
      const { unmount } = render(<MapView markers={spread(60)} onSelectStartup={noop} />);
      unmount();
      expect(frames.size).toBe(0);
      flushFrames();
      expect(L.marker).toHaveBeenCalledTimes(12);
    });

    it('never makes the same pin twice when the view is redrawn while pins are still waiting', () => {
      render(<MapView markers={spread(60)} onSelectStartup={noop} />);
      handlers.moveend(); // the same view again
      flushFrames();
      expect(L.marker).toHaveBeenCalledTimes(60);
    });
  });

  it('lists companies that sit at one place when they are clicked, and opens the one that is picked', () => {
    const onSelectStartup = vi.fn();
    render(<MapView markers={[pin('x', 'X Co'), pin('y', 'Y Co'), pin('far', 'Far Co', -37.81, 144.96)]} onSelectStartup={onSelectStartup} />);
    const stack = L.marker.mock.results.map((r) => r.value).find((m) => m.opts.icon.opts.html.textContent === '2');
    expect(stack.opts.icon.opts.html.className).toContain('marker-cluster-inner');
    stack.on.mock.calls[0][1]();
    const popup = L.popup.mock.results.at(-1).value;
    expect(L.popup).toHaveBeenCalledWith(expect.objectContaining({ className: 'stack-popup' }));
    expect(popup.openOn).toHaveBeenCalledWith(mapInstance);
    const list = popup.setContent.mock.calls[0][0];
    const buttons = [...list.querySelectorAll('button')];
    expect(buttons.map((b) => b.textContent).sort()).toEqual(['X Co', 'Y Co']);
    buttons.find((b) => b.textContent === 'Y Co').click();
    expect(onSelectStartup).toHaveBeenCalledWith(expect.objectContaining({ slug: 'y', name: 'Y Co' }));
  });

  it('redraws for the new view when the map is moved or zoomed, removing what is no longer there', () => {
    render(<MapView markers={[pin('a', 'A', -33.8688, 151.2093), pin('b', 'B', -33.8679, 151.2093)]} onSelectStartup={noop} />);
    expect(L.marker).toHaveBeenCalledTimes(2); // two pins at the deepest zoom
    mapInstance.getZoom.mockReturnValue(5);
    handlers.moveend();
    expect(L.marker).toHaveBeenCalledTimes(3); // now one cluster of the two
    expect(layerInstance.removeLayer).toHaveBeenCalledTimes(2);
  });

  it('starts from nothing when the companies change (a filter), because a cluster\'s number belongs to the grouping that made it', () => {
    const { rerender } = render(<MapView markers={[pin('a', 'A')]} onSelectStartup={noop} />);
    expect(L.marker).toHaveBeenCalledTimes(1);
    layerInstance.clearLayers.mockClear();
    rerender(<MapView markers={[pin('b', 'B', -37.81, 144.96), pin('c', 'C', -27.47, 153.02)]} onSelectStartup={noop} />);
    expect(layerInstance.clearLayers).toHaveBeenCalledTimes(1);
    expect(L.marker).toHaveBeenCalledTimes(3);
  });

  it('rebuilds only the pins whose look changed when a company is selected', () => {
    const markers = [pin('a', 'A'), pin('b', 'B', -37.81, 144.96), pin('c', 'C', -27.47, 153.02)];
    const { rerender } = render(<MapView markers={markers} onSelectStartup={noop} />);
    expect(L.marker).toHaveBeenCalledTimes(3);
    rerender(<MapView markers={markers} onSelectStartup={noop} selectedName="B" />);
    expect(L.marker).toHaveBeenCalledTimes(4);
    expect(layerInstance.removeLayer).toHaveBeenCalledTimes(1);
    expect(icons().at(-1).html.classList.contains('pin-selected')).toBe(true);
  });

  describe('the page\'s card for a company, the city the map is on, and where it looks', () => {
    const MELBOURNE = [pin('m1', 'M One', -37.81, 144.96, { city: 'Melbourne' }), pin('m2', 'M Two', -37.9, 145.1, { city: 'Melbourne' })];
    const ALL = [pin('a', 'A'), ...MELBOURNE];

    it('hands the page the company when its pin is pressed, and opens no card of its own', () => {
      const onSelectPin = vi.fn();
      render(<MapView markers={[pin('acme-ai', 'Acme AI', -33.87, 151.21, { hiring: 1, domain: 'acme.ai', precision: 'SUBURB', place: 'Surry Hills, Sydney' })]} onSelectPin={onSelectPin} />);
      lastMarker().on.mock.calls[0][1]();
      expect(onSelectPin).toHaveBeenCalledWith(expect.objectContaining({ slug: 'acme-ai', name: 'Acme AI', lat: -33.87, lng: 151.21, hiring: true, website: 'https://acme.ai', location_precision: 'SUBURB' }));
      expect(L.popup).not.toHaveBeenCalled();
    });

    it('hands the page the company picked from a list of companies at one place', () => {
      const onSelectPin = vi.fn();
      const onSelectStartup = vi.fn();
      render(<MapView markers={[pin('x', 'X Co'), pin('y', 'Y Co'), pin('far', 'Far Co', -37.81, 144.96)]} onSelectPin={onSelectPin} onSelectStartup={onSelectStartup} />);
      L.marker.mock.results.map((r) => r.value).find((m) => m.opts.icon.opts.html.textContent === '2').on.mock.calls[0][1]();
      const list = L.popup.mock.results.at(-1).value.setContent.mock.calls[0][0];
      [...list.querySelectorAll('button')].find((b) => b.textContent === 'Y Co').click();
      expect(onSelectPin).toHaveBeenCalledWith(expect.objectContaining({ slug: 'y', name: 'Y Co' }));
      expect(onSelectStartup).not.toHaveBeenCalled();
    });

    it('tells the page when the bare map is pressed, so it can put the card away', () => {
      const onClearPin = vi.fn();
      render(<MapView markers={[]} onClearPin={onClearPin} />);
      handlers.click();
      expect(onClearPin).toHaveBeenCalledTimes(1);
      expect(() => { cleanup(); render(<MapView markers={[]} />); handlers.click(); }).not.toThrow();
    });

    it('says where the map is looking when it opens and after each move', () => {
      const onViewChange = vi.fn();
      render(<MapView markers={[]} onViewChange={onViewChange} />);
      expect(onViewChange).toHaveBeenLastCalledWith({ lat: -33, lng: 145, zoom: 17 });
      mapInstance.getCenter.mockReturnValueOnce({ lat: -37.8, lng: 144.9 });
      handlers.moveend();
      expect(onViewChange).toHaveBeenLastCalledWith({ lat: -37.8, lng: 144.9, zoom: 17 });
    });

    it('takes the credit for the tiles without Leaflet\'s own name in front of it', () => {
      render(<MapView markers={[]} />);
      expect(L.map).toHaveBeenCalledWith(expect.any(HTMLElement), expect.objectContaining({ attributionControl: false }));
      expect(L.control.attribution).toHaveBeenCalledWith({ position: 'bottomright', prefix: false });
      expect(attributionInstance.addTo).toHaveBeenCalledWith(mapInstance);
    });

    it('moves to the pins of a city when the city is picked, once they arrive, and not before', () => {
      const { rerender } = render(<MapView markers={ALL} scope="" />);
      expect(mapInstance.fitBounds).not.toHaveBeenCalled();
      rerender(<MapView markers={ALL} scope="Melbourne" />); // the city is picked: the pins of the city are not here yet
      expect(mapInstance.fitBounds).not.toHaveBeenCalled();
      rerender(<MapView markers={MELBOURNE} scope="Melbourne" />);
      expect(mapInstance.fitBounds).toHaveBeenCalledTimes(1);
      expect(mapInstance.fitBounds).toHaveBeenCalledWith({ points: [[-37.81, 144.96], [-37.9, 145.1]] }, expect.objectContaining({ maxZoom: 13 }));
    });

    it('leaves the map where the visitor put it when something else about the pins changes', () => {
      const { rerender } = render(<MapView markers={ALL} scope="Melbourne" />);
      expect(mapInstance.fitBounds).toHaveBeenCalledTimes(1); // it opened on the city
      mapInstance.fitBounds.mockClear();
      rerender(<MapView markers={[...MELBOURNE]} scope="Melbourne" />); // a sector was picked, say: new pins, the same city
      expect(mapInstance.fitBounds).not.toHaveBeenCalled();
    });

    it('opens on the city the address names, once its pins are in', () => {
      const { rerender } = render(<MapView markers={[]} scope="Melbourne" />);
      expect(mapInstance.fitBounds).not.toHaveBeenCalled(); // nothing to fit yet
      rerender(<MapView markers={MELBOURNE} scope="Melbourne" />);
      expect(mapInstance.fitBounds).toHaveBeenCalledTimes(1);
    });

    it('goes back to Australia when the city is cleared', () => {
      const { rerender } = render(<MapView markers={MELBOURNE} scope="Melbourne" />);
      mapInstance.setView.mockClear();
      rerender(<MapView markers={ALL} scope="" />);
      expect(mapInstance.setView).toHaveBeenCalledWith([-33, 145], 5);
    });

    it('shows a city known only as a group where there are no pins to fit, never closer than the city', () => {
      const { rerender } = render(<MapView markers={[]} areas={[]} scope="Perth" />);
      rerender(<MapView markers={[]} areas={[{ ...SYDNEY_GROUP, label: 'Perth', city: 'Perth', lat: -31.95, lng: 115.86 }]} scope="Perth" />);
      expect(mapInstance.fitBounds).toHaveBeenCalledWith({ points: [[-31.95, 115.86]] }, expect.objectContaining({ maxZoom: 10 }));
    });

    it('brings a company into view when asked, a little way up from the bottom sheet, and leaves one that is already clear', () => {
      const { rerender } = render(<MapView markers={[]} focus={null} />);
      rerender(<MapView markers={[]} focus={{ key: 1, lat: -33.87, lng: 151.21, inset: 300 }} />); // off to the right of the window
      expect(mapInstance.flyTo).toHaveBeenCalledTimes(1);
      mapInstance.flyTo.mockClear();
      rerender(<MapView markers={[]} focus={{ key: 2, lat: -33.1, lng: 150.2, inset: 300 }} />); // inside it, clear of the sheet
      expect(mapInstance.flyTo).not.toHaveBeenCalled();
    });

    it('goes home when asked to', () => {
      const { rerender } = render(<MapView markers={[]} />);
      mapInstance.setView.mockClear();
      rerender(<MapView markers={[]} focus={{ key: 3, home: true }} />);
      expect(mapInstance.setView).toHaveBeenCalledWith([-33, 145], 5);
    });
  });

  it('removes the map on unmount', () => {
    const { unmount } = render(<MapView markers={[]} onSelectStartup={noop} />);
    unmount();
    expect(mapInstance.remove).toHaveBeenCalledTimes(1);
  });

  describe('how well a place is known', () => {
    it('draws a suburb\'s pin as approximate, and an office\'s as it always was', () => {
      render(<MapView markers={[pin('a', 'A', -33.87, 151.21, { precision: 'SUBURB', place: 'Surry Hills, Sydney' }), pin('b', 'B', -37.81, 144.96, { precision: 'EXACT', place: '1 William Street, Melbourne', checked: 1 })]} onSelectStartup={noop} />);
      const [suburb, office] = icons().map((i) => i.html);
      expect(suburb.classList.contains('pin-approx')).toBe(true);
      expect(office.classList.contains('pin-approx')).toBe(false);
    });

    it('says in the tooltip the name, where, and how well that is known', () => {
      render(<MapView markers={[pin('a', 'Example Startup', -37.81, 144.96, { precision: 'EXACT', place: '123 Example Street, Melbourne', checked: 1 })]} onSelectStartup={noop} />);
      const [content] = lastMarker().bindTooltip.mock.calls[0];
      expect([...content.children].map((c) => c.textContent)).toEqual(['Example Startup', '123 Example Street, Melbourne', 'Verified office']);
      expect(content.querySelector('.tip-quality').className).toContain('tip-exact');
    });

    it('does not call an address that was only on file verified, and calls a suburb suburb-level', () => {
      render(<MapView markers={[pin('a', 'A', -33.87, 151.21, { precision: 'EXACT', place: '1 George Street, Sydney', checked: 0 }), pin('b', 'B', -37.81, 144.96, { precision: 'SUBURB', place: 'Richmond, Melbourne' })]} onSelectStartup={noop} />);
      const words = L.marker.mock.results.map((r) => r.value.bindTooltip.mock.calls[0][0].querySelector('.tip-quality').textContent);
      expect(words).toEqual(['Office address on file', 'Location: suburb-level']);
    });

    it('builds the tooltip as text, whatever the company or the place is called', () => {
      const evil = '<img src=x onerror=alert(1)>';
      render(<MapView markers={[pin('a', evil, -37.81, 144.96, { precision: 'EXACT', place: evil })]} onSelectStartup={noop} />);
      const [content] = lastMarker().bindTooltip.mock.calls[0];
      expect(content.querySelector('img')).toBeNull();
      expect(content.textContent).toContain(evil);
    });

    it('opens a company from its card with how well its place is known already in hand, and says it on the card', () => {
      const onSelectStartup = vi.fn();
      render(<MapView markers={[pin('acme', 'Acme', -33.88, 151.21, { precision: 'SUBURB', place: 'Surry Hills, Sydney' })]} onSelectStartup={onSelectStartup} />);
      lastMarker().on.mock.calls[0][1]();
      const card = L.popup.mock.results.at(-1).value.setContent.mock.calls[0][0];
      expect(card.querySelector('.pin-pop-more').textContent).toContain('Location: suburb-level');
      card.querySelector('.pin-pop-cta').click();
      expect(onSelectStartup).toHaveBeenCalledWith(expect.objectContaining({ slug: 'acme', location_precision: 'SUBURB', location: { precision: 'SUBURB', place: 'Surry Hills, Sydney', quality: 'Location: suburb-level' } }));
    });
  });

  describe('companies known only to a city or a state', () => {
    const groupMarker = () => L.marker.mock.results.map((r) => r.value).find((m) => m.opts.pane === 'areas');

    it('draws a group as a ring and a label in a pane under the pins, never as a pin, and says what it is', () => {
      render(<MapView markers={[]} areas={[SYDNEY_GROUP]} onSelectStartup={noop} />);
      expect(L.marker).toHaveBeenCalledTimes(1);
      expect(L.marker).toHaveBeenCalledWith([-33.8688, 151.2093], expect.objectContaining({ pane: 'areas', title: 'Sydney — 42 startups with city-level locations', keyboard: false }));
      const { html, className } = icons().at(-1);
      expect(className).toBe('area-marker-icon');
      expect(html.className).toContain('area-city');
      expect(html.querySelector('.area-ring')).not.toBeNull();
      expect(html.querySelector('.area-chip').textContent).toBe('Sydney42city-level');
      expect(html.querySelector('.area-chip').getAttribute('aria-label')).toBe('Sydney — 42 startups with city-level locations');
      expect(groupMarker().addTo).toHaveBeenCalledWith(areaLayerInstance);
      expect(groupMarker().bindTooltip).toHaveBeenCalledWith('Sydney — 42 startups with city-level locations', expect.any(Object));
    });

    it('draws a state\'s group as state-level, and says "1 startup" for one', () => {
      render(<MapView markers={[]} areas={[{ kind: 'STATE', label: 'Victoria', city: null, state: 'VIC', lat: -36.9, lng: 144.3, count: 1, sample: [] }]} onSelectStartup={noop} />);
      expect(icons().at(-1).html.className).toContain('area-state');
      expect(groupMarker().opts.title).toBe('Victoria — 1 startup with a state-level location');
    });

    it('is drawn alongside the pins without disturbing them', () => {
      render(<MapView markers={[pin('a', 'A'), pin('b', 'B', -37.81, 144.96)]} areas={[SYDNEY_GROUP]} onSelectStartup={noop} />);
      expect(L.marker).toHaveBeenCalledTimes(3);
      expect(L.marker.mock.calls.filter((c) => c[1].pane === 'areas')).toHaveLength(1);
      expect(layerInstance.clearLayers).toHaveBeenCalledTimes(1); // the pins' own start-from-nothing, and only that
    });

    it('builds the label as text, whatever the place is called', () => {
      const evil = '<img src=x onerror=alert(1)>';
      render(<MapView markers={[]} areas={[{ ...SYDNEY_GROUP, label: evil }]} onSelectStartup={noop} />);
      const { html } = icons().at(-1);
      expect(html.querySelector('img')).toBeNull();
      expect(html.querySelector('b').textContent).toBe(evil);
    });

    it('lists a few of its companies when it is clicked, and opens the one that is picked', () => {
      const onSelectStartup = vi.fn();
      render(<MapView markers={[]} areas={[SYDNEY_GROUP]} onSelectStartup={onSelectStartup} onViewArea={vi.fn()} />);
      groupMarker().on.mock.calls[0][1]();
      expect(L.popup).toHaveBeenCalledWith(expect.objectContaining({ className: expect.stringContaining('stack-popup') }));
      const popup = L.popup.mock.results.at(-1).value;
      expect(popup.setLatLng).toHaveBeenCalledWith([-33.8688, 151.2093]);
      expect(popup.openOn).toHaveBeenCalledWith(mapInstance);
      const box = popup.setContent.mock.calls[0][0];
      expect(box.querySelector('.area-pop-title').textContent).toBe('Sydney — 42 startups with city-level locations');
      expect(box.querySelector('.area-pop-note').textContent).toMatch(/no pin of their own/);
      const names = [...box.querySelectorAll('.stack-item')];
      expect(names.map((b) => b.textContent)).toEqual(['Trace', 'TrueState']);
      names[1].click();
      expect(onSelectStartup).toHaveBeenCalledWith({
        slug: 'truestate', name: 'TrueState', city: 'Sydney', verified: true, location_precision: 'CITY',
        location: { precision: 'CITY', place: 'Sydney, NSW', quality: 'Location: city-level' },
      });
    });

    it('opens all of them as a list from "View all", with the group', () => {
      const onViewArea = vi.fn();
      render(<MapView markers={[]} areas={[SYDNEY_GROUP]} onSelectStartup={noop} onViewArea={onViewArea} />);
      groupMarker().on.mock.calls[0][1]();
      const box = L.popup.mock.results.at(-1).value.setContent.mock.calls[0][0];
      const all = box.querySelector('.area-viewall');
      expect(all.textContent).toBe('View all 42 in the list');
      all.click();
      expect(onViewArea).toHaveBeenCalledWith(SYDNEY_GROUP);
    });

    it('does nothing when clicked on a page that listens to nothing (the landing page map): it is a label to hover', () => {
      render(<MapView markers={[]} areas={[SYDNEY_GROUP]} />);
      expect(() => groupMarker().on.mock.calls[0][1]()).not.toThrow();
      expect(L.popup).not.toHaveBeenCalled();
    });

    it('is drawn again only when the groups change, not when the pins do', () => {
      const groups = [SYDNEY_GROUP]; // the page holds its groups in state: the same array until the server sends others
      const { rerender } = render(<MapView markers={[pin('a', 'A')]} areas={groups} onSelectStartup={noop} />);
      areaLayerInstance.clearLayers.mockClear();
      rerender(<MapView markers={[pin('b', 'B', -37.81, 144.96)]} areas={groups} onSelectStartup={noop} />);
      expect(areaLayerInstance.clearLayers).not.toHaveBeenCalled();
      rerender(<MapView markers={[pin('b', 'B', -37.81, 144.96)]} areas={[{ ...SYDNEY_GROUP, count: 5 }]} onSelectStartup={noop} />);
      expect(areaLayerInstance.clearLayers).toHaveBeenCalledTimes(1);
      expect(L.marker.mock.calls.filter((c) => c[1].pane === 'areas')).toHaveLength(2);
    });

    it('draws no group when there are none', () => {
      render(<MapView markers={[pin('a', 'A')]} onSelectStartup={noop} />);
      expect(L.marker.mock.calls.filter((c) => c[1].pane === 'areas')).toHaveLength(0);
    });
  });
  // The name under a pin: from zoom 7 (9 on a phone), and only where it fits. latLngToContainerPoint is the test's own: 0.01
  // degree is 20 pixels, so two pins 0.015 degree of longitude apart are 30 pixels apart.
  describe('the name under a pin', () => {
    const namesOn = () => icons().map((i) => i.html).filter(Boolean).filter((h) => h.querySelector?.('.pin-label')).map((h) => [h.querySelector('.pin-label').textContent, h.querySelector('.pin-label').classList.contains('pin-label-on')]);
    const close = (a = {}, b = {}) => [pin('a', 'Alpha', -33.0, 150.0, a), pin('b', 'Beta', -33.0, 150.028, b)]; // 56px apart: the pins clear each other, their names would run together
    const mapEl = (container) => container.querySelector('#map');

    it('is built as text, with the name only, hidden from screen readers', () => {
      render(<MapView markers={[pin('a', '<img src=x onerror=alert(1)>')]} onSelectStartup={noop} />);
      const html = icons().at(-1).html;
      const label = html.querySelector('.pin-label');
      expect(label.textContent).toBe('<img src=x onerror=alert(1)>');
      expect(label.querySelector('img')).toBeNull();
      expect(label.getAttribute('aria-hidden')).toBe('true');
    });

    it('is written under a pin from zoom 7, and the map is circles only below it', () => {
      mapInstance.getZoom.mockReturnValue(7);
      const { container } = render(<MapView markers={[pin('a', 'Alpha')]} onSelectStartup={noop} />);
      flushFrames();
      expect(mapEl(container)).toHaveClass('show-pin-labels');
      expect(namesOn()).toEqual([['Alpha', true]]);
      mapInstance.getZoom.mockReturnValue(6);
      handlers.moveend();
      flushFrames();
      expect(mapEl(container)).not.toHaveClass('show-pin-labels');
    });

    it('waits for zoom 9 on a phone', () => {
      vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
      mapInstance.getZoom.mockReturnValue(8);
      const { container } = render(<MapView markers={[pin('a', 'Alpha')]} onSelectStartup={noop} />);
      flushFrames();
      expect(mapEl(container)).not.toHaveClass('show-pin-labels');
      mapInstance.getZoom.mockReturnValue(9);
      handlers.moveend();
      flushFrames();
      expect(mapEl(container)).toHaveClass('show-pin-labels');
      expect(window.matchMedia).toHaveBeenCalledWith('(max-width: 639px)');
    });

    it('names the company that is hiring, and not the one beside it that would run into it', () => {
      render(<MapView markers={close({}, { hiring: 1 })} onSelectStartup={noop} />);
      flushFrames();
      expect(namesOn()).toEqual([['Alpha', false], ['Beta', true]]);
    });

    it('names the open company before one that is hiring', () => {
      render(<MapView markers={close({}, { hiring: 1 })} onSelectStartup={noop} selectedName="Alpha" />);
      flushFrames();
      expect(namesOn().filter(([, on]) => on).map(([name]) => name)).toEqual(['Alpha']);
    });

    it('names every company that has room', () => {
      render(<MapView markers={[pin('a', 'Alpha', -33.0, 150.0), pin('b', 'Beta', -33.0, 150.2)]} onSelectStartup={noop} />);
      flushFrames();
      expect(namesOn()).toEqual([['Alpha', true], ['Beta', true]]);
    });

    it('writes no name where a cluster is, and writes it once the cluster is clear of the pin', () => {
      const stackAt = (lat) => [pin('s1', 'S1', lat, 150.0), pin('s2', 'S2', lat, 150.0)]; // two companies at one place: drawn as a "2"
      // 20px under the pin, where its name would go
      const { rerender } = render(<MapView markers={[pin('a', 'Alpha', -33.0, 150.0), ...stackAt(-33.01)]} onSelectStartup={noop} />);
      flushFrames();
      expect(namesOn()).toEqual([['Alpha', false]]);
      // 100px under it: room for the name
      rerender(<MapView markers={[pin('a', 'Alpha', -33.0, 150.0), ...stackAt(-33.05)]} onSelectStartup={noop} />);
      flushFrames();
      expect(namesOn().at(-1)).toEqual(['Alpha', true]);
    });

    it('works out again which names fit when the map moves, and when the companies change', () => {
      const { rerender } = render(<MapView markers={close({}, { hiring: 1 })} onSelectStartup={noop} />);
      flushFrames();
      expect(namesOn()).toEqual([['Alpha', false], ['Beta', true]]);
      // a filter leaves only Alpha: a new set of pins, and now it has room
      rerender(<MapView markers={[pin('a', 'Alpha', -33.0, 150.0)]} onSelectStartup={noop} />);
      flushFrames();
      expect(namesOn().at(-1)).toEqual(['Alpha', true]);
    });
  });

  describe('the firms\' offices', () => {
    const firmMarkers = () => L.marker.mock.results.map((r) => r.value).filter((m) => m.opts.icon.opts.html?.classList?.contains('inst-pin'));

    it('draws each office as a rounded square with the firm\'s initial, in a layer of its own, never as a company\'s pin', () => {
      render(<MapView markers={[pin('a', 'A')]} institutionPins={[firm('blackbird', 'Blackbird'), firm('airtree', 'AirTree', -37.81, 144.96)]} onSelectStartup={noop} />);
      const marks = firmMarkers();
      expect(marks).toHaveLength(2);
      expect(marks[0].addTo).toHaveBeenCalledWith(instLayerInstance);
      const html = marks[0].opts.icon.opts.html;
      expect(html.className).toBe('inst-pin');
      expect(html.querySelector('.inst-initial').textContent).toBe('B');
      expect(html.classList.contains('custom-pin-badge')).toBe(false);
      expect(html.querySelector('img')).toBeNull();
      expect(L.marker).toHaveBeenCalledWith([-33.87, 151.21], expect.any(Object));
    });

    it('names an office under its square like a company\'s, from the same zoom and only where it fits', () => {
      mapInstance.getZoom.mockReturnValue(7);
      const { container } = render(<MapView markers={[]} institutionPins={[firm('blackbird', 'Blackbird')]} onSelectStartup={noop} />);
      const label = firmMarkers()[0].opts.icon.opts.html.querySelector('.pin-label');
      expect(label.textContent).toBe('Blackbird');
      expect(label.getAttribute('aria-hidden')).toBe('true');
      expect(container.querySelector('#map')).toHaveClass('show-pin-labels');
      expect(label.classList.contains('pin-label-on')).toBe(true);
      mapInstance.getZoom.mockReturnValue(6);
      handlers.moveend();
      flushFrames();
      expect(container.querySelector('#map')).not.toHaveClass('show-pin-labels');
    });

    it('opens a small card: the name, where, one way in (its page in the app when it has one), and the rest under "More"', () => {
      const onOpenInternal = vi.fn();
      render(<MapView markers={[]} institutionPins={[firm('blackbird', 'Blackbird', -33.87, 151.21, { href: '/investors/blackbird' })]} onSelectStartup={noop} onOpenInternal={onOpenInternal} />);
      firmMarkers()[0].on.mock.calls[0][1]();
      expect(L.popup).toHaveBeenCalledWith(expect.objectContaining({ className: 'pin-popup' }));
      const card = L.popup.mock.results.at(-1).value.setContent.mock.calls[0][0];
      expect(card.querySelector('.pin-pop-name').textContent).toBe('Blackbird');
      expect(card.querySelector('.pin-pop-blurb').textContent).toBe('Sydney · Sydney');
      const cta = card.querySelector('a.pin-pop-cta');
      expect(cta.textContent).toBe('View investor');
      expect(card.querySelectorAll('.pin-pop-cta')).toHaveLength(1);
      expect(card.querySelector('.pin-pop-more').open).toBe(false);
      expect(card.querySelector('.pin-pop-more').textContent).toContain('Level 2, 12 Example Street');
      cta.click();
      expect(onOpenInternal).toHaveBeenCalledWith('/investors/blackbird');
      expect(mapInstance.closePopup).toHaveBeenCalled();
    });

    it('sends a firm with no page of its own to its website, in a new tab that cannot reach back', () => {
      render(<MapView markers={[]} institutionPins={[firm('quiet', 'Quiet Fund')]} onSelectStartup={noop} />);
      firmMarkers()[0].on.mock.calls[0][1]();
      const cta = L.popup.mock.results.at(-1).value.setContent.mock.calls[0][0].querySelector('a.pin-pop-cta');
      expect(cta.textContent).toBe('Visit website');
      expect(cta.getAttribute('href')).toBe('https://firm.example');
      expect(cta.target).toBe('_blank');
      expect(cta.rel).toBe('noopener noreferrer');
    });

    it('draws no firm when there are none, and none when its layer is switched off', () => {
      const { rerender } = render(<MapView markers={[]} onSelectStartup={noop} />);
      expect(firmMarkers()).toHaveLength(0);
      rerender(<MapView markers={[]} institutionPins={[firm('blackbird', 'Blackbird')]} onSelectStartup={noop} />);
      expect(firmMarkers()).toHaveLength(1);
      instLayerInstance.clearLayers.mockClear();
      rerender(<MapView markers={[]} institutionPins={[firm('blackbird', 'Blackbird')]} showInstitutions={false} onSelectStartup={noop} />);
      expect(instLayerInstance.clearLayers).toHaveBeenCalled();
      expect(firmMarkers()).toHaveLength(1); // nothing new was drawn
    });

    it('is not disturbed by the companies changing, and does not disturb them', () => {
      const pins = [firm('blackbird', 'Blackbird')]; // the page holds the firms in state: the same array until the server sends others
      const { rerender } = render(<MapView markers={[pin('a', 'A')]} institutionPins={pins} onSelectStartup={noop} />);
      instLayerInstance.clearLayers.mockClear();
      rerender(<MapView markers={[pin('b', 'B', -37.81, 144.96)]} institutionPins={pins} onSelectStartup={noop} />);
      expect(instLayerInstance.clearLayers).not.toHaveBeenCalled();
    });
  });

  describe('the layers', () => {
    it('draws nothing of the companies while their layer is off, and the pins again when it is back on', () => {
      const markers = [pin('a', 'A'), pin('b', 'B', -37.81, 144.96)];
      const { rerender } = render(<MapView markers={markers} areas={[SYDNEY_GROUP]} onSelectStartup={noop} />);
      expect(L.marker).toHaveBeenCalledTimes(3); // two pins and a group
      layerInstance.clearLayers.mockClear();
      areaLayerInstance.clearLayers.mockClear();
      rerender(<MapView markers={markers} areas={[SYDNEY_GROUP]} showCompanies={false} onSelectStartup={noop} />);
      expect(layerInstance.clearLayers).toHaveBeenCalled();
      expect(areaLayerInstance.clearLayers).toHaveBeenCalled();
      expect(L.marker).toHaveBeenCalledTimes(3); // nothing was drawn while it was off
      rerender(<MapView markers={markers} areas={[SYDNEY_GROUP]} showCompanies onSelectStartup={noop} />);
      expect(L.marker).toHaveBeenCalledTimes(6); // the pins and the group, again
    });

    it('keeps the firms on while the companies are off', () => {
      const pins = [firm('blackbird', 'Blackbird')];
      const markers = [pin('a', 'A')];
      const { rerender } = render(<MapView markers={markers} institutionPins={pins} onSelectStartup={noop} />);
      rerender(<MapView markers={markers} institutionPins={pins} showCompanies={false} onSelectStartup={noop} />);
      expect(instLayerInstance.addTo).toHaveBeenCalled();
      expect(L.marker.mock.results.map((r) => r.value).filter((m) => m.opts.icon.opts.html?.classList?.contains('inst-pin'))).toHaveLength(1);
    });
  });

  describe('the basemap', () => {
    it('opens dark: the free tiles inverted, with no new tile layer made for it', () => {
      const { container } = render(<MapView markers={[]} onSelectStartup={noop} />);
      expect(container.querySelector('#map')).toHaveClass('osm-inverted');
      expect(container.querySelector('#map').dataset.basemap).toBe('dark');
      expect(L.tileLayer).toHaveBeenCalledTimes(1);
      expect(L.tileLayer.mock.calls[0][0]).toBe('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'); // no Mapbox token: the free tiles
    });

    it('opens light when asked: the same tiles as they are', () => {
      const { container } = render(<MapView markers={[]} basemap="light" onSelectStartup={noop} />);
      expect(container.querySelector('#map')).not.toHaveClass('osm-inverted');
      expect(container.querySelector('#map').dataset.basemap).toBe('light');
    });

    it('switches between them without making the map again', () => {
      const { container, rerender } = render(<MapView markers={[]} onSelectStartup={noop} />);
      rerender(<MapView markers={[]} basemap="light" onSelectStartup={noop} />);
      expect(container.querySelector('#map')).not.toHaveClass('osm-inverted');
      expect(container.querySelector('#map').dataset.basemap).toBe('light');
      rerender(<MapView markers={[]} basemap="dark" onSelectStartup={noop} />);
      expect(container.querySelector('#map')).toHaveClass('osm-inverted');
      expect(L.map).toHaveBeenCalledTimes(1);
      expect(L.tileLayer).toHaveBeenCalledTimes(1);
    });
  });});
