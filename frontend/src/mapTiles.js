// The map's background, in one place. The marks are what the map is for, so the background is a quiet one. Without a Mapbox token (VITE_MAPBOX_TOKEN, whose
// dark and light styles are used when there is one) the free OpenStreetMap tiles are used, and CSS (styles.css, .map-quiet-dark and .map-quiet-light) turns
// them down: the dark map is the tiles inverted and drawn in greys, the light map the tiles faded, so the roads and names stay where they are (the main
// roads, the suburbs) but sit behind the logos instead of competing with them. (CARTO's Dark Matter and Positron are what this was drawn to look like, but
// they answer "API key required" without a key, so they are not used.) A different provider is a change to this file only.
export const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
export const TILE_OPTIONS = {
  maxZoom: 19,
  noWrap: true,
  attribution: '&copy; OpenStreetMap contributors',
};
export const quietClass = (basemap) => (basemap === 'light' ? 'map-quiet-light' : 'map-quiet-dark');
