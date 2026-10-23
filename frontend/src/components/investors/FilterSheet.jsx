import { splitValues, joinValues } from '../MultiSelect.jsx';
import { useDialog } from '../../hooks/useDialog.js';
import { CloseIcon } from '../explore/icons.jsx';

// The filters on a phone: one button opens a sheet over the page that holds all of them, each as a short list of boxes to tick, with the number of
// investors that would be shown and a way to clear them all. It closes with its own button, with Escape, and with a press outside it, and focus goes back
// to the button that opened it. A filter is only listed when some investor has a value for it, as in the menus on a wide screen.
// `groups` are [{ id, label, options: [{ value, label?, count? }], value, onChange }] (several values ticked), and `children` is whatever else belongs in the sheet.
function Group({ group }) {
  const chosen = splitValues(group.value);
  const known = new Set(group.options.map((o) => o.value));
  const shown = [...chosen.filter((v) => !known.has(v)).map((v) => ({ value: v })), ...group.options];
  const toggle = (v) => group.onChange(joinValues(chosen.includes(v) ? chosen.filter((x) => x !== v) : [...chosen, v]));
  return (
    <fieldset className="inv-sheet-group">
      <legend>{group.label}{chosen.length > 0 && <span className="xt-badge">{chosen.length}</span>}</legend>
      <ul className="inv-sheet-list">
        {shown.map((o) => (
          <li key={o.value}>
            <label className="xt-check">
              <input type="checkbox" checked={chosen.includes(o.value)} onChange={() => toggle(o.value)} />
              <span>{o.label ?? o.value}</span>
              {o.count != null && <span className="xt-optcount">{o.count}</span>}
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

export default function FilterSheet({ groups, count, active, onClear, onClose, children }) {
  const { titleId, overlayProps, panelProps } = useDialog(onClose);
  return (
    <div className="inv-sheet-overlay" {...overlayProps}>
      <div className="inv-sheet" {...panelProps}>
        <div className="inv-sheet-head">
          <h2 id={titleId}>Filters</h2>
          <button type="button" className="inv-sheet-close" aria-label="Close the filters" onClick={onClose}><CloseIcon size={20} /></button>
        </div>
        <div className="inv-sheet-body">
          {groups.filter((g) => g.options.length > 0 || splitValues(g.value).length > 0).map((g) => <Group key={g.id} group={g} />)}
          {children}
        </div>
        <div className="inv-sheet-foot">
          {active && <button type="button" className="inv-sheet-clear" onClick={onClear}>Clear all</button>}
          <button type="button" className="taskbtn inv-sheet-done" onClick={onClose}>{count == null ? 'Show investors' : `Show ${count} ${count === 1 ? 'investor' : 'investors'}`}</button>
        </div>
      </div>
    </div>
  );
}
