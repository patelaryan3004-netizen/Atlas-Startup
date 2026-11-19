import { describe, it, expect } from 'vitest';
import { oneSentence, cardSector, cardPlace } from '../src/popupText.js';

// The words of a pin's card: one sentence, the sector, and where it is.
describe('the one sentence of a card', () => {
  it('is the first sentence of what the company says, and nothing it did not say', () => {
    expect(oneSentence('Makes clinical software. It is used in 200 hospitals.')).toBe('Makes clinical software.');
    expect(oneSentence('Link-in-bio and creator landing page platform')).toBe('Link-in-bio and creator landing page platform'); // no full stop: one sentence
    expect(oneSentence('Is it new? Yes.')).toBe('Is it new?');
    expect(oneSentence('')).toBe('');
    expect(oneSentence(null)).toBe('');
    expect(oneSentence('   ')).toBe('');
    expect(oneSentence('Many   spaces\n and   lines. Next one.')).toBe('Many spaces and lines.');
  });

  it('does not stop at an abbreviation or a number with a full stop in it', () => {
    expect(oneSentence('Acme Pty. ltd builds tools for builders. Another sentence.')).toBe('Acme Pty. ltd builds tools for builders.');
    expect(oneSentence('Version 2.5 of the platform is live. Next.')).toBe('Version 2.5 of the platform is live.');
  });

  it('cuts a long sentence at a word with an ellipsis, within the limit, and leaves a short one whole', () => {
    const long = `${'Builds software that helps clinics book and bill and follow up with patients '.repeat(6)}done.`;
    const cut = oneSentence(long, 100);
    expect(cut.length).toBeLessThanOrEqual(100);
    expect(cut.endsWith('…')).toBe(true);
    expect(cut).not.toMatch(/[\s,;:]…$/);
    expect(long.startsWith(cut.slice(0, -1))).toBe(true); // a prefix of what the company said, nothing added
    expect(oneSentence('Short one.', 100)).toBe('Short one.');
  });
});

describe('the sector of a card', () => {
  it('is the display sector the server sent, else what the source said, and never "Unknown"', () => {
    expect(cardSector({ sectorGroup: 'Health & Biotech', sector: 'HealthTech' })).toBe('Health & Biotech');
    expect(cardSector({ sector: 'HealthTech' })).toBe('HealthTech'); // an older answer, with no display sector
    expect(cardSector({ sector: 'Unknown' })).toBe('');
    expect(cardSector({ sectorGroup: null, sector: 'unknown' })).toBe('');
    expect(cardSector(null, undefined)).toBe('');
  });

  it('takes the display sector from whichever of the places that know it does, before any raw label', () => {
    expect(cardSector(null, { sector: 'Fintech' }, { sectorGroup: 'Fintech', sector: 'Insurtech' })).toBe('Fintech');
    expect(cardSector({ sector: 'Insurtech' }, { sectorGroup: 'Fintech' })).toBe('Fintech');
  });
});

describe('the place of a card', () => {
  it('is the suburb and the city, the city alone, or nothing: never a street', () => {
    expect(cardPlace({ suburb: 'Surry Hills', city: 'Sydney' })).toBe('Surry Hills, Sydney');
    expect(cardPlace({ suburb: 'Yatala', city: 'Yatala' })).toBe('Yatala'); // a suburb that is the city, once
    expect(cardPlace({ city: 'Perth' })).toBe('Perth');
    expect(cardPlace({ suburb: 'Fremantle', city: 'Unknown' })).toBe('Fremantle');
    expect(cardPlace({ city: '' })).toBe('');
    expect(cardPlace(null, {})).toBe('');
  });

  it('reads the record first and the pin after it for what the first does not say', () => {
    expect(cardPlace({ suburb: 'Collingwood' }, { suburb: 'Fitzroy', city: 'Melbourne' })).toBe('Collingwood, Melbourne');
    expect(cardPlace(null, { suburb: 'Fitzroy', city: 'Melbourne' })).toBe('Fitzroy, Melbourne');
  });
});
