// The same role is one address, however it was linked: https, a lower-case host, no tracking, no fragment, no trailing slash. Two postings with the same canonical
// address are the same role (a repost under a new id, a board listing and the company's own page), which is how a duplicate is caught when the provider's ids differ.
//
// gh_jid is NOT removed: on an employer's own careers page it is what says which job the page is.
const TRACKING = /^(?:utm_.+|gh_src|gh_ref|lever-source|lever-origin|source|src|ref|referrer|trk|fbclid|gclid|mc_cid|mc_eid)$/i;

export function canonicalUrl(raw) {
  let u;
  try { u = new URL(String(raw ?? '').trim()); } catch (e) { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  u.protocol = 'https:';
  u.hostname = u.hostname.toLowerCase();
  u.hash = '';
  const kept = [...u.searchParams].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  u.search = '';
  for (const [k, v] of kept) u.searchParams.append(k, v);
  let out = u.href;
  if (u.pathname.length > 1 && u.pathname.endsWith('/') && !u.search) out = out.replace(/\/$/, '');
  else if (u.pathname.length > 1 && u.pathname.endsWith('/')) out = out.replace(/\/\?/, '?');
  return out;
}
