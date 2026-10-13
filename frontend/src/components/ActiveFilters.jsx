import { splitValues, joinValues } from './MultiSelect.jsx';
import { SEED_TO_SERIES_A, remoteLabel, teamLabel } from '../directory.js';

const PRECISION_WORDS = { EXACT: 'Exact office', SUBURB: 'Suburb only', CITY: 'City only', STATE: 'State only', UNKNOWN: 'Place unknown' };
const HIRING_WORDS = { yes: 'Hiring now', no: 'Not verified as hiring' };

// The filters that are on, one chip each (a filter of several values has a chip for each value): [{ key, value, group, text }]. `group`
// is what kind of filter it is (for the screen reader), `text` what it says. The concept filter taskGate is never shown: it is not one.
// The stages "Seed to Series A" are one chip, since that is what was chosen.
export function activeChips(filters) {
  const chips = [];
  const add = (key, group, values, words = (v) => v) => values.forEach((value) => chips.push({ key, value, group, text: words(value) }));
  add('sector', 'Sector', splitValues(filters.sector));
  add('city', 'City', splitValues(filters.city));
  add('state', 'State', splitValues(filters.state).map((v) => v.toUpperCase()));
  add('precision', 'Place', splitValues(filters.precision).map((v) => v.toUpperCase()), (v) => PRECISION_WORDS[v] ?? v);
  add('stage', 'Stage', filters.stage === SEED_TO_SERIES_A ? [SEED_TO_SERIES_A] : splitValues(filters.stage), (v) => (v === SEED_TO_SERIES_A ? 'Seed to Series A' : v));
  add('investor', 'Investor', filters.investor ? [filters.investor] : []);
  add('hiring', 'Hiring', filters.hiring ? [filters.hiring] : [], (v) => HIRING_WORDS[v] ?? v);
  add('remote', 'Remote policy', splitValues(filters.remote), (v) => remoteLabel(v) ?? v);
  add('tech', 'Tech stack', splitValues(filters.tech));
  add('team', 'Team size', splitValues(filters.team), (v) => teamLabel(v) ?? v);
  add('events', 'Events', filters.events ? [filters.events] : [], () => 'Events this week');
  add('fresh', 'New', filters.fresh ? [filters.fresh] : [], () => 'New this week');
  add('search', 'Search', filters.search?.trim() ? [filters.search.trim()] : [], (v) => `“${v}”`);
  return chips;
}

// Each chip takes its filter off, and only that value of it.
export function withoutChip(filters, { key, value }) {
  if (key === 'stage' && value === SEED_TO_SERIES_A) return { ...filters, stage: '' };
  if (key === 'sector' || key === 'city' || key === 'state' || key === 'precision' || key === 'stage' || key === 'remote' || key === 'tech' || key === 'team') {
    return { ...filters, [key]: joinValues(splitValues(filters[key]).filter((v) => v.toUpperCase() !== String(value).toUpperCase())) };
  }
  return { ...filters, [key]: '' };
}

export default function ActiveFilters({ filters, onChange, onClear }) {
  const chips = activeChips(filters);
  if (!chips.length) return null;
  return (
    <ul className="active-filters" aria-label="Filters that are on">
      {chips.map((chip) => (
        <li key={`${chip.key}:${chip.value}`}>
          <button type="button" className="chip" onClick={() => onChange(withoutChip(filters, chip))} aria-label={`Remove filter: ${chip.group} ${chip.text}`}>
            <span className="chip-text">{chip.text}</span>
            <span className="chip-x" aria-hidden="true">&#10005;</span>
          </button>
        </li>
      ))}
      {chips.length > 1 && <li><button type="button" className="linkbtn chip-clear" onClick={onClear}>Clear all</button></li>}
    </ul>
  );
}
