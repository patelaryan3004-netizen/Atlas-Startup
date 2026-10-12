import { splitValues } from './MultiSelect.jsx';

// The quick filters in the bar above the list: Hiring and Events this week switch on and off; Sector, Stage and City pick from what the
// directory has. Each sets the same filter the Filters drawer does, so the two always agree.
function Pick({ label, filters, field, options, onChange }) {
  const chosen = field === 'stage' ? (filters.stage ? [filters.stage] : []) : splitValues(filters[field]);
  const value = chosen.length === 1 ? chosen[0] : '';
  const known = options.filter((o) => o && o !== 'Unknown');
  if (!known.length) return null;
  return (
    <label className={chosen.length ? 'qf-chip qf-chip-on' : 'qf-chip'}>
      <select aria-label={label} value={value} onChange={(e) => onChange({ ...filters, [field]: e.target.value })}>
        <option value="">{chosen.length > 1 ? `${label} (${chosen.length})` : label}</option>
        {known.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

export default function QuickFilters({ filters, meta, onChange }) {
  const toggle = (field, on) => () => onChange({ ...filters, [field]: filters[field] === on ? '' : on });
  const switchChip = (field, on, text) => (
    <button type="button" className={filters[field] === on ? 'qf-chip qf-chip-on' : 'qf-chip'} aria-pressed={filters[field] === on} onClick={toggle(field, on)}>{text}</button>
  );
  return (
    <div className="qf" role="group" aria-label="Quick filters">
      {switchChip('hiring', 'yes', 'Hiring')}
      <Pick label="Sector" field="sector" options={meta?.sectors ?? []} filters={filters} onChange={onChange} />
      <Pick label="Stage" field="stage" options={meta?.stages ?? []} filters={filters} onChange={onChange} />
      <Pick label="City" field="city" options={meta?.cities ?? []} filters={filters} onChange={onChange} />
      {switchChip('events', 'week', 'Events this week')}
    </div>
  );
}
