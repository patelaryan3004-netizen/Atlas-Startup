// How the list of startups is laid out, shared by the list and by the placeholder drawn while the list's file arrives, so the placeholder
// has the shape of what replaces it. The gallery (a grid of pictures) is the way in, on every screen; the table is the other way, and a visitor's choice
// is kept in this browser. (An older choice of "cards" was a grid of text cards: it is the gallery now.)
export const LAYOUT_KEY = 'auStartupListLayout';
export const WIDE_LIST = '(min-width: 900px)';

export function initialLayout() {
  try {
    if (localStorage.getItem(LAYOUT_KEY) === 'table') return 'table';
  } catch (e) { /* a browser that will not say: the gallery */ }
  return 'gallery';
}
