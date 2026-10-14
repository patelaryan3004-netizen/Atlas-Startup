import { useState } from 'react';
import { splitValues, joinValues } from '../MultiSelect.jsx';
import { usePopover } from '../../hooks/usePopover.js';
import { ChevronDown } from './icons.jsx';

const FIND_FROM = 8; // a list longer than this gets a box to narrow it

// A filter of several values as a small button with a menu of checkboxes under it (Stage, Sector, Location). The button says how many are chosen,
// each choice says how many investors have it, and a value that is on but no longer offered stays in the list, so it can be unticked.
// `options` are [{ value, label?, count? }]; `value` is the chosen ones joined with commas, which is how the server takes several.
export default function CheckMenu({ label, options, value, onChange, noun = label.toLowerCase() }) {
  const { open, setOpen, ref } = usePopover();
  const [find, setFind] = useState('');
  const chosen = splitValues(value);
  const known = new Set(options.map((o) => o.value));
  const words = (o) => String(o.label ?? o.value);
  const shown = [...chosen.filter((v) => !known.has(v)).map((v) => ({ value: v })), ...options].filter((o) => words(o).toLowerCase().includes(find.trim().toLowerCase()));
  const toggle = (v) => onChange(joinValues(chosen.includes(v) ? chosen.filter((x) => x !== v) : [...chosen, v]));
  if (!options.length && !chosen.length) return null;
  return (
    <div className="xt-menu" ref={ref}>
      <button type="button" className={chosen.length ? 'xt-btn xt-btn-on' : 'xt-btn'} aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span>{label}{chosen.length ? <>{' '}<span className="xt-badge">{chosen.length}</span></> : null}</span>
        <ChevronDown size={18} className="xt-chev" />
      </button>
      {open && (
        <div className="xt-pop xt-checkpop" role="group" aria-label={label}>
          {options.length > FIND_FROM && (
            <input type="search" className="xt-find" aria-label={`Find ${noun}`} placeholder={`Find ${noun}`} value={find} onChange={(e) => setFind(e.target.value)} />
          )}
          <ul className="xt-checklist">
            {shown.map((o) => (
              <li key={o.value}>
                <label className="xt-check">
                  <input type="checkbox" checked={chosen.includes(o.value)} onChange={() => toggle(o.value)} />
                  <span>{words(o)}</span>
                  {o.count != null && <span className="xt-optcount">{o.count}</span>}
                </label>
              </li>
            ))}
            {shown.length === 0 && <li className="xt-none">None match.</li>}
          </ul>
          {chosen.length > 0 && <button type="button" className="xt-clear" onClick={() => onChange('')}>Clear {noun}</button>}
        </div>
      )}
    </div>
  );
}
