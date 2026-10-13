// The "Submit a startup" form is a Tally form. Until its address is put here the site keeps its own form, so there is
// never a broken frame. Paste the form's share link (https://tally.so/r/<id>) in place of the placeholder, or set it as
// VITE_TALLY_SUBMIT_URL (a build setting on Vercel).
//
// The Tally form should ask for: company name, website, city, your role, and "Do you want to claim this profile?". The site's own
// form (used while this is the placeholder) asks the same, plus a one-line description and the stage.
export const TALLY_SUBMIT_URL = import.meta.env.VITE_TALLY_SUBMIT_URL || 'TALLY_SUBMIT_URL_HERE';

// The waitlist is already a real Tally form (kdVrGo), so it is used as it is; the brief's placeholder (TALLY_FORM_URL_HERE) is for a
// site that has none. To point the waitlist at another form, set VITE_TALLY_WAITLIST_URL to its share link.
export const WAITLIST_URL = import.meta.env.VITE_TALLY_WAITLIST_URL || 'https://tally.so/r/kdVrGo';

// The embed address of a Tally share link, or null while it is still the placeholder (or not a Tally link).
export function tallyEmbed(url) {
  const m = /^https:\/\/tally\.so\/(?:r|embed)\/([A-Za-z0-9]+)/.exec(url ?? '');
  return m ? `https://tally.so/embed/${m[1]}?hideTitle=1&alignLeft=1` : null;
}

// ---------- the People pages ----------
//
// Two more Tally forms, made by the owner: one to nominate someone, one to ask for an edit or the removal of a card. Until one is made its
// address is the placeholder, and the page says the form is not set up yet instead of linking to nothing. To set one up, make the form in
// Tally and put its share link (https://tally.so/r/<id>) in VITE_TALLY_NOMINATE_URL or VITE_TALLY_REMOVAL_URL (a build setting on Vercel),
// or replace the placeholder below.
//
// The nomination form should ask for: name, a link, role type (founder, operator, investor), why they are worth following, and a
// checkbox "I am nominating myself or have asked them". The removal form is opened with name, id and type filled in as hidden fields
// (Tally reads them from the address), so a request says which card it is about.
export const NOMINATE_URL = import.meta.env.VITE_TALLY_NOMINATE_URL || 'TALLY_NOMINATE_URL_HERE';
export const REMOVAL_URL = import.meta.env.VITE_TALLY_REMOVAL_URL || 'TALLY_REMOVAL_URL_HERE';

export const NOMINATE_FIELDS = [
  'Name', 'A link to them', 'Role type: founder, operator or investor', 'Why they are worth following',
  'A checkbox: I am nominating myself or have asked them',
];

// A real Tally address, not the placeholder or anything else.
export const isConfigured = (url) => typeof url === 'string' && /^https:\/\/tally\.so\//.test(url);

// The address Tally lets a page show in a frame: /r/<id> is the share link, /embed/<id> is the frame.
export function embedUrl(url) {
  const base = url.replace('://tally.so/r/', '://tally.so/embed/').split('?')[0];
  return `${base}?hideTitle=1&alignLeft=1&transparentBackground=1`;
}

// The removal form, opened about one card: the share link with the card's name, id and kind in the address.
export function removalHref(url, entry) {
  const params = new URLSearchParams({ name: entry.name, id: entry.id, type: entry.type });
  return `${url.split('?')[0]}?${params}`;
}
