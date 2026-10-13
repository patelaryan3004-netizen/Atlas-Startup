import { useEffect, useState } from 'react';
import { fetchStartupPage } from '../api.js';
import { Avatar } from './EntityCard.jsx';
import { freshOf, freshText } from '../freshness.js';

const SHOWN = 8;

// The companies that raised, or had a role seen on a page of their own, in the last 14 days, among those the filters pick: a strip above the
// list. There is none when there are none, and none while the list is already narrowed to them. What it says about each ("Raised 3 Oct") is
// read from the company's own dates, and a company with no such date is left out whatever the server sent.
export default function NewThisWeek({ filters, onSelectStartup, onShowAll }) {
  const [found, setFound] = useState({ items: [], count: 0 });

  useEffect(() => {
    if (filters.fresh === 'week') { setFound({ items: [], count: 0 }); return undefined; }
    const ctrl = new AbortController();
    fetchStartupPage({ ...filters, fresh: 'week' }, { limit: SHOWN, offset: 0, sort: 'name', signal: ctrl.signal })
      .then((page) => {
        if (ctrl.signal.aborted) return;
        const items = (page.results ?? []).map((s) => ({ s, fresh: freshOf(s) })).filter((x) => x.fresh && freshText(x.fresh));
        setFound({ items, count: items.length ? page.count ?? items.length : 0 });
      })
      .catch(() => { if (!ctrl.signal.aborted) setFound({ items: [], count: 0 }); });
    return () => ctrl.abort();
  }, [filters]);

  if (found.items.length === 0) return null;
  return (
    <section className="new-week" aria-labelledby="newWeekTitle">
      <div className="new-week-head">
        <h2 id="newWeekTitle" className="new-week-title">New this week</h2>
        {found.count > found.items.length && onShowAll && (
          <button type="button" className="linkbtn new-week-all" onClick={onShowAll}>See all {found.count}</button>
        )}
      </div>
      <ul className="new-week-list">
        {found.items.map(({ s, fresh }) => (
          <li key={s.slug || s.name}>
            <button type="button" className="new-week-item" onClick={() => onSelectStartup(s)}>
              <Avatar name={s.name} website={s.website} />
              <span className="new-week-name">{s.name}</span>
              <span className="new-week-what">{freshText(fresh)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
