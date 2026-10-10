import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

const handlers = {};
const bounds = { getWest: () => 110, getEast: () => 156, getSouth: () => -45, getNorth: () => -9 };
const mapInstance = {
  setView: vi.fn(function () { return this; }),
  remove: vi.fn(),
  on: vi.fn((event, fn) => { handlers[event] = fn; }),
  getZoom: vi.fn(() => 17),
  getBounds: vi.fn(() => bounds),
  latLngToContainerPoint: vi.fn(([lat, lng]) => ({ x: (lng - 150) * 2000, y: (-33 - lat) * 2000 })),
  createPane: vi.fn(() => ({ style: {} })),
};
const tileLayerInstance = { addTo: vi.fn() };
const zoomControlInstance = { addTo: vi.fn() };
// Two layer groups are made each time the map is: the groups (cities and states) first, the pins second.
const areaLayerInstance = { addTo: vi.fn(function () { return this; }), clearLayers: vi.fn(), removeLayer: vi.fn() };
const layerInstance = { addTo: vi.fn(function () { return this; }), clearLayers: vi.fn(), removeLayer: vi.fn() };

vi.mock('leaflet', () => {
  const marker = vi.fn((latlng, opts) => ({ latlng, opts, bindTooltip: vi.fn(), on: vi.fn(), addTo: vi.fn() }));
  const popup = vi.fn(() => {
    const p = { setLatLng: vi.fn(() => p), setContent: vi.fn(() => p), openOn: vi.fn(() => p) };
    return p;
  });
  const layerGroup = vi.fn(() => (layerGroup.mock.calls.length % 2 === 1 ? areaLayerInstance : layerInstance));
  return {
    default: {
      map: vi.fn(() => mapInstance),
      tileLayer: vi.fn(() => tileLayerInstance),
      control: { zoom: vi.fn(() => zoomControlInstance) },
      layerGroup,
      marker,
      popup,
      divIcon: vi.fn((opts) => ({ opts })),
    },
  };
});

import L from 'leaflet';
import MapView from '../../src/components/MapView.jsx';

// [slug, name, lat, lng, sector, city, hiring, domain] and, from a server that says how well a place is known, [precision, place, checked]
const pin = (slug, name, lat = -33.87, lng = 151.21, extra = {}) => [slug, name, lat, lng, extra.sector ?? 'AI', extra.city ?? 'Sydney', extra.hiring ?? 0, extra.domain ?? '',
  ...(extra.precision ? [extra.precision, extra.place ?? '', extra.checked ?? 0] : [])];
const SYDNEY_GROUP = { kind: 'CITY', key: 'CITY|Sydney|NSW', label: 'Sydney', city: 'Sydney', state: 'NSW', lat: -33.8688, lng: 151.2093, count: 42, sample: [{ slug: 'trace', name: 'Trace' }, { slug: 'truestate', name: 'TrueState' }] };
const noop = () => {};
const colourOf = (hex) => { const probe = document.createElement('div'); probe.style.borderColor = hex; return probe.style.borderColor; };
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
    mapInstance.getZoom.mockReturnValue(17);
    frames = new Map();
    frameCount = 0;
    vi.stubGlobal('requestAnimationFrame', (fn) => { frameCount += 1; frames.set(frameCount, fn); return frameCount; });
    vi.stubGlobal('cancelAnimationFrame', (id) => { frames.delete(id); });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('initializes the map, tile layer, zoom control, a layer for pins and a pane and layer for groups once on mount', () => {
    render(<MapView markers={[]} sectorColors={{}} onSelectStartup={noop} />);
    expect(L.map).toHaveBeenCalledTimes(1);
    expect(L.tileLayer).toHaveBeenCalledTimes(1);
    expect(tileLayerInstance.addTo).toHaveBeenCalledWith(mapInstance);
    expect(zoomControlInstance.addTo).toHaveBeenCalledWith(mapInstance);
    expect(L.layerGroup).toHaveBeenCalledTimes(2); // the groups of cities, and the pins
    expect(layerInstance.addTo).toHaveBeenCalledWith(mapInstance);
    expect(areaLayerInstance.addTo).toHaveBeenCalledWith(mapInstance);
    expect(mapInstance.createPane).toHaveBeenCalledWith('areas');
    expect(mapInstance.on).toHaveBeenCalledWith('moveend', expect.any(Function));
  });

  it('puts a pin on the map for each company in view when zoomed in', () => {
    render(<MapView markers={[pin('a', 'A'), pin('b', 'B', -37.81, 144.96)]} sectorColors={{}} onSelectStartup={noop} />);
    expect(L.marker).toHaveBeenCalledTimes(2);
    expect(L.marker).toHaveBeenCalledWith([-33.87, 151.21], expect.any(Object));
    expect(L.marker).toHaveBeenCalledWith([-37.81, 144.96], expect.any(Object));
    expect(lastMarker().addTo).toHaveBeenCalledWith(layerInstance);
  });

  it('builds each pin as elements, with the sector colour on its border and its initial inside', () => {
    render(<MapView markers={[pin('a', 'Acme', -33.87, 151.21, { sector: 'AI' })]} sectorColors={{ AI: '#abcdef' }} onSelectStartup={noop} />);
    const { html, className } = icons().at(-1);
    expect(className).toBe('custom-leaflet-marker');
    expect(html).toBeInstanceOf(HTMLElement);
    expect(html.style.borderColor).toBe(colourOf('#abcdef'));
    expect(html.querySelector('.pin-fallback').textContent).toBe('A');
    expect(html.querySelector('.pin-fallback').style.background).toBe(colourOf('#abcdef'));
  });

  it('falls back to a default colour when the sector has no mapped colour', () => {
    render(<MapView markers={[pin('a', 'A', -33.87, 151.21, { sector: 'Unmapped' })]} sectorColors={{}} onSelectStartup={noop} />);
    expect(icons().at(-1).html.style.borderColor).toBe(colourOf('#444'));
  });

  it('renders a Clearbit logo with a Google-favicon fallback, and hides it if that fails too, when the company has a website and the map is zoomed in', () => {
    render(<MapView markers={[pin('a', 'A', -33.87, 151.21, { domain: 'canva.com' })]} sectorColors={{}} onSelectStartup={noop} />);
    const img = icons().at(-1).html.querySelector('img');
    expect(img.src).toContain('https://logo.clearbit.com/canva.com');
    img.onerror();
    expect(img.src).toContain('www.google.com/s2/favicons?domain=canva.com');
    img.onerror();
    expect(img.style.display).toBe('none');
  });

  it('draws no logo when the company has no website', () => {
    render(<MapView markers={[pin('z', 'Zeta')]} sectorColors={{}} onSelectStartup={noop} />);
    const { html } = icons().at(-1);
    expect(html.querySelector('img')).toBeNull();
    expect(html.textContent).toContain('Z');
  });

  it('draws no logos when zoomed out, or when too many pins are on screen, so the page does not fetch hundreds of images', () => {
    mapInstance.getZoom.mockReturnValue(12);
    render(<MapView markers={[pin('a', 'A', -33.87, 151.21, { domain: 'canva.com' })]} sectorColors={{}} onSelectStartup={noop} />);
    expect(icons().at(-1).html.querySelector('img')).toBeNull();
    cleanup();
    vi.clearAllMocks();

    mapInstance.getZoom.mockReturnValue(13);
    const few = Array.from({ length: 10 }, (_, i) => pin(`p${i}`, `P${i}`, -33.8 + i * 0.02, 151.2, { domain: `p${i}.com` }));
    render(<MapView markers={few} sectorColors={{}} onSelectStartup={noop} />);
    expect(icons().every((i) => i.html.querySelector('img'))).toBe(true);
    cleanup();
    vi.clearAllMocks();

    const many = Array.from({ length: 61 }, (_, i) => pin(`p${i}`, `P${i}`, -33.0 + i * 0.02, 151.2, { domain: `p${i}.com` }));
    render(<MapView markers={many} sectorColors={{}} onSelectStartup={noop} />);
    flushFrames();
    expect(icons()).toHaveLength(61);
    expect(icons().some((i) => i.html.querySelector('img'))).toBe(false);
  });

  it('marks a hiring company with a hiring-dot badge, and omits it when not hiring', () => {
    render(<MapView markers={[pin('a', 'A', -33.87, 151.21, { hiring: 1 }), pin('b', 'B', -37.81, 144.96, { hiring: 0 })]} sectorColors={{}} onSelectStartup={noop} />);
    const [a, b] = icons().map((i) => i.html);
    expect(a.querySelector('.pin-hiring-dot')).not.toBeNull();
    expect(b.querySelector('.pin-hiring-dot')).toBeNull();
  });

  it('marks the selected company with a selected class, and no other', () => {
    render(<MapView markers={[pin('a', 'A'), pin('b', 'B', -37.81, 144.96)]} sectorColors={{}} onSelectStartup={noop} selectedName="B" />);
    const [a, b] = icons().map((i) => i.html);
    expect(a.classList.contains('pin-selected')).toBe(false);
    expect(b.classList.contains('pin-selected')).toBe(true);
  });

  it('marks a tracked company with a star, and omits it for the others', () => {
    render(<MapView markers={[pin('a', 'A'), pin('b', 'B', -37.81, 144.96)]} sectorColors={{}} onSelectStartup={noop} trackedNames={new Set(['A'])} />);
    const [a, b] = icons().map((i) => i.html);
    expect(a.querySelector('.pin-tracked-star')).not.toBeNull();
    expect(b.querySelector('.pin-tracked-star')).toBeNull();
  });

  it('calls onSelectStartup with what the pin knows when a pin is clicked', () => {
    const onSelectStartup = vi.fn();
    render(<MapView markers={[pin('acme-ai', 'Acme AI', -33.87, 151.21, { sector: 'AI', city: 'Sydney', hiring: 1, domain: 'acme.ai' })]} sectorColors={{}} onSelectStartup={onSelectStartup} />);
    const [event, handler] = lastMarker().on.mock.calls[0];
    expect(event).toBe('click');
    handler();
    expect(onSelectStartup).toHaveBeenCalledWith({ slug: 'acme-ai', name: 'Acme AI', lat: -33.87, lng: 151.21, sector: 'AI', city: 'Sydney', hiring: true, verified: true, website: 'https://acme.ai' });
  });

  it('does not fail when a pin is clicked and nobody is listening (the landing page map)', () => {
    render(<MapView markers={[pin('a', 'A')]} sectorColors={{}} />);
    expect(() => lastMarker().on.mock.calls[0][1]()).not.toThrow();
  });

  it('binds a lightweight hover tooltip with name, sector and city, built as text and never as HTML', () => {
    const evil = '<img src=x onerror=alert(1)>';
    render(<MapView markers={[pin('a', evil, -33.87, 151.21, { sector: 'AI', city: 'Sydney' })]} sectorColors={{}} onSelectStartup={noop} />);
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
      render(<MapView markers={near} sectorColors={{}} onSelectStartup={noop} />);
      expect(L.marker).toHaveBeenCalledTimes(2);
      const cluster = icons().find((i) => i.className === 'marker-cluster-custom');
      expect(cluster.html.className).toBe('marker-cluster-inner cluster-small');
      expect(cluster.html.textContent).toBe('2');
      expect(cluster.iconSize).toEqual([40, 40]);
    });

    it('zooms in on a cluster when it is clicked', () => {
      mapInstance.getZoom.mockReturnValue(5);
      render(<MapView markers={near} sectorColors={{}} onSelectStartup={noop} />);
      const clusterMarker = L.marker.mock.results.map((r) => r.value).find((m) => m.opts.icon.opts.className === 'marker-cluster-custom');
      clusterMarker.on.mock.calls[0][1]();
      const [latlng, zoom] = mapInstance.setView.mock.calls.at(-1);
      expect(latlng[0]).toBeCloseTo(-33.868, 2);
      expect(zoom).toBeGreaterThan(5);
    });

    it('sizes a cluster by how many companies it holds', () => {
      mapInstance.getZoom.mockReturnValue(3);
      const crowd = Array.from({ length: 60 }, (_, i) => pin(`p${i}`, `P${i}`, -33.87 + (i % 10) * 0.001, 151.2 + Math.floor(i / 10) * 0.001));
      render(<MapView markers={crowd} sectorColors={{}} onSelectStartup={noop} />);
      expect(icons().find((i) => i.className === 'marker-cluster-custom').html.className).toContain('cluster-large');
    });

    it('draws only what is in view: a handful of elements however many companies there are', () => {
      mapInstance.getZoom.mockReturnValue(5);
      const thousands = Array.from({ length: 5000 }, (_, i) => pin(`p${i}`, `P${i}`, -33.7 - ((i * 7919) % 1000) / 5000, 151 + ((i * 104729) % 1000) / 4000));
      render(<MapView markers={thousands} sectorColors={{}} onSelectStartup={noop} />);
      flushFrames();
      expect(L.marker.mock.calls.length).toBeLessThan(40);
    });
  });

  describe('a crowded view', () => {
    it('makes the first few pins at once and the rest over the next frames, so a slow phone keeps answering touches', () => {
      render(<MapView markers={spread(60)} sectorColors={{}} onSelectStartup={noop} />);
      expect(L.marker).toHaveBeenCalledTimes(12); // the first batch, in the same frame as the move
      expect(frames.size).toBe(1); // and the rest is waiting for a frame
      flushFrames();
      expect(L.marker).toHaveBeenCalledTimes(60);
      expect(new Set(L.marker.mock.calls.map((c) => c[0][0])).size).toBe(60); // each pin once
    });

    it('makes a view of a dozen or fewer in one go, with no frame waiting', () => {
      render(<MapView markers={spread(12)} sectorColors={{}} onSelectStartup={noop} />);
      expect(L.marker).toHaveBeenCalledTimes(12);
      expect(frames.size).toBe(0);
    });

    it('makes bigger batches while they are quick and smaller ones while they are slow', () => {
      let clock = 0;
      vi.spyOn(performance, 'now').mockImplementation(() => { clock += 1; return clock; }); // every batch takes 1 ms
      render(<MapView markers={spread(150)} sectorColors={{}} onSelectStartup={noop} />);
      flushFrames();
      const quickFrames = frameCount;
      expect(L.marker).toHaveBeenCalledTimes(150);
      expect(quickFrames).toBeLessThanOrEqual(4); // 12, 24, 48, 96

      cleanup();
      vi.clearAllMocks();
      frames = new Map();
      frameCount = 0;
      vi.spyOn(performance, 'now').mockImplementation(() => { clock += 50; return clock; }); // every batch takes 50 ms
      render(<MapView markers={spread(150)} sectorColors={{}} onSelectStartup={noop} />);
      flushFrames();
      expect(L.marker).toHaveBeenCalledTimes(150);
      expect(frameCount).toBeGreaterThan(quickFrames * 5); // 12, 6, 4, 4, ...
    });

    it('drops what was still waiting when the map moves on: a newer view replaces the last one\'s leftovers', () => {
      render(<MapView markers={spread(60)} sectorColors={{}} onSelectStartup={noop} />);
      expect(frames.size).toBe(1);
      mapInstance.getZoom.mockReturnValue(5);
      handlers.moveend();
      flushFrames();
      expect(L.marker.mock.calls.length).toBeLessThan(25); // the 12 already made, and the few clusters of the new view; not 60 more
    });

    it('stops making pins when the map is taken away', () => {
      const { unmount } = render(<MapView markers={spread(60)} sectorColors={{}} onSelectStartup={noop} />);
      unmount();
      expect(frames.size).toBe(0);
      flushFrames();
      expect(L.marker).toHaveBeenCalledTimes(12);
    });

    it('never makes the same pin twice when the view is redrawn while pins are still waiting', () => {
      render(<MapView markers={spread(60)} sectorColors={{}} onSelectStartup={noop} />);
      handlers.moveend(); // the same view again
      flushFrames();
      expect(L.marker).toHaveBeenCalledTimes(60);
    });
  });

  it('lists companies that sit at one place when they are clicked, and opens the one that is picked', () => {
    const onSelectStartup = vi.fn();
    render(<MapView markers={[pin('x', 'X Co'), pin('y', 'Y Co'), pin('far', 'Far Co', -37.81, 144.96)]} sectorColors={{}} onSelectStartup={onSelectStartup} />);
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
    render(<MapView markers={[pin('a', 'A', -33.8688, 151.2093), pin('b', 'B', -33.8679, 151.2093)]} sectorColors={{}} onSelectStartup={noop} />);
    expect(L.marker).toHaveBeenCalledTimes(2); // two pins at the deepest zoom
    mapInstance.getZoom.mockReturnValue(5);
    handlers.moveend();
    expect(L.marker).toHaveBeenCalledTimes(3); // now one cluster of the two
    expect(layerInstance.removeLayer).toHaveBeenCalledTimes(2);
  });

  it('starts from nothing when the companies change (a filter), because a cluster\'s number belongs to the grouping that made it', () => {
    const { rerender } = render(<MapView markers={[pin('a', 'A')]} sectorColors={{}} onSelectStartup={noop} />);
    expect(L.marker).toHaveBeenCalledTimes(1);
    layerInstance.clearLayers.mockClear();
    rerender(<MapView markers={[pin('b', 'B', -37.81, 144.96), pin('c', 'C', -27.47, 153.02)]} sectorColors={{}} onSelectStartup={noop} />);
    expect(layerInstance.clearLayers).toHaveBeenCalledTimes(1);
    expect(L.marker).toHaveBeenCalledTimes(3);
  });

  it('rebuilds only the pins whose look changed when a company is selected', () => {
    const markers = [pin('a', 'A'), pin('b', 'B', -37.81, 144.96), pin('c', 'C', -27.47, 153.02)];
    const { rerender } = render(<MapView markers={markers} sectorColors={{}} onSelectStartup={noop} />);
    expect(L.marker).toHaveBeenCalledTimes(3);
    rerender(<MapView markers={markers} sectorColors={{}} onSelectStartup={noop} selectedName="B" />);
    expect(L.marker).toHaveBeenCalledTimes(4);
    expect(layerInstance.removeLayer).toHaveBeenCalledTimes(1);
    expect(icons().at(-1).html.classList.contains('pin-selected')).toBe(true);
  });

  it('removes the map on unmount', () => {
    const { unmount } = render(<MapView markers={[]} sectorColors={{}} onSelectStartup={noop} />);
    unmount();
    expect(mapInstance.remove).toHaveBeenCalledTimes(1);
  });

  describe('how well a place is known', () => {
    it('draws a suburb\'s pin as approximate, and an office\'s as it always was', () => {
      render(<MapView markers={[pin('a', 'A', -33.87, 151.21, { precision: 'SUBURB', place: 'Surry Hills, Sydney' }), pin('b', 'B', -37.81, 144.96, { precision: 'EXACT', place: '1 William Street, Melbourne', checked: 1 })]} sectorColors={{}} onSelectStartup={noop} />);
      const [suburb, office] = icons().map((i) => i.html);
      expect(suburb.classList.contains('pin-approx')).toBe(true);
      expect(office.classList.contains('pin-approx')).toBe(false);
    });

    it('says in the tooltip the name, where, and how well that is known', () => {
      render(<MapView markers={[pin('a', 'Example Startup', -37.81, 144.96, { precision: 'EXACT', place: '123 Example Street, Melbourne', checked: 1 })]} sectorColors={{}} onSelectStartup={noop} />);
      const [content] = lastMarker().bindTooltip.mock.calls[0];
      expect([...content.children].map((c) => c.textContent)).toEqual(['Example Startup', '123 Example Street, Melbourne', 'Verified office']);
      expect(content.querySelector('.tip-quality').className).toContain('tip-exact');
    });

    it('does not call an address that was only on file verified, and calls a suburb suburb-level', () => {
      render(<MapView markers={[pin('a', 'A', -33.87, 151.21, { precision: 'EXACT', place: '1 George Street, Sydney', checked: 0 }), pin('b', 'B', -37.81, 144.96, { precision: 'SUBURB', place: 'Richmond, Melbourne' })]} sectorColors={{}} onSelectStartup={noop} />);
      const words = L.marker.mock.results.map((r) => r.value.bindTooltip.mock.calls[0][0].querySelector('.tip-quality').textContent);
      expect(words).toEqual(['Office address on file', 'Location: suburb-level']);
    });

    it('builds the tooltip as text, whatever the company or the place is called', () => {
      const evil = '<img src=x onerror=alert(1)>';
      render(<MapView markers={[pin('a', evil, -37.81, 144.96, { precision: 'EXACT', place: evil })]} sectorColors={{}} onSelectStartup={noop} />);
      const [content] = lastMarker().bindTooltip.mock.calls[0];
      expect(content.querySelector('img')).toBeNull();
      expect(content.textContent).toContain(evil);
    });

    it('opens a company from its pin with how well its place is known already in hand', () => {
      const onSelectStartup = vi.fn();
      render(<MapView markers={[pin('acme', 'Acme', -33.88, 151.21, { precision: 'SUBURB', place: 'Surry Hills, Sydney' })]} sectorColors={{}} onSelectStartup={onSelectStartup} />);
      lastMarker().on.mock.calls[0][1]();
      expect(onSelectStartup).toHaveBeenCalledWith(expect.objectContaining({ slug: 'acme', location_precision: 'SUBURB', location: { precision: 'SUBURB', place: 'Surry Hills, Sydney', quality: 'Location: suburb-level' } }));
    });
  });

  describe('companies known only to a city or a state', () => {
    const groupMarker = () => L.marker.mock.results.map((r) => r.value).find((m) => m.opts.pane === 'areas');

    it('draws a group as a ring and a label in a pane under the pins, never as a pin, and says what it is', () => {
      render(<MapView markers={[]} areas={[SYDNEY_GROUP]} sectorColors={{}} onSelectStartup={noop} />);
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
      render(<MapView markers={[]} areas={[{ kind: 'STATE', label: 'Victoria', city: null, state: 'VIC', lat: -36.9, lng: 144.3, count: 1, sample: [] }]} sectorColors={{}} onSelectStartup={noop} />);
      expect(icons().at(-1).html.className).toContain('area-state');
      expect(groupMarker().opts.title).toBe('Victoria — 1 startup with a state-level location');
    });

    it('is drawn alongside the pins without disturbing them', () => {
      render(<MapView markers={[pin('a', 'A'), pin('b', 'B', -37.81, 144.96)]} areas={[SYDNEY_GROUP]} sectorColors={{}} onSelectStartup={noop} />);
      expect(L.marker).toHaveBeenCalledTimes(3);
      expect(L.marker.mock.calls.filter((c) => c[1].pane === 'areas')).toHaveLength(1);
      expect(layerInstance.clearLayers).toHaveBeenCalledTimes(1); // the pins' own start-from-nothing, and only that
    });

    it('builds the label as text, whatever the place is called', () => {
      const evil = '<img src=x onerror=alert(1)>';
      render(<MapView markers={[]} areas={[{ ...SYDNEY_GROUP, label: evil }]} sectorColors={{}} onSelectStartup={noop} />);
      const { html } = icons().at(-1);
      expect(html.querySelector('img')).toBeNull();
      expect(html.querySelector('b').textContent).toBe(evil);
    });

    it('lists a few of its companies when it is clicked, and opens the one that is picked', () => {
      const onSelectStartup = vi.fn();
      render(<MapView markers={[]} areas={[SYDNEY_GROUP]} sectorColors={{}} onSelectStartup={onSelectStartup} onViewArea={vi.fn()} />);
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
      render(<MapView markers={[]} areas={[SYDNEY_GROUP]} sectorColors={{}} onSelectStartup={noop} onViewArea={onViewArea} />);
      groupMarker().on.mock.calls[0][1]();
      const box = L.popup.mock.results.at(-1).value.setContent.mock.calls[0][0];
      const all = box.querySelector('.area-viewall');
      expect(all.textContent).toBe('View all 42 in the list');
      all.click();
      expect(onViewArea).toHaveBeenCalledWith(SYDNEY_GROUP);
    });

    it('does nothing when clicked on a page that listens to nothing (the landing page map): it is a label to hover', () => {
      render(<MapView markers={[]} areas={[SYDNEY_GROUP]} sectorColors={{}} />);
      expect(() => groupMarker().on.mock.calls[0][1]()).not.toThrow();
      expect(L.popup).not.toHaveBeenCalled();
    });

    it('is drawn again only when the groups change, not when the pins do', () => {
      const groups = [SYDNEY_GROUP]; // the page holds its groups in state: the same array until the server sends others
      const { rerender } = render(<MapView markers={[pin('a', 'A')]} areas={groups} sectorColors={{}} onSelectStartup={noop} />);
      areaLayerInstance.clearLayers.mockClear();
      rerender(<MapView markers={[pin('b', 'B', -37.81, 144.96)]} areas={groups} sectorColors={{}} onSelectStartup={noop} />);
      expect(areaLayerInstance.clearLayers).not.toHaveBeenCalled();
      rerender(<MapView markers={[pin('b', 'B', -37.81, 144.96)]} areas={[{ ...SYDNEY_GROUP, count: 5 }]} sectorColors={{}} onSelectStartup={noop} />);
      expect(areaLayerInstance.clearLayers).toHaveBeenCalledTimes(1);
      expect(L.marker.mock.calls.filter((c) => c[1].pane === 'areas')).toHaveLength(2);
    });

    it('draws no group when there are none', () => {
      render(<MapView markers={[pin('a', 'A')]} sectorColors={{}} onSelectStartup={noop} />);
      expect(L.marker.mock.calls.filter((c) => c[1].pane === 'areas')).toHaveLength(0);
    });
  });
  // The name under a pin: from zoom 7 (9 on a phone), and only where it fits. latLngToContainerPoint is the test's own: 0.01
  // degree is 20 pixels, so two pins 0.015 degree of longitude apart are 30 pixels apart.
  describe('the name under a pin', () => {
    const namesOn = () => icons().map((i) => i.html).filter(Boolean).filter((h) => h.querySelector?.('.pin-label')).map((h) => [h.querySelector('.pin-label').textContent, h.querySelector('.pin-label').classList.contains('pin-label-on')]);
    const close = (a = {}, b = {}) => [pin('a', 'Alpha', -33.0, 150.0, a), pin('b', 'Beta', -33.0, 150.015, b)]; // 30px apart: their names would run together
    const mapEl = (container) => container.querySelector('#map');

    it('is built as text, with the name only, hidden from screen readers', () => {
      render(<MapView markers={[pin('a', '<img src=x onerror=alert(1)>')]} sectorColors={{}} onSelectStartup={noop} />);
      const html = icons().at(-1).html;
      const label = html.querySelector('.pin-label');
      expect(label.textContent).toBe('<img src=x onerror=alert(1)>');
      expect(label.querySelector('img')).toBeNull();
      expect(label.getAttribute('aria-hidden')).toBe('true');
    });

    it('is written under a pin from zoom 7, and the map is circles only below it', () => {
      mapInstance.getZoom.mockReturnValue(7);
      const { container } = render(<MapView markers={[pin('a', 'Alpha')]} sectorColors={{}} onSelectStartup={noop} />);
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
      const { container } = render(<MapView markers={[pin('a', 'Alpha')]} sectorColors={{}} onSelectStartup={noop} />);
      flushFrames();
      expect(mapEl(container)).not.toHaveClass('show-pin-labels');
      mapInstance.getZoom.mockReturnValue(9);
      handlers.moveend();
      flushFrames();
      expect(mapEl(container)).toHaveClass('show-pin-labels');
      expect(window.matchMedia).toHaveBeenCalledWith('(max-width: 639px)');
    });

    it('names the company that is hiring, and not the one beside it that would run into it', () => {
      render(<MapView markers={close({}, { hiring: 1 })} sectorColors={{}} onSelectStartup={noop} />);
      flushFrames();
      expect(namesOn()).toEqual([['Alpha', false], ['Beta', true]]);
    });

    it('names the open company before one that is hiring', () => {
      render(<MapView markers={close({}, { hiring: 1 })} sectorColors={{}} onSelectStartup={noop} selectedName="Alpha" />);
      flushFrames();
      expect(namesOn().filter(([, on]) => on).map(([name]) => name)).toEqual(['Alpha']);
    });

    it('names every company that has room', () => {
      render(<MapView markers={[pin('a', 'Alpha', -33.0, 150.0), pin('b', 'Beta', -33.0, 150.2)]} sectorColors={{}} onSelectStartup={noop} />);
      flushFrames();
      expect(namesOn()).toEqual([['Alpha', true], ['Beta', true]]);
    });

    it('writes no name where a cluster is, and writes it once the cluster is clear of the pin', () => {
      const stackAt = (lat) => [pin('s1', 'S1', lat, 150.0), pin('s2', 'S2', lat, 150.0)]; // two companies at one place: drawn as a "2"
      // 20px under the pin, where its name would go
      const { rerender } = render(<MapView markers={[pin('a', 'Alpha', -33.0, 150.0), ...stackAt(-33.01)]} sectorColors={{}} onSelectStartup={noop} />);
      flushFrames();
      expect(namesOn()).toEqual([['Alpha', false]]);
      // 100px under it: room for the name
      rerender(<MapView markers={[pin('a', 'Alpha', -33.0, 150.0), ...stackAt(-33.05)]} sectorColors={{}} onSelectStartup={noop} />);
      flushFrames();
      expect(namesOn().at(-1)).toEqual(['Alpha', true]);
    });

    it('works out again which names fit when the map moves, and when the companies change', () => {
      const { rerender } = render(<MapView markers={close({}, { hiring: 1 })} sectorColors={{}} onSelectStartup={noop} />);
      flushFrames();
      expect(namesOn()).toEqual([['Alpha', false], ['Beta', true]]);
      // a filter leaves only Alpha: a new set of pins, and now it has room
      rerender(<MapView markers={[pin('a', 'Alpha', -33.0, 150.0)]} sectorColors={{}} onSelectStartup={noop} />);
      flushFrames();
      expect(namesOn().at(-1)).toEqual(['Alpha', true]);
    });
  });
});
