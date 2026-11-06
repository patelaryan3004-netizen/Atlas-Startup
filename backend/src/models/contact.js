// Contact details quoted from a page: an email address or a phone number. A company's page prints them for its customers; this directory's data is public, so a page's wording that
// reaches a title, a note, a description or a working file has them taken out (they are not facts about where a company is, and a number printed on a page can belong to a person).
// One list of patterns, used where text from a page is stored (discovery, evidence, audit rows written from now on) and by the privacy scan that guards the data files
// (tests/privacyScan.test.js). Never applied to a structured field (an address, a website, an identifier): only to free text.
//
//   redactContacts("Call 1800 000 123 or hello@example.com") === "Call [phone removed] or [email removed]"
//   findContacts(text) -> [{ kind: 'email' | 'phone' | 'mobile', text }]

export const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
// an Australian mobile: 04xx xxx xxx, (04) xxxx xxxx, +61 4xx xxx xxx
export const MOBILE_RE = /(?:\(04\)\s?\d{4}\s?\d{4}|(?<!\d)04\d{2}[\s-]?\d{3}[\s-]?\d{3}(?!\d)|\+\s?61[\s-]?\(?0?\)?[\s-]?4(?:[\s-]?\d){8})/g;
// an Australian landline or service number (02/03/07/08, 1300, 1800, 13 xx xx), another country's number with a +, and a North American one
export const PHONE_RE = new RegExp([
  String.raw`\+\s?61[\s-]?\(?0?\)?[\s-]?[2-378][\s-]?\d{4}[\s-]?\d{4}`,
  String.raw`\(0[2-478]\)[\s-]?\d{4}[\s-]?\d{4}`,
  String.raw`(?<!\d)0[2-478][\s-]?\d{4}[\s-]?\d{4}(?!\d)`,
  String.raw`(?<!\d)1300[\s-]?\d{3}[\s-]?\d{3}(?!\d)`,
  String.raw`(?<!\d)1800[\s-]?\d{3}[\s-]?\d{3}(?!\d)`,
  String.raw`(?<![\d-])13[\s-]\d{2}[\s-]\d{2}(?![\d-])`,
  String.raw`\+\d{1,3}[\s-]?\(?\d{1,4}\)?(?:[\s-]?\d{2,4}){2,3}`,
  String.raw`\(\d{3}\)\s?\d{3}[\s.-]\d{4}`,
  String.raw`(?<!\d)\d{3}[.-]\d{3}[.-]\d{4}(?!\d)`,
].join('|'), 'g');

const fresh = (re) => new RegExp(re.source, re.flags);

export function findContacts(text) {
  const t = String(text ?? '');
  const out = [];
  for (const m of t.matchAll(fresh(EMAIL_RE))) out.push({ kind: 'email', text: m[0] });
  const mobiles = [...t.matchAll(fresh(MOBILE_RE))];
  for (const m of mobiles) out.push({ kind: 'mobile', text: m[0] });
  for (const m of t.matchAll(fresh(PHONE_RE))) if (!mobiles.some((x) => x[0].includes(m[0]) || m[0].includes(x[0]))) out.push({ kind: 'phone', text: m[0] });
  return out;
}

export const hasContact = (text) => findContacts(text).length > 0;

export function redactContacts(text) {
  if (typeof text !== 'string' || !text) return text;
  return text.replace(fresh(EMAIL_RE), '[email removed]').replace(fresh(MOBILE_RE), '[phone removed]').replace(fresh(PHONE_RE), '[phone removed]');
}
