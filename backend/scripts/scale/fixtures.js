// Synthetic companies for scale tests. STAGING DATA ONLY.
//
// Nothing here is real: company names, founders and investors are invented, websites sit on the reserved .test
// domain (which never resolves), and what is copied from the real directory is only its SHAPE and its statistics
// (how many are in Sydney, how many are hiring, how long a blurb is), so a dataset of 5,000 stresses the app the
// way 5,000 real companies would. It is deterministic (the same size and seed give the same companies), and it
// refuses to write into backend/src/data: fake companies must never be one typo away from production.
//
//   node scripts/scale/fixtures.js --size 5000 --out <dir>      writes <dir>/startups.json
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { slugify } from '../../src/models/company.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REAL_DATA = path.resolve(HERE, '..', '..', 'src', 'data');
export const SIZES = [213, 500, 1000, 2500, 5000, 10000];

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rand, list) => list[Math.floor(rand() * list.length)];
function weighted(rand, entries) {
  let r = rand() * entries.reduce((n, [, w]) => n + w, 0);
  for (const [value, w] of entries) { r -= w; if (r <= 0) return value; }
  return entries.at(-1)[0];
}
const gauss = (rand) => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());

// Where the real directory's companies are: [city, state, lat, lng, share, spread in degrees, hot spots [lat, lng, spread, chance]].
// Sydney and Melbourne are dense, and within them a few streets are denser still: that is what makes clustering hard.
const CITIES = [
  ['Sydney', 'NSW', -33.8688, 151.2093, 0.455, 0.05, [[-33.8847, 151.2098, 0.006, 0.3], [-33.8688, 151.2093, 0.005, 0.2]]],
  ['Melbourne', 'VIC', -37.8136, 144.9631, 0.25, 0.05, [[-37.8183, 144.9946, 0.007, 0.3], [-37.8136, 144.9631, 0.005, 0.2]]],
  ['Brisbane', 'QLD', -27.4698, 153.0251, 0.055, 0.04, [[-27.4698, 153.0251, 0.008, 0.3]]],
  ['Adelaide', 'SA', -34.9285, 138.6007, 0.03, 0.04, []], ['Perth', 'WA', -31.9505, 115.8605, 0.03, 0.04, []],
  ['Canberra', 'ACT', -35.2809, 149.13, 0.03, 0.03, []], ['Newcastle', 'NSW', -32.9283, 151.7817, 0.015, 0.03, []],
  ['Gold Coast', 'QLD', -28.0167, 153.4, 0.015, 0.03, []], ['Hobart', 'TAS', -42.8821, 147.3272, 0.01, 0.02, []],
  ['Wollongong', 'NSW', -34.4278, 150.8931, 0.005, 0.02, []], ['Geelong', 'VIC', -38.1499, 144.3617, 0.005, 0.02, []],
  ['Darwin', 'NT', -12.4634, 130.8456, 0.003, 0.02, []], ['Cairns', 'QLD', -16.9186, 145.7781, 0.002, 0.02, []],
  ['Unknown', null, null, null, 0.065, 0, []], // an unconfirmed location: listed, not on the map
];
const SECTORS = [['Fintech', 27], ['HealthTech', 14], ['AI', 11], ['AgTech', 8], ['HR Tech', 8], ['EdTech', 7], ['Climate', 7], ['Construction SaaS', 7], ['Cybersecurity', 6], ['PropTech', 6], ['SaaS', 6], ['Hardware', 5],
  ['Robotics', 3], ['Medtech', 3], ['Legal tech', 3], ['Marketplace', 3], ['Consumer', 3], ['MarTech', 3], ['Retail', 2], ['Space', 2], ['Hospitality Tech', 2], ['B2B SaaS', 2], ['Climate SaaS', 2], ['Enterprise Software', 2],
  ['Logistics', 2], ['Green ammonia', 2], ['Quantum', 2], ['Energy', 2], ['HR', 2], ['Computer vision', 1], ['Automotive', 1], ['Vertical AI', 1], ['VR', 1], ['Web3', 1], ['Unknown', 14]];
const STAGES = [['Seed', 44], ['Growth', 34], ['Early', 33], ['Unknown', 32], ['Series A', 25], ['Series B', 15], ['Pre-seed', 15], ['Series C', 4], ['Series C+', 2], ['Series B+', 2], ['Unicorn', 2], ['Series D', 1], ['Series E', 1], ['Other Equity', 1]];
const INVESTOR_COUNT = [[0, 22], [1, 154], [2, 21], [3, 9], [4, 7], [5, 1], [7, 2]];
const SIDE = ['Platform', 'Marketplace', 'SaaS', 'Deep Tech', 'Analytics'];
// How well the real directory knows where its located companies are: an exact office, a suburb, only the city.
const PRECISIONS = [['EXACT', 73], ['SUBURB', 5.5], ['CITY', 21.5]];
// Suburb names for the dense cities (place names only: no real address, company or person comes with them).
const SUBURBS = {
  Sydney: ['Surry Hills', 'Pyrmont', 'Redfern', 'Chippendale', 'Barangaroo', 'Ultimo', 'Darlinghurst', 'Newtown', 'North Sydney'],
  Melbourne: ['Richmond', 'Collingwood', 'Southbank', 'Fitzroy', 'Docklands', 'Carlton', 'Cremorne', 'South Yarra'],
  Brisbane: ['Fortitude Valley', 'South Brisbane', 'Milton', 'Newstead', 'Spring Hill'],
};
const POSTCODE_BASE = { NSW: 2000, VIC: 3000, QLD: 4000, SA: 5000, WA: 6000, TAS: 7000, NT: 800, ACT: 2600 };
const CHECKED_AT = '2026-10-05T04:00:00.000Z';
// Every synthetic company that is hiring has had its open roles read from a page, so `hiring` means in the fixtures what it means
// to a visitor (toPublic): a flag no page backs is not counted.
const HIRING_CHECKED_AT = '2026-10-05T15:00:00.000Z';

const A = ['Cobalt', 'Nimbus', 'Quill', 'Zephyr', 'Lumen', 'Atlas', 'Ember', 'Sable', 'Juniper', 'Harbour', 'Tidal', 'Marlin', 'Wattle', 'Kestrel', 'Indigo', 'Saffron', 'Basalt', 'Meridian', 'Lantern', 'Orchid',
  'Pebble', 'Cinder', 'Thistle', 'Willow', 'Quartz', 'Ripple', 'Summit', 'Beacon', 'Mallee', 'Coral', 'Fable', 'Gossamer', 'Halcyon', 'Ivory', 'Jasper', 'Kindle', 'Larch', 'Mosaic', 'Nectar', 'Opal',
  'Paragon', 'Quasar', 'Russet', 'Solstice', 'Tundra', 'Umber', 'Vesper', 'Wisp', 'Xenon', 'Yarrow', 'Zenith', 'Alder', 'Birch', 'Cedar', 'Dune', 'Eclipse', 'Fjord', 'Glacier', 'Heron', 'Isle',
  'Jetty', 'Karri', 'Lagoon', 'Mirage', 'Nomad', 'Oasis', 'Prairie', 'Quokka', 'Reef', 'Spinifex', 'Terrace', 'Ultra', 'Vista', 'Wren', 'Axiom', 'Brine', 'Clover', 'Delta', 'Echo', 'Flint',
  'Garnet', 'Hazel', 'Ironbark', 'Jarrah', 'Koala', 'Lyrebird', 'Magpie', 'Numbat', 'Osprey', 'Platypus', 'Quoll', 'Rosella', 'Saltbush', 'Taipan', 'Urchin', 'Wombat', 'Banksia', 'Cassowary', 'Dingo', 'Emu',
  'Frill', 'Galah', 'Honey', 'Ibis', 'Jabiru', 'Kelpie', 'Lorikeet', 'Mulga', 'Noosa', 'Outback', 'Pelican', 'Quail', 'Rainbow', 'Sundew', 'Tern', 'Uluru', 'Vine', 'Waratah', 'Yabby', 'Zircon'];
const B = ['Labs', 'Health', 'Robotics', 'Pay', 'Cloud', 'Bio', 'Data', 'Works', 'Systems', 'Studio', 'Energy', 'Logic', 'Mobility', 'Foods', 'Learning', 'Security', 'Finance', 'Homes', 'Fleet', 'Grid',
  'Forge', 'Loop', 'Stack', 'Wave', 'Link', 'Mind', 'Craft', 'Field', 'Port', 'Scale', 'Shift', 'Signal', 'Spark', 'Sense', 'Layer', 'Bridge', 'Pilot', 'Vault', 'Atlas AI', 'Analytics',
  'Care', 'Rail', 'Space', 'Sound', 'Soil', 'Sky', 'Shore', 'Route', 'Rent', 'Quote', 'Press', 'Pulse', 'Print', 'Plan', 'Orbit', 'Ops', 'Nest', 'Net', 'Name', 'Mint',
  'Mesh', 'Mark', 'Lift', 'Kit', 'Key', 'Jump', 'Join', 'Iron', 'Hub', 'Host', 'Hive', 'Hatch', 'Gate', 'Fuse', 'Frame', 'Form', 'Flow', 'Fit', 'Feed', 'Edge',
  'Drive', 'Dock', 'Desk', 'Deck', 'Cure', 'Code', 'Clear', 'Chain', 'Cast', 'Case', 'Camp', 'Cache', 'Byte', 'Build', 'Brew', 'Bolt', 'Beam', 'Base', 'Barn', 'Array',
  'Arc', 'Apps', 'Angle', 'Align', 'Aid', 'Agri', 'Aero', 'Add', 'Able', 'Zone', 'Yield', 'Yard', 'Work', 'Wire', 'Wing', 'Wind', 'Wallet', 'Vox', 'View', 'Verse'];
const FIRST = ['Ava', 'Noah', 'Mia', 'Liam', 'Isla', 'Oliver', 'Chloe', 'Jack', 'Zoe', 'Lucas', 'Ruby', 'Ethan', 'Grace', 'Mason', 'Ella', 'Leo', 'Sophie', 'Harry', 'Lily', 'Henry', 'Tara', 'Dev', 'Priya', 'Arjun', 'Mei', 'Kenji', 'Aroha', 'Tane', 'Lena', 'Omar', 'Sana', 'Ivan', 'Nina', 'Felix', 'Hana', 'Theo', 'Maya', 'Owen', 'Eva', 'Kai', 'Nora', 'Cody', 'Bree', 'Jett', 'Skye', 'Rhys', 'Tess', 'Finn', 'Alba', 'Brodie', 'Ines', 'Raj', 'Anika', 'Callum', 'Dani', 'Elise', 'Fraser', 'Gemma', 'Hugo', 'Imogen'];
const LAST = ['Anderson', 'Brown', 'Campbell', 'Davies', 'Edwards', 'Fraser', 'Graham', 'Harrison', 'Ito', 'Jones', 'Kelly', 'Lee', 'Murphy', 'Nguyen', 'OBrien', 'Patel', 'Quinn', 'Roberts', 'Smith', 'Taylor', 'Underwood', 'Vance', 'Walker', 'Xu', 'Young', 'Zhang', 'Abbott', 'Bailey', 'Chen', 'Dawson',
  'Ellis', 'Foster', 'Gibson', 'Hughes', 'Ingram', 'Jenkins', 'Khan', 'Lawson', 'Morgan', 'Nash', 'Owens', 'Price', 'Reid', 'Singh', 'Turner', 'Upton', 'Vaughan', 'Wallace', 'Yates', 'Zimmer', 'Archer', 'Barker', 'Carter', 'Dunn', 'Evans', 'Ford', 'Grant', 'Hayes', 'Irving', 'Johnson',
  'Keane', 'Lambert', 'Mills', 'Norris', 'Palmer', 'Rowe', 'Shaw', 'Tran', 'Vega', 'Wood', 'Yoon', 'Zahra', 'Alexander', 'Bell', 'Cooper', 'Doyle', 'Ferguson', 'Gill', 'Hall', 'Jackson'];
const FIRMS_A = ['Harbour', 'Bluegum', 'Ironbark', 'Saltbush', 'Wattle', 'Kestrel', 'Coral', 'Outback', 'Tide', 'Granite', 'Jarrah', 'Banksia', 'Cobalt', 'Meridian', 'Southern', 'Northgate', 'Eastbank', 'Westfield', 'Lyrebird', 'Kookaburra'];
const FIRMS_B = ['Capital', 'Ventures', 'Partners', 'Fund', 'Angels', 'Labs'];
const INVESTORS = FIRMS_A.flatMap((a) => FIRMS_B.map((b) => `${a} ${b}`)); // 120 invented firms
const INVESTOR_WEIGHTS = INVESTORS.map((name, i) => [name, 1 / (i + 1) ** 0.9]); // a few firms are in many companies

const KIND = ['software', 'platform', 'tools', 'infrastructure', 'marketplace', 'services', 'hardware', 'analytics'];
const FOR = ['clinics', 'farms', 'builders', 'lenders', 'schools', 'retailers', 'councils', 'miners', 'exporters', 'landlords', 'carers', 'teams'];
const STREETS = ['George', 'Collins', 'Elizabeth', 'King', 'Queen', 'Bourke', 'Flinders', 'Pitt', 'Kippax', 'Crown', 'Oxford', 'Swan', 'Chapel', 'Lonsdale', 'Little Bourke', 'Mary', 'Albert', 'Hunter'];
const SUFFIX = ['Street', 'Road', 'Lane', 'Place', 'Avenue'];

function pickMany(rand, entries, count) {
  const chosen = new Set();
  let guard = 0;
  while (chosen.size < count && guard < count * 20) { chosen.add(weighted(rand, entries)); guard += 1; }
  return [...chosen];
}

export function generateCompanies(count, { seed = 1 } = {}) {
  const rand = rng(seed * 7919 + count);
  const combos = A.length * B.length;
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const p = (i * 7727) % combos; // a permutation, so names are unique and not in alphabetical runs
    const name = `${A[p % A.length]} ${B[Math.floor(p / A.length) % B.length]}${i >= combos ? ` ${Math.floor(i / combos) + 1}` : ''}`;
    const id = slugify(name);
    const [city, state, clat, clng, , spread, hot] = weighted(rand, CITIES.map((c) => [c, c[4]]));
    const verified = city !== 'Unknown';
    // A company known only to its city has no point: a city centre is not where it is.
    const precision = verified ? weighted(rand, PRECISIONS) : 'UNKNOWN';
    const pinned = precision === 'EXACT' || precision === 'SUBURB';
    let lat = null;
    let lng = null;
    if (pinned) {
      const spot = hot.find((h) => rand() < h[3]);
      const [centreLat, centreLng, s] = spot ? [spot[0], spot[1], spot[2]] : [clat, clng, spread];
      lat = Math.round((centreLat + gauss(rand) * s) * 1e5) / 1e5;
      lng = Math.round((centreLng + gauss(rand) * s * 1.2) * 1e5) / 1e5;
    }
    const sector = weighted(rand, SECTORS);
    const hiring = rand() < 0.32;
    const founders = rand() < 0.49 ? Array.from({ length: weighted(rand, [[1, 5], [2, 4], [3, 1]]) }, () => `${pick(rand, FIRST)} ${pick(rand, LAST)}`) : undefined;
    const investors = pickMany(rand, INVESTOR_WEIGHTS, weighted(rand, INVESTOR_COUNT));
    const compact = id.replace(/-/g, '');
    const suburb = pinned ? pick(rand, SUBURBS[city] ?? [city]) : null;
    const postcode = pinned ? String(POSTCODE_BASE[state] + Math.floor(rand() * 90)).padStart(4, '0') : null;
    // About a fifth of the exact addresses have been checked against the company's own page, as in the real directory.
    const checked = precision === 'EXACT' && rand() < 0.22;
    out.push({
      name, sector, sectorFull: rand() < 0.4 && sector !== 'Unknown' ? `${sector} / ${pick(rand, SIDE)}` : sector, city, lat, lng, investors,
      stage: weighted(rand, STAGES), hiring, verified, website: rand() < 0.79 ? `https://www.${compact}.test` : '',
      blurb: `${pick(rand, ['Smart', 'Modern', 'Simple', 'Open', 'Fast', 'Secure', 'Local', 'Automated'])} ${pick(rand, KIND)} for ${pick(rand, FOR)}.`,
      taskGate: { enabled: hiring && rand() < 0.28, type: null },
      ...(precision === 'EXACT' ? { address: `${1 + Math.floor(rand() * 400)} ${pick(rand, STREETS)} ${pick(rand, SUFFIX)}, ${suburb}, ${city} ${state} ${postcode}` } : {}),
      ...(precision === 'SUBURB' ? { address: `${suburb}, ${city} ${state} ${postcode}` } : {}),
      ...(founders ? { founders } : {}),
      ...(rand() < 0.12 ? { foundedYear: 2008 + Math.floor(rand() * 18) } : {}),
      id, slug: id, logo: null, subsector: null, state, country: verified ? 'Australia' : null, suburb, postcode, company_status: null,
      location_precision: precision, location_source: verified ? (checked ? 'company_website' : 'directory_record') : null,
      location_source_url: checked ? `https://www.${compact}.test/contact` : null, location_verified_at: checked ? CHECKED_AT : null,
      location_confidence: verified ? (checked ? 'medium' : 'low') : null,
      hiring_status: hiring ? 'hiring' : null, hiring_verified_at: hiring ? HIRING_CHECKED_AT : null,
      employee_range: null, funding_total: null, last_funding_date: null, last_funding_round: null,
      verification_status: verified ? 'location_verified' : 'unverified', confidence_score: null, created_at: null, updated_at: null, last_verified_at: null,
      founder_ids: (founders ?? []).map(slugify), investor_ids: investors.map(slugify), source_ids: [],
    });
    if (out.at(-1).taskGate.enabled) out.at(-1).taskGate.type = 'Coding task';
  }
  return out;
}

// Writes <dir>/startups.json. Refuses the real data directory, and any directory called src/data.
export async function writeFixture(count, dir, options = {}) {
  const target = path.resolve(dir);
  const inside = path.relative(REAL_DATA, target);
  if (!inside.startsWith('..') && !path.isAbsolute(inside)) throw new Error(`refusing to write synthetic companies into ${REAL_DATA}: fixtures belong in a temporary folder`);
  if (/[\\/]src[\\/]data$/i.test(target)) throw new Error('refusing to write synthetic companies into a src/data folder');
  await mkdir(target, { recursive: true });
  const file = path.join(target, 'startups.json');
  await writeFile(file, `${JSON.stringify(generateCompanies(count, options), null, 2)}\n`);
  return file;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : fallback; };
  const size = Number(arg('size', 213));
  const out = arg('out');
  if (!out) { console.error('usage: node scripts/scale/fixtures.js --size 5000 --out <a temporary folder>'); process.exitCode = 2; } else {
    writeFixture(size, out).then((f) => console.log(`${size} synthetic companies -> ${f}`), (e) => { console.error(`error: ${e.message}`); process.exitCode = 1; });
  }
}
