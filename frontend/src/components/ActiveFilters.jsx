import { splitValues, joinValues } from './MultiSelect.jsx';

const PRECISION_WORDS = { EXACT: 'Exact office', SUBURB: 'Suburb only', CITY: 'City only', STATE: 'State only', UNKNOWN: 'Place unknown' };
const HIRING_WORDS = { yes: 'Hiring now', no: 'Not verified as hiring' };

// The filters that are on, one chip each (a filter of several values has a chip for each value): [{ key, value, group, text }]. `group`
// is what kind of filter it is (for the screen reader), `text` what it says. The concept filter taskGate is never shown: it is not one.
export function activeChips(filters) {
  const chips = [];
  const add = (key, group, values, words = (v) => v) => values.forEach((value) => chips.push({ key, value, group, text: words(value) }));
  add('sector', 'Sector', splitValues(filters.sector));
  add('city', 'City', splitValues(filters.city));
  add('state', 'State', splitValues(filters.state).map((v) => v.toUpperCase()));
  add('precision', 'Place', splitValues(filters.precision).map((v) => v.toUpperCase()), (v) => PRECISION_WORDS[v] ?? v);
  add('stage', 'Stage', filters.stage ? [filters.stage] : []);
  add('investor', 'Investor', filters.investor ? [filters.investor] : []);
  add('hiring', 'Hiring', filters.hiring ? [filters.hiring] : [], (v) => HIRING_WORDS[v] ?? v);
  add('search', 'Search', filters.search?.trim() ? [filters.search.trim()] : [], (v) => `“${v}”`);
  return chips;
}

// Each chip takes its filter off, and only that value of it.
export function withoutChip(filters, { key, value }) {
  if (key === 'sector' || key === 'city' || key === 'state' || key === 'precision') {
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
