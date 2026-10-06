import { useEffect, useState } from 'react';
import { fetchSuggestions } from '../api.js';
import { useEscapeClose } from '../hooks/useEscapeClose.js';

const SUGGEST_DELAY_MS = 200;

// The search box. What it suggests is asked of the server (companies, people, investors, industries and
// locations that match, five of each at most), a moment after typing stops, and an answer to text that has since
// changed is dropped: the page never holds the companies in order to search them.
export default function SearchBar({ filters, onApplyFilters }) {
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState(null);
  useEscapeClose(() => setOpen(false));

  const q = filters.search.trim();

  useEffect(() => {
    if (!q) { setGroups(null); return undefined; }
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      fetchSuggestions(q, { signal: ctrl.signal })
        .then((found) => { if (!ctrl.signal.aborted) setGroups(found); })
        .catch((err) => { if (!ctrl.signal.aborted && err.name !== 'AbortError') setGroups(null); });
    }, SUGGEST_DELAY_MS);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [q]);

  const hasResults = !!groups && (
    groups.companies.length || groups.people.length || groups.investors.length
    || groups.industries.length || groups.locations.length
  );

  const selectText = (text) => {
    onApplyFilters({ search: text });
    setOpen(false);
  };
  const selectField = (field, value) => {
    onApplyFilters({ search: '', [field]: value });
    setOpen(false);
  };

  return (
    <div className="floating-search">
      <input
        type="text"
        placeholder="Search Australian startups, founders, investors..."
        value={filters.search}
        onChange={(e) => { onApplyFilters({ search: e.target.value }); setOpen(true); }}
        onFocus={() => setOpen(true)}
        aria-label="Search startups, founders, investors, industries, locations"
      />

      {open && q && (
        <>
          <div className="search-scrim" onClick={() => setOpen(false)} />
          <div className="search-dropdown">
            {groups && !hasResults && <div className="search-empty">No matches for &ldquo;{filters.search}&rdquo;.</div>}

            {groups?.companies.length > 0 && (
              <div className="search-group">
                <div className="search-group-label">Companies</div>
                {groups.companies.map((s) => (
                  <button key={s.slug || s.name} className="search-result" onClick={() => selectText(s.name)}>
                    {s.name}
                  </button>
                ))}
              </div>
            )}

            {groups?.people.length > 0 && (
              <div className="search-group">
                <div className="search-group-label">People</div>
                {groups.people.map((p) => (
                  <button key={p.name} className="search-result" onClick={() => selectText(p.name)}>
                    {p.name}<span className="search-result-meta">{p.company}</span>
                  </button>
                ))}
              </div>
            )}

            {groups?.investors.length > 0 && (
              <div className="search-group">
                <div className="search-group-label">Investors</div>
                {groups.investors.map((i) => (
                  <button key={i} className="search-result" onClick={() => selectField('investor', i)}>{i}</button>
                ))}
              </div>
            )}

            {groups?.industries.length > 0 && (
              <div className="search-group">
                <div className="search-group-label">Industries</div>
                {groups.industries.map((s) => (
                  <button key={s} className="search-result" onClick={() => selectField('sector', s)}>{s}</button>
                ))}
              </div>
            )}

            {groups?.locations.length > 0 && (
              <div className="search-group">
                <div className="search-group-label">Locations</div>
                {groups.locations.map((c) => (
                  <button key={c} className="search-result" onClick={() => selectField('city', c)}>{c}</button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
