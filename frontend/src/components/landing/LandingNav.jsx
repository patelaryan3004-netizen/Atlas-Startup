import { useEffect, useRef, useState } from 'react';

// Where each link goes in the app. The product has no accounts, so the one action on the right is the waitlist, which
// opens the same form as the app's own Join waitlist button.
const LINKS = [
  { label: 'Discover', href: '/' },
  { label: 'Lists', href: '/?view=lists' },
  { label: 'Jobs', href: '/?view=jobs' },
];

function Mark() {
  // Three points joined: a small network, in the ink of the page.
  return (
    <svg className="landing-brand-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M6 17.5 12 6.5l6 11M6 17.5h12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <circle cx="12" cy="6.5" r="2.4" fill="currentColor" />
      <circle cx="6" cy="17.5" r="2.4" fill="currentColor" />
      <circle cx="18" cy="17.5" r="2.4" fill="currentColor" />
    </svg>
  );
}

function MenuIcon({ open }) {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false">
      <path
        d={open ? 'M5 5l10 10M15 5 5 15' : 'M3.5 6.5h13M3.5 13.5h13'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function LandingNav() {
  const [open, setOpen] = useState(false);
  const bar = useRef(null);
  const toggle = useRef(null);

  // On a phone the links sit in a panel under the bar: Escape or a press anywhere else puts it away.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') { setOpen(false); toggle.current?.focus(); }
    };
    const onPress = (event) => {
      if (!bar.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPress);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPress);
    };
  }, [open]);

  return (
    <header className="landing-nav" ref={bar}>
      <a className="landing-brand" href="/welcome">
        <Mark />
        <span>AU Startup Map</span>
      </a>

      <nav id="landing-menu" className="landing-nav-links" aria-label="Main" data-open={open ? 'true' : 'false'}>
        <ul>
          {LINKS.map((link) => (
            <li key={link.label}>
              <a href={link.href} onClick={() => setOpen(false)}>{link.label}</a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="landing-nav-end">
        <a className="landing-nav-cta" href="/?view=waitlist">Join waitlist</a>
        <button
          ref={toggle}
          type="button"
          className="landing-menu-btn"
          aria-expanded={open}
          aria-controls="landing-menu"
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => setOpen((was) => !was)}
        >
          <MenuIcon open={open} />
        </button>
      </div>
    </header>
  );
}
