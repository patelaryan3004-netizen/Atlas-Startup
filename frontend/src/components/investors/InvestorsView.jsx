import { useCallback, useEffect, useRef, useState } from 'react';
import InvestorDirectory from './InvestorDirectory.jsx';
import InvestorProfile from './InvestorProfile.jsx';
import InvestorPersonProfile from './InvestorPersonProfile.jsx';
import { clearRoute, readRoute, writeRoute } from './route.js';
import { usePageTitle } from './usePageTitle.js';
import '../../investors.css';

// The investor directory as a page of its own, as Jobs is. It holds three views (the directory, one investor, one person)
// and keeps the address bar in step, so each can be linked to and the back button goes where a person expects. The
// directory stays mounted behind a profile: coming back finds the same filters, the same results and the same place.
export default function InvestorsView({ initialRoute = { kind: 'list' }, fromLink = false, onClose, onOpenCompany }) {
  const [route, setRoute] = useState(initialRoute);
  const scroller = useRef(null);
  const listScroll = useRef(0);
  const title = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // The address says where the page is from the first moment. A page opened from a link is in the history already, so the address
  // is only tidied (an old ?view=investors link is written in the new form); one opened from the map is a step of its own.
  useEffect(() => { writeRoute(initialRoute, { replace: fromLink }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Back and forward move between the investor pages; back past the first of them is the map.
  useEffect(() => {
    const onPop = () => {
      const next = readRoute();
      if (next) setRoute(next);
      else closeRef.current();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // The tab names the directory for the whole visit; a profile names itself over it once it has loaded, and gives it back on leaving.
  usePageTitle('Australian Startup Investors · AU Startup Map');

  const go = useCallback((next) => {
    if (route.kind === 'list') listScroll.current = scroller.current?.scrollTop ?? 0;
    setRoute(next);
    writeRoute(next);
  }, [route.kind]);

  // On a new view the page starts at its top; back at the directory it returns to where it was, and its title takes focus.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (route.kind === 'list') {
      el.scrollTop = listScroll.current;
      title.current?.querySelector('h1')?.focus({ preventScroll: true });
    } else {
      el.scrollTop = 0;
    }
  }, [route.kind, route.slug]);

  const close = () => { clearRoute(); onClose(); };
  // A company opens over the map, so the investor pages leave the address as they do when closed.
  const openCompany = (company) => { clearRoute(); onOpenCompany(company); };
  const toList = () => go({ kind: 'list' });
  const openInvestor = (slug) => go({ kind: 'investor', slug });
  const openPerson = (slug) => go({ kind: 'person', slug });

  return (
    <div id="investorsView" ref={scroller}>
      <header className="inv-bar">
        <button type="button" className="hdrbtn" onClick={close}>← Back to map</button>
        <span className="inv-bar-name">AU Startup Map</span>
      </header>
      <main className="inv-main" id="inv-main">
        <div hidden={route.kind !== 'list'} ref={title}>
          <InvestorDirectory onOpen={openInvestor} onClose={close} />
        </div>
        {route.kind === 'investor' && (
          <InvestorProfile key={route.slug} slug={route.slug} onBack={toList} onOpenInvestor={openInvestor} onOpenPerson={openPerson} onOpenCompany={openCompany} />
        )}
        {route.kind === 'person' && (
          <InvestorPersonProfile key={route.slug} slug={route.slug} onBack={toList} onOpenInvestor={openInvestor} onOpenCompany={openCompany} />
        )}
      </main>
    </div>
  );
}
