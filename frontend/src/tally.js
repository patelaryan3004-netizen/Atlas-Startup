// The "Submit a startup" form is a Tally form. Until its address is put here the site keeps its own form, so there is
// never a broken frame. Paste the form's share link (https://tally.so/r/<id>) in place of the placeholder.
export const TALLY_SUBMIT_URL = 'TALLY_SUBMIT_URL_HERE';

// The embed address of a Tally share link, or null while it is still the placeholder (or not a Tally link).
export function tallyEmbed(url) {
  const m = /^https:\/\/tally\.so\/(?:r|embed)\/([A-Za-z0-9]+)/.exec(url ?? '');
  return m ? `https://tally.so/embed/${m[1]}?hideTitle=1&alignLeft=1` : null;
}
