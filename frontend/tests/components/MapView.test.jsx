import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

const mapInstance = {
  setView: vi.fn(function () { return this; }),
  remove: vi.fn(),
};
const tileLayerInstance = { addTo: vi.fn() };
const zoomControlInstance = { addTo: vi.fn() };
const clusterInstance = {
  addTo: vi.fn(),
  addLayers: vi.fn(),
  clearLayers: vi.fn(),
};

vi.mock('leaflet.markercluster', () => ({}));

vi.mock('leaflet', () => {
  const marker = vi.fn(() => ({
    bindPopup: vi.fn(),
    bindTooltip: vi.fn(),
    addTo: vi.fn(),
  }));
  return {
    default: {
      map: vi.fn(() => mapInstance),
      tileLayer: vi.fn(() => tileLayerInstance),
      control: { zoom: vi.fn(() => zoomControlInstance) },
      marker,
      divIcon: vi.fn((opts) => ({ opts })),
      markerClusterGroup: vi.fn(() => clusterInstance),
    },
  };
});

import L from 'leaflet';
import MapView from '../../src/components/MapView.jsx';

function startup(overrides = {}) {
  return {
    name: 'Test Co',
    sector: 'AI',
    sectorFull: 'AI / Testing',
    city: 'Sydney',
    lat: -33.8,
    lng: 151.2,
    investors: ['Test VC'],
    stage: 'Seed',
    hiring: true,
    verified: true,
    website: 'https://example.com',
    blurb: 'A test startup',
    taskGate: { enabled: true, type: 'Coding task' },
    ...overrides,
  };
}

describe('MapView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  it('initializes the map, tile layer and cluster group once on mount', () => {
    render(<MapView startups={[]} sectorColors={{}} />);
    expect(L.map).toHaveBeenCalledTimes(1);
    expect(L.tileLayer).toHaveBeenCalledTimes(1);
    expect(tileLayerInstance.addTo).toHaveBeenCalledWith(mapInstance);
    expect(zoomControlInstance.addTo).toHaveBeenCalledWith(mapInstance);
    expect(L.markerClusterGroup).toHaveBeenCalledTimes(1);
    expect(clusterInstance.addTo).toHaveBeenCalledWith(mapInstance);
  });

  it('passes an iconCreateFunction that colors clusters by density', () => {
    render(<MapView startups={[]} sectorColors={{}} />);
    const { iconCreateFunction } = L.markerClusterGroup.mock.calls[0][0];
    expect(typeof iconCreateFunction).toBe('function');

    L.divIcon.mockClear();
    iconCreateFunction({ getChildCount: () => 5 });
    expect(L.divIcon.mock.calls.at(-1)[0].html).toContain('cluster-small');

    iconCreateFunction({ getChildCount: () => 25 });
    expect(L.divIcon.mock.calls.at(-1)[0].html).toContain('cluster-medium');

    iconCreateFunction({ getChildCount: () => 80 });
    expect(L.divIcon.mock.calls.at(-1)[0].html).toContain('cluster-large');
  });

  it('creates a marker only for verified startups and adds them to the cluster group', () => {
    const startups = [startup({ name: 'A', verified: true }), startup({ name: 'B', verified: false })];
    render(<MapView startups={startups} sectorColors={{ AI: '#123456' }} />);
    expect(L.marker).toHaveBeenCalledTimes(1);
    expect(L.marker).toHaveBeenCalledWith([startups[0].lat, startups[0].lng], expect.any(Object));
    expect(clusterInstance.addLayers).toHaveBeenCalledTimes(1);
    expect(clusterInstance.addLayers.mock.calls[0][0]).toHaveLength(1);
  });

  it('uses the sector color from sectorColors for the pin border', () => {
    const startups = [startup({ sector: 'AI' })];
    render(<MapView startups={startups} sectorColors={{ AI: '#abcdef' }} />);
    const iconOpts = L.divIcon.mock.calls.at(-1)[0];
    expect(iconOpts.html).toContain('#abcdef');
  });

  it('falls back to a default color when the sector has no mapped color', () => {
    const startups = [startup({ sector: 'Unmapped' })];
    render(<MapView startups={startups} sectorColors={{}} />);
    const iconOpts = L.divIcon.mock.calls.at(-1)[0];
    expect(iconOpts.html).toContain('#444');
  });

  it('renders a Clearbit logo img with a Google-favicon fallback when the startup has a website', () => {
    const startups = [startup({ website: 'https://www.canva.com' })];
    render(<MapView startups={startups} sectorColors={{}} />);
    const iconOpts = L.divIcon.mock.calls.at(-1)[0];
    expect(iconOpts.html).toContain('https://logo.clearbit.com/canva.com');
    expect(iconOpts.html).toContain('onerror=');
    expect(iconOpts.html).toContain('www.google.com/s2/favicons?domain=canva.com');
  });

  it('renders only the fallback initial when the startup has no website', () => {
    const startups = [startup({ name: 'Zeta', website: '' })];
    render(<MapView startups={startups} sectorColors={{}} />);
    const iconOpts = L.divIcon.mock.calls.at(-1)[0];
    expect(iconOpts.html).not.toContain('logo.clearbit.com');
    expect(iconOpts.html).toContain('>Z<');
  });

  it('builds a rich popup card with badges, facts, verify status and investor chips', () => {
    const startups = [startup({
      name: 'Acme AI', sector: 'AI', investors: ['Blackbird', 'AirTree'], address: '1 Test St, Sydney NSW 2000',
    })];
    render(<MapView startups={startups} sectorColors={{ AI: '#abcdef' }} />);

    const markerResult = L.marker.mock.results.at(-1).value;
    const [html, opts] = markerResult.bindPopup.mock.calls[0];

    expect(html).toContain('Acme AI');
    expect(html).toContain('pc-badge');
    expect(html).toContain('>AI<');
    expect(html).toContain('pc-investors');
    expect(html).toContain('Blackbird');
    expect(html).toContain('AirTree');
    expect(html).toContain('is-address');
    expect(html).toContain('Address on file');
    expect(opts).toMatchObject({ maxWidth: 280, className: 'pc-popup' });
  });

  it('shows a founders section with a real name and a LinkedIn-search link, never a guessed profile URL', () => {
    const startups = [startup({ name: 'Acme AI', founders: ['Jane Smith'] })];
    render(<MapView startups={startups} sectorColors={{}} />);
    const markerResult = L.marker.mock.results.at(-1).value;
    const [html] = markerResult.bindPopup.mock.calls[0];

    expect(html).toContain('pc-founders');
    expect(html).toContain('Jane Smith');
    expect(html).toContain('linkedin.com/search/results/people');
    expect(html).toContain(encodeURIComponent('Jane Smith Acme AI'));
    expect(html).not.toContain('linkedin.com/in/');
  });

  it('shows a founded-year line when foundedYear is present, omits it otherwise', () => {
    const withYear = [startup({ name: 'Old Co', foundedYear: 2012 })];
    const { unmount } = render(<MapView startups={withYear} sectorColors={{}} />);
    let html = L.marker.mock.results.at(-1).value.bindPopup.mock.calls[0][0];
    expect(html).toContain('Founded 2012');
    unmount();

    vi.clearAllMocks();
    const withoutYear = [startup({ name: 'New Co' })];
    render(<MapView startups={withoutYear} sectorColors={{}} />);
    html = L.marker.mock.results.at(-1).value.bindPopup.mock.calls[0][0];
    expect(html).not.toContain('Founded');
  });

  it('omits the founders section entirely when no founders are on file (never invents one)', () => {
    const startups = [startup({ founders: undefined })];
    render(<MapView startups={startups} sectorColors={{}} />);
    const markerResult = L.marker.mock.results.at(-1).value;
    const [html] = markerResult.bindPopup.mock.calls[0];
    expect(html).not.toContain('pc-founders');
  });

  it('shows the approximate-location note in the popup when no address is on file', () => {
    const startups = [startup({ address: undefined })];
    render(<MapView startups={startups} sectorColors={{}} />);
    const markerResult = L.marker.mock.results.at(-1).value;
    const [html] = markerResult.bindPopup.mock.calls[0];
    expect(html).toContain('is-approx');
    expect(html).toContain('Location approximate');
  });

  it('clears previous cluster layers before rendering a new set when startups change', () => {
    const first = [startup({ name: 'A' })];
    const second = [startup({ name: 'B' }), startup({ name: 'C' })];
    const { rerender } = render(<MapView startups={first} sectorColors={{}} />);
    expect(L.marker).toHaveBeenCalledTimes(1);

    rerender(<MapView startups={second} sectorColors={{}} />);
    expect(clusterInstance.clearLayers).toHaveBeenCalledTimes(2);
    expect(L.marker).toHaveBeenCalledTimes(3);
    expect(clusterInstance.addLayers.mock.calls.at(-1)[0]).toHaveLength(2);
  });

  it('removes the map on unmount', () => {
    const { unmount } = render(<MapView startups={[]} sectorColors={{}} />);
    unmount();
    expect(mapInstance.remove).toHaveBeenCalledTimes(1);
  });

  it('renders a Suggest an edit button carrying the company name in a data attribute, not inline JS', () => {
    const startups = [startup({ name: 'Acme AI' })];
    render(<MapView startups={startups} sectorColors={{}} />);
    const markerResult = L.marker.mock.results.at(-1).value;
    const [html] = markerResult.bindPopup.mock.calls[0];

    expect(html).toContain('pc-suggest-edit');
    expect(html).toContain('data-name="Acme AI"');
    expect(html).toContain('this.dataset.name');
    expect(html).not.toContain('__auMapSuggestEdit("Acme AI")');
  });

  it('HTML-escapes quotes and ampersands in the company name so the attribute cannot be broken out of', () => {
    const startups = [startup({ name: 'Tom & Jerry "Co"' })];
    render(<MapView startups={startups} sectorColors={{}} />);
    const markerResult = L.marker.mock.results.at(-1).value;
    const [html] = markerResult.bindPopup.mock.calls[0];

    expect(html).toContain('data-name="Tom &amp; Jerry &quot;Co&quot;"');
  });

  it('wires window.__auMapSuggestEdit to the onSuggestEdit prop and cleans it up on unmount', () => {
    const onSuggestEdit = vi.fn();
    const { unmount } = render(<MapView startups={[]} sectorColors={{}} onSuggestEdit={onSuggestEdit} />);

    expect(window.__auMapSuggestEdit).toBe(onSuggestEdit);
    window.__auMapSuggestEdit('Acme AI');
    expect(onSuggestEdit).toHaveBeenCalledWith('Acme AI');

    unmount();
    expect(window.__auMapSuggestEdit).toBeUndefined();
  });
});
