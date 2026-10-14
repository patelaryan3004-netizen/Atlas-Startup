import { useRef, useState } from 'react';
import { useEscapeClose } from '../hooks/useEscapeClose.js';
import { MoreIcon } from './explore/icons.jsx';

// The menu behind the three dots at the end of the header: everything the header has no room for. On a phone it also holds the four places the
// header names (Explore, Jobs, Investors, Saved), which the narrow header leaves out.
export default function HeaderMenu({
  onExplore, onShowJobs, hiringCount, onShowInvestors, onShowPeople, onShowCuratedLists, onShowNews, newsVisible, onToggleNews, onShowWaitlist,
  onShowUnverified, unverifiedCount, onShowTracked, trackedCount, onShowAbout, onShowPrivacy, onShowFeedback, directoryUrl,
}) {
  const [open, setOpen] = useState(false);
  const toggle = useRef(null);
  useEscapeClose(() => setOpen(false));

  // An item shuts the menu, and the item is gone with it: focus goes to the menu's own button first, so a dialog the item opens gives focus back
  // to something that is still there when it closes.
  const go = (fn) => () => { toggle.current?.focus(); fn?.(); setOpen(false); };

  return (
    <div className="hdr-menu">
      <button ref={toggle} className="xh-more" aria-label="Menu" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((v) => !v)}>
        <MoreIcon size={22} />
      </button>
      {open && (
        <>
          <div className="hdr-menu-scrim" onClick={() => setOpen(false)} />
          <div className="hdr-menu-panel" role="menu">
            {/* Phones only: the header's own links are hidden there, so they live here too. */}
            <div className="hdr-menu-mobile-nav">
              <button className="hdr-menu-item" onClick={go(onExplore)}>Explore</button>
              <button className="hdr-menu-item" onClick={go(onShowJobs)}>
                Jobs{hiringCount > 0 && <span className="nav-hiring-hint"> &middot; {hiringCount} hiring now</span>}
              </button>
              <button className="hdr-menu-item" onClick={go(onShowInvestors)}>Investors</button>
              <button className="hdr-menu-item" onClick={go(onShowTracked)}>Saved{trackedCount > 0 ? ` (${trackedCount})` : ''}</button>
              <div className="hdr-menu-sep" />
            </div>
            {onShowPeople && <button className="hdr-menu-item" onClick={go(onShowPeople)}>People</button>}
            <button className="hdr-menu-item" onClick={go(onShowCuratedLists)}>Lists</button>
            <button className="hdr-menu-item" onClick={go(onShowNews)}>News</button>
            <button className="hdr-menu-item" onClick={go(onShowWaitlist)}>Join waitlist</button>
            <button className="hdr-menu-item" onClick={go(onShowUnverified)}>Unconfirmed ({unverifiedCount})</button>
            <button className="hdr-menu-item" onClick={go(onToggleNews)}>{newsVisible ? 'Hide news ticker' : 'Show news ticker'}</button>
            <div className="hdr-menu-sep" />
            <button className="hdr-menu-item" onClick={go(onShowAbout)}>About &amp; sources</button>
            <a className="hdr-menu-item" href="/methodology">Methodology</a>
            <a className="hdr-menu-item" href="/about">About</a>
            <a className="hdr-menu-item" href="/contact">Contact</a>
            <button className="hdr-menu-item" onClick={go(onShowFeedback)}>Feedback</button>
            <button className="hdr-menu-item" onClick={go(onShowPrivacy)}>Privacy</button>
            <a className="hdr-menu-item" href={directoryUrl}>Full list (no JS)</a>
            <p className="hdr-menu-credit">Built by Aryan &middot; Monash University. A beta, independent project.</p>
          </div>
        </>
      )}
    </div>
  );
}
