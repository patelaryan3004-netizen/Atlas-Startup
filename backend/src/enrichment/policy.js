// What the enrichment pipeline may do with what it finds, field by field.
//
// Everything it finds is recorded as evidence with its source. What it may then do to the
// COMPANY RECORD is much narrower, and is decided here:
//
//   fill     put the value on the record, but only if the record has no value for the field, only if
//            every active source agrees, and only if the evidence is at least `min` confidence.
//   suggest  leave the record alone; the evidence waits as a suggestion for a person to apply or turn down.
//   confirm  evidence only: it raises how well the record is backed, and changes nothing.
//
// It never overwrites a value the record already holds. Where evidence disagrees with the record, that is a
// conflict for a person (the evidence model reports it), however confident the evidence is.
//
// And a run has a MODE. In 'suggest' mode nothing is filled whatever the policy says: the run only gathers
// evidence. That is how a new pipeline should meet real websites for the first time. 'fill' applies the
// policy below.
//
// Why each is what it is:
//   description    the company's own homepage description, when the record has none: its own words.
//   founded_year   fill only from structured data. "Since 2019" in a sentence is not a founding date.
//   hiring_status  fill only from structured job postings, and only ever 'hiring': a page with no postings
//                  does not show a company is not hiring.
//   founders, investors   a sentence on a page can name the wrong people, so a person decides.
//   address, city, state  a pin on the map needs coordinates, which a website does not give.
//   sector, subsector, stage, funding   not here: a company's own site is not a legitimate source for them.

export const MODES = ['suggest', 'fill'];

export const FIELD_POLICY = {
  website: { mode: 'confirm' },
  description: { mode: 'fill', min: 'medium' },
  founded_year: { mode: 'fill', min: 'high' },
  hiring_status: { mode: 'fill', min: 'high' },
  founders: { mode: 'suggest' },
  investors: { mode: 'suggest' },
  address: { mode: 'suggest' },
  city: { mode: 'suggest' },
  state: { mode: 'suggest' },
};

const RANK = { low: 1, medium: 2, high: 3 };
export const atLeast = (confidence, min) => RANK[confidence] >= RANK[min];

// 'fill' | 'suggest' | 'confirm' for one field, given the best confidence among its evidence.
export function decide(field, bestConfidence, mode) {
  const policy = FIELD_POLICY[field] ?? { mode: 'suggest' };
  if (policy.mode === 'confirm') return 'confirm';
  if (policy.mode === 'fill' && mode === 'fill' && atLeast(bestConfidence, policy.min)) return 'fill';
  return 'suggest';
}
