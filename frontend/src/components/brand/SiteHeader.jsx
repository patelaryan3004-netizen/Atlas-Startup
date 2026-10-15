import HeaderMenu from '../HeaderMenu.jsx';
import { AustraliaMark, PlusIcon, ArrowRight } from '../explore/icons.jsx';
import { HOME_PATH } from '../../paths.js';
import { NAV, ADD_HREF, isPlainClick } from './nav.js';

// The header: the same on every page. The site's name goes to the landing page, the pill in the middle goes to the five places, "Add company" is the
// one action, and the dots hold everything else (on a phone the five places move in there as well). `active` is the place the page is, `go` the handlers
// of the app's own pages, `counts` the numbers beside Jobs ("hiring now") and Saved. `extra` is anything the page puts beside the action.
export default function SiteHeader({ active = null, go = {}, counts = {}, onAdd, menu = {}, extra = null, addLabel = 'Add company' }) {
  return (
    <header className="sh">
      <a className="sh-brand" href={HOME_PATH} aria-label="Go to home">
        <AustraliaMark size={38} className="sh-mark" />
        <span className="sh-name">AU Startup Map</span>
      </a>

      <nav className="sh-nav" aria-label="Main">
        {NAV.map(({ id, label, href }) => {
          const handler = go[id];
          return (
            <a
              key={id}
              className="sh-link"
              href={href}
              aria-current={active === id ? 'page' : undefined}
              title={id === 'jobs' && counts.jobs > 0 ? `${counts.jobs} hiring now` : undefined}
              onClick={handler ? (event) => { if (isPlainClick(event)) { event.preventDefault(); handler(); } } : undefined}
            >
              {label}
              {id === 'saved' && counts.saved > 0 && <span className="sh-count">{counts.saved}</span>}
            </a>
          );
        })}
      </nav>

      <div className="sh-end">
        {extra}
        {onAdd ? (
          <button type="button" className="sh-add" onClick={onAdd} aria-label={addLabel}>
            <PlusIcon size={20} /><span className="sh-add-text">{addLabel}</span><ArrowRight size={18} className="sh-add-text" />
          </button>
        ) : (
          <a className="sh-add" href={ADD_HREF} aria-label={addLabel}>
            <PlusIcon size={20} /><span className="sh-add-text">{addLabel}</span><ArrowRight size={18} className="sh-add-text" />
          </a>
        )}
        <HeaderMenu {...menu} go={go} hiringCount={counts.jobs} trackedCount={counts.saved} />
      </div>
    </header>
  );
}
