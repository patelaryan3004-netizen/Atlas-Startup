// Where the map page's views change, in map zoom, and where the national view looks. Kept apart from the drawing (atlasLayer.js, geo.js: the coastline is a
// file of its own) so the map can ask them without carrying the country's outline until the drawing is wanted.
//
// Below ATLAS_ZOOM the drawn country shows with its city badges and the street map is off. The street map's tiles start to load a little before they show
// (TILES_LOAD_ZOOM), and the clusters and the pins come in from PINS_ZOOM, so for a stretch of zoom the badges, the clusters and the streets are all fading
// into one another and the visitor never sees one jump to the next.
export const ATLAS_ZOOM = 6.5;
export const PINS_ZOOM = 5.75;
export const TILES_LOAD_ZOOM = 5.5;
export const SMALL_ZOOM = 3.7; // under this (a phone's country) the state names are left off

// All of the mainland and Tasmania: the west coast to the east coast, Cape York to the south of Tasmania.
export const NATIONAL_BOUNDS = [[-44.2, 112.4], [-9.8, 154.6]];

// The room the national view leaves round the country: a little on a wide screen; on a phone, the sheet at the bottom takes the lower part.
export function nationalPadding(narrow) {
  return narrow ? { paddingTopLeft: [8, 8], paddingBottomRight: [8, 96] } : { paddingTopLeft: [28, 28], paddingBottomRight: [28, 28] };
}

// The room a city's pins are fitted into.
export function cityPadding(narrow) {
  return narrow ? { paddingTopLeft: [32, 48], paddingBottomRight: [32, 150] } : { paddingTopLeft: [64, 64], paddingBottomRight: [64, 96] };
}
export const CITY_FIT_MAX_ZOOM = 13;
