// A member's profile: who they are, what they are building, how to find their work, and what they are open to. Kept short on purpose.
//
// What a profile says is what the member wrote. Nothing here is checked or vouched for, and the site never says it is: a member is not "verified",
// and a profile is not a reference. (References from people who really worked with someone are left for later: see docs/network.md.)
import { bad, cleanText, httpsUrl, oneOf, initialsOf, looksLikeEmail } from './validate.js';
import { INTENT_IDS, SKILL_IDS, INTERESTS } from './taxonomy.js';

export const OPEN_TO = ['collaborators', 'work', 'feedback', 'conversations'];
export const MAX_PROJECTS = 5;
export const MAX_SKILLS = 8;
export const MAX_INTERESTS = 6;
export const MAX_GOALS = 4;
export const MAX_PAST = 5;

// What anyone may see. Never the email, the password hash or whether the account is suspended.
// An older record has none of the newer fields: they read as empty, never as a guess.
export const publicMember = (m) => ({
  id: m.id, name: m.name, initials: initialsOf(m.name), role: m.role, city: m.city, intro: m.intro, building: m.building,
  links: { website: '', professional_profile: '', github: '', portfolio: '', ...m.links }, open_to: m.open_to,
  skills: m.skills ?? [], interests: m.interests ?? [], looking_for: m.looking_for ?? [], past: m.past ?? [], remote: Boolean(m.remote),
  listed: m.listed, joined_at: m.created_at.slice(0, 7),
});

// What a member sees of themselves: their own email too.
// `contact` is how they agreed to be reached by someone they accept an introduction with (introductions.js): it is shown to no one else.
export const privateMember = (m) => ({ ...publicMember(m), email: m.email, email_verified: m.email_verified, suspended: m.suspended, contact: m.contact ?? '' });

// A closed list a member picks from: a list of ids, each in the list, none twice, at most `max`.
const pickList = (value, allowed, name, max) => {
  if (!Array.isArray(value)) throw bad(`${name} must be a list.`);
  const ids = [...new Set(value.map((v) => oneOf(v, allowed, name)))];
  if (ids.length > max) throw bad(`Choose up to ${max} for ${name.toLowerCase()}.`);
  return ids;
};

// How someone can be reached once an introduction is agreed: an email address or a link. Kept private.
const contactOf = (value) => {
  const text = cleanText(value, { name: 'Contact', max: 120 });
  if (!text) return '';
  return looksLikeEmail(text) ? text : httpsUrl(text, { name: 'Contact' });
};

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
      professional_profile: httpsUrl(links.professional_profile, { name: 'LinkedIn or professional profile link' }),
      github: httpsUrl(links.github, { name: 'GitHub link' }),
      portfolio: httpsUrl(links.portfolio, { name: 'Portfolio link' }),
    };
  }
  if ('skills' in input) out.skills = pickList(input.skills, SKILL_IDS, 'Skills', MAX_SKILLS);
  if ('interests' in input) out.interests = pickList(input.interests, INTERESTS, 'Interests', MAX_INTERESTS);
  if ('looking_for' in input) out.looking_for = pickList(input.looking_for, INTENT_IDS, 'Looking for', MAX_GOALS);
  if ('past' in input) {
    if (!Array.isArray(input.past)) throw bad('Previous projects must be a list.');
    if (input.past.length > MAX_PAST) throw bad(`Share up to ${MAX_PAST} previous projects or contributions.`);
    out.past = input.past.map((p, i) => {
      if (!p || typeof p !== 'object') throw bad(`Previous project ${i + 1} is not valid.`);
      return {
        title: cleanText(p.title, { name: `Previous project ${i + 1} title`, min: 1, max: 80, required: true }),
        url: httpsUrl(p.url, { name: `Previous project ${i + 1} link` }),
        note: cleanText(p.note, { name: `Previous project ${i + 1} note`, max: 200 }),
      };
    });
  }
  if ('remote' in input) {
    if (typeof input.remote !== 'boolean') throw bad('Remote must be true or false.');
    out.remote = input.remote;
  }
  if ('contact' in input) out.contact = contactOf(input.contact);
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
    .filter((m) => !q || [m.name, m.role, m.city, m.intro, ...m.building.map((p) => p.title), ...(m.skills ?? []), ...(m.interests ?? [])].join(' ').toLowerCase().includes(q))
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id));
  const cities = [...new Set(data.members.filter((m) => m.listed && !m.suspended && m.city).map((m) => m.city))].sort();
  return { total: rows.length, results: rows.slice(offset, offset + limit).map(publicMember), cities, offset, limit, hasMore: offset + limit < rows.length };
}
