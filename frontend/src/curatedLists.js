// Two list shapes share this config, told apart by `type`:
//
// type: 'filter' — filters, applied through the same sector/city/stage/hiring/
// taskGate params the filter panel and share-URL already use. The card's live
// count is the server's own count for exactly these filters (`/api/startups/count`),
// so it can never disagree with the list a click opens. Clicking the card applies
// those filters and switches to list view. `category` is a short editorial
// grouping label shown on the card (Industry/Location/Status) - not sent to the API.
//
// Several cards below roll up more than one real sector/city string from
// startups.json (e.g. the dataset has both "HealthTech" and "Healthtech").
// `filters.sector`/`filters.city` accept a comma-separated list for this -
// the backend matches any one of them, still an exact match, just against a
// set instead of a single string. Every value referenced here is a real,
// currently-used sector or city in the dataset, not an invented taxonomy.
//
// Two categories from the original brief are deliberately left out:
// - "Recently funded" - startups.json has no funding-date field, so there is
//   no honest way to compute this.
// - "VC-backed" - every company in this directory is already VC-backed by
//   definition (it's a VC-backed-startup directory), so the filter would
//   match 100% of listings and discriminate nothing.
//
// type: 'people' — not a startup filter at all: `people` is a plain array of {name, role, company, why, link}, shown as a card that expands
// inline. There is none in this file now. The people worth following are the owner's reviewed file (people_seed.json), shown on the People
// page behind VITE_SHOW_PEOPLE with the pages that back each one: a name is not kept here too, where it could be shown without that flag or
// show someone the owner has put on hold. (The older list is in git history, in the commit before this note.)
export const curatedLists = [
  {
    id: 'currently-hiring',
    type: 'filter',
    name: 'Startups Hiring Now',
    description: 'Companies with open roles right now.',
    category: 'Status',
    filters: { hiring: 'yes' },
  },
  {
    id: 'au-ai',
    type: 'filter',
    name: 'Australian AI Startups',
    description: 'Companies building in AI - from applied AI products to AI infrastructure.',
    category: 'Industry',
    filters: { sector: 'AI,AI infrastructure,Enterprise AI,Enterprise AI software,Industrial AI,Maritime AI,Sales AI,Vertical AI' },
  },
  {
    id: 'au-fintech',
    type: 'filter',
    name: 'Australian Fintech Startups',
    description: 'Companies building financial products and infrastructure.',
    category: 'Industry',
    filters: { sector: 'Fintech' },
  },
  {
    id: 'au-healthtech',
    type: 'filter',
    name: 'Australian Healthtech Startups',
    description: 'Digital health, medtech and telehealth companies.',
    category: 'Industry',
    filters: { sector: 'HealthTech,Healthtech,Medtech,Telehealth' },
  },
  {
    id: 'au-climate',
    type: 'filter',
    name: 'Australian Climate Startups',
    description: 'Companies working on climate and the energy transition.',
    category: 'Industry',
    filters: { sector: 'Climate,Climate SaaS,ClimateTech' },
  },
  {
    id: 'au-deeptech',
    type: 'filter',
    name: 'Australian Deeptech',
    description: 'Quantum, robotics, space and other hard-science-led companies.',
    category: 'Industry',
    filters: { sector: 'Quantum,Quantum computing,Robotics,Space,Satellite IoT,Computer vision,Industrial AI' },
  },
  {
    id: 'au-ecommerce',
    type: 'filter',
    name: 'Australian E-commerce',
    description: 'Companies selling direct to consumers or powering online retail.',
    category: 'Industry',
    filters: { sector: 'Ecommerce' },
  },
  {
    id: 'au-saas',
    type: 'filter',
    name: 'Australian SaaS',
    description: 'Subscription software companies, across every industry they serve.',
    category: 'Industry',
    filters: { sector: 'SaaS,B2B SaaS,Climate SaaS,Construction SaaS,Contact-centre SaaS,Engineering SaaS,Hospitality SaaS,Logistics SaaS,Productivity SaaS,Strategy SaaS,ESG SaaS,Automotive SaaS' },
  },
  {
    id: 'melbourne',
    type: 'filter',
    name: 'Melbourne Startups',
    description: 'Companies based in Melbourne.',
    category: 'Location',
    filters: { city: 'Melbourne' },
  },
  {
    id: 'sydney',
    type: 'filter',
    name: 'Sydney Startups',
    description: 'Companies based in Sydney.',
    category: 'Location',
    filters: { city: 'Sydney,Sydney (Chippendale)' },
  },

  {
    id: 'melbourne-ai',
    type: 'filter',
    name: 'Melbourne AI startups',
    description: 'AI-sector companies based in Melbourne.',
    category: 'Location',
    filters: { city: 'Melbourne', sector: 'AI' },
  },
];
