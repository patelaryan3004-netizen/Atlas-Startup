import { Avatar } from './EntityCard.jsx';
import HiringBadge from './HiringBadge.jsx';
import { UnverifiedBadge } from './VerifiedNote.jsx';
import { nextEvent, eventDay, isBlank, verifiedLabel } from '../freshness.js';
import { remoteLabel } from '../directory.js';

// The list as a table: a row a company, a column a thing about it. Name, Stage, Hiring and Last verified are for every company; Team size,
// Remote policy and Tech stack are facts a page has to give, so each column is there only when some company in the list has one (a
// column of empty cells says nothing). A column that sorts is a button in its header; the sort is the server's (one page is all the
// browser holds), and the way it runs is fixed by what it is (names A to Z, the biggest team first, the newest check first).
const COLUMNS = [
  { key: 'name', label: 'Name', sort: 'name', way: 'ascending' },
  { key: 'stage', label: 'Stage', sort: 'stage', way: 'ascending' },
  { key: 'team', label: 'Team size', sort: 'team', way: 'descending', has: (s) => s.team_size != null },
  { key: 'remote', label: 'Remote policy', sort: 'remote', way: 'ascending', has: (s) => Boolean(remoteLabel(s.remote_policy)) },
  { key: 'tech', label: 'Tech stack', sort: null, has: (s) => Array.isArray(s.tech_stack) && s.tech_stack.length > 0 },
  { key: 'hiring', label: 'Hiring', sort: 'hiring', way: 'descending' },
  { key: 'verified', label: 'Last verified', sort: 'verified', way: 'descending' },
];
const ARROW = { ascending: '↑', descending: '↓' };
const TECH_SHOWN = 4;

export const columnsFor = (items) => COLUMNS.filter((c) => !c.has || items.some(c.has));

function Cell({ column, s, trackedNames, selectedName, onSelectStartup }) {
  switch (column.key) {
    case 'name': {
      const event = nextEvent(s.events);
      return (
        <th scope="row" className="st-name">
          <button type="button" className={s.name === selectedName ? 'st-open st-open-selected' : 'st-open'} onClick={() => onSelectStartup(s)}>
            <Avatar name={s.name} website={s.website} />
            <span className="st-name-text">{s.name}</span>
          </button>
          {trackedNames?.has(s.name) && <span className="startup-card-tracked" title="Tracked">★</span>}
          {event && <span className="event-badge" title={event.title}>{eventDay(event)}</span>}
          <UnverifiedBadge company={s} />
        </th>
      );
    }
    case 'stage': return <td>{isBlank(s.stage) ? null : s.stage}</td>;
    case 'team': return <td className="st-num">{s.team_size ?? null}</td>;
    case 'remote': return <td>{remoteLabel(s.remote_policy)}</td>;
    case 'tech': {
      const tools = Array.isArray(s.tech_stack) ? s.tech_stack : [];
      return (
        <td>
          {tools.length > 0 && (
            <ul className="st-tags" aria-label="Tech stack">
              {tools.slice(0, TECH_SHOWN).map((t) => <li key={t}>{t}</li>)}
              {tools.length > TECH_SHOWN && <li className="st-more" title={tools.slice(TECH_SHOWN).join(', ')}>+{tools.length - TECH_SHOWN}</li>}
            </ul>
          )}
        </td>
      );
    }
    case 'hiring': return <td><HiringBadge company={s} /></td>;
    case 'verified': {
      const fresh = verifiedLabel(s.last_verified_at);
      return <td>{fresh && <span className={fresh.stale ? 'verified-note verified-note-stale' : 'verified-note'}>{fresh.text}</span>}</td>;
    }
    default: return <td />;
  }
}

export default function StartupTable({ items, sort, onSort, onSelectStartup, selectedName, trackedNames, count }) {
  const columns = columnsFor(items);
  return (
    <div className="startup-table-wrap">
      <table className="startup-table">
        <caption className="sr-only">{count} {count === 1 ? 'startup' : 'startups'}, sorted by {columns.find((c) => c.sort === sort)?.label ?? 'name'}</caption>
        <thead>
          <tr>
            {columns.map((c) => {
              const active = c.sort && c.sort === sort;
              return (
                <th key={c.key} scope="col" className={c.key === 'team' ? 'st-num' : undefined} aria-sort={active ? c.way : undefined}>
                  {c.sort ? (
                    <button type="button" className={active ? 'st-sort st-sort-on' : 'st-sort'} onClick={() => onSort(c.sort)}>
                      {c.label}
                      <span className="st-arrow" aria-hidden="true">{active ? ARROW[c.way] : ''}</span>
                    </button>
                  ) : c.label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {items.map((s) => (
            <tr key={s.slug || s.name}>
              {columns.map((c) => <Cell key={c.key} column={c} s={s} trackedNames={trackedNames} selectedName={selectedName} onSelectStartup={onSelectStartup} />)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
