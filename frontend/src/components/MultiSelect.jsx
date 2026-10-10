import { useState } from 'react';

// A filter of several values at once: a box that says what is chosen, and under it the list to tick. A long list (the sectors) has a
// box to narrow it. The value is the chosen ones joined with commas, which is how the server takes several (sector=AI,Fintech).
export const splitValues = (value) => (value ? String(value).split(',').filter(Boolean) : []);
export const joinValues = (values) => values.join(',');

export default function MultiSelect({ id, label, all, noun, options, value, onChange }) {
  const [find, setFind] = useState('');
  const chosen = splitValues(value);
  // A chosen value the list no longer has (a link from before) stays on the list, so it can be unticked.
  const known = new Set(options);
  const extra = chosen.filter((v) => !known.has(v));
  const shown = [...extra, ...options].filter((v) => v.toLowerCase().includes(find.trim().toLowerCase()));
  const summary = chosen.length === 0 ? all : chosen.length <= 2 ? chosen.join(', ') : `${chosen.length} ${noun}`;

  const toggle = (v) => onChange(joinValues(chosen.includes(v) ? chosen.filter((x) => x !== v) : [...chosen, v]));

  return (
    <div className="fgroup" role="group" aria-labelledby={`${id}-label`}>
      <span className="flabel" id={`${id}-label`}>{label}</span>
      <details className="fmulti">
        <summary className="fmulti-summary">{summary}</summary>
        <div className="fmulti-body">
          {options.length > 8 && (
            <input type="search" className="fmulti-find" aria-label={`Find in ${noun}`} placeholder={`Find in ${noun}`} value={find} onChange={(e) => setFind(e.target.value)} />
          )}
          <ul className="fmulti-list">
            {shown.map((v) => (
              <li key={v}>
                <label className="fmulti-opt">
                  <input type="checkbox" checked={chosen.includes(v)} onChange={() => toggle(v)} />
                  <span>{v}</span>
                </label>
              </li>
            ))}
            {shown.length === 0 && <li className="fmulti-none">None match.</li>}
          </ul>
          {chosen.length > 0 && <button type="button" className="linkbtn fmulti-clear" onClick={() => onChange('')}>Clear {noun}</button>}
        </div>
      </details>
    </div>
  );
}
