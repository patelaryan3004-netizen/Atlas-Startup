// The sector a visitor chooses by: ONE short list of 12 display sectors (plus "Other"), shared by the map and the directory.
//
// The data keeps the sector label each source gave a company ("HealthTech", "Healthtech", "Medtech", "Enterprise AI", "Sales AI", "Construction SaaS"...: 97 of them, many of
// them one idea in different words). Those labels are never changed: a record's `sector` is what its source said. `sectorGroup` is added beside it, from the table below, so a
// menu can offer twelve names and not ninety-seven, and "HealthTech" and "Healthtech" are one choice.
//
// Rules the table follows:
//   - every label is placed by hand (nothing is guessed from a word inside it), so a new label is not silently put somewhere: it is `Other` until a person places it, and a test lists
//     every label the data has and fails for one the table does not know;
//   - a company with no sector, or "Unknown", has no group: it is unclassified, not "Other";
//   - "Other" is for sectors that are known and do not fit any of the twelve (a coworking space is not a sector of startup).
export const SECTOR_GROUPS = [
  'AI & Data',
  'Software & DevTools',
  'Cybersecurity',
  'Fintech',
  'Health & Biotech',
  'Climate & Energy',
  'Food & Agriculture',
  'Consumer & Commerce',
  'Education',
  'Property & Construction',
  'Industrial & Logistics',
  'Deep Tech & Space',
];
export const OTHER_SECTOR = 'Other';
export const SECTOR_OPTIONS = [...SECTOR_GROUPS, OTHER_SECTOR];

const TABLE = {
  'AI & Data': ['AI', 'AI infrastructure', 'Enterprise AI', 'Enterprise AI software', 'Sales AI', 'Vertical AI', 'Industrial AI', 'Maritime AI', 'Computer vision', 'Data', 'Data infrastructure', 'Analytics'],
  'Software & DevTools': [
    'SaaS', 'B2B SaaS', 'DevTools', 'Enterprise', 'Enterprise Software', 'Productivity SaaS', 'Strategy SaaS', 'Engineering SaaS', 'Contact-centre SaaS', 'Video software',
    'HR Tech', 'HR', 'Workforce', 'Legal tech', 'Legaltech', 'GRC', 'Martech', 'Adtech', 'Research Tech', 'Web3',
  ],
  Cybersecurity: ['Cybersecurity'],
  Fintech: ['Fintech', 'Insurtech', 'WealthTech', 'Open banking'],
  'Health & Biotech': ['HealthTech', 'Medtech', 'Biotech', 'Telehealth', 'Aged', 'Wearables'],
  'Climate & Energy': ['Energy', 'Climate', 'ClimateTech', 'Climate SaaS', 'ESG SaaS', 'Green ammonia'],
  'Food & Agriculture': ['AgTech', 'Food', 'Alt-protein', 'Cellular agriculture'],
  'Consumer & Commerce': [
    'Consumer', 'Marketplace', 'Retail', 'Retail media', 'Ecommerce', 'Fashion', 'Sports', 'Media', 'Gaming', 'Gaming infrastructure', 'Travel', 'Experiences',
    'Hospitality', 'Hospitality Tech', 'Hospitality SaaS',
  ],
  Education: ['EdTech'],
  'Property & Construction': ['PropTech', 'Construction SaaS', 'Construction safety SaaS'],
  'Industrial & Logistics': [
    'Logistics', 'Logistics SaaS', 'Industrial Automation', 'Manufacturing', 'Mining Tech', 'Mobility', 'Automotive', 'Automotive SaaS', 'Automotive data', 'Packaging',
  ],
  'Deep Tech & Space': ['Space', 'Satellite IoT', 'Geospatial', 'Quantum', 'Quantum computing', 'Hardware', 'Robotics', 'Defence', 'Spatial Computing', 'VR'],
  [OTHER_SECTOR]: ['Community'],
};

// The label as it is looked up: case and surrounding space do not matter ("Healthtech", "HealthTech" and "HR tech", "HR Tech" are one word each, so each is in the table once), and nothing else is folded.
const key = (label) => String(label ?? '').trim().toLowerCase();
const GROUP_OF = new Map();
for (const [group, labels] of Object.entries(TABLE)) {
  for (const label of labels) {
    if (GROUP_OF.has(key(label)) && GROUP_OF.get(key(label)) !== group) throw new Error(`sector "${label}" is placed in two groups`);
    GROUP_OF.set(key(label), group);
  }
}

// What a sector means as a source's "no answer": the record is unclassified.
const MISSING = new Set(['', 'unknown', 'n/a', 'none']);

// The display sector of a source label: one of SECTOR_GROUPS, "Other" for a known sector that fits none of them, or null for a company with no sector.
export function sectorGroupOf(label) {
  const k = key(label);
  if (MISSING.has(k)) return null;
  return GROUP_OF.get(k) ?? OTHER_SECTOR;
}

// Is this label one the table places by hand? (A test asks it of every label in the data.)
export const isPlacedSector = (label) => MISSING.has(key(label)) || GROUP_OF.has(key(label));

// The labels the table places in a group (for the tests and the documentation).
export const labelsOf = (group) => [...(TABLE[group] ?? [])];
