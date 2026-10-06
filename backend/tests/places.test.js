import { describe, it, expect } from 'vitest';
import { AU_STATES, STATES, CITIES, cityCentre, stateCentre, distanceMetres, statesAt, conflictsWithState, centreAt, kmFromCity } from '../src/geo/places.js';

describe('the states and the cities', () => {
  it('knows the eight states and territories, each with a name, a centre inside its own box and a box', () => {
    expect(AU_STATES).toEqual(['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT']);
    for (const code of AU_STATES) {
      const s = STATES[code];
      expect(s.name).toBeTruthy();
      const [lat, lng] = s.centre;
      expect(statesAt(lat, lng), `${code}'s own centre is in its box`).toContain(code);
    }
  });

  it('keeps every city inside the box of the state it is filed under', () => {
    for (const c of CITIES) expect(statesAt(c.lat, c.lng), `${c.name} is in ${c.state}`).toContain(c.state);
  });

  it('finds a city centre by name and state, ignoring a parenthetical and case, and is not fooled by a suburb', () => {
    expect(cityCentre('Sydney', 'NSW')).toMatchObject({ name: 'Sydney', lat: -33.8688, lng: 151.2093 });
    expect(cityCentre('sydney (Chippendale)', 'NSW')?.name).toBe('Sydney');
    expect(cityCentre('Sydney', 'VIC')).toBeNull(); // the state is part of the key
    expect(cityCentre('Richmond', 'VIC')).toBeNull(); // a suburb, not a city centre
    expect(cityCentre('Unknown', null)).toBeNull();
    expect(stateCentre('VIC')).toMatchObject({ name: 'Victoria' });
    expect(stateCentre('XX')).toBeNull();
  });
});

describe('distance and place', () => {
  it('measures a great-circle distance in metres', () => {
    expect(distanceMetres(-33.8688, 151.2093, -33.8688, 151.2093)).toBe(0);
    // Sydney to Melbourne is about 714 km as the crow flies.
    const km = distanceMetres(-33.8688, 151.2093, -37.8136, 144.9631) / 1000;
    expect(km).toBeGreaterThan(700);
    expect(km).toBeLessThan(730);
  });

  it('says which states a point is in, none for a point at sea, and treats a border as both', () => {
    expect(statesAt(-33.8688, 151.2093)).toEqual(['NSW']);
    expect(statesAt(-37.8136, 144.9631)).toEqual(['VIC']);
    expect(statesAt(0, 0)).toEqual([]);
    expect(statesAt(-35.353, 149.232)).toEqual(expect.arrayContaining(['NSW', 'ACT'])); // Queanbeyan, beside the ACT
  });

  it('calls a point a conflict only when it is in Australia and not in the state named', () => {
    expect(conflictsWithState(-33.8688, 151.2093, 'NSW')).toBe(false);
    expect(conflictsWithState(-33.8688, 151.2093, 'VIC')).toBe(true);
    expect(conflictsWithState(51.5, -0.12, 'NSW')).toBe(false); // not in Australia at all: a different problem
    expect(conflictsWithState(-35.353, 149.232, 'NSW')).toBe(false);
    expect(conflictsWithState(-35.353, 149.232, 'ACT')).toBe(false);
  });

  it('recognises a point that sits on a city centre, within a tolerance, and the directory\'s own alternative points', () => {
    expect(centreAt(-33.8688, 151.2093)).toMatchObject({ city: 'Sydney', state: 'NSW', distance: 0 });
    expect(centreAt(-33.86984, 151.20828)).toMatchObject({ city: 'Sydney' }); // the point 36 companies share today
    expect(centreAt(-33.8848, 151.2098)).toBeNull(); // Surry Hills, about 2 km away
    expect(centreAt(-35.29759, 149.10127)).toMatchObject({ city: 'Canberra' }); // an alternative point for Canberra
    expect(centreAt(-33.8688, 151.2103, 50)).toBeNull(); // 100 m away is outside a 50 m tolerance
    expect(centreAt(-33.8688, 151.2103, 250)).toMatchObject({ city: 'Sydney' });
  });

  it('says how far a point is from the city a record names, or nothing when the city is not on file', () => {
    expect(kmFromCity(-33.8688, 151.2093, 'Sydney', 'NSW')).toBe(0);
    expect(kmFromCity(-37.8136, 144.9631, 'Sydney', 'NSW')).toBeGreaterThan(700);
    expect(kmFromCity(-37.8, 144.9, 'Richmond', 'VIC')).toBeNull();
  });
});
