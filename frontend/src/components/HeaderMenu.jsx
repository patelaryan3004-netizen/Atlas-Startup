import { useState } from 'react';
import { useEscapeClose } from '../hooks/useEscapeClose.js';

export default function HeaderMenu({
  onExplore, onShowJobs, hiringCount, onShowCuratedLists, newsVisible, onToggleNews, onShowWaitlist,
  onShowUnverified, unverifiedCount, onShowTracked, trackedCount,
}) {
  const [open, setOpen] = useState(false);
  useEscapeClose(() => setOpen(false));

  const go = (fn) => () => { fn(); setOpen(false); };

  return (
    <div className="hdr-menu">
      <button
        className="hdrbtn nav-mobile-toggle"
        aria-label="Menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        &#9776;
      </button>
      {open && (
        <>
          <div className="hdr-menu-scrim" onClick={() => setOpen(false)} />
          <div className="hdr-menu-panel">
            {/* Mobile only: the primary nav row is hidden below the nav breakpoint, so it lives here too. */}
            <div className="hdr-menu-mobile-nav">
              <button className="hdr-menu-item" onClick={go(onExplore)}>Explore</button>
              <button className="hdr-menu-item" onClick={go(onShowJobs)}>
                Jobs{hiringCount > 0 && <span className="nav-hiring-hint"> · {hiringCount} hiring now</span>}
              </button>
              <button className="hdr-menu-item" onClick={go(onShowCuratedLists)}>Lists</button>
              <button className="hdr-menu-item" onClick={go(onToggleNews)}>{newsVisible ? 'Hide news' : 'News'}</button>
              <button className="hdr-menu-item hdr-menu-item-accent" onClick={go(onShowWaitlist)}>Join waitlist</button>
              <div className="hdr-menu-sep" />
            </div>
            <button className="hdr-menu-item" onClick={go(onShowUnverified)}>Unconfirmed ({unverifiedCount})</button>
            <button className="hdr-menu-item" onClick={go(onShowTracked)}>&#9733; Tracked ({trackedCount})</button>
          </div>
        </>
      )}
    </div>
  );
}
