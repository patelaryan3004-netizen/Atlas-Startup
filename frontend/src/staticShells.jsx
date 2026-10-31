import { DIRECTORY_URL } from './api.js';
import { curatedLists } from './curatedLists.js';

// The text of the pages the app draws itself (the map, the curated lists, the investors), written into their HTML at build time
// (scripts/prerender.mjs) so a search engine, a link preview and a visitor with no scripts read something real instead of an empty page.
// A visitor whose scripts run never sees it: index.html marks the page "js" and the stylesheet hides a .static-shell, and the app draws
// over it. It says only what the data says, and links to the plain list of every company.

const KEY_LINKS = [
  ['What Still Early is', '/'],
  ['The map', '/map'],
  ['Curated lists', '/lists'],
  ['Investors', '/investors'],
  ['How we verify', '/methodology'],
  ['About', '/about'],
  ['Contact', '/contact'],
];

function Links() {
  return (
    <ul>
      <li><a href={DIRECTORY_URL}>Browse every company as a plain list</a></li>
      {KEY_LINKS.map(([label, href]) => <li key={href}><a href={href}>{label}</a></li>)}
    </ul>
  );
}

// The map, and any address the app draws that has no page of its own here: what the site is, and the way to the plain list.
export function MapShell() {
  return (
    <div className="static-shell">
      <h1>Still Early</h1>
      <p>
        A map and a list of Australian startups: where they are, who is hiring now, and the page each fact came from. The map needs
        JavaScript; the plain list does not.
      </p>
      <Links />
    </div>
  );
}

// Every curated list that picks companies, with how many companies it picks (as of the build).
export function ListsShell({ counts }) {
  const lists = curatedLists.filter((list) => list.type === 'filter');
  return (
    <div className="static-shell">
      <h1>Curated lists of Australian startups</h1>
      <p>Lists by industry, city and what the companies are doing now. Each opens the matching startups.</p>
      <ul>
        {lists.map((list, i) => (
          <li key={list.id}>
            <a href={`/lists/${encodeURIComponent(list.id)}`}>{list.name}</a>: {list.description}
            {Number.isFinite(counts?.[i]) ? ` ${counts[i]} ${counts[i] === 1 ? 'company' : 'companies'}.` : ''}
          </li>
        ))}
      </ul>
      <Links />
    </div>
  );
}

// Every published investor, by name, with the kind of investor it is and where.
export function InvestorsShell({ investors }) {
  const list = investors?.results ?? [];
  return (
    <div className="static-shell">
      <h1>Australian startup investors</h1>
      <p>
        {list.length ? `${list.length} investors` : 'Investors'} in Australian startups, each with the pages behind its claims. Each page shows what the
        investor invests in and where, and says when it was last checked.
      </p>
      <ul>
        {list.map((investor) => (
          <li key={investor.slug}>
            <a href={`/investors/${encodeURIComponent(investor.slug)}`}>{investor.name}</a>
            {[investor.type_label, investor.location?.label].filter(Boolean).length ? `: ${[investor.type_label, investor.location?.label].filter(Boolean).join(', ')}.` : ''}
          </li>
        ))}
      </ul>
      <Links />
    </div>
  );
}
