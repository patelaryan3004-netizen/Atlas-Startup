import { describe, it, expect } from 'vitest';
import {
  nameKey, looseNameKey, nameTokens, parseNameVariants, similarity, canonicalDomain, websiteUrl, registrableDomain,
  isValidABN, isValidACN, normalizeABN, normalizeACN, normalizeAddress, cityKey, personKey,
} from '../src/models/identity.js';

describe('nameKey', () => {
  it('makes punctuation, spacing and case irrelevant: the Leonardo example', () => {
    expect(nameKey('Leonardo.Ai')).toBe('leonardoai');
    expect(nameKey('Leonardo AI')).toBe('leonardoai');
    expect(nameKey('LEONARDO.AI')).toBe(nameKey('leonardo ai'));
    expect(nameKey('Open AI')).toBe(nameKey('OpenAI'));
  });

  it('drops legal-form words and a leading "the", but not when that is all there is', () => {
    expect(nameKey('Acme Pty Ltd')).toBe('acme');
    expect(nameKey('ACME Pty. Limited')).toBe('acme');
    expect(nameKey('The Memo')).toBe('memo');
    expect(nameKey('Limited')).toBe('limited');
  });

  it('reads & as "and", strips accents and ignores a parenthetical', () => {
    expect(nameKey('Black & White')).toBe(nameKey('Black and White'));
    expect(nameKey('Café Co')).toBe('cafe');
    expect(nameKey('Hone (HoneAg)')).toBe('hone');
  });

  it('is empty for nothing', () => {
    expect(nameKey('')).toBe('');
    expect(nameKey(null)).toBe('');
    expect(nameKey('...')).toBe('');
  });

  it('does not treat different names as the same', () => {
    expect(nameKey('Canva')).not.toBe(nameKey('Canvas'));
    expect(nameKey('Zero Latency')).not.toBe(nameKey('Zero'));
  });
});

describe('looseNameKey and nameTokens', () => {
  it('also drops trailing descriptive words, so a suffix does not hide a match', () => {
    expect(looseNameKey('DataMesh Group')).toBe('datamesh');
    expect(looseNameKey('Foo Labs')).toBe('foo');
    expect(looseNameKey('Foo Technologies Pty Ltd')).toBe('foo');
    expect(looseNameKey('Group')).toBe('group');
  });

  it('keeps "AI" in the name: it is often part of the brand', () => {
    expect(looseNameKey('Leonardo AI')).toBe('leonardoai');
    expect(looseNameKey('Leonardo AI')).not.toBe(looseNameKey('Leonardo'));
  });

  it('lists the name tokens without legal forms', () => {
    expect(nameTokens('The Who Gives a Crap Pty Ltd')).toEqual(['who', 'gives', 'a', 'crap']);
  });
});

describe('parseNameVariants', () => {
  it('splits the aliases and former names the legacy data keeps inside the name', () => {
    expect(parseNameVariants('Hone (HoneAg)')).toEqual({ primary: 'Hone', aliases: ['HoneAg'], formerNames: [] });
    expect(parseNameVariants('Cor (Cor AI)')).toEqual({ primary: 'Cor', aliases: ['Cor AI'], formerNames: [] });
    expect(parseNameVariants('Brumby (formerly GrazeMate)')).toEqual({ primary: 'Brumby', aliases: [], formerNames: ['GrazeMate'] });
    expect(parseNameVariants('Start My Tomorrow (TMRW)')).toEqual({ primary: 'Start My Tomorrow', aliases: ['TMRW'], formerNames: [] });
    expect(parseNameVariants('Sherpa (4You Innovation)').aliases).toEqual(['4You Innovation']);
  });

  it('understands the usual ways of saying "formerly" and "also known as"', () => {
    expect(parseNameVariants('Foo (fka Bar)').formerNames).toEqual(['Bar']);
    expect(parseNameVariants('Foo (previously Bar Pty Ltd)').formerNames).toEqual(['Bar Pty Ltd']);
    expect(parseNameVariants('Foo (aka Baz)').aliases).toEqual(['Baz']);
    expect(parseNameVariants('Foo (t/a Baz)').aliases).toEqual(['Baz']);
  });

  it('leaves a plain name alone and never returns an empty primary', () => {
    expect(parseNameVariants('Canva')).toEqual({ primary: 'Canva', aliases: [], formerNames: [] });
    expect(parseNameVariants('(Acme)').primary).toBe('(Acme)');
  });
});

describe('similarity', () => {
  it('is 1 for the same key and 0 for nothing', () => {
    expect(similarity('canva', 'canva')).toBe(1);
    expect(similarity('', 'canva')).toBe(0);
  });

  it('scores a typo or dropped letter high and unrelated names low', () => {
    expect(similarity('datamesh', 'datamesh')).toBe(1);
    expect(similarity('everlab', 'everlabs')).toBeGreaterThan(0.85);
    expect(similarity('canva', 'xero')).toBeLessThan(0.4);
    expect(similarity('blackbird', 'airtree')).toBeLessThan(0.4);
  });

  it('is symmetric', () => {
    expect(similarity('lyrebirdhealth', 'lyrebird')).toBeCloseTo(similarity('lyrebird', 'lyrebirdhealth'), 10);
  });
});

describe('canonicalDomain', () => {
  it('reduces any spelling of a website to the same registrable domain', () => {
    for (const input of ['https://www.Leonardo.ai/path?x=1', 'leonardo.ai', 'HTTP://leonardo.ai/', 'https://app.leonardo.ai', 'https://leonardo.ai:8443']) {
      expect(canonicalDomain(input), input).toMatchObject({ domain: 'leonardo.ai', shared: false, nonCompany: false });
    }
  });

  it('knows two-part suffixes: sherpa.net.au, not net.au', () => {
    expect(canonicalDomain('https://sherpa.net.au').domain).toBe('sherpa.net.au');
    expect(canonicalDomain('https://app.shop.sherpa.net.au/x').domain).toBe('sherpa.net.au');
    expect(canonicalDomain('https://unloan.com.au').domain).toBe('unloan.com.au');
    expect(registrableDomain('a.b.example.co.uk')).toBe('example.co.uk');
  });

  it('takes the domain out of an email address', () => {
    expect(canonicalDomain('hello@sherpa.net.au').domain).toBe('sherpa.net.au');
  });

  it('keeps the whole host on a shared platform, where the subdomain is the tenant', () => {
    const a = canonicalDomain('https://acme.netlify.app');
    const b = canonicalDomain('https://other.netlify.app');
    expect(a).toMatchObject({ domain: 'acme.netlify.app', shared: true });
    expect(a.domain).not.toBe(b.domain);
  });

  it("treats a platform's own address as an ordinary company site, and only its subdomains as tenants", () => {
    // Linktree's own website is linktr.ee. Its users' profiles are paths on it.
    expect(canonicalDomain('https://linktr.ee')).toMatchObject({ domain: 'linktr.ee', shared: false, nonCompany: false });
    expect(canonicalDomain('https://linktr.ee/acme').nonCompany).toBe(true);
    expect(canonicalDomain('https://medium.com/@acme').nonCompany).toBe(true);
    expect(canonicalDomain('https://medium.com')).toMatchObject({ domain: 'medium.com', nonCompany: false });
    expect(canonicalDomain('https://acme.medium.com')).toMatchObject({ domain: 'acme.medium.com', shared: true });
    expect(canonicalDomain('https://netlify.app')).toMatchObject({ domain: 'netlify.app', shared: false });
  });

  it('flags hosts that can never identify a company: social, registries, directories and press', () => {
    for (const url of ['https://www.linkedin.com/company/acme', 'https://au.linkedin.com/in/someone', 'https://x.com/acme', 'https://www.startupdaily.net/topic/funding/foo/', 'https://www.crunchbase.com/organization/acme']) {
      expect(canonicalDomain(url).nonCompany, url).toBe(true);
    }
    expect(canonicalDomain('https://airwallex.com').nonCompany).toBe(false);
    expect(canonicalDomain('https://vulnetix.com').nonCompany).toBe(false);
  });

  it('returns null for anything that is not a usable public host', () => {
    for (const input of ['', null, undefined, 'localhost', 'https://localhost:3000', 'http://192.168.0.1', 'https://[::1]/', 'ftp://acme.com', 'not a url', 'intranet']) {
      expect(canonicalDomain(input), String(input)).toBeNull();
    }
  });

  it('builds a clean https URL, and none for a host that is not a company site', () => {
    expect(websiteUrl('Leonardo.ai/careers')).toBe('https://leonardo.ai');
    expect(websiteUrl('http://www.sherpa.net.au')).toBe('https://sherpa.net.au');
    expect(websiteUrl('https://linkedin.com/company/acme')).toBeNull();
    expect(websiteUrl('')).toBeNull();
  });
});

describe('ABN and ACN', () => {
  it('validates with the published algorithms', () => {
    expect(isValidABN('53004085616')).toBe(true); // ATO's worked example: 445 = 5 x 89
    expect(isValidABN('53 004 085 616')).toBe(true);
    expect(isValidABN('53004085617')).toBe(false);
    expect(isValidABN('5300408561')).toBe(false);
    expect(isValidACN('004085616')).toBe(true);
    expect(isValidACN('004 085 616')).toBe(true);
    expect(isValidACN('004085617')).toBe(false);
    expect(isValidACN('00408561')).toBe(false);
  });

  it("accepts Fastlane's ACN as published in its privacy policy", () => {
    expect(isValidACN('690 900 497')).toBe(true);
    expect(isValidACN('690 900 498')).toBe(false);
  });

  it('normalises a valid number to digits and rejects an invalid one', () => {
    expect(normalizeABN('53 004 085 616')).toBe('53004085616');
    expect(normalizeACN('690 900 497')).toBe('690900497');
    expect(normalizeABN('12 345 678 901')).toBeNull();
    expect(normalizeACN('123456789')).toBeNull();
    expect(normalizeABN(null)).toBeNull();
  });
});

describe('addresses, cities and people', () => {
  it('compares street addresses regardless of unit prefixes and abbreviations', () => {
    expect(normalizeAddress('Level 3, 10 George St, Sydney NSW 2000')).toBe(normalizeAddress('10 George Street Sydney NSW 2000'));
    expect(normalizeAddress('Suite 5/18 Wangaratta Rd, Richmond VIC 3121')).toContain('wangaratta road richmond vic 3121');
    expect(normalizeAddress('1 George St, Sydney NSW 2000')).not.toBe(normalizeAddress('2 George St, Sydney NSW 2000'));
  });

  it('keys a city without its suburb, and treats Unknown as nothing', () => {
    expect(cityKey('Sydney (Chippendale)')).toBe('sydney');
    expect(cityKey('  MELBOURNE ')).toBe('melbourne');
    expect(cityKey('Unknown')).toBeNull();
    expect(cityKey('')).toBeNull();
  });

  it('identifies a person only by a full name', () => {
    expect(personKey('Melanie  Perkins')).toBe('melanie perkins');
    expect(personKey('Zoë Smith-Jones')).toBe('zoe smith-jones');
    expect(personKey('Cher')).toBeNull();
    expect(personKey('')).toBeNull();
  });
});
