import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rowOf, slug, isLinkedIn, CLOSED, cleanAddress, sharedWords } from '../scripts/perth/rows.mjs';
import { placeOfAddress } from '../src/geo/metro.js';

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
