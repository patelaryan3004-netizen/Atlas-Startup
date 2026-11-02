import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rowOf, slug, isLinkedIn, CLOSED, cleanAddress, sharedWords } from '../scripts/places/rows.mjs';
import { placeOfAddress } from '../src/geo/metro.js';
import { CITIES, matchersOf } from '../scripts/places/cities.mjs';

// The Perth research list is research, not fact: how its rows are read, and what counts as a Greater Perth address.

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'perth', 'research', 'perth-startups-research-2026-10-31.json');

describe('a row of the research list', () => {
  it('has a clean name, and keeps the other names it gives: a name in brackets, and "Previously X / Y"', () => {
    const rhizo = rowOf({ name: 'Rhizo Tech (Canopy)', group: 'perth_pre_accelerator_2026', perth_relationship: 'perth_programme_not_location_proof', sources: ['https://blog.spacecubed.com/x'] });
    expect(rhizo).toMatchObject({ key: 'rhizotech', name: 'Rhizo Tech', aliases: ['Canopy'] });
    const komo = rowOf({ name: 'Komo', note: 'Previously QuizJam / Komo Digital; one company record.', sources: [] });
    expect(komo.aliases).toEqual(['QuizJam', 'Komo Digital']);
    expect(rowOf({ name: 'StayOnHire', note: 'Previously Idle Australia; one company record.', sources: [] }).aliases).toEqual(['Idle Australia']);
    expect(rowOf({ name: 'Plain', note: 'Separate from early-stage startups; check ownership.', sources: [] }).aliases).toEqual([]);
  });

  it('keeps the website the research gave, null when it gave none, and the group and relationship, so nothing is promoted to "confirmed Perth"', () => {
    const row = rowOf({ name: 'Momentify', website: 'https://peachie.au/', group: 'plus_eight_2026', perth_relationship: 'perth_programme_not_location_proof', sources: [] });
    expect(row).toMatchObject({ website: 'https://peachie.au/', group: 'plus_eight_2026', relationship: 'perth_programme_not_location_proof' });
    expect(rowOf({ name: 'Absolute VR', sources: [] }).website).toBeNull();
  });

  it('never lists a LinkedIn page as a source to read, and says it skipped one', () => {
    const row = rowOf({ name: 'Bamboo', sources: ['https://au.linkedin.com/company/getbambooapp', 'https://example.com/a'] });
    expect(row.sources).toEqual(['https://example.com/a']);
    expect(row.skippedSources).toEqual(['https://au.linkedin.com/company/getbambooapp']);
    expect(isLinkedIn('https://www.linkedin.com/in/someone')).toBe(true);
    expect(isLinkedIn('https://notlinkedin.com/')).toBe(false);
    expect(isLinkedIn('not a url')).toBe(false);
  });

  it('makes a key from the name that does not change with case, punctuation or accents', () => {
    expect(slug('Déjà Vu')).toBe(slug('deja vu'));
    expect(slug('Ocean Hex')).toBe('oceanhex');
  });
});

describe('the research file', () => {
  const research = JSON.parse(readFileSync(FILE, 'utf8'));

  it('has the 210 rows its counts say, in the groups it names, with no name twice', () => {
    expect(research.companies).toHaveLength(research.counts.total);
    const names = research.companies.map((c) => rowOf(c).key);
    expect(new Set(names).size).toBe(names.length);
    expect(research.companies.filter((c) => c.group === 'perth_evidence')).toHaveLength(research.counts.perth_location_evidence);
    expect(research.companies.filter((c) => c.group === 'established_or_listed_tech').length).toBeGreaterThan(0);
  });

  it('says in its own words that it is research: only the perth_evidence group reports a Perth location, and a programme or an investor never does', () => {
    for (const c of research.companies) {
      if (/programme|investor_portfolio|award/.test(c.perth_relationship)) expect(c.group, c.name).not.toBe('perth_evidence');
    }
  });
});

describe('what counts as Greater Perth', () => {
  it('is a Western Australian address with a postcode inside the Perth range, and not a regional town', () => {
    expect(placeOfAddress('Head Office Unit 3/33 Millrose Dr, Malaga Western Australia 6090')).toBeNull(); // "Western Australia" spelled out is not a state code: the page text is read for WA
    expect(placeOfAddress('Unit 3/33 Millrose Dr, Malaga WA 6090').city).toBe('Perth');
    expect(placeOfAddress('L32 152-158 St Georges Terrace, Perth, WA 6000').city).toBe('Perth');
    expect(placeOfAddress('Bentley Technology Park, 8/8 Sarich Way, Bentley WA 6102').city).toBe('Perth');
    expect(placeOfAddress('Hampton Street, Karratha WA 6714').city).toBeNull(); // regional WA
    expect(placeOfAddress('Bunbury WA 6230').city).toBeNull();
  });

  it('reads a postcode written before the state, and still says nothing for a state it does not know', () => {
    expect(placeOfAddress('West Perth 6005, WA')).toMatchObject({ city: 'Perth', state: 'WA', postcode: '6005' });
    expect(placeOfAddress('Perth, 6000, WA').city).toBe('Perth');
    expect(placeOfAddress('Perth')).toBeNull();
  });
});

describe('the street address a page gives', () => {
  it('is the address and not the page\'s wording around it', () => {
    expect(cleanAddress('Head office: 24 Hasler Road, Osborne Park, WA, 6017')).toBe('24 Hasler Road, Osborne Park, WA, 6017');
    expect(cleanAddress('5828 Address 30 Coolgardie St, West Perth, WA 6005')).toBe('30 Coolgardie St, West Perth, WA 6005'); // a run-in telephone number and a label
    expect(cleanAddress('Ltd 183 Stirling Hwy, Nedlands WA 6009')).toBe('183 Stirling Hwy, Nedlands WA 6009'); // "Pty Ltd" is not a level
    expect(cleanAddress('Level 17, 109 St Georges Terrace, Perth WA 6000')).toBe('Level 17, 109 St Georges Terrace, Perth WA 6000');
  });

  it('writes a level the way the location code reads one', () => {
    expect(cleanAddress('com L1 1109 Hay St, West Perth WA 6005')).toBe('Level 1, 1109 Hay St, West Perth WA 6005');
  });

  it('is null for a box number or a place with no street, so no pin is made from them', () => {
    expect(cleanAddress('GPO Box 5288, Sydney NSW 2001')).toBeNull();
    expect(cleanAddress('Perth WA 6000')).toBeNull();
    expect(cleanAddress(null)).toBeNull();
  });
});

describe('two descriptions of one company', () => {
  it('share words of five letters or more that are not the words every description has', () => {
    expect(sharedWords('Maintenance management software for mining plant', 'AiSpanner: maintenance management across the lifecycle')).toEqual(['maintenance', 'management']);
    expect(sharedWords('A platform for Perth startups', 'The Perth platform for founders')).toEqual([]); // every word they share is a common one
  });
});

describe('a page that says the business has stopped', () => {
  it('is caught, so a closed or acquired business is not published as an operating startup', () => {
    for (const text of ['Hall is now part of Tracksuit', 'We have closed our doors', 'The company has ceased trading', 'Acme has been acquired by Big Co']) expect(CLOSED.test(text), text).toBe(true);
    for (const text of ['We are part of the Spacecubed community', 'Acquire new customers faster']) expect(CLOSED.test(text), text).toBe(false);
  });
});

describe('a page that is a contract and not a closure notice', () => {
  it('is not read as a business that has stopped: insolvency wording in terms of service is not a closure', () => {
    for (const text of ['"Insolvency Event" means, for a person, being in liquidation or winding up', 'a resolution is passed for a party’s winding up', 'the other party is bankrupt, in a voluntary arrangement, in liquidation']) expect(CLOSED.test(text), text).toBe(false);
    for (const text of ['The company has been placed into voluntary administration', 'See-Mode has been acquired by DeepHealth', 'MOGLabs is now part of Santec']) expect(CLOSED.test(text), text).toBe(true);
  });
});

describe('what differs from one city to the next', () => {
  it('reads an address in the state of the city, and an address in another state as somewhere else', () => {
    const m = matchersOf(CITIES.melbourne);
    expect(m.normState('Level 3, 1 Collins Street, Melbourne 3000')).toBe('Level 3, 1 Collins Street, Melbourne VIC 3000');
    expect(m.normState('Collingwood Victoria 3066')).toBe('Collingwood VIC 3066');
    expect([...'Head office: 20 Woodruff St, Port Melbourne VIC 3207'.matchAll(m.addrFwd())]).toHaveLength(1);
    expect([...'1 George St, Sydney NSW 2000'.matchAll(m.otherState)]).toHaveLength(1);
    expect([...'Level 5, 1 Queens Rd, Melbourne VIC 3004'.matchAll(m.otherState)]).toHaveLength(0); // its own state is not "elsewhere"
    expect(m.statement.test('We are a Melbourne-based company')).toBe(true);
    expect(m.box.test('PO Box 59, Elwood')).toBe(true);
    const p = matchersOf(CITIES.perth);
    expect(p.normState('Perth 6000')).toBe('Perth WA 6000');
    expect(p.statement.test('a Perth-based startup')).toBe(true);
  });

  it('puts Geelong and Ballarat outside Greater Melbourne', () => {
    expect(placeOfAddress('1 Moorabool St, Geelong VIC 3220').city).toBeNull();
    expect(placeOfAddress('Level 9, 31 Queen St, Melbourne VIC 3000').city).toBe('Melbourne');
    expect(placeOfAddress('Monash University, Clayton VIC 3800').city).toBe('Melbourne');
  });
});

describe('the Melbourne research file', () => {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'melbourne', 'research', 'melbourne-startups-research-2026-10-31.json');
  const research = JSON.parse(readFileSync(file, 'utf8'));

  it('has the 342 rows its counts say, with no name twice, and reads its own relationship field', () => {
    expect(research.companies).toHaveLength(research.counts.total_research_records);
    const rows = research.companies.map(rowOf);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
    expect(rows.every((r) => r.relationship)).toBe(true);
    expect(rows.filter((r) => r.established)).toHaveLength(research.counts.established_or_acquired);
  });

  it('says a programme or a directory is not a Melbourne office: only the location-evidence group reports a place', () => {
    for (const c of research.companies) if (c.group === 'programme_lead') expect(c.melbourne_relationship, c.name).toBe('programme_association_only');
  });
});
