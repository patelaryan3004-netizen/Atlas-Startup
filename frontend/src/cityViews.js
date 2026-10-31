// The cities of the map page's selector, in the order it lists them, and where the map looks when one is picked (the middle of the city and how far in). The
// centres are the ones the backend keeps for the same cities (backend/src/geo/places.js). A city with no company yet is still a place the map can go to: it
// says so (0 companies) and does not pretend.
export const MAP_CITIES = ['Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide', 'Canberra', 'Gold Coast', 'Newcastle', 'Hobart', 'Darwin'];

const VIEWS = {
  Sydney: { lat: -33.8688, lng: 151.2093, zoom: 12 },
  Melbourne: { lat: -37.8136, lng: 144.9631, zoom: 12 },
  Brisbane: { lat: -27.4698, lng: 153.0251, zoom: 12 },
  Perth: { lat: -31.9505, lng: 115.8605, zoom: 12 },
  Adelaide: { lat: -34.9285, lng: 138.6007, zoom: 12 },
  Canberra: { lat: -35.2809, lng: 149.13, zoom: 12 },
  'Gold Coast': { lat: -28.0167, lng: 153.4, zoom: 11 },
  Newcastle: { lat: -32.9283, lng: 151.7817, zoom: 12 },
  Hobart: { lat: -42.8821, lng: 147.3272, zoom: 12 },
  Darwin: { lat: -12.4634, lng: 130.8456, zoom: 12 },
};

// Where the map looks for a scope (the `city` filter): the city's view when the scope is exactly one of the cities above, else nothing (several cities, or one
// the list does not have, are fitted to their pins).
export const cityView = (scope) => (typeof scope === 'string' && Object.hasOwn(VIEWS, scope) ? VIEWS[scope] : null);
