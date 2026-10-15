import { useCallback, useEffect, useRef, useState } from 'react';
import InvestorDirectory from './InvestorDirectory.jsx';
import InvestorProfile from './InvestorProfile.jsx';
import InvestorPersonProfile from './InvestorPersonProfile.jsx';
import SuggestInvestor from './SuggestInvestor.jsx';
import SiteHeader from '../brand/SiteHeader.jsx';
import { clearRoute, readRoute, writeRoute } from './route.js';
import { usePageTitle } from './usePageTitle.js';
import { useMediaQuery } from '../../hooks/useMediaQuery.js';
import { useSavedInvestors } from '../../hooks/useSavedInvestors.js';
import '../../investors.css';

// From this width an investor opens beside the results; under it, in a full-screen drawer.
export const SIDE_BY_SIDE = '(min-width: 1000px)';
// The step in the history that opened an investor's panel from the directory (see writeRoute): closing the panel goes Back over it.
const PANEL_STEP = { investors: 'panel' };
const inDirectory = (kind) => kind === 'list' || kind === 'investor';

// The investor directory as a page of its own, as Jobs is. It holds four views and keeps the address bar in step, so each can be linked to and
// the back button goes where a person expects: the directory (/investors), the directory with one investor open beside the results
// (/investors/<slug>), that investor's own full page (/investors/<slug>/profile) and a person (/investors/people/<slug>). The directory stays
// mounted behind the two full pages: coming back finds the same search, filters, sort, view, tab and place.
//
// `chrome` is what the shared header needs from the app: the places it goes to (go), the counts beside them, the action and the menu's own props.
export default function InvestorsView({ initialRoute = { kind: 'list' }, fromLink = false, onClose, onOpenCompany, chrome = {} }) {
  const [route, setRoute] = useState(initialRoute);
  const [tab, setTab] = useState('all'); // All investors, or the Saved ones
  const [suggesting, setSuggesting] = useState(false);
  const saved = useSavedInvestors();
  const sideBySide = useMediaQuery(SIDE_BY_SIDE, true);
  const scroller = useRef(null);
  const listScroll = useRef(0);
  const title = useRef(null);
  const wasKind = useRef(route.kind);
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

  const go = useCallback((next, options) => {
    if (inDirectory(route.kind) && !inDirectory(next.kind)) listScroll.current = scroller.current?.scrollTop ?? 0;
    setRoute(next);
    writeRoute(next, options);
  }, [route.kind]);

  // On a full page the page starts at its top; back at the directory it returns to where it was, and its title takes focus. (Opening or switching
  // an investor's panel is not a move: the results stay exactly where they are.)
  useEffect(() => {
    const was = wasKind.current;
    wasKind.current = route.kind;
    const el = scroller.current;
    if (!el) return;
    if (inDirectory(route.kind)) {
      if (!inDirectory(was)) {
        el.scrollTop = listScroll.current;
        title.current?.querySelector('h1')?.focus({ preventScroll: true });
      }
    } else {
      el.scrollTop = 0;
    }
  }, [route.kind, route.slug]);

  const close = () => { clearRoute(); onClose(); };
  // A company opens over the map, so the investor pages leave the address as they do when closed.
  const openCompany = (company) => { clearRoute(); onOpenCompany(company); };

  // An investor's panel: a step of its own from the directory, and a replace of the open one from another investor (so Back is the directory, not
  // every investor looked at). Closing it goes Back over the step it made, or, from a link, puts the directory in its place.
  const openInvestor = (slug) => {
    if (route.kind === 'investor') {
      if (route.slug !== slug) go({ kind: 'investor', slug }, { replace: true, state: window.history.state });
    } else {
      go({ kind: 'investor', slug }, { state: route.kind === 'list' ? PANEL_STEP : null });
    }
  };
  const closePanel = () => {
    if (window.history.state?.investors === 'panel') { window.history.back(); return; }
    go({ kind: 'list' }, { replace: true });
  };
  const openProfile = (slug) => go({ kind: 'profile', slug });
  const openPerson = (slug) => go({ kind: 'person', slug });
  const toList = () => go({ kind: 'list' });

  // The shared header's places, as this page has them: Investors is where it is (the directory, with nothing open), and Saved is the saved tab.
  const showDirectory = () => {
    setTab('all');
    if (route.kind === 'investor') closePanel();
    else if (route.kind !== 'list') toList();
    scroller.current?.scrollTo?.({ top: 0 });
  };
  const showSaved = () => {
    setTab('saved');
    if (route.kind !== 'list' && route.kind !== 'investor') toList();
    scroller.current?.scrollTo?.({ top: 0 });
  };

  // The header is the app's, with the three places that mean something else here: Explore leaves for the map, Investors is this page, and Saved is the saved tab.
  const places = { ...chrome.go, explore: close, investors: showDirectory, saved: showSaved };
  const counts = { ...chrome.counts, saved: saved.saved.length };
  const drawerOpen = route.kind === 'investor' && !sideBySide;

  return (
    <div id="investorsView" ref={scroller} className={drawerOpen ? 'inv-locked' : undefined}>
      <SiteHeader active="investors" go={places} counts={counts} addLabel="Add investor" onAdd={() => setSuggesting(true)} menu={chrome.menu} />
      <main className="inv-main" id="inv-main">
        <div hidden={!inDirectory(route.kind)} ref={title}>
          <InvestorDirectory
            selected={route.kind === 'investor' ? route.slug : null}
            panelMode={sideBySide ? 'side' : 'drawer'}
            tab={tab}
            onTab={setTab}
            saved={saved.saved}
            isSaved={saved.isSaved}
            onToggleSaved={saved.toggle}
            onOpen={openInvestor}
            onClosePanel={closePanel}
            onOpenFull={openProfile}
            onOpenInvestor={openInvestor}
            onOpenPerson={openPerson}
            onOpenCompany={openCompany}
            onClose={close}
          />
        </div>
        {route.kind === 'profile' && (
          <InvestorProfile key={route.slug} slug={route.slug} onBack={() => go({ kind: 'investor', slug: route.slug })} onOpenInvestor={openProfile} onOpenPerson={openPerson} onOpenCompany={openCompany} />
        )}
        {route.kind === 'person' && (
          <InvestorPersonProfile key={route.slug} slug={route.slug} onBack={toList} onOpenInvestor={openProfile} onOpenCompany={openCompany} />
        )}
      </main>
      {suggesting && <SuggestInvestor onClose={() => setSuggesting(false)} />}
    </div>
  );
}
