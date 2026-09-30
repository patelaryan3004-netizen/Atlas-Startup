import { useMemo, useState } from 'react';
import { useEscapeClose } from '../hooks/useEscapeClose.js';

const MAX_PER_GROUP = 5;

export default function SearchBar({ filters, onApplyFilters, startups, meta }) {
  const [open, setOpen] = useState(false);
  useEscapeClose(() => setOpen(false));

  const q = filters.search.trim().toLowerCase();

  const groups = useMemo(() => {
    if (!q) return null;

    const companies = startups
      .filter((s) => s.name.toLowerCase().includes(q))
      .slice(0, MAX_PER_GROUP);

    const people = [];
    const seenPeople = new Set();
    for (const s of startups) {
      for (const f of s.founders || []) {
        if (people.length >= MAX_PER_GROUP) break;
        if (!seenPeople.has(f) && f.toLowerCase().includes(q)) {
          seenPeople.add(f);
          people.push({ name: f, company: s.name });
        }
      }
      if (people.length >= MAX_PER_GROUP) break;
    }

    const investors = (meta.investors || []).filter((i) => i.toLowerCase().includes(q)).slice(0, MAX_PER_GROUP);
    const industries = (meta.sectors || []).filter((s) => s.toLowerCase().includes(q)).slice(0, MAX_PER_GROUP);
    const locations = (meta.cities || []).filter((c) => c.toLowerCase().includes(q)).slice(0, MAX_PER_GROUP);

    return { companies, people, investors, industries, locations };
  }, [q, startups, meta]);

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
            {!hasResults && <div className="search-empty">No matches for &ldquo;{filters.search}&rdquo;.</div>}

            {groups.companies.length > 0 && (
              <div className="search-group">
                <div className="search-group-label">Companies</div>
                {groups.companies.map((s) => (
                  <button key={s.name} className="search-result" onClick={() => selectText(s.name)}>
                    {s.name}
                  </button>
                ))}
              </div>
            )}

            {groups.people.length > 0 && (
              <div className="search-group">
                <div className="search-group-label">People</div>
                {groups.people.map((p) => (
                  <button key={p.name} className="search-result" onClick={() => selectText(p.name)}>
                    {p.name}<span className="search-result-meta">{p.company}</span>
                  </button>
                ))}
              </div>
            )}

            {groups.investors.length > 0 && (
              <div className="search-group">
                <div className="search-group-label">Investors</div>
                {groups.investors.map((i) => (
                  <button key={i} className="search-result" onClick={() => selectField('investor', i)}>{i}</button>
                ))}
              </div>
            )}

            {groups.industries.length > 0 && (
              <div className="search-group">
                <div className="search-group-label">Industries</div>
                {groups.industries.map((s) => (
                  <button key={s} className="search-result" onClick={() => selectField('sector', s)}>{s}</button>
                ))}
              </div>
            )}

            {groups.locations.length > 0 && (
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
