import { curatedLists } from './curatedLists.js';

// Schema for the company<->person side of the ecosystem graph:
//   Company <-> Founder   - real, from startups.json founders[]
//   Company <-> Investor  - real, but firm-level only (startups.json
//                           investors[] holds firm names like "Blackbird",
//                           not partner names) - no per-partner attribution
//                           data exists, so investors are not linked to a
//                           specific person yet.
//   Person  <-> Person    - not modeled: no relationship data exists yet.
//   Person  <-> Company   - currentCompany below.
//   Person  <-> Startup   - same edge as Company<->Founder, from the person's side.
//
// Only two real people sources exist today: a startup's founders[] (name
// only) and curatedLists.js's people-to-follow list (name, role, company,
// why, link - each checked against a real source per that file's own
// sourcing note). getPersonProfile cross-references the two by exact name
// match. Fields with no real backing (previousCompanies, industry,
// location, relationships) stay empty rather than guessed, so the shape is
// ready for a future data source without ever having shipped a fabrication.
export const PERSON_ROLES = ['Founder', 'Investor', 'Operator', 'Advisor', 'Ecosystem'];

const peopleToFollow = curatedLists.find((list) => list.type === 'people')?.people || [];

function findVerifiedEntry(name) {
  return peopleToFollow.find((p) => p.name === name) || null;
}

// Every startup that lists this exact name in founders[] - the only honest
// source for "current/previous companies" (no employment-history field
// exists). Someone founding two listed companies shows both.
function foundingRolesFor(name, startups) {
  return startups
    .filter((s) => s.founders?.includes(name))
    .map((s) => ({ company: s.name, website: s.website || null }));
}

export function getPersonProfile(name, startups = []) {
  const verified = findVerifiedEntry(name);
  const foundedAt = foundingRolesFor(name, startups);

  const roles = [];
  if (foundedAt.length > 0 || (verified?.role && /founder/i.test(verified.role))) roles.push('Founder');
  if (verified?.role && /invest|partner|\bvc\b/i.test(verified.role)) roles.push('Investor');

  return {
    name,
    roles,
    role: verified?.role || (foundedAt.length > 0 ? 'Founder' : null),
    currentCompany: verified?.company || foundedAt[0]?.company || null,
    foundedAt,
    notableWork: verified?.why || null,
    link: verified?.link || null,
    // Structurally present for the future graph, always empty today -
    // no real source backs these yet.
    previousCompanies: [],
    industry: null,
    location: null,
    relationships: [],
  };
}
