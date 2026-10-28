// A member's profile: who they are, what they are building, how to find their work, and what they are open to. Kept short on purpose.
//
// What a profile says is what the member wrote. Nothing here is checked or vouched for, and the site never says it is: a member is not "verified",
// and a profile is not a reference. (References from people who really worked with someone are left for later: see docs/network.md.)
import { bad, cleanText, httpsUrl, oneOf, initialsOf } from './validate.js';

export const OPEN_TO = ['collaborators', 'work', 'feedback', 'conversations'];
export const MAX_PROJECTS = 5;

// What anyone may see. Never the email, the password hash or whether the account is suspended.
export const publicMember = (m) => ({
  id: m.id, name: m.name, initials: initialsOf(m.name), role: m.role, city: m.city, intro: m.intro, building: m.building, links: m.links, open_to: m.open_to,
  listed: m.listed, joined_at: m.created_at.slice(0, 7),
});

// What a member sees of themselves: their own email too.
export const privateMember = (m) => ({ ...publicMember(m), email: m.email, email_verified: m.email_verified, suspended: m.suspended });

// The fields a member may change, checked. Returns only the fields that were given, ready to merge into the record.
export function profileChanges(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw bad('Send the profile as an object.');
  const out = {};
  if ('name' in input) out.name = cleanText(input.name, { name: 'Your name', min: 2, max: 60, required: true });
  if ('role' in input) out.role = cleanText(input.role, { name: 'Role', max: 80 });
  if ('city' in input) out.city = cleanText(input.city, { name: 'City', max: 60 });
  if ('intro' in input) out.intro = cleanText(input.intro, { name: 'Introduction', max: 300, multiline: true });
  if ('building' in input) {
    if (!Array.isArray(input.building)) throw bad('What you are building must be a list.');
    if (input.building.length > MAX_PROJECTS) throw bad(`Share up to ${MAX_PROJECTS} projects.`);
    out.building = input.building.map((p, i) => {
      if (!p || typeof p !== 'object') throw bad(`Project ${i + 1} is not valid.`);
      return {
        title: cleanText(p.title, { name: `Project ${i + 1} title`, min: 1, max: 80, required: true }),
        url: httpsUrl(p.url, { name: `Project ${i + 1} link` }),
        note: cleanText(p.note, { name: `Project ${i + 1} note`, max: 200 }),
      };
    });
  }
  if ('links' in input) {
    const links = input.links ?? {};
    out.links = {
      website: httpsUrl(links.website, { name: 'Website' }),
      professional_profile: httpsUrl(links.professional_profile, { name: 'Professional profile link' }),
    };
  }
  if ('open_to' in input) {
    if (!Array.isArray(input.open_to)) throw bad('Open to must be a list.');
    out.open_to = [...new Set(input.open_to.map((v) => oneOf(v, OPEN_TO, 'Open to')))];
  }
  if ('listed' in input) {
    if (typeof input.listed !== 'boolean') throw bad('Listed must be true or false.');
    out.listed = input.listed;
  }
  return out;
}

// Members who have chosen to be listed, newest first, for Discover. A search looks in name, role, city, introduction and project titles.
export function listMembers(data, { search = '', city = '', openTo = '', limit = 20, offset = 0, ids = null } = {}) {
  const q = search.trim().toLowerCase();
  const rows = data.members
    .filter((m) => !m.suspended && (ids ? ids.includes(m.id) : m.listed))
    .filter((m) => !city || m.city.toLowerCase() === city.toLowerCase())
    .filter((m) => !openTo || m.open_to.includes(openTo))
    .filter((m) => !q || [m.name, m.role, m.city, m.intro, ...m.building.map((p) => p.title)].join(' ').toLowerCase().includes(q))
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id));
  const cities = [...new Set(data.members.filter((m) => m.listed && !m.suspended && m.city).map((m) => m.city))].sort();
  return { total: rows.length, results: rows.slice(offset, offset + limit).map(publicMember), cities, offset, limit, hasMore: offset + limit < rows.length };
}
