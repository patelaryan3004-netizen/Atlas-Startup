// What the gallery remembers when the visitor leaves it for the map (or anywhere else in the app) and comes back: how many startups had been loaded and how far down
// the page they were, for the same filters and sort. It lives in this tab's sessionStorage (nothing is sent anywhere, nothing outlives the tab), is used once, and is
// forgotten after a quarter of an hour, so a visit later in the day starts at the top.
const KEY = 'auGalleryMemory';
const FRESH_MS = 15 * 60 * 1000;

const keyOf = (filters, sort) => JSON.stringify([Object.entries(filters ?? {}).filter(([, v]) => v).sort(([a], [b]) => (a < b ? -1 : 1)), sort]);

export function rememberGallery(filters, sort, { count, scrollY }) {
  try { sessionStorage.setItem(KEY, JSON.stringify({ key: keyOf(filters, sort), count, scrollY, at: Date.now() })); } catch (e) { /* a browser that will not keep it: the gallery opens at the top */ }
}

// The place the gallery was left at for these filters, or null. (It is read without being removed: a page that draws twice, as in development, still finds it. The gallery
// calls forgetGallery once it is up.)
export function recallGallery(filters, sort) {
  try {
    const raw = sessionStorage.getItem(KEY);
    const found = raw ? JSON.parse(raw) : null;
    if (!found || found.key !== keyOf(filters, sort) || Date.now() - found.at > FRESH_MS) return null;
    return Number.isFinite(found.count) && Number.isFinite(found.scrollY) ? { count: found.count, scrollY: found.scrollY } : null;
  } catch (e) { return null; }
}

export function forgetGallery() {
  try { sessionStorage.removeItem(KEY); } catch (e) { /* nothing to forget */ }
}
