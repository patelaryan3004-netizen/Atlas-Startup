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
};
const tileLayerInstance = { addTo: vi.fn() };
const zoomControlInstance = { addTo: vi.fn() };
const layerInstance = { addTo: vi.fn(function () { return this; }), clearLayers: vi.fn(), removeLayer: vi.fn() };

vi.mock('leaflet', () => {
  const marker = vi.fn((latlng, opts) => ({ latlng, opts, bindTooltip: vi.fn(), on: vi.fn(), addTo: vi.fn() }));
  const popup = vi.fn(() => {
    const p = { setLatLng: vi.fn(() => p), setContent: vi.fn(() => p), openOn: vi.fn(() => p) };
    return p;
  });
  return {
    default: {
      map: vi.fn(() => mapInstance),
      tileLayer: vi.fn(() => tileLayerInstance),
      control: { zoom: vi.fn(() => zoomControlInstance) },
      layerGroup: vi.fn(() => layerInstance),
      marker,
      popup,
      divIcon: vi.fn((opts) => ({ opts })),
    },
  };
});

import L from 'leaflet';
import MapView from '../../src/components/MapView.jsx';

// [slug, name, lat, lng, sector, city, hiring, domain]
const pin = (slug, name, lat = -33.87, lng = 151.21, extra = {}) => [slug, name, lat, lng, extra.sector ?? 'AI', extra.city ?? 'Sydney', extra.hiring ?? 0, extra.domain ?? ''];
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

  it('initializes the map, tile layer, zoom control and a layer for pins once on mount', () => {
    render(<MapView markers={[]} sectorColors={{}} onSelectStartup={noop} />);
    expect(L.map).toHaveBeenCalledTimes(1);
    expect(L.tileLayer).toHaveBeenCalledTimes(1);
    expect(tileLayerInstance.addTo).toHaveBeenCalledWith(mapInstance);
    expect(zoomControlInstance.addTo).toHaveBeenCalledWith(mapInstance);
    expect(L.layerGroup).toHaveBeenCalledTimes(1);
    expect(layerInstance.addTo).toHaveBeenCalledWith(mapInstance);
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
});
