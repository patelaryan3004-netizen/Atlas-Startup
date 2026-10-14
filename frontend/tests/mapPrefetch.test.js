import { describe, it, expect } from 'vitest';
import { opensOnMap } from '../src/mapPrefetch.js';

// The map's file (Leaflet and the pins' code) is the biggest piece of the app, so only an address that opens the map asks for it.
describe('which addresses open the map', () => {
  it('opens it for the map itself and for what sits over it', () => {
    for (const [path, search] of [['/', ''], ['/', '?sector=AI'], ['/startup/canva', ''], ['/', '?view=waitlist'], ['/', '?view=submit']]) {
      expect(opensOnMap(path, search), `${path}${search}`).toBe(true);
    }
  });

  it('does not open it for the list of startups, the jobs board or any other page', () => {
    for (const [path, search] of [['/', '?view=list'], ['/', '?view=list&search=canva'], ['/', '?view=jobs'], ['/jobs', ''], ['/jobs/', ''], ['/investors', ''], ['/investors/people/x', ''], ['/news', ''], ['/people', ''], ['/lists', ''], ['/lists/currently-hiring', '']]) {
      expect(opensOnMap(path, search), `${path}${search}`).toBe(false);
    }
  });
});
