// Accelerator cohorts: an intake of a programme that a company went through ("Startmate · Winter 2026").
//
// A company's `cohorts` is a list of ids from this registry, an optional fact like `tech_stack` (company.js, FACT_FIELDS): the record has the key once
// a page has said so, and it is served only where an active evidence row from a public page backs it, with that page's address and the date it was
// read (catalog.js backedFacts). Being in a cohort says exactly that: the company took part in that programme's intake. It says nothing about its
// funding, its stage, whether it is hiring, or any tie to this site.
//
// The registry is code, like REMOTE_POLICIES: a new intake is one entry here (and then evidence rows that name it), so the filter, the search words,
// the dataset checks and the evidence checks all know it at once.
//   accelerator  who runs the programme
//   cohort       the intake, as its organiser writes it
//   label        the one line a visitor reads (a filter option, a chip, a line on a company)
//   aliases      other ways a visitor writes the intake; they are searchable and never shown as a second name
export const COHORTS = {
  'startmate-w26': {
    accelerator: 'Startmate',
    cohort: 'Winter 2026',
    label: 'Startmate · Winter 2026',
    aliases: ['W26', 'Winter 26', 'Winter ’26'],
  },
};

export const COHORT_IDS = Object.keys(COHORTS);
export const isCohort = (id) => typeof id === 'string' && Object.hasOwn(COHORTS, id);

// The words a search for this cohort matches, lower case: the accelerator, the intake, each alias, and the accelerator with each of them.
export function cohortTerms(id) {
  const c = COHORTS[id];
  if (!c) return [];
  const names = [c.cohort, ...c.aliases];
  return [...new Set([c.accelerator, c.label, ...names, ...names.map((n) => `${c.accelerator} ${n}`)].map((t) => t.toLowerCase()))];
}

// A cohort as a company shows it: what it is, and the page (and the day it was read) that says the company was in it.
export function programOf(id, source = null) {
  const c = COHORTS[id];
  return {
    id, accelerator: c.accelerator, cohort: c.cohort, label: c.label, aliases: c.aliases,
    source_url: source?.url ?? null, verified_at: source?.verified_at ?? null,
  };
}
