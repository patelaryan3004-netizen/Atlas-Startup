// Typed edges for a future Australian startup ecosystem graph. This module
// only builds and queries the edge list - no UI reads it directly yet, per
// "make the data architecture capable of representing relationships, not a
// social graph UI." It's designed so Company/People/Investor profiles,
// discovery and curated lists can all query the same edges later without a
// reshape.
//
// Only two relationship types have real, verified data behind them today -
// everything else in RELATIONSHIP_TYPES is vocabulary the schema already
// supports, populated the moment a real source exists:
//
//   FOUNDED / COFOUNDED  - startups.json founders[]. A company with exactly
//                          one name is FOUNDED, more than one is COFOUNDED
//                          for each of them - derived from the real array
//                          length, not guessed.
//   INVESTED_IN          - startups.json investors[]. These are firm names
//                          ("Blackbird", "AirTree"), not partner names - no
//                          per-partner attribution data exists, so the
//                          `from` node is typed Firm, never Person.
//
// Deliberately NOT populated, for lack of any real source in this app:
//   WORKED_AT, EMPLOYED    - no employee/operator field exists.
//   ADVISED, MENTORED      - no advisor field exists.
//   PARTNERED_WITH         - no partnership field exists.
//   ACQUIRED                - some blurbs mention an acquisition in free
//                             text (e.g. "Acquired by Canva, 2024"), and
//                             `stage` can be the literal value "Acquired",
//                             but there is no structured acquirer field.
//                             Parsing prose to guess who acquired whom would
//                             be inference, not verified data - so this
//                             stays unpopulated rather than regex-guessed.
//   INCUBATED_BY, ACCELERATED_BY - no accelerator/incubator field exists.
export const RELATIONSHIP_TYPES = [
  'FOUNDED', 'COFOUNDED', 'WORKED_AT', 'INVESTED_IN', 'ADVISED', 'MENTORED',
  'EMPLOYED', 'PARTNERED_WITH', 'ACQUIRED', 'INCUBATED_BY', 'ACCELERATED_BY',
];

export const NODE_TYPES = ['Person', 'Company', 'Firm', 'Accelerator'];

function edge(type, from, to) {
  return { type, from, to };
}

// Pure function: startups.json (or any array in the same shape) in,
// edge list out. No side effects, so it's cheap to rebuild whenever the
// dataset changes and easy to unit test in isolation.
export function buildRelationships(startups) {
  const edges = [];
  for (const s of startups) {
    const founders = s.founders || [];
    const founderType = founders.length > 1 ? 'COFOUNDED' : 'FOUNDED';
    for (const name of founders) {
      edges.push(edge(founderType, { type: 'Person', id: name }, { type: 'Company', id: s.name }));
    }
    for (const firm of s.investors || []) {
      edges.push(edge('INVESTED_IN', { type: 'Firm', id: firm }, { type: 'Company', id: s.name }));
    }
  }
  return edges;
}

const touchesNode = (endpoint, type, id) => endpoint.type === type && endpoint.id === id;

export function relationshipsForCompany(edges, companyName) {
  return edges.filter(
    (e) => touchesNode(e.from, 'Company', companyName) || touchesNode(e.to, 'Company', companyName)
  );
}

export function relationshipsForPerson(edges, personName) {
  return edges.filter((e) => touchesNode(e.from, 'Person', personName));
}
