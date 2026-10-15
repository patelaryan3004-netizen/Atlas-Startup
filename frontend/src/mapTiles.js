// The map's background, in one place: a light one, with quiet streets, pale green parks and soft blue water. The marks are what the map is for, so the
// background is a quiet one. Without a Mapbox token (VITE_MAPBOX_TOKEN, whose light style is used when there is one) the free OpenStreetMap tiles are used,
// and CSS (styles.css, .map-quiet-light) turns them down, so the roads and names stay where they are (the main roads, the suburbs) but sit behind the logos
// instead of competing with them. (CARTO's Positron is what this was drawn to look like, but it answers "API key required" without a key, so it is not
// used.) A different provider is a change to this file only.
export const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
export const TILE_OPTIONS = {
  maxZoom: 19,
  noWrap: true,
  attribution: '&copy; OpenStreetMap contributors',
};
export const quietClass = () => 'map-quiet-light';
