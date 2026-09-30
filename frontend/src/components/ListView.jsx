import { useMemo, useState } from 'react';

function domainOf(website) {
  if (!website) return null;
  try {
    return new URL(website).hostname.replace(/^www\./, '');
  } catch (e) {
    return null;
  }
}

function CardLogo({ website, name }) {
  const domain = domainOf(website);
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  const [failed, setFailed] = useState(false);
  const [triedFallback, setTriedFallback] = useState(false);

  if (!domain || failed) {
    return <span className="startup-card-logo-fallback">{initial}</span>;
  }
  const src = triedFallback
    ? `https://www.google.com/s2/favicons?domain=${domain}&sz=64`
    : `https://logo.clearbit.com/${domain}?size=64`;
  return (
    <img
      className="startup-card-logo"
      src={src}
      alt=""
      onError={() => (triedFallback ? setFailed(true) : setTriedFallback(true))}
    />
  );
}

// Only sorts backed by a real field on the startup record. "Recently added"
// and "Recently funded" would need a date field that doesn't exist in the
// dataset, so they're left out rather than faked with a stand-in.
const SORTS = {
  name: { label: 'Name (A–Z)', compare: (a, b) => a.name.localeCompare(b.name) },
  hiring: { label: 'Hiring now', compare: (a, b) => (b.hiring === true) - (a.hiring === true) || a.name.localeCompare(b.name) },
  location: { label: 'Location (A–Z)', compare: (a, b) => a.city.localeCompare(b.city) || a.name.localeCompare(b.name) },
  industry: { label: 'Industry (A–Z)', compare: (a, b) => (a.sectorFull || a.sector).localeCompare(b.sectorFull || b.sector) || a.name.localeCompare(b.name) },
};

export default function ListView({ startups, sectorColors, onSelectStartup, selectedName, trackedNames }) {
  const [sort, setSort] = useState('name');

  const sorted = useMemo(
    () => [...startups].sort(SORTS[sort].compare),
    [startups, sort]
  );

  return (
    <div id="startupListView">
      <div className="startup-list-toolbar">
        <span className="startup-list-count">{startups.length} {startups.length === 1 ? 'startup' : 'startups'}</span>
        <label className="startup-list-sort">
          Sort by
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            {Object.entries(SORTS).map(([key, { label }]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </label>
      </div>

      {startups.length === 0 ? (
        <p className="modal-sub startup-list-empty">No startups match your filters.</p>
      ) : (
        <div className="startup-grid">
          {sorted.map((s) => (
            <button
              key={s.name}
              className={s.name === selectedName ? 'startup-card startup-card-selected' : 'startup-card'}
              onClick={() => onSelectStartup(s)}
            >
              <div className="startup-card-top">
                <CardLogo website={s.website} name={s.name} />
                <div className="startup-card-heading">
                  <h3>
                    {s.name}
                    {trackedNames?.has(s.name) && <span className="startup-card-tracked" title="Tracked">★</span>}
                  </h3>
                  <div className="startup-card-meta">{s.sectorFull || s.sector} · {s.city} · {s.stage}</div>
                </div>
              </div>

              {s.blurb && <p className="pc-desc startup-card-desc">{s.blurb}</p>}

              <div className="startup-card-tags">
                {s.hiring ? (
                  <span className="hiring-badge">● Hiring now</span>
                ) : (
                  <span className="hiring-badge hiring-badge-off">Not hiring</span>
                )}
                {s.taskGate?.enabled && <span className="taskgate-badge">TASK-GATE</span>}
                {!s.verified && <span className="badge-unverified">Unverified</span>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
