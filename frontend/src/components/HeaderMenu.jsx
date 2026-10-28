import { useRef, useState } from 'react';
import { useEscapeClose } from '../hooks/useEscapeClose.js';
import { MoreIcon } from './explore/icons.jsx';

// An item is a button when the page has something to do for it, and a link when it only has an address (the plain pages, which are not the app, have
// no dialogs to open: they have the addresses). With neither it is left out.
function Item({ onClick, href, children, accent = false }) {
  const className = accent ? 'hdr-menu-item hdr-menu-item-accent' : 'hdr-menu-item';
  if (onClick) return <button type="button" className={className} onClick={onClick}>{children}</button>;
  if (href) return <a className={className} href={href}>{children}</a>;
  return null;
}

// The menu behind the three dots at the end of the header: everything the header has no room for. (The three places are in the header, and on a phone in the
// bar along the bottom; what belongs to a person is under their avatar.)
export default function HeaderMenu({
  onShowLists, onShowPeople, onShowNews, newsVisible, onToggleNews, onShowWaitlist, onShowUnverified, unverifiedCount, 
  onShowAbout, onShowPrivacy, onShowFeedback, directoryUrl,
}) {
  const [open, setOpen] = useState(false);
  const toggle = useRef(null);
  useEscapeClose(() => setOpen(false));

  // An item shuts the menu, and the item is gone with it: focus goes to the menu's own button first, so a dialog the item opens gives focus back
  // to something that is still there when it closes.
  const run = (fn) => (fn ? () => { toggle.current?.focus(); fn(); setOpen(false); } : undefined);
  return (
    <div className="hdr-menu">
      <button ref={toggle} type="button" className="sh-more" aria-label="Menu" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((v) => !v)}>
        <MoreIcon size={22} />
      </button>
      {open && (
        <>
          <div className="hdr-menu-scrim" onClick={() => setOpen(false)} />
          <div className="hdr-menu-panel" role="menu">
            <Item onClick={run(onShowLists)} href="/lists">Collections</Item>
            <Item onClick={run(onShowPeople)}>People</Item>
            <Item onClick={run(onShowNews)} href="/news">News</Item>
            <Item onClick={run(onShowWaitlist)}>Join waitlist</Item>
            <Item onClick={run(onShowUnverified)}>{onShowUnverified ? `Unconfirmed (${unverifiedCount ?? 0})` : ''}</Item>
            <Item onClick={run(onToggleNews)}>{newsVisible ? 'Hide news ticker' : 'Show news ticker'}</Item>
            <div className="hdr-menu-sep" />
            <Item onClick={run(onShowAbout)}>About &amp; sources</Item>
            <a className="hdr-menu-item" href="/methodology">Methodology</a>
            <a className="hdr-menu-item" href="/about">About</a>
            <a className="hdr-menu-item" href="/contact">Contact</a>
            <Item onClick={run(onShowFeedback)}>Feedback</Item>
            <Item onClick={run(onShowPrivacy)}>Privacy</Item>
            {directoryUrl && <a className="hdr-menu-item" href={directoryUrl}>Full list (no JS)</a>}
            <p className="hdr-menu-credit">Built by Aryan &middot; Monash University. A beta, independent project.</p>
          </div>
        </>
      )}
    </div>
  );
}
