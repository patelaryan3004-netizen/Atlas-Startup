import { describe, it, expect, afterEach } from 'vitest';
import { main, parseArgs } from '../scripts/locations.js';
import { loadRaw } from '../src/models/dataset.js';
import { CITIES, STATES } from '../src/geo/places.js';
import { remember } from '../src/models/geocodeCache.js';
import { transact } from '../src/models/store.js';
import { makeDataDir, readDataDir, removeMadeDirs } from './helpers/store.js';
import { co, dataset, source, evidenceRow, nominatim, fakeClock, osm, osmHouse, NOW, ISO, KIPPAX, KIPPAX_QUERY, KIPPAX_POINT, WILLIAM, WILLIAM_QUERY, WILLIAM_POINT } from './helpers/locations.js';

afterEach(removeMadeDirs);

const WILLIAM_HOUSE = osmHouse(WILLIAM_POINT, { house_number: '15', road: 'William Street', suburb: 'Melbourne', city: 'Melbourne', state: 'Victoria', postcode: '3000' });

async function cli(dir, argv, deps = {}) {
  const lines = [];
  const clock = deps.clock ?? fakeClock();
  const web = deps.web ?? nominatim();
  const code = await main(argv, { dataDir: dir, out: (s) => lines.push(s), now: clock.now, sleep: clock.sleep, fetchImpl: web.fetchImpl, ...deps.extra });
  return { code, text: lines.join('\n'), web, clock };
}
const fresh = (companies, extra = {}) => makeDataDir(dataset(companies, extra));
const mix = () => [
  co('Acme', { address: KIPPAX, lat: KIPPAX_POINT.lat + 0.0007, lng: KIPPAX_POINT.lng }),
  co('Beta', { address: WILLIAM, city: 'Melbourne' }),
  co('Citywide', { lat: -33.86984, lng: 151.20828 }),
  co('Suburban', { address: 'Surry Hills, Sydney NSW 2010', lat: -33.8848, lng: 151.2098 }),
  co('Nowhere', { city: 'Unknown', verified: false }),
];
const SCRIPT = () => ({ [KIPPAX_QUERY]: [osmHouse(KIPPAX_POINT)], [WILLIAM_QUERY]: [WILLIAM_HOUSE] });
const byName = (ds, name) => ds.companies.find((c) => c.name === name);
const audits = (ds, action) => ds.audit_trail.filter((r) => r.action === action);

describe('reading the arguments', () => {
  it('splits words from flags, repeats and values', () => {
    expect(parseArgs(['set', 'acme', '--city', 'Sydney', '--apply', '--lat', '-33.8'])).toEqual({ positional: ['set', 'acme'], flags: { city: 'Sydney', apply: true, lat: '-33.8' } });
    expect(parseArgs(['review', '--issue', 'a', '--issue', 'b']).flags.issue).toEqual(['a', 'b']);
  });
});

describe('looking at the locations', () => {
  it('says how well locations are known, in the words the Command Center uses, and what is wrong', async () => {
    const dir = await fresh(mix());
    const r = await cli(dir, ['status']);
    expect(r.code).toBe(0);
    expect(r.text).toMatch(/Locations at 2026-10-05: 5 companies/);
    expect(r.text).toMatch(/Exact locations:\s+1\b/);
    expect(r.text).toMatch(/Suburb locations:\s+1\b/);
    expect(r.text).toMatch(/City-only locations:\s+2\b/);
    expect(r.text).toMatch(/State-only locations:\s+0\b/);
    expect(r.text).toMatch(/Unknown locations:\s+1\b/);
    expect(r.text).toMatch(/Duplicate coordinates:/);
    expect(r.text).toMatch(/City-centroid coordinates:\s+1\b/);
    expect(r.text).toMatch(/Location conflicts:/);
    expect(r.text).toMatch(/Missing coordinates:/);
    expect(r.text).toMatch(/Potentially stale locations:/);
    expect(r.text).toMatch(/Review queue: 5 companies/);
    expect(r.text).toMatch(/\[city_level_only\]/);
    expect(r.text).toMatch(/Geocode cache: 0 answer\(s\)/);
  });

  it('can say it as JSON', async () => {
    const dir = await fresh(mix());
    const r = await cli(dir, ['status', '--json']);
    const out = JSON.parse(r.text);
    expect(out.precision).toEqual({ EXACT: 1, SUBURB: 1, CITY: 2, STATE: 0, UNKNOWN: 1 });
    expect(out.flags.city_centroid_coordinates).toBe(1);
    expect(out.issues.city_level_only.count).toBe(2);
    expect(out.cache).toBe(0);
  });

  it('lists the review queue worst first, can filter it by problem, limit it, and say it as JSON', async () => {
    const dir = await fresh(mix());
    const all = await cli(dir, ['review']);
    // two have a high-severity problem (an address never plotted, a city centre as a pin), then the medium, then the low
    expect(all.text.split('\n').map((l) => l.split(/\s+/)[0])).toEqual(['Beta', 'Citywide', 'Nowhere', 'Acme', 'Suburban']);
    const city = await cli(dir, ['review', '--issue', 'city_level_only']);
    expect(city.text.split('\n').map((l) => l.split(/\s+/)[0]).sort()).toEqual(['Beta', 'Citywide']);
    const none = await cli(dir, ['review', '--issue', 'stale_location']);
    expect(none.text).toBe('Nothing to review.');
    const json = JSON.parse((await cli(dir, ['review', '--issue', 'city_level_only', '--json'])).text);
    expect(json.map((x) => x.name).sort()).toEqual(['Beta', 'Citywide']);
    expect(json[0]).toMatchObject({ precision: 'CITY' });
    expect((await cli(dir, ['review', '--limit', '1'])).text.split('\n')).toHaveLength(1);
    await expect(cli(dir, ['review', '--issue', 'sad'])).rejects.toThrow(/unknown issue "sad": the issues are /);
    await expect(cli(dir, ['review', '--limit', 'lots'])).rejects.toThrow(/--limit must be a number/);
  });

  it('refuses a command it does not know, and reads and writes nothing for help', async () => {
    const dir = await fresh(mix());
    const before = await loadRaw(dir);
    await expect(cli(dir, ['frobnicate'])).rejects.toThrow(/unknown command "frobnicate"/);
    const help = await cli(dir, []);
    expect(help.text).toMatch(/Commands: status, review, geocode, verify, promote, normalize, places, set/);
    expect(await loadRaw(dir)).toEqual(before);
  });
});

describe('asking the geocoder', () => {
  it('asks once per address, keeps the answers, and changes no company without --apply', async () => {
    const dir = await fresh(mix());
    const before = await readDataDir(dir);
    const r = await cli(dir, ['geocode'], { web: nominatim(SCRIPT()) });
    expect(r.code).toBe(0);
    expect(r.web.asked().sort()).toEqual([KIPPAX_QUERY, WILLIAM_QUERY, 'Surry Hills, NSW, 2010, Australia'].sort());
    expect(r.text).toMatch(/3 companies with an address to check: 3 asked of the geocoder, 0 answered from the cache/);
    expect(r.text).toMatch(/nothing on a record was changed; add --apply to put the 2 good answer\(s\) on the records/);
    expect(r.clock.sleeps).toEqual([1100, 1100]); // three questions, never faster than one a second
    const ds = await readDataDir(dir);
    expect(ds.companies).toEqual(before.companies);
    expect(ds.geocode_cache.map((x) => [x.query, x.status])).toEqual(expect.arrayContaining([[KIPPAX_QUERY, 'found'], [WILLIAM_QUERY, 'found'], ['Surry Hills, NSW, 2010, Australia', 'none']]));
    expect(audits(ds, 'location.geocode')).toEqual([expect.objectContaining({ actor: 'locations', role: 'cli', via: 'cli', target: { type: 'system', id: 'geocoder' }, summary: 'Asked the geocoder about 3 address(es), 0 answered from the cache' })]);
  });

  it('does not ask again for an address it has an answer to, whether or not it applied it', async () => {
    const dir = await fresh(mix());
    await cli(dir, ['geocode'], { web: nominatim(SCRIPT()) });
    const web = nominatim(SCRIPT());
    const again = await cli(dir, ['geocode'], { web });
    expect(web.calls).toEqual([]);
    expect(again.text).toMatch(/0 asked of the geocoder, 3 answered from the cache/);
    const ds = await readDataDir(dir);
    expect(audits(ds, 'location.geocode')).toHaveLength(1); // nothing was asked the second time, so there is nothing to record
  });

  it('with --apply puts the good answers on the records: places an unplotted address, replaces a point that is the same place, leaves the rest', async () => {
    const dir = await fresh(mix());
    const r = await cli(dir, ['geocode', '--apply', '--by', 'Aryan'], { web: nominatim(SCRIPT()) });
    expect(r.text).toMatch(/Changed: 2 companies/);
    expect(r.text).toMatch(/Acme: lat .* -> -33\.88437/);
    const ds = await readDataDir(dir);
    expect(byName(ds, 'Acme')).toMatchObject({ lat: KIPPAX_POINT.lat, lng: KIPPAX_POINT.lng, location_precision: 'EXACT' });
    expect(byName(ds, 'Beta')).toMatchObject({ lat: WILLIAM_POINT.lat, lng: WILLIAM_POINT.lng, location_precision: 'EXACT', suburb: 'Melbourne', postcode: '3000', location_source: 'directory_record', location_verified_at: null });
    expect(byName(ds, 'Suburban')).toMatchObject({ lat: -33.8848, lng: 151.2098, location_precision: 'SUBURB' }); // the geocoder knew nothing of it
    expect(byName(ds, 'Citywide').location_precision).toBe('CITY');
    const rows = audits(ds, 'location.geocode');
    expect(rows).toHaveLength(3); // one for the run, one for each company changed
    expect(rows.filter((x) => x.target.type === 'company').map((x) => [x.target.id, x.actor, x.role]).sort()).toEqual([['acme', 'Aryan', 'cli'], ['beta', 'Aryan', 'cli']]);
    expect(rows.find((x) => x.target.id === 'beta').changes.map((c) => c.field)).toEqual(expect.arrayContaining(['lat', 'lng', 'location_precision']));
    // the headquarters rows follow the companies
    expect(ds.company_locations.find((x) => x.id === 'beta.hq')).toMatchObject({ latitude: WILLIAM_POINT.lat, location_precision: 'EXACT' });
  });

  it('does not move a pin the geocoder disagrees with: it is reported as a conflict', async () => {
    const dir = await fresh([co('Acme', { address: KIPPAX, ...KIPPAX_POINT })]);
    const far = osmHouse({ lat: KIPPAX_POINT.lat - 0.03, lng: KIPPAX_POINT.lng });
    const r = await cli(dir, ['geocode', '--apply'], { web: nominatim({ [KIPPAX_QUERY]: [far] }) });
    expect(r.text).toMatch(/conflicts: 1/);
    expect(r.text).toMatch(/CONFLICT Acme: the point on file is \d\.\d km from where the geocoder puts the address/);
    const ds = await readDataDir(dir);
    expect(byName(ds, 'Acme').lat).toBe(KIPPAX_POINT.lat);
    expect(audits(ds, 'location.geocode').filter((x) => x.target.type === 'company')).toEqual([]);
  });

  it('can be limited to a number of questions, or to one company', async () => {
    const dir = await fresh(mix());
    const limited = await cli(dir, ['geocode', '--limit', '1'], { web: nominatim(SCRIPT()) });
    expect(limited.web.calls).toHaveLength(1);
    expect(limited.text).toMatch(/1 asked of the geocoder/);
    const dir2 = await fresh(mix());
    const one = await cli(dir2, ['geocode', '--company', 'beta'], { web: nominatim(SCRIPT()) });
    expect(one.web.asked()).toEqual([WILLIAM_QUERY]);
    expect(one.text).toMatch(/^1 company with an address to check: 1 asked of the geocoder/);
    await expect(cli(dir2, ['geocode', '--company', 'nobody'])).rejects.toThrow(/no company "nobody"/);
  });

  it('stops when the geocoder says to, exits 2, keeps what it had and does not keep the failure', async () => {
    const dir = await fresh(mix());
    const web = nominatim({ [KIPPAX_QUERY]: 429, [WILLIAM_QUERY]: [WILLIAM_HOUSE] });
    const r = await cli(dir, ['geocode'], { web });
    expect(r.code).toBe(2);
    expect(r.text).toMatch(/stopped early: the geocoder answered 429 \(retry after 60 s\)/);
    expect(web.calls.length).toBeLessThanOrEqual(3);
    const ds = await readDataDir(dir);
    expect(ds.geocode_cache.every((x) => x.status !== 'error')).toBe(true);
    expect(audits(ds, 'location.geocode')[0].summary).toMatch(/; stopped: the geocoder answered 429/);
  });

  it('reports an address it could not ask about, and carries on', async () => {
    const dir = await fresh([co('Acme', { address: KIPPAX, ...KIPPAX_POINT }), co('Beta', { address: WILLIAM, city: 'Melbourne' })]);
    const r = await cli(dir, ['geocode'], { web: nominatim({ [KIPPAX_QUERY]: new Error('offline'), [WILLIAM_QUERY]: [WILLIAM_HOUSE] }) });
    expect(r.code).toBe(0);
    expect(r.text).toMatch(/Acme: could not reach the geocoder: offline/);
    expect(r.text).toMatch(/1 failed/);
    const ds = await readDataDir(dir);
    expect(ds.geocode_cache.map((x) => x.query)).toEqual([WILLIAM_QUERY]);
  });

  it('sends nothing but the address', async () => {
    const dir = await fresh([co('Acme', { address: KIPPAX, ...KIPPAX_POINT, founders: ['Jane Doe'], website: 'https://acme.example', blurb: 'Secret plans.' })]);
    const web = nominatim(SCRIPT());
    await cli(dir, ['geocode'], { web });
    for (const call of web.calls) expect(call.url).not.toMatch(/Jane|Doe|acme|Secret/i);
    expect(web.calls[0].userAgent).toMatch(/^AUStartupMapBot\/1\.0 /);
  });
});

describe('recording where an address was found', () => {
  const backed = () => fresh([co('Acme', { address: KIPPAX, ...KIPPAX_POINT })], {});
  const withEvidence = async () => {
    const dir = await backed();
    await transact(dir, (work) => { work.sources.push(source('site')); work.evidence.push(evidenceRow('acme', 'address', KIPPAX, 'site')); return { result: null }; }, { now: () => NOW });
    return dir;
  };

  it('shows what it would do, and does it only with --apply, and says so in the audit trail', async () => {
    const dir = await withEvidence();
    // the company was migrated before the evidence existed, so its location is an untraced directory record
    expect(byName(await readDataDir(dir), 'Acme').location_source).toBe('directory_record');
    const dry = await cli(dir, ['verify']);
    expect(dry.text).toMatch(/Would record a source for: 1 company/);
    expect(dry.text).toMatch(/\(nothing was changed; add --apply\)/);
    expect(byName(await readDataDir(dir), 'Acme').location_source).toBe('directory_record');
    const done = await cli(dir, ['verify', '--apply']);
    expect(done.text).toMatch(/Recorded a source for: 1 company/);
    const ds = await readDataDir(dir);
    expect(byName(ds, 'Acme')).toMatchObject({ location_source: 'company_website', location_source_url: 'https://site.example/contact', location_verified_at: ISO, location_confidence: 'medium' });
    expect(audits(ds, 'location.verify')).toEqual([expect.objectContaining({ target: { type: 'company', id: 'acme' }, summary: "Recorded where Acme's address was found (company_website)", actor: 'locations', role: 'cli' })]);
    expect((await cli(dir, ['verify', '--apply'])).text).toMatch(/Recorded a source for: 0 companies/);
  });
});

describe('giving a city-level company the address its own website states', () => {
  const ADDRESS = '24 Campbell Street, Sydney NSW 2000';
  const QUERY = '24 Campbell Street, Sydney, NSW, 2000, Australia';
  const HOUSE = osmHouse({ lat: -33.8764, lng: 151.2049 }, { house_number: '24', road: 'Campbell Street', suburb: 'Sydney', postcode: '2000' });
  const build = () => fresh([co('Harrison'), co('Quantum', { city: 'Canberra', state: 'ACT' })], {
    sources: [source('site')], evidence: [evidenceRow('harrison', 'address', ADDRESS, 'site'), evidenceRow('quantum', 'address', '1/477 Pitt Street, Sydney NSW 2000', 'site')],
  });

  it('is asked of the geocoder first, then shown, then done only with --apply, with the reason in the audit trail', async () => {
    const dir = await build();
    const web = nominatim({ [QUERY]: [HOUSE] });
    await cli(dir, ['geocode'], { web });
    expect(web.asked()).toEqual(expect.arrayContaining([QUERY, '477 Pitt Street, Sydney, NSW, 2000, Australia']));
    expect(byName(await readDataDir(dir), 'Harrison')).toMatchObject({ location_precision: 'CITY', lat: null }); // asking changes nobody
    const dry = await cli(dir, ['promote']);
    expect(dry.text).toMatch(/^Would promote: 1 company\n {2}Harrison: 24 Campbell Street, Sydney NSW 2000 \(company_website\)/);
    expect(dry.text).toMatch(/not promoted Quantum: its own page puts it in NSW, the record in ACT/);
    expect(dry.text).toMatch(/\(nothing was changed; add --apply\)/);
    expect(byName(await readDataDir(dir), 'Harrison').location_precision).toBe('CITY');
    const done = await cli(dir, ['promote', '--apply', '--by', 'Aryan']);
    expect(done.text).toMatch(/^Promoted: 1 company/);
    const ds = await readDataDir(dir);
    expect(byName(ds, 'Harrison')).toMatchObject({ location_precision: 'EXACT', address: ADDRESS, lat: -33.8764, lng: 151.2049, location_source: 'company_website', location_confidence: 'high' });
    expect(byName(ds, 'Quantum')).toMatchObject({ location_precision: 'CITY', city: 'Canberra' });
    expect(audits(ds, 'location.promote')).toEqual([expect.objectContaining({
      actor: 'Aryan', role: 'cli', via: 'cli', target: { type: 'company', id: 'harrison' },
      summary: 'Gave Harrison the address its own website states (24 Campbell Street, Sydney NSW 2000), at the point the geocoder puts it',
    })]);
    expect(audits(ds, 'location.promote')[0].changes.map((c) => c.field)).toEqual(expect.arrayContaining(['address', 'lat', 'lng', 'location_precision']));
    expect((await cli(dir, ['promote', '--apply'])).text).toMatch(/^Promoted: 0 companies/);
  });

  it('says to ask the geocoder first when it has not been asked, and limits itself to one company when told to', async () => {
    const dir = await build();
    const r = await cli(dir, ['promote']);
    expect(r.text).toMatch(/not promoted Harrison: the geocoder has not been asked: run `geocode` first/);
    const one = await cli(dir, ['promote', '--company', 'quantum']);
    expect(one.text).not.toMatch(/Harrison/);
    await expect(cli(dir, ['promote', '--company', 'nobody'])).rejects.toThrow(/no company "nobody"/);
    await expect(cli(dir, ['promote', '--apply', '--company', 'nobody'])).rejects.toThrow(/no company "nobody"/);
  });
});

describe('taking a city centre off a company that is not at it', () => {
  it('shows what it would clear, clears it only with --apply, and records it', async () => {
    const dir = await fresh(mix());
    const dry = await cli(dir, ['normalize']);
    expect(dry.text).toMatch(/Would clear the coordinates of: 1 company/);
    expect(dry.text).toMatch(/Citywide: lat -33\.86984 -> null; lng 151\.20828 -> null/);
    expect(byName(await readDataDir(dir), 'Citywide').lat).toBe(-33.86984);
    const done = await cli(dir, ['normalize', '--apply', '--by', 'Aryan']);
    expect(done.text).toMatch(/Cleared the coordinates of: 1 company/);
    const ds = await readDataDir(dir);
    expect(byName(ds, 'Citywide')).toMatchObject({ lat: null, lng: null, location_precision: 'CITY' });
    expect(byName(ds, 'Acme').lat).not.toBeNull();
    expect(audits(ds, 'location.normalize')).toEqual([expect.objectContaining({ actor: 'Aryan', summary: expect.stringMatching(/^Cleared the coordinates of Citywide/), changes: [{ field: 'lat', from: -33.86984, to: null }, { field: 'lng', from: 151.20828, to: null }] })]);
    expect((await cli(dir, ['normalize', '--apply'])).text).toMatch(/Cleared the coordinates of: 0 companies/);
  });
});

describe('checking the city-centre reference points', () => {
  const centreOf = (city) => osm({ lat: city.lat + 0.002, lng: city.lng }, { city: city.name, state: STATES[city.state].name }, { category: 'boundary', type: 'administrative', addresstype: 'city' });

  it('asks about every city once, says how far each of our points is from the geocoder\'s, and marks the ones to check', async () => {
    const dir = await fresh(mix());
    const script = {};
    for (const city of CITIES) script[`${city.name}, ${STATES[city.state].name}, Australia`] = [centreOf(city)];
    const sydney = CITIES.find((c) => c.name === 'Sydney');
    script['Sydney, New South Wales, Australia'] = [centreOf({ ...sydney, lat: sydney.lat + 0.05 })]; // 5.5 km away
    const r = await cli(dir, ['places'], { web: nominatim(script) });
    expect(r.code).toBe(0);
    expect(r.web.calls).toHaveLength(CITIES.length);
    expect(r.text).toMatch(/Sydney\s+5\.\d km from the geocoder's centre\s+<-- check this point in src\/geo\/places\.js/);
    expect(r.text).toMatch(/Melbourne\s+0\.2 km from the geocoder's centre\n/);
    const ds = await readDataDir(dir);
    expect(ds.geocode_cache).toHaveLength(CITIES.length);
    const again = nominatim(script);
    await cli(dir, ['places'], { web: again });
    expect(again.calls).toEqual([]); // the second look is from the cache
  });

  it('says so when the geocoder does not know a city, and stops when it is told to', async () => {
    const dir = await fresh(mix());
    const r = await cli(dir, ['places'], { web: nominatim({}) });
    expect(r.text).toMatch(/Sydney\s+not found by the geocoder/);
    const dir2 = await fresh(mix());
    const stopped = await cli(dir2, ['places'], { web: nominatim({ 'Sydney, New South Wales, Australia': 429 }) });
    expect(stopped.code).toBe(2);
    expect(stopped.text).toMatch(/Sydney\s+the geocoder answered 429/);
  });
});

describe('recording a place by hand', () => {
  const setArgs = (...more) => ['set', 'citywide', '--reason', 'their contact page says so', ...more];

  it('records an office address with a point and a source, and says why in the audit trail', async () => {
    const dir = await fresh(mix());
    const r = await cli(dir, setArgs('--city', 'Sydney', '--address', '25 Martin Place, Sydney NSW 2000', '--lat', '-33.8680', '--lng', '151.2105', '--source', 'company_website', '--source-url', 'https://citywide.example/contact', '--by', 'Aryan'));
    expect(r.text).toMatch(/^Citywide: EXACT, changed /);
    const ds = await readDataDir(dir);
    expect(byName(ds, 'Citywide')).toMatchObject({ location_precision: 'EXACT', lat: -33.868, lng: 151.2105, address: '25 Martin Place, Sydney NSW 2000', suburb: 'Sydney', postcode: '2000', location_source: 'company_website', location_source_url: 'https://citywide.example/contact', location_verified_at: ISO, location_confidence: 'medium' });
    expect(audits(ds, 'location.set')).toEqual([expect.objectContaining({ actor: 'Aryan', role: 'cli', via: 'cli', target: { type: 'company', id: 'citywide' }, reason: 'their contact page says so', summary: "Set Citywide's location (EXACT)" })]);
    expect(audits(ds, 'location.set')[0].changes.map((c) => c.field)).toEqual(expect.arrayContaining(['address', 'lat', 'lng', 'location_precision', 'location_source']));
  });

  it('records a suburb, with a point, as suburb-level', async () => {
    const dir = await fresh(mix());
    const r = await cli(dir, setArgs('--city', 'Sydney', '--suburb', 'Newtown', '--lat', '-33.8978', '--lng', '151.1743'));
    expect(r.text).toMatch(/^Citywide: SUBURB/);
    expect(byName(await readDataDir(dir), 'Citywide')).toMatchObject({ location_precision: 'SUBURB', suburb: 'Newtown', lat: -33.8978, location_source: 'manual' });
  });

  it('records only a city as city-level and keeps no coordinates', async () => {
    const dir = await fresh(mix());
    const r = await cli(dir, ['set', 'acme', '--city', 'Melbourne', '--state', 'VIC', '--precision', 'city', '--reason', 'moved']);
    expect(r.text).toMatch(/^Acme: CITY/);
    expect(byName(await readDataDir(dir), 'Acme')).toMatchObject({ location_precision: 'CITY', city: 'Melbourne', state: 'VIC', lat: null, lng: null, suburb: null });
  });

  it('refuses without a reason, without a company, for a company that does not exist, and for a place it cannot believe', async () => {
    const dir = await fresh(mix());
    const before = await loadRaw(dir);
    await expect(cli(dir, ['set', 'citywide', '--city', 'Sydney'])).rejects.toThrow(/say why, with --reason/);
    await expect(cli(dir, ['set', '--reason', 'because'])).rejects.toThrow(/set needs a company id/);
    await expect(cli(dir, ['set', 'nobody', '--city', 'Sydney', '--reason', 'because'])).rejects.toThrow(/no company "nobody"/);
    await expect(cli(dir, setArgs('--city', 'Sydney', '--precision', 'ROUGH'))).rejects.toThrow(/--precision must be one of EXACT, SUBURB, CITY, STATE, UNKNOWN/);
    await expect(cli(dir, setArgs('--city', 'Sydney', '--lat', 'north', '--lng', '151'))).rejects.toThrow(/--lat must be a number/);
    await expect(cli(dir, setArgs('--city', 'Sydney', '--lat', '-33.8', '--lng', '151.2'))).rejects.toThrow(/coordinates need an address/);
    await expect(cli(dir, setArgs('--city', 'London', '--address', '1 Mile End Road, London', '--lat', '51.52', '--lng', '-0.04'))).rejects.toThrow(/not in Australia/);
    await expect(cli(dir, setArgs('--city', 'Sydney', '--address', '25 Martin Place, Sydney NSW 2000', '--lat', '-33.868', '--lng', '151.21', '--source', 'company_website', '--source-url', 'https://www.linkedin.com/company/citywide'))).rejects.toThrow(/says where a person is/);
    await expect(cli(dir, setArgs('--city', 'Sydney', '--precision', 'UNKNOWN'))).rejects.toThrow(/take the company off the map/);
    expect(await loadRaw(dir)).toEqual(before); // nothing was written by any of them
  });
});

describe('what the commands leave behind', () => {
  it('keeps the data valid, and the audit trail append-only, through the whole run', async () => {
    const dir = await fresh(mix());
    await cli(dir, ['geocode', '--apply'], { web: nominatim(SCRIPT()) });
    await cli(dir, ['normalize', '--apply']);
    await cli(dir, ['set', 'nowhere', '--city', 'Perth', '--reason', 'their site says Perth']);
    const ds = await readDataDir(dir);
    expect(ds.audit_trail.length).toBeGreaterThanOrEqual(5);
    expect(ds.audit_trail.map((r) => r.action)).toEqual(expect.arrayContaining(['location.geocode', 'location.normalize', 'location.set']));
    const status = JSON.parse((await cli(dir, ['status', '--json'])).text);
    expect(status.precision.EXACT).toBe(2);
    expect(status.flags.city_centroid_coordinates).toBe(0);
  });

  it('uses the answers already in the cache when a run is started on a data directory that has them', async () => {
    const rows = [];
    remember(rows, { provider: 'nominatim', query: KIPPAX_QUERY, status: 'found', quality: 'house', result: { ...KIPPAX_POINT, address: { house_number: '110', road: 'Kippax Street', suburb: 'Surry Hills', state: 'New South Wales', postcode: '2010' } } }, NOW);
    const dir = await fresh([co('Acme', { address: KIPPAX })], { geocode_cache: rows });
    const web = nominatim();
    const r = await cli(dir, ['geocode', '--apply'], { web });
    expect(web.calls).toEqual([]);
    expect(r.text).toMatch(/0 asked of the geocoder, 1 answered from the cache/);
    expect(byName(await readDataDir(dir), 'Acme')).toMatchObject({ location_precision: 'EXACT', lat: KIPPAX_POINT.lat });
  });
});
