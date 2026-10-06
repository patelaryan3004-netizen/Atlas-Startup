import { describe, it, expect } from 'vitest';
import { addressParts, sameAddress } from '../src/models/identity.js';
import { valuesEqual } from '../src/models/evidence.js';

// Pairs that came out of reading real company sites against the addresses already on file.
const SAME = [
  ['Level 8, 10-14 Waterloo Street, Surry Hills NSW 2010', '10-14 Waterloo St, Surry Hills NSW 2010'],
  ['Level 8, 4 Martin Place, Sydney NSW 2000', '8/4 Martin Place, Sydney NSW 2000'],
  ['93 Shepherd St, Chippendale, Sydney NSW 2008', '93 Shepherd Street, CHIPPENDALE NSW 2008'],
  ['Level 7, 15 William Street, Melbourne VIC 3000', '15 William Street, Melbourne VIC 3000'],
  ['Suite 1.103/477 Pitt St, Haymarket NSW 2000', '477 Pitt Street, Haymarket NSW 2000'],
  ['1/477 Pitt Street, Sydney NSW 2000', 'Unit 12, 477 Pitt St, Sydney NSW 2000'],
  ['5 Collins Street, Melbourne', '5 Collins St, Melbourne VIC 3000'], // one side has no postcode
  // from the websites of companies already on file
  ['Mezzanine, Levels 1–3, 388 George Street, Sydney NSW 2000', '388 George Street, Sydney NSW 2000'],
  ['The Foundry, 1 Locomotive St, Eveleigh NSW 2015', '1 Locomotive St, Eveleigh NSW 2015'],
  ['Upper Ground, The Foundry, 1 Locomotive Street, Eveleigh NSW 2015', '1 Locomotive Street, Eveleigh NSW 2015'],
  ['L24/T3, 300 Barangaroo Ave, Sydney NSW 2000', '300 Barangaroo Ave, Sydney NSW 2000'],
  ['L6/365 Collins St, Melbourne VIC 3000', '365 Collins Street, Melbourne VIC 3000'],
  ['Studio 6, 124 Whitehall St, Footscray VIC 3011', '124 Whitehall Street, Footscray VIC 3011'],
  ['Level 7 127 Creek Street, Brisbane QLD 4000', '127 Creek St, Brisbane QLD 4000'],
  ['77 Darlington Drive, Yatala QLD 4207', 'Yatala QLD 4207'], // less specific, not contradictory
];
const DIFFERENT = [
  ['251 Riley Street, Surry Hills, Sydney NSW 2010', '115 Cooper St, Surry Hills NSW 2010'], // Propeller Aero: another street
  ['10 George Street, Sydney NSW 2000', '10 George Street, Parramatta NSW 2150'], // the same street name, another place
  ['4 Martin Place, Sydney NSW 2000', '14 Martin Place, Sydney NSW 2000'],
  ['5 Smith Road, Richmond VIC 3121', '5 Smith Street, Richmond VIC 3121'],
  ['L6/365 Collins St, Melbourne VIC 3000', '395 Collins St, Melbourne VIC 3000'], // Rosterfy: 365 or 395
  ['Kensington, Melbourne VIC 3031', '500 Collins Street, Melbourne VIC 3000'], // no street on one side, and the postcodes differ
  ['77 Darlington Drive, Yatala QLD 4207', 'Yatala QLD 4000'],
  ['Macquarie University Cyber Hub, Sydney NSW 2109', '4 Research Park Drive, Macquarie Park NSW 2113'],
];

describe('telling whether two addresses are the same place', () => {
  it('knows one place written two ways: unit, level, abbreviation, case and suburb are not what makes it different', () => {
    for (const [a, b] of SAME) {
      expect(sameAddress(a, b), `${a}  vs  ${b}`).toBe(true);
      expect(sameAddress(b, a), `${b}  vs  ${a}`).toBe(true);
    }
  });

  it('knows two places: another street number, street, or postcode', () => {
    for (const [a, b] of DIFFERENT) expect(sameAddress(a, b), `${a}  vs  ${b}`).toBe(false);
  });

  it('reads the street and postcode out of an address, and says so when there is no street', () => {
    expect(addressParts('Level 8, 10-14 Waterloo St, Surry Hills NSW 2010')).toEqual({ street: '10 14 waterloo street', postcode: '2010' });
    expect(addressParts('8/4 Martin Place, Sydney NSW 2000')).toEqual({ street: '4 martin place', postcode: '2000' });
    expect(addressParts('Mezzanine, Levels 1–3, 388 George Street, Sydney NSW 2000')).toEqual({ street: '388 george street', postcode: '2000' });
    expect(addressParts('Yatala QLD 4207')).toEqual({ street: null, postcode: '4207' });
    expect(addressParts('Sydney')).toBeNull();
    expect(addressParts(null)).toBeNull();
  });

  it('falls back to comparing the words when there is no street to compare', () => {
    expect(sameAddress('Sydney CBD', 'sydney  cbd')).toBe(true);
    expect(sameAddress('Sydney CBD', 'Melbourne CBD')).toBe(false);
  });

  it('is what the evidence model means by the same address, so a re-formatted address is not a conflict', () => {
    for (const [a, b] of SAME) expect(valuesEqual('address', a, b)).toBe(true);
    for (const [a, b] of DIFFERENT) expect(valuesEqual('address', a, b)).toBe(false);
    expect(valuesEqual('address', null, null)).toBe(true);
    expect(valuesEqual('address', '1 George Street', null)).toBe(false);
  });
});
