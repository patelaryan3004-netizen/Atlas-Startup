// institutions_seed.json: the firms (VC funds and the like) the owner has reviewed, and where each has an office. It is typed in by the owner;
// nothing here is made up, and a line with nothing behind it is left out, never filled in.
//
//   {
//     "institutions": [
//       { "id": "blackbird", "name": "Blackbird", "website": "https://www.blackbird.vc",
//         "offices": [ { "label": "Sydney", "address": "Level 2, 12 Example Street, Sydney NSW 2000", "city": "Sydney", "state": "NSW",
//                        "lat": null, "lng": null } ] }
//     ],
//     "hold": [ { "name": "...", "issue": "why it is not published yet" } ]
//   }
//
//   offices: []   (or none)   the firm is listed, and has no pin: there is no office to draw
//   lat and lng               both given, or both null: given, they are the office's point; null, the address is geocoded (once, kept)
//   hold                      entries with an unresolved issue: never rendered, never served, only counted
//   placeholder: true         treated as held
// A name or a field that fails these rules is reported in `problems` and the entry (or the office) is dropped: a seed with a mistake in it
// shows what is right, and says what is not.
import { slugify } from './company.js';

export const SEED_FILE = 'institutions_seed.json';

const text = (v, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const https = (v) => (typeof v === 'string' && /^https:\/\/\S+$/i.test(v.trim()) ? v.trim() : null);
const number = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function checkOffice(raw, where, problems) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { problems.push(`${where}: an office must be an object`); return null; }
  const lat = number(raw.lat ?? raw.latitude);
  const lng = number(raw.lng ?? raw.lon ?? raw.longitude);
  const gave = raw.lat != null || raw.latitude != null || raw.lng != null || raw.lon != null || raw.longitude != null;
  let point = { lat: null, lng: null };
  if (gave) {
    if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180) problems.push(`${where}: lat and lng must both be numbers on the earth, or both null: the point is left out`);
    else point = { lat, lng };
  }
  const address = text(raw.address, 300);
  const city = text(raw.city, 80);
  if (!address && !city && point.lat == null) { problems.push(`${where}: an office needs an address, a city or a point: left out`); return null; }
  return { label: text(raw.label ?? raw.name, 80), address, city, state: text(raw.state, 40), ...point, source: https(raw.source ?? raw.sourceUrl) };
}

export function checkInstitutionSeed(json) {
  const problems = [];
  const root = Array.isArray(json) ? { institutions: json } : json && typeof json === 'object' ? json : {};
  const list = root.institutions ?? root.firms ?? [];
  if (!Array.isArray(list)) problems.push('"institutions" must be a list');
  const held = (Array.isArray(root.hold) ? root.hold : []).map((h) => ({ name: text(h?.name) ?? '(no name)', issue: text(h?.issue, 400) }));
  const institutions = [];
  const ids = new Set();
  (Array.isArray(list) ? list : []).forEach((raw, n) => {
    const name = text(raw?.name, 120);
    const where = `institutions[${n}]${name ? ` "${name}"` : ''}`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { problems.push(`${where}: not an object`); return; }
    if (raw.placeholder === true || raw.hold === true || raw.status === 'hold') { held.push({ name: name ?? '(no name)', issue: text(raw.issue, 400) ?? 'on hold' }); return; }
    if (!name) { problems.push(`${where}: needs a name: left out`); return; }
    const id = text(raw.id ?? raw.slug, 80) ?? slugify(name);
    if (ids.has(id)) { problems.push(`${where}: the id "${id}" is already used: left out`); return; }
    let offices = [];
    if (raw.offices != null && !Array.isArray(raw.offices)) problems.push(`${where}: "offices" must be a list: treated as none`);
    else offices = (raw.offices ?? []).map((o, i) => checkOffice(o, `${where}.offices[${i}]`, problems)).filter(Boolean);
    ids.add(id);
    institutions.push({ id, name, website: https(raw.website), type: text(raw.type, 60), offices });
  });
  return { institutions, held, problems };
}
