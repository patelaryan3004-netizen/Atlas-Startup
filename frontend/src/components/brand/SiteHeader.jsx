import HeaderMenu from '../HeaderMenu.jsx';
import { PlusIcon, ArrowRight } from '../explore/icons.jsx';
import Wordmark from './Wordmark.jsx';
import BottomNav from './BottomNav.jsx';
import AccountMenu from '../network/AccountMenu.jsx';
import AuthHost from '../network/AuthHost.jsx';
import { HOME_PATH } from '../../paths.js';
import { NAV, ADD_HREF, linkProps } from './nav.js';

// The header: the same on every page. The site's name goes to the welcome page, the pill in the middle goes to the three places (Home, Discover,
// Opportunities), the page's own action (when it has one) and the person's avatar sit at the end, and the dots hold everything else. On a phone the three
// places move to a bar along the bottom (BottomNav). `active` is the place the page is, `go` the handlers of the app's own pages (a link a page can take over
// is followed inside the app), `counts` the numbers beside the places, `extra` anything the page puts beside the action.
//
// What belongs to a person (their profile, what they saved, signing out) is in the avatar's menu: there is no "Saved" or "Profile" place of its own.
export default function SiteHeader({ active = null, go = {}, counts = {}, onAdd, menu = {}, extra = null, addLabel = null }) {
  return (
    <>
      <header className="sh">
        <a className="sh-brand" href={HOME_PATH} aria-label="Go to home">
          <Wordmark className="sh-wordmark" />
        </a>

        <nav className="sh-nav" aria-label="Main">
          {NAV.map(({ id, label, href }) => {
            return (
              <a
                key={id}
                className="sh-link"
                aria-current={active === id ? 'page' : undefined}
                {...linkProps(href, go[id])}
              >
                {label}
              </a>
            );
          })}
        </nav>

        <div className="sh-end">
          {extra}
          {addLabel && (onAdd ? (
            <button type="button" className="sh-add" onClick={onAdd} aria-label={addLabel}>
              <PlusIcon size={20} /><span className="sh-add-text">{addLabel}</span><ArrowRight size={18} className="sh-add-text" />
            </button>
          ) : (
            <a className="sh-add" href={ADD_HREF} aria-label={addLabel}>
              <PlusIcon size={20} /><span className="sh-add-text">{addLabel}</span><ArrowRight size={18} className="sh-add-text" />
            </a>
          ))}
          <AccountMenu go={go} savedCount={counts.saved} />
          <HeaderMenu {...menu} go={go} />
        </div>
      </header>
      <BottomNav active={active} go={go} />
      <AuthHost />
    </>
  );
}
