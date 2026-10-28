import { describe, it, expect } from 'vitest';
import { opensOnMap } from '../src/mapPrefetch.js';

// The map's file (Leaflet and the pins' code) is the biggest piece of the app, and the map is one way to look at startups, not the first: only an address that asks
// for it (?view=map) fetches it.
describe('which addresses open the map', () => {
  it('opens it for an address that asks for the map, on Discover, on a company\'s panel, or at an older /', () => {
    for (const [path, search] of [['/discover', '?view=map'], ['/discover', '?sector=AI&view=map'], ['/startup/canva', '?view=map'], ['/', '?view=map']]) {
      expect(opensOnMap(path, search), `${path}${search}`).toBe(true);
    }
  });

  it('does not open it for Home, the list of startups, a company\'s panel over the list, or any other page', () => {
    for (const [path, search] of [
      ['/', ''], ['/home', ''], ['/discover', ''], ['/discover', '?sector=AI'], ['/discover/people', ''], ['/startup/canva', ''], ['/', '?sector=AI'], ['/', '?view=list'], ['/', '?view=jobs'],
      ['/jobs', ''], ['/jobs/', ''], ['/events', ''], ['/me', ''], ['/saved', ''], ['/members/m_abc', ''], ['/investors', ''], ['/investors/people/x', ''], ['/news', ''], ['/people', ''],
      ['/lists', ''], ['/lists/currently-hiring', ''], ['/about', ''],
    ]) {
      expect(opensOnMap(path, search), `${path}${search}`).toBe(false);
    }
  });
});
