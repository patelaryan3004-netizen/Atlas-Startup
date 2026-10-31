import { describe, it, expect } from 'vitest';
import { placeOfAddress } from '../scripts/portfolio/places.mjs';
import { SOURCES, usableWebsite, websiteFromProfile, sourceById } from '../scripts/portfolio/sources.mjs';

// The portfolio importer's pure parts: where an address puts a company, which link is a company's own website, and how each portfolio page is read.

describe('the city an address puts a company in', () => {
  it('names one of the ten cities from the state and a postcode inside its range', () => {
    expect(placeOfAddress('80 George St, The Rocks NSW 2000')).toEqual({ city: 'Sydney', state: 'NSW', postcode: '2000' });
    expect(placeOfAddress('Level 3, 12 Collins St, Melbourne VIC 3000').city).toBe('Melbourne');
    expect(placeOfAddress('2/290 Boundary Street, Spring Hill QLD 4000').city).toBe('Brisbane');
    expect(placeOfAddress('Surfers Paradise QLD 4217').city).toBe('Gold Coast');
    expect(placeOfAddress('1 King William St, Adelaide SA 5000').city).toBe('Adelaide');
    expect(placeOfAddress('St Georges Terrace, Perth WA 6000').city).toBe('Perth');
    expect(placeOfAddress('Salamanca Place, Hobart TAS 7000').city).toBe('Hobart');
    expect(placeOfAddress('Mitchell St, Darwin NT 0800').city).toBe('Darwin');
    expect(placeOfAddress('London Circuit, Canberra ACT 2601').city).toBe('Canberra');
    expect(placeOfAddress('Hunter St, Newcastle NSW 2300').city).toBe('Newcastle');
  });

  it('gives the state but no city when the postcode is outside the ten cities, and nothing when there is no state and postcode', () => {
    expect(placeOfAddress('Main St, Orange NSW 2800')).toEqual({ city: null, state: 'NSW', postcode: '2800' });
    expect(placeOfAddress('Level 9, 1 Market St')).toBeNull();
    expect(placeOfAddress(null)).toBeNull();
    expect(placeOfAddress('Sydney, Australia')).toBeNull(); // a name alone is not an address
  });

  it('does not take a postcode that belongs to another state (2600 is Canberra only with the ACT)', () => {
    expect(placeOfAddress('Somewhere NSW 2610').city).toBeNull();
    expect(placeOfAddress('Somewhere ACT 2610').city).toBe('Canberra');
  });
});

describe('which link is a company\'s own website', () => {
  it('is not a social page, a job board, a map link or a news site', () => {
    for (const url of ['https://www.linkedin.com/company/x', 'https://goo.gl/maps/abc', 'https://twitter.com/x', 'https://x.com/x', 'https://www.crunchbase.com/organization/x', 'https://squarepeg.getro.com/jobs']) {
      expect(usableWebsite(url), url).toBe(false);
    }
    for (const url of ['https://www.amber.com.au/', 'https://eucalyptus.vc/', 'https://beapplied.com']) expect(usableWebsite(url), url).toBe(true);
    expect(usableWebsite('not a url')).toBe(false);
  });

  const page = (links) => `<html><body>${links.map(([href, text]) => `<a href="${href}">${text}</a>`).join('')}</body></html>`;

  it('is the link called "website" or "visit", ahead of the firm\'s own pages and its social links', () => {
    const html = page([['/jobs', 'Jobs'], ['https://www.linkedin.com/company/x', 'LinkedIn'], ['https://eucalyptus.vc/', 'Website'], ['https://other.example/', 'Other']]);
    expect(websiteFromProfile(html, 'https://www.airtree.vc/companies/eucalyptus', { ownHosts: ['airtree.vc'], label: /^website$/i })).toBe('https://eucalyptus.vc/');
  });

  it('is the one external link left when none is labelled, and nothing when more than one is (a person looks)', () => {
    const one = page([['https://www.linkedin.com/company/x', 'LinkedIn'], ['https://thecompany.example/', 'x']]);
    expect(websiteFromProfile(one, 'https://firm.example/portfolio/x', { ownHosts: ['firm.example'] })).toBe('https://thecompany.example/');
    const two = page([['https://a.example/', 'x'], ['https://b.example/', 'y']]);
    expect(websiteFromProfile(two, 'https://firm.example/portfolio/x', { ownHosts: ['firm.example'] })).toBeNull();
  });
});

describe('how each portfolio page is read', () => {
  it('has a source for each page: a firm or an accelerator, read as profiles or as a direct list, with the investor it names', () => {
    expect(SOURCES.map((s) => s.id)).toEqual([
      'blackbird-portfolio', 'airtree-portfolio', 'squarepeg-portfolio', 'oneventures-portfolio', 'investible-portfolio', 'startmate-portfolio', 'folklore-portfolio', 'giantleap-portfolio', 'cicada-residents',
    ]);
    for (const s of SOURCES) {
      expect(['profiles', 'direct'], s.id).toContain(s.mode);
      expect(['vc_portfolio', 'accelerator_portfolio'], s.id).toContain(s.kind);
      expect(s.listUrl, s.id).toMatch(/^https:\/\//);
      expect(typeof s.parseList, s.id).toBe('function');
      if (s.mode === 'profiles') expect(typeof s.parseProfile, s.id).toBe('function');
    }
    expect(sourceById('cicada-residents').investor).toBeNull(); // a residency is not an investment
    expect(sourceById('blackbird-portfolio').investor).toBe('Blackbird');
  });

  it('finds the profile of each company on a listing and ignores the listing\'s own links', () => {
    const html = '<a href="/portfolio">Portfolio</a><a href="/portfolio/canva">Canva</a><a href="/portfolio/culture-amp">Culture Amp</a><a href="/blog/x">Post</a><a href="/portfolio/canva">Canva</a>';
    const found = sourceById('blackbird-portfolio').parseList(html, 'https://www.blackbird.vc/portfolio');
    expect(found.map((f) => f.profile_url)).toEqual(['https://www.blackbird.vc/portfolio/canva', 'https://www.blackbird.vc/portfolio/culture-amp']);
  });

  it('reads a company\'s name, website and description off its profile page', () => {
    const html = '<html><head><title>Eucalyptus | Blackbird</title><meta name="description" content="Direct-to-consumer healthcare brands."></head><body><a href="https://jobs.blackbird.vc/jobs">Startup Jobs</a><a href="http://eucalyptus.vc/">Visit WEBsite</a></body></html>';
    const facts = sourceById('blackbird-portfolio').parseProfile(html, 'https://www.blackbird.vc/portfolio/eucalyptus');
    expect(facts).toEqual({ name: 'Eucalyptus', website: 'http://eucalyptus.vc/', description: 'Direct-to-consumer healthcare brands.' });
  });

  it('reads the companies of a list that carries them directly: a name, a website and a line', () => {
    const cicada = '<ul><li><h4><a href="https://www.ant61.com/" target="_blank">ANT61</a></h4> <p class="x">Leader in spacecraft reliability.</p></li></ul>';
    expect(sourceById('cicada-residents').parseList(cicada, 'https://www.cicadainnovations.com/incubator/residents')).toEqual([
      { name: 'ANT61', website: 'https://www.ant61.com/', description: 'Leader in spacecraft reliability.' },
    ]);
    const giant = '<a href="https://www.amber.com.au/" target="_blank" class="portfolio_item w-inline-block"><div>Climate</div><h3 class="h">Amber</h3><p class="t">Energy retailer.</p></a>';
    expect(sourceById('giantleap-portfolio').parseList(giant, 'https://www.giantleap.com.au/portfolio')).toEqual([
      { name: 'Amber', website: 'https://www.amber.com.au/', description: 'Energy retailer.' },
    ]);
  });
});
