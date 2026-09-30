import { curatedLists } from './curatedLists.js';
import { buildRelationships, relationshipsForPerson } from './relationships.js';

// Schema for the company<->person side of the ecosystem graph. Built on top
// of relationships.js's typed edges (see that file for which relationship
// types have real data behind them today - only FOUNDED/COFOUNDED and
// INVESTED_IN do).
//   Company <-> Founder   - real: FOUNDED/COFOUNDED edges.
//   Company <-> Investor  - real, but firm-level only (INVESTED_IN edges
//                           come from firm names like "Blackbird", not
//                           partner names - no per-partner attribution data
//                           exists, so investors are not linked to a
//                           specific person yet).
//   Person  <-> Person    - not modeled: no relationship data exists yet.
//   Person  <-> Company   - currentCompany below.
//   Person  <-> Startup   - same edge as Company<->Founder, from the person's side.
//
// Only two real people sources exist today: a startup's founders[] (name
// only) and curatedLists.js's people-to-follow list (name, role, company,
// why, link - each checked against a real source per that file's own
// sourcing note). getPersonProfile cross-references the two by exact name
// match. Fields with no real backing (previousCompanies, industry,
// location) stay empty rather than guessed, so the shape is ready for a
// future data source without ever having shipped a fabrication.
export const PERSON_ROLES = ['Founder', 'Investor', 'Operator', 'Advisor', 'Ecosystem'];

const peopleToFollow = curatedLists.find((list) => list.type === 'people')?.people || [];

function findVerifiedEntry(name) {
  return peopleToFollow.find((p) => p.name === name) || null;
}

export function getPersonProfile(name, startups = []) {
  const verified = findVerifiedEntry(name);
  const relationships = relationshipsForPerson(buildRelationships(startups), name);
  const foundedAt = relationships
    .filter((r) => r.type === 'FOUNDED' || r.type === 'COFOUNDED')
    .map((r) => {
      const company = startups.find((s) => s.name === r.to.id);
      return { company: r.to.id, website: company?.website || null };
    });

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
    relationships,
    // Structurally present for the future graph, always empty today -
    // no real source backs these yet.
    previousCompanies: [],
    industry: null,
    location: null,
  };
}
