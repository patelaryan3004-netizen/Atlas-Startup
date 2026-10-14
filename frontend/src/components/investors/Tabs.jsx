// A row of tabs: one is selected, the arrow keys move between them (and Home and End to the ends), and only the selected one is a tab stop. Used for
// the directory's "All investors | Saved" and for the panel's Overview | Portfolio | People. `tabs` are [id, label, count?]; each tab names the panel it
// controls (`${prefix}-panel`) and is itself `${prefix}-tab-${id}`.
export default function Tabs({ prefix, tabs, value, onChange, label, className = '' }) {
  const move = (e, at) => {
    const to = e.key === 'ArrowRight' ? at + 1 : e.key === 'ArrowLeft' ? at - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null;
    if (to == null) return;
    e.preventDefault();
    const next = tabs[(to + tabs.length) % tabs.length][0];
    onChange(next);
    document.getElementById(`${prefix}-tab-${next}`)?.focus();
  };
  return (
    <div className={`inv-tabs${className ? ` ${className}` : ''}`} role="tablist" aria-label={label}>
      {tabs.map(([id, text, count], at) => (
        <button
          key={id}
          type="button"
          role="tab"
          id={`${prefix}-tab-${id}`}
          aria-selected={value === id}
          aria-controls={`${prefix}-panel`}
          tabIndex={value === id ? 0 : -1}
          className={value === id ? 'inv-tab inv-tab-on' : 'inv-tab'}
          onClick={() => onChange(id)}
          onKeyDown={(e) => move(e, at)}
        >
          {text}{count != null && count !== 0 && <>{' '}<span className="inv-tab-count">{count}</span></>}
        </button>
      ))}
    </div>
  );
}
