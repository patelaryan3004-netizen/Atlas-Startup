// Shared scaffolding for the location tests: companies with and without addresses, a dataset, and a scripted
// Nominatim, so no test touches the network or waits a second between requests.
import { migrateDataset } from '../../src/models/dataset.js';

export const NOW = Date.parse('2026-10-05T04:00:00.000Z');
export const ISO = '2026-10-05T04:00:00.000Z';

export const co = (name, over = {}) => ({
  name, sector: 'AI', sectorFull: 'AI', city: 'Sydney', lat: null, lng: null, investors: [], stage: 'Seed', hiring: false, verified: true,
  website: '', blurb: 'A company.', taskGate: { enabled: false }, ...over,
});

export const dataset = (companies, extra = {}) => migrateDataset({
  companies, people: [], investors: [], sources: [], evidence: [], funding_rounds: [], jobs: [], news: [], ...extra,
});

export const source = (id, kind = 'company_website', url = `https://${id}.example/contact`) => ({ id, kind, url, title: id, publisher: null, retrieved_at: ISO, note: '' });
export const evidenceRow = (company_id, field, value, source_id, over = {}) => ({
  id: `${company_id}.${field}.${source_id}`, company_id, field, value, source_id, confidence: 'medium', verified_at: ISO, status: 'active', note: null, ...over,
});

// The addresses most of the tests use, and where OpenStreetMap puts them.
export const KIPPAX = '110 Kippax Street, Surry Hills, Sydney NSW 2010';
export const KIPPAX_QUERY = '110 Kippax Street, Surry Hills, NSW, 2010, Australia';
export const KIPPAX_POINT = { lat: -33.88437, lng: 151.20963 };
export const WILLIAM = 'Level 7, 15 William Street, Melbourne VIC 3000';
export const WILLIAM_QUERY = '15 William Street, Melbourne, VIC, 3000, Australia';
export const WILLIAM_POINT = { lat: -37.81715, lng: 144.95621 };

// One row as Nominatim answers it (format=jsonv2, addressdetails=1).
export const osm = ({ lat, lng }, address = {}, over = {}) => ({
  lat: String(lat), lon: String(lng), display_name: 'somewhere, Australia', category: 'building', type: 'yes', addresstype: 'building', importance: 0.3, osm_type: 'way', osm_id: 1,
  boundingbox: ['-33.9', '-33.8', '151.2', '151.3'], address: { country_code: 'au', ...address }, ...over,
});
export const osmHouse = (point, address = {}) => osm(point, { house_number: '110', road: 'Kippax Street', suburb: 'Surry Hills', city: 'Sydney', state: 'New South Wales', postcode: '2010', ...address });
export const osmSuburb = (point, address = {}, over = {}) => osm(point, { suburb: 'Surry Hills', city: 'Sydney', state: 'New South Wales', postcode: '2010', ...address }, { category: 'boundary', type: 'administrative', addresstype: 'suburb', ...over });

// A scripted Nominatim: the text asked -> the rows it answers (an array), an HTTP status (a number), or an Error. Anything
// not scripted is "no results". `calls` records what was asked and who asked.
export function nominatim(script = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const q = u.searchParams.get('q');
    calls.push({ q, url: String(url), userAgent: init.headers?.['User-Agent'], countrycodes: u.searchParams.get('countrycodes') });
    const hit = script[q];
    if (hit instanceof Error) throw hit;
    if (typeof hit === 'number') return new Response('', { status: hit, headers: hit === 429 ? { 'retry-after': '60' } : {} });
    if (typeof hit === 'string') return new Response(hit, { status: 200, headers: { 'content-type': 'text/html' } });
    return new Response(JSON.stringify(hit ?? []), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { calls, fetchImpl, asked: () => calls.map((c) => c.q) };
}

// A clock that only moves when something sleeps, so the spacing between requests can be read off it.
export function fakeClock(start = NOW) {
  let t = start;
  const sleeps = [];
  return { now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; }, sleeps };
}
