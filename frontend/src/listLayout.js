// How the list of startups is laid out, shared by the list and by the placeholder drawn while the list's file arrives, so the placeholder
// has the shape of what replaces it. A visitor's choice is kept in this browser; without one, a screen wide enough gets the table and a
// phone gets cards.
export const LAYOUT_KEY = 'auStartupListLayout';
export const WIDE_LIST = '(min-width: 900px)';

export function initialLayout() {
  try {
    const saved = localStorage.getItem(LAYOUT_KEY);
    if (saved === 'table' || saved === 'cards') return saved;
  } catch (e) { /* a browser that will not say: the default */ }
  return typeof window.matchMedia === 'function' && window.matchMedia(WIDE_LIST).matches ? 'table' : 'cards';
}
