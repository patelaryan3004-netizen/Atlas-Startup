import { describe, it, expect } from 'vitest';
import { startupDescription, startupJsonLd } from '../src/seo.js';

describe('what a company page tells a search engine', () => {
  it('describes a company by its own blurb', () => {
    expect(startupDescription({ name: 'Canva', blurb: 'Design for everyone', sector: 'AI', city: 'Sydney' })).toBe('Design for everyone');
  });

  it('otherwise says who and where from the fields it has, and says no sector it does not know', () => {
    expect(startupDescription({ name: 'Acme', sector: 'Fintech', city: 'Sydney', state: 'NSW' })).toBe('Acme Fintech startup in Sydney, NSW');
    expect(startupDescription({ name: 'Acme', sector: 'Unknown', city: 'Perth' })).toBe('Acme startup in Perth');
    expect(startupDescription({ name: 'Acme' })).toBe('Acme startup in Australia');
  });

  it('writes an Organization from the fields the record has, and nothing it does not', () => {
    const ld = startupJsonLd({
      name: 'Culture Amp', website: 'https://www.cultureamp.com', blurb: 'Employee engagement', foundedYear: 2011, city: 'Melbourne', state: 'VIC', country: 'Australia',
      address: 'Level 2/29 Stewart St, Richmond VIC 3121', postcode: '3121', location: { precision: 'EXACT' }, founders: ['Didier Elzinga', 'Jon Williamson'],
    });
    expect(ld).toEqual({
      '@context': 'https://schema.org', '@type': 'Organization', name: 'Culture Amp', url: 'https://www.cultureamp.com', description: 'Employee engagement', foundingDate: '2011',
      address: { '@type': 'PostalAddress', addressLocality: 'Melbourne', addressRegion: 'VIC', streetAddress: 'Level 2/29 Stewart St, Richmond VIC 3121', postalCode: '3121', addressCountry: 'AU' },
      founder: [{ '@type': 'Person', name: 'Didier Elzinga' }, { '@type': 'Person', name: 'Jon Williamson' }],
    });
  });

  it('gives a street address only for an office that is known: a suburb or a city stays a city', () => {
    const base = { name: 'X', city: 'Sydney', state: 'NSW', address: '1 Example St', postcode: '2000' };
    for (const precision of ['SUBURB', 'CITY', 'STATE', 'UNKNOWN', undefined]) {
      const ld = startupJsonLd({ ...base, location: precision ? { precision } : undefined });
      expect(ld.address.streetAddress).toBeUndefined();
      expect(ld.address.postalCode).toBeUndefined();
    }
  });

  it('leaves out what is missing: no address, founders, website, blurb or founding year', () => {
    expect(startupJsonLd({ name: 'Bare Co', city: 'Unknown' })).toEqual({ '@context': 'https://schema.org', '@type': 'Organization', name: 'Bare Co' });
  });
});
