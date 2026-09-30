import { useState } from 'react';
import { useEscapeClose } from '../hooks/useEscapeClose.js';

export default function HeaderMenu({
  newsVisible, onToggleNews, onShowCuratedLists, onShowUnverified, unverifiedCount,
  onShowTracked, trackedCount, onShowSubmitForm, onShowWaitlist,
}) {
  const [open, setOpen] = useState(false);
  useEscapeClose(() => setOpen(false));

  const go = (fn) => () => { fn(); setOpen(false); };

  return (
    <div className="hdr-menu">
      <button
        className="hdrbtn"
        aria-label="More"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        &#8942;
      </button>
      {open && (
        <>
          <div className="hdr-menu-scrim" onClick={() => setOpen(false)} />
          <div className="hdr-menu-panel">
            <button className="hdr-menu-item" onClick={go(onToggleNews)}>{newsVisible ? 'Hide news' : 'Show news'}</button>
            <button className="hdr-menu-item" onClick={go(onShowCuratedLists)}>Curated lists</button>
            <button className="hdr-menu-item" onClick={go(onShowUnverified)}>Unconfirmed ({unverifiedCount})</button>
            <button className="hdr-menu-item" onClick={go(onShowTracked)}>&#9733; Tracked ({trackedCount})</button>
            <div className="hdr-menu-sep" />
            <button className="hdr-menu-item hdr-menu-item-accent" onClick={go(onShowSubmitForm)}>Submit a startup</button>
            <button className="hdr-menu-item hdr-menu-item-accent" onClick={go(onShowWaitlist)}>Join waitlist</button>
          </div>
        </>
      )}
    </div>
  );
}
