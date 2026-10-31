import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { BIG_CITIES, metroOf, metroOfPostcode, placeOfAddress } from '../src/geo/metro.js';

// A company's `city` is often its suburb. The ten big cities the map page lists find the companies in their suburbs too, by postcode, without changing any record.

describe('the big city a place belongs to', () => {
  it('lists the ten cities of the map page, in its order', () => {
    expect(BIG_CITIES).toEqual(['Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide', 'Canberra', 'Gold Coast', 'Newcastle', 'Hobart', 'Darwin']);
  });

  it('is decided by the state and the postcode, inside the city\'s own range', () => {
    expect(metroOfPostcode('NSW', '2060')).toBe('Sydney'); // North Sydney
    expect(metroOfPostcode('VIC', 3121)).toBe('Melbourne'); // Richmond
    expect(metroOfPostcode('QLD', '4006')).toBe('Brisbane');
    expect(metroOfPostcode('QLD', '4217')).toBe('Gold Coast');
    expect(metroOfPostcode('ACT', '2600')).toBe('Canberra');
    expect(metroOfPostcode('NT', '0800')).toBe('Darwin');
    expect(metroOfPostcode('NSW', '2800')).toBeNull(); // Orange is not Sydney
    expect(metroOfPostcode('QLD', '4575')).toBeNull(); // the Sunshine Coast is not one of the ten
    expect(metroOfPostcode('NSW', '3000')).toBeNull(); // a postcode of another state
    expect(metroOfPostcode(null, '2000')).toBeNull();
    expect(metroOfPostcode('NSW', 'abcd')).toBeNull();
  });

  it('reads a postcode off an address, and says nothing for an address without one', () => {
    expect(placeOfAddress('Level 14, 275 Alfred St, North Sydney NSW 2060')).toEqual({ city: 'Sydney', state: 'NSW', postcode: '2060' });
    expect(placeOfAddress('Level 14, 275 Alfred St')).toBeNull();
  });

  it('finds a company\'s big city from its own postcode, else its address, else the city it names if that is one of the ten', () => {
    expect(metroOf({ city: 'Richmond', state: 'VIC', postcode: '3121' })).toBe('Melbourne');
    expect(metroOf({ city: 'Chippendale', state: 'NSW', address: '25/12 Buckland Street, Chippendale NSW 2008' })).toBe('Sydney');
    expect(metroOf({ city: 'Perth', state: 'WA' })).toBe('Perth');
    expect(metroOf({ city: 'Orange', state: 'NSW', postcode: '2800' })).toBeNull();
    expect(metroOf({ city: 'Unknown' })).toBeNull();
  });
});

describe('the city filter', () => {
  it('finds the companies in a city\'s suburbs under the city, and still under the suburb\'s own name', async () => {
    const underCity = await request(app).get('/api/startups?city=Sydney&limit=200');
    const names = underCity.body.results.map((c) => c.name);
    expect(names).toContain('Asseti'); // its city on record is North Sydney
    const underSuburb = await request(app).get('/api/startups?city=North%20Sydney&limit=200');
    expect(underSuburb.body.results.map((c) => c.name)).toContain('Asseti');
    expect(underCity.body.count).toBeGreaterThanOrEqual(underSuburb.body.count);
  });

  it('counts a suburb\'s companies in its big city in the busiest cities, and does not list a suburb as a city of its own there', async () => {
    const summary = await request(app).get('/api/startups/summary');
    const cities = summary.body.topCities.map((c) => c.city);
    expect(cities).toContain('Sydney');
    expect(cities).not.toContain('North Sydney');
  });

  it('keeps a town outside the ten under its own name only', async () => {
    const orange = await request(app).get('/api/startups?city=Orange&limit=50');
    expect(orange.body.results.map((c) => c.name)).toContain('Pairtree');
    const sydney = await request(app).get('/api/startups?city=Sydney&search=Pairtree');
    expect(sydney.body.results).toEqual([]);
  });
});
