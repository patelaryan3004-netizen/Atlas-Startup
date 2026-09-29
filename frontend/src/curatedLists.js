// Two list shapes share this config, told apart by `type`:
//
// type: 'filter' — filters (applied through the same sector/city/stage/hiring/
// taskGate params the filter panel and share-URL already use) plus match (the
// same rule, as a predicate) so the card can show a live count without a
// server round-trip. Clicking the card applies those filters to the map.
//
// type: 'people' — not a startup filter at all. `people` is a plain array of
// {name, role, company, why, link}. Clicking the card expands it inline
// instead of touching the map filters. Leave `people` empty until real data
// is supplied; the card shows a "no one listed yet" state rather than
// fabricated names.
export const curatedLists = [
  {
    id: 'task-gated',
    type: 'filter',
    name: 'Task-gated only',
    description: 'Companies where applying means completing a real work-sample task first.',
    filters: { taskGate: 'yes' },
    match: (s) => s.taskGate?.enabled === true,
  },
  {
    id: 'melbourne-ai',
    type: 'filter',
    name: 'Melbourne AI startups',
    description: 'AI-sector companies based in Melbourne.',
    filters: { city: 'Melbourne', sector: 'AI' },
    match: (s) => s.city === 'Melbourne' && s.sector === 'AI',
  },
  {
    id: 'currently-hiring',
    type: 'filter',
    name: 'Currently hiring',
    description: 'Companies with open roles right now.',
    filters: { hiring: 'yes' },
    match: (s) => s.hiring === true,
  },
  {
    id: 'people-to-follow',
    type: 'people',
    name: 'AU Startup People to Follow',
    description: 'Founders, operators and investors worth following in the AU startup scene.',
    people: [],
  },
];
