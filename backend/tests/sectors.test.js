import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECTOR_GROUPS, SECTOR_OPTIONS, OTHER_SECTOR, sectorGroupOf, isPlacedSector, labelsOf } from '../src/models/sectors.js';
import { buildSnapshot, createCatalog, readFilters, select, facets, summary, markers, areas, recordFor, suggest, MARKER_FIELDS, CARD_FIELDS, FUNDING_STAGES, FACETS, isInactive } from '../src/catalog/catalog.js';

// The one list of display sectors the map and Discover share (models/sectors.js), the stage options (funding rounds only) and the companies that have closed.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(HERE, '..', 'src', 'data', 'startups.json');

describe('the display sectors', () => {
  it('are the twelve the brief names, in its order, and Other after them', () => {
    expect(SECTOR_GROUPS).toEqual([
      'AI & Data', 'Software & DevTools', 'Cybersecurity', 'Fintech', 'Health & Biotech', 'Climate & Energy', 'Food & Agriculture', 'Consumer & Commerce', 'Education', 'Property & Construction',
      'Industrial & Logistics', 'Deep Tech & Space',
    ]);
    expect(SECTOR_OPTIONS).toEqual([...SECTOR_GROUPS, OTHER_SECTOR]);
  });

  it('put the variants of one idea in one place, by a table and not a guess', () => {
    for (const label of ['HealthTech', 'Healthtech', 'Medtech', 'Biotech', 'Telehealth']) expect(sectorGroupOf(label), label).toBe('Health & Biotech');
    for (const label of ['Enterprise AI', 'Sales AI', 'Vertical AI', 'AI', 'AI infrastructure', 'Data']) expect(sectorGroupOf(label), label).toBe('AI & Data');
    for (const label of ['HR Tech', 'HR tech', 'Martech', 'MarTech', 'Legal tech', 'Legaltech']) expect(sectorGroupOf(label), label).toBe('Software & DevTools');
    for (const label of ['Insurtech', 'WealthTech', 'Open banking', 'Fintech']) expect(sectorGroupOf(label), label).toBe('Fintech');
    expect(sectorGroupOf('PropTech')).toBe('Property & Construction');
    expect(sectorGroupOf('Construction SaaS')).toBe('Property & Construction');
    expect(sectorGroupOf('Space')).toBe('Deep Tech & Space');
    expect(sectorGroupOf('  healthtech ')).toBe('Health & Biotech'); // case and the space round it do not matter
  });

  it('leave a company with no sector unclassified, and put a sector that is known but fits none in Other', () => {
    for (const none of [undefined, null, '', 'Unknown', 'unknown']) expect(sectorGroupOf(none), String(none)).toBeNull();
    expect(sectorGroupOf('Community')).toBe(OTHER_SECTOR);
    expect(sectorGroupOf('Underwater basket weaving')).toBe(OTHER_SECTOR); // a new label: not guessed into a group
    expect(isPlacedSector('Underwater basket weaving')).toBe(false);
  });

  it('place no label in two groups', () => {
    const seen = new Map();
    for (const group of SECTOR_OPTIONS) for (const label of labelsOf(group)) { expect(seen.has(label.toLowerCase()), label).toBe(false); seen.set(label.toLowerCase(), group); }
  });

  describe('in the shipped data', () => {
    let snap;
    beforeAll(async () => { const c = createCatalog({ file: FILE, reloadMs: 0 }); await c.refresh(); snap = await c.snapshot(); });

    it('place every sector label the data has by hand: a new label fails here until a person places it', () => {
      const labels = [...new Set(snap.records.map((r) => r.sector))];
      expect(labels.length).toBeGreaterThan(90);
      const unplaced = labels.filter((label) => !isPlacedSector(label));
      expect(unplaced).toEqual([]);
    });

    it('classify every company with a sector, none with "Unknown", and change no record\'s own sector', () => {
      for (const r of snap.records) {
        if (!r.sector || r.sector === 'Unknown') expect(r.sectorGroup, r.name).toBeNull();
        else { expect(SECTOR_OPTIONS, r.name).toContain(r.sectorGroup); expect(r.sectorGroup, r.name).toBe(sectorGroupOf(r.sector)); }
      }
      expect(snap.records.some((r) => r.sector === 'HealthTech')).toBe(true); // the label the source gave is still there
      expect(snap.meta.sectors).toContain('HealthTech');
    });

    it('offer twelve sectors and Other, each with companies, in the list\'s order', () => {
      expect(snap.meta.sectorGroups.map((o) => o.value)).toEqual(SECTOR_OPTIONS.filter((v) => snap.records.some((r) => r.sectorGroup === v)));
      expect(snap.meta.sectorGroups.map((o) => o.value).slice(0, 12)).toEqual(SECTOR_GROUPS);
      for (const { count } of snap.meta.sectorGroups) expect(count).toBeGreaterThan(0);
    });

    it('filter by a display sector (the group) and still by the label an older link names', () => {
      const count = (f) => select(snap, readFilters(f)).length;
      const health = snap.records.filter((r) => r.sectorGroup === 'Health & Biotech').length;
      expect(count({ sector: 'Health & Biotech' })).toBe(health);
      // the older address names the source's own label: it means that label, as it always did
      expect(count({ sector: 'HealthTech' })).toBe(snap.records.filter((r) => r.sector === 'HealthTech').length);
      expect(count({ sector: 'HealthTech' })).toBeLessThan(health);
      expect(count({ sector: 'Healthtech' })).toBe(snap.records.filter((r) => r.sector === 'Healthtech').length);
      // several at once, either kind, once each
      expect(count({ sector: 'HealthTech,Fintech' })).toBe(new Set(snap.records.map((r, i) => (r.sector === 'HealthTech' || r.sectorGroup === 'Fintech' ? i : -1)).filter((i) => i >= 0)).size);
      // the name is both a source's label and a display sector ("Fintech"): it means the display sector, which holds that label's companies and more
      expect(count({ sector: 'Fintech' })).toBe(snap.records.filter((r) => r.sectorGroup === 'Fintech').length);
      expect(count({ sector: 'Fintech' })).toBeGreaterThan(snap.records.filter((r) => r.sector === 'Fintech').length);
      expect(count({ sector: 'No such sector' })).toBe(0);
    });

    it('count the sectors for what is chosen, so a menu offers only the ones with a result: the city and the type, here', () => {
      const matched = select(snap, readFilters({ city: 'Melbourne', onMap: 'yes' }));
      const out = facets(snap, matched, ['sectorGroup']).sectorGroup;
      expect(out.values.map((v) => v.value)).toEqual(SECTOR_OPTIONS.filter((v) => out.values.some((o) => o.value === v))); // the list's order, not the biggest first
      for (const { value, count } of out.values) expect(select(snap, readFilters({ city: 'Melbourne', onMap: 'yes', sector: value })).length, value).toBe(count);
      expect(out.values.reduce((n, v) => n + v.count, 0)).toBeLessThanOrEqual(matched.length);
      // the same numbers are in the summary the page already asks for
      expect(summary(snap, matched).sectors).toEqual(out.values);
      // the sector chosen is not part of the question: with Fintech chosen the menu still offers the others
      expect(summary(snap, select(snap, readFilters({ city: 'Melbourne', onMap: 'yes', sector: 'Fintech' }))).sectors.map((o) => o.value)).toEqual(['Fintech']);
      expect(FACETS).toContain('sectorGroup');
      // organisations of another type have their own sectors: the menu follows the type
      const spaces = summary(snap, select(snap, readFilters({ orgType: 'space' }))).sectors.map((o) => o.value);
      expect(spaces).toEqual([OTHER_SECTOR]);
    });

    it('suggest the display sectors when a search is typed (the same list the menus offer), and one that is chosen filters like the menu does', () => {
      expect(suggest(snap, 'health').industries).toEqual(['Health & Biotech']);
      expect(suggest(snap, 'fin').industries).toEqual(['Fintech']);
      expect(suggest(snap, 'zzzz').industries).toEqual([]);
      expect(select(snap, readFilters({ sector: suggest(snap, 'health').industries[0] })).length).toBeGreaterThan(100);
    });

    it('offer only the funding rounds as stages, earliest first, and none of what became of a company', () => {
      expect(snap.meta.stages).toEqual(FUNDING_STAGES.filter((s) => snap.records.some((r) => r.stage === s)));
      for (const not of ['Acquired', 'Subsidiary', 'Unicorn', 'Unknown', 'Early', 'Growth', 'Other Equity', 'Defunct (in administration)', 'Defunct (in liquidation)']) expect(snap.meta.stages, not).not.toContain(not);
      expect(snap.meta.stages[0]).toBe('Pre-seed');
      // a link that names one of the others still filters: nothing was removed from a record
      expect(select(snap, readFilters({ stage: 'Unicorn' })).length).toBeGreaterThan(0);
    });

    it('keep a company that has closed off the map and out of what the map shows, and keep its record and its page', () => {
      const closed = snap.records.map((r, i) => [r, i]).filter(([r]) => /^Defunct/i.test(r.stage ?? '') || r.company_status === 'defunct');
      expect(closed.length).toBeGreaterThan(0);
      const onMap = select(snap, readFilters({ onMap: 'yes' }));
      const pinned = markers(snap, select(snap, {}));
      for (const [r, i] of closed) {
        expect([...onMap], r.name).not.toContain(i);
        expect(snap.markers[i], r.name).toBeNull();
        expect(recordFor(snap, r.slug), r.name).toBeTruthy(); // its own page is still there
        expect([...select(snap, {})], r.name).toContain(i); // and so is the record in the directory
      }
      expect(pinned.every((m) => !closed.some(([r]) => r.slug === m[0]))).toBe(true);
    });
  });
});

describe('what the map draws and what is closed', () => {
  const company = (name, over = {}) => {
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return {
      id, slug: id, name, sector: 'Fintech', sectorFull: 'Fintech', city: 'Melbourne', state: 'VIC', country: 'Australia', lat: -37.8136, lng: 144.9631, investors: [], stage: 'Seed', hiring: false, verified: true,
      website: `https://${id}.test`, blurb: 'x', taskGate: { enabled: false }, suburb: 'Collingwood', postcode: '3066', address: '1 Smith Street, Collingwood VIC 3066', location_precision: 'EXACT',
      location_source: 'directory_record', location_source_url: null, location_verified_at: null, location_confidence: 'low', ...over,
    };
  };
  const snapOf = (rows) => buildSnapshot(JSON.stringify(rows), 'test');

  it('call a company closed by its stage, its status or the owner\'s list, and no other', () => {
    expect(isInactive({ stage: 'Defunct (in administration)' })).toBe(true);
    expect(isInactive({ stage: 'Defunct (in liquidation)' })).toBe(true);
    expect(isInactive({ company_status: 'defunct' })).toBe(true);
    expect(isInactive({ maturity: 'Collapsed' })).toBe(true);
    expect(isInactive({ stage: 'Acquired', company_status: 'acquired' })).toBe(false); // acquired is not closed
    expect(isInactive({ stage: 'Seed' })).toBe(false);
  });

  it('draw no pin, no group and no count for a closed company, and keep it in the list, the directory and its own page', () => {
    const rows = [
      company('Live Co'), company('Gone Co', { stage: 'Defunct (in liquidation)' }), company('Admin Co', { stage: 'Defunct (in administration)' }),
      company('Closed Co', { company_status: 'defunct' }), company('Collapsed Co', { maturity: 'Collapsed' }),
      company('City Only', { location_precision: 'CITY', lat: null, lng: null, address: undefined, suburb: null }),
      company('Closed City Only', { stage: 'Defunct (in liquidation)', location_precision: 'CITY', lat: null, lng: null, address: undefined, suburb: null }),
    ];
    const snap = snapOf(rows);
    const all = select(snap, {});
    expect(markers(snap, all).map((m) => m[1])).toEqual(['Live Co']);
    expect(areas(snap, all).items.flatMap((a) => a.sample.map((s) => s.name))).toEqual(['City Only']);
    expect([...select(snap, readFilters({ onMap: 'yes' }))].map((i) => snap.records[i].name)).toEqual(['Live Co', 'City Only']);
    expect(all).toHaveLength(7); // every record is still in the directory
    expect(recordFor(snap, 'gone-co').name).toBe('Gone Co');
    expect(snap.meta.maturities.every((m) => m.value !== 'Collapsed')).toBe(true);
  });

  it('say a pin\'s display sector and suburb on the pin, after the fields it always had', () => {
    expect(MARKER_FIELDS.slice(0, 13)).toEqual(['slug', 'name', 'lat', 'lng', 'sector', 'city', 'hiring', 'domain', 'precision', 'place', 'checked', 'logo', 'metro']);
    expect(MARKER_FIELDS.slice(13)).toEqual(['sectorGroup', 'suburb']);
    const snap = snapOf([company('Pay Co'), company('Lost Co', { sector: 'Unknown', sectorFull: 'Unknown' }), company('Odd Co', { sector: 'Community' })]);
    const [pay, lost, odd] = markers(snap, select(snap, {}));
    const at = (row, name) => row[MARKER_FIELDS.indexOf(name)];
    expect(at(pay, 'sectorGroup')).toBe('Fintech');
    expect(at(pay, 'suburb')).toBe('Collingwood');
    expect(at(pay, 'sector')).toBe('Fintech'); // what the source said, still
    expect(at(lost, 'sectorGroup')).toBeNull(); // no sector: nothing is made up
    expect(at(odd, 'sectorGroup')).toBe('Other');
    expect(CARD_FIELDS).toContain('sectorGroup');
  });
});
