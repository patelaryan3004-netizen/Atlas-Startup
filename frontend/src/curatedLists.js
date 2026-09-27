// Each list needs two things that stay in sync: `filters` (applied through the
// same sector/city/stage/hiring/taskGate params the filter panel and share-URL
// already use) and `match` (the same rule, as a predicate) so the card can show
// an accurate live count without waiting on a server round-trip. Add a list by
// giving both.
export const curatedLists = [
  {
    id: 'task-gated',
    name: 'Task-gated only',
    description: 'Companies where applying means completing a real work-sample task first.',
    filters: { taskGate: 'yes' },
    match: (s) => s.taskGate?.enabled === true,
  },
  {
    id: 'melbourne-ai',
    name: 'Melbourne AI startups',
    description: 'AI-sector companies based in Melbourne.',
    filters: { city: 'Melbourne', sector: 'AI' },
    match: (s) => s.city === 'Melbourne' && s.sector === 'AI',
  },
  {
    id: 'currently-hiring',
    name: 'Currently hiring',
    description: 'Companies with open roles right now.',
    filters: { hiring: 'yes' },
    match: (s) => s.hiring === true,
  },
];
