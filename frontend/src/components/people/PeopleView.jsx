import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchPeople, fetchInstitutions, fetchLists, fetchList } from '../../api.js';
import { usePageMeta } from '../../hooks/usePageMeta.js';
import { present } from '../../freshness.js';
import IndexRow, { cardId } from '../IndexRow.jsx';
import { AppLink } from '../investors/common.jsx';
import PersonCard from './PersonCard.jsx';
import InstitutionCard from './InstitutionCard.jsx';
import TallyDialog from './TallyDialog.jsx';
import SiteHeader from '../brand/SiteHeader.jsx';
import { NOMINATE_URL, NOMINATE_FIELDS } from '../../tally.js';
import '../../investors.css';
import '../../people.css';

const PAGE = 20;
const SEARCH_DELAY_MS = 250;

export const TABS = [
  { id: 'founders', label: 'Founders', role: 'founder', none: 'No founders are listed yet.', noun: 'founder' },
  { id: 'operators', label: 'Operators', role: 'operator', none: 'No operators are listed yet.', noun: 'operator' },
  { id: 'investors', label: 'Investors (people)', role: 'investor', none: 'No investors who are people are listed yet.', noun: 'investor' },
  { id: 'institutions', label: 'Institutions', role: null, none: 'No institutions are listed yet.', noun: 'institution' },
];

// The page's state is in its address, so a tab, a list or a search is a link: /people?tab=operators, /people?list=<id>, /people?q=sydney.
export function readAddress(search = window.location.search) {
  const params = new URLSearchParams(search);
  const tab = TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : null;
  return { tab, list: params.get('list') || null, q: (params.get('q') || '').slice(0, 80) };
}

// A list is its own page: the tab and the word do not apply to it.
export function addressOf({ tab, list, q }) {
  const params = new URLSearchParams();
  if (list) params.set('list', list);
  else {
    if (tab) params.set('tab', tab);
    if (q) params.set('q', q);
  }
  const query = params.toString();
  return `/people${query ? `?${query}` : ''}`;
}

const plural = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;
// What a list holds, by kind, in words ("1 person", "2 people", "1 company", "3 companies").
const WORDS = { person: ['person', 'people'], institution: ['institution', 'institutions'], company: ['company', 'companies'] };
const kindCount = (n, kind) => `${n} ${WORDS[kind][n === 1 ? 0 : 1]}`;

// A company on a list of companies: the one card, with the company's name opening it in the app.
function CompanyCard({ company, onOpenCompany }) {
  const facts = present(company.sectorFull || company.sector, company.city, company.stage).join(' · ');
  return (
    <li className="person-card" id={cardId('company', company.slug || company.name)} tabIndex={-1}>
      <h2 className="person-name">
        <AppLink href={`/startup/${encodeURIComponent(company.slug || company.name)}`} onOpen={() => onOpenCompany(company)}>{company.name}</AppLink>
      </h2>
      {facts && <p className="person-role">{facts}</p>}
      {company.blurb && <p className="person-why">{company.blurb}</p>}
    </li>
  );
}

// The people and firms worth following, at /people: four tabs (founders, operators, investors who are people, institutions), the
// curated lists that gather them, and a way to nominate someone. Everything on it was typed in by a person and shows the pages
// behind it; a tab with no one in it says so, and does not fill itself.
export default function PeopleView({ chrome = {}, onOpenCompany, onOpenInternal, initialAddress }) {
  const start = useRef(initialAddress ?? readAddress()).current;
  const [tab, setTab] = useState(start.tab); // null until a tab is chosen: the first with someone in it is shown
  const [list, setList] = useState(start.list);
  const [input, setInput] = useState(start.q);
  const [applied, setApplied] = useState(start.q);
  const [lists, setLists] = useState([]);
  const [counts, setCounts] = useState(null);
  const [view, setView] = useState({ status: 'loading', kind: 'person', items: [], count: 0, hasMore: false, listMeta: null });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const [nominating, setNominating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [attempt, setAttempt] = useState(0); // asking again after a failure
  const generation = useRef(0);
  const shownTab = tab ?? 'founders';
  const current = TABS.find((t) => t.id === shownTab);

  usePageMeta({
    title: 'People worth following · AU Startup Map',
    description: 'Founders, operators and investors in Australian startups, and the firms behind them, each with the pages that back it.',
    path: '/people',
  });

  // The word searched for waits for a short pause in typing.
  useEffect(() => {
    if (input === applied) return undefined;
    const timer = setTimeout(() => setApplied(input.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [input, applied]);

  // The address follows the page (replacing: a tab is not a step to go back through).
  useEffect(() => {
    try {
      const url = addressOf({ tab, list, q: applied });
      if (url !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(window.history.state, '', url);
    } catch (e) { /* a locked-down browser: the page still works */ }
  }, [tab, list, applied]);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchLists({ signal: ctrl.signal }).then(({ results }) => { if (!ctrl.signal.aborted) setLists(results ?? []); }).catch(() => {});
    return () => ctrl.abort();
  }, []);

  const ask = useCallback((offset, signal) => {
    if (list) return fetchList(list, { limit: PAGE, offset, signal });
    if (current.id === 'institutions') return fetchInstitutions({ search: applied }, { limit: PAGE, offset, signal });
    return fetchPeople({ role: current.role, search: applied }, { limit: PAGE, offset, signal });
  }, [list, current, applied]);

  const kindOf = (answer) => (list ? ({ people: 'person', institutions: 'institution', companies: 'company' })[answer.list.type] : current.id === 'institutions' ? 'institution' : 'person');

  useEffect(() => {
    const ctrl = new AbortController();
    generation.current += 1;
    setMoreFailed(false);
    setView((v) => ({ ...v, status: 'loading', items: [] }));
    ask(0, ctrl.signal)
      .then((answer) => {
        if (ctrl.signal.aborted) return;
        if (answer.counts) setCounts(answer.counts);
        setView({ status: 'ready', kind: kindOf(answer), items: answer.results, count: answer.count, hasMore: answer.hasMore, listMeta: answer.list ?? null });
        // Nobody is listed under the tab shown by default: show the first tab that has someone.
        if (!tab && !list && !applied && answer.counts && answer.counts[shownTab] === 0) {
          const next = TABS.find((t) => answer.counts[t.id] > 0);
          if (next) setTab(next.id);
        }
      })
      .catch((err) => {
        if (ctrl.signal.aborted || err?.name === 'AbortError') return;
        setView({ status: err?.status === 404 ? 'missing' : 'error', kind: 'person', items: [], count: 0, hasMore: false, listMeta: null });
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask, attempt]);

  const showMore = async () => {
    const mine = generation.current;
    setLoadingMore(true);
    setMoreFailed(false);
    try {
      const answer = await ask(view.items.length);
      if (mine === generation.current) setView((v) => ({ ...v, items: [...v.items, ...answer.results], count: answer.count, hasMore: answer.hasMore }));
    } catch (e) {
      if (mine === generation.current) setMoreFailed(true);
    } finally {
      setLoadingMore(false);
    }
  };

  const choose = (id) => { setList(null); setTab(id); };
  const onTabKey = (event) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = TABS[(TABS.findIndex((t) => t.id === shownTab) + step + TABS.length) % TABS.length];
    choose(next.id);
    requestAnimationFrame(() => document.getElementById(`people-tab-${next.id}`)?.focus());
  };

  const shareUrl = list ? new URL(addressOf({ list }), window.location.origin).href : '';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) { /* clipboard unavailable */ }
  };

  const { status, kind, items, count, hasMore, listMeta } = view;
  const noun = list ? (kind === 'company' ? 'company' : kind) : current.noun;
  const indexKind = kind;
  const searching = !list && applied !== '';

  return (
    <div id="investorsView" className="people-page">
      <SiteHeader go={chrome.go} counts={chrome.counts} onAdd={chrome.onAdd} menu={chrome.menu} />
      <main className="inv-main" id="people-main">
        <section className="inv-intro" aria-labelledby="people-title">
          <h1 id="people-title" tabIndex={-1}>People worth following</h1>
          <p className="inv-lead">Founders, operators and investors in Australian startups, and the firms behind them. Each entry is typed in by a person and shows the pages behind it.</p>
          <p className="people-nominate"><button type="button" className="hdrbtn hdrbtn-accent" onClick={() => setNominating(true)}>Nominate someone</button></p>
        </section>

        {lists.length > 0 && (
          <nav className="people-lists" aria-label="Lists">
            <span className="people-lists-label">Lists</span>
            <ul>
              {lists.map((l) => (
                <li key={l.id}>
                  <button type="button" className="people-chip" aria-pressed={list === l.id} onClick={() => setList(list === l.id ? null : l.id)}>
                    {l.title}<span className="people-chip-count"> {l.count}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        )}

        {list ? (
          <section className="people-banner" aria-label={listMeta ? `List: ${listMeta.title}` : 'List'}>
            <div>
              <h2 className="people-banner-title">{listMeta?.title ?? 'List'}</h2>
              {listMeta?.description && <p className="people-banner-desc">{listMeta.description}</p>}
              {listMeta?.curator && <p className="people-banner-curator">Curated by {listMeta.curator}</p>}
            </div>
            <div className="people-banner-side">
              <span className="people-banner-count">{status === 'ready' ? kindCount(count, kind) : ''}</span>
              <button type="button" className="hdrbtn" onClick={copy}>{copied ? 'Link copied' : 'Copy link'}</button>
              <button type="button" className="linkbtn" onClick={() => setList(null)}>All people</button>
            </div>
          </section>
        ) : (
          <>
            <div className="people-tabs" role="tablist" aria-label="Who to show" onKeyDown={onTabKey}>
              {TABS.map((t) => (
                <button
                  key={t.id}
                  id={`people-tab-${t.id}`}
                  type="button"
                  role="tab"
                  aria-selected={t.id === shownTab}
                  aria-controls="people-panel"
                  tabIndex={t.id === shownTab ? 0 : -1}
                  className="people-tab"
                  onClick={() => choose(t.id)}
                >
                  {t.label}{counts && <span className="people-tab-count"> {counts[t.id]}</span>}
                </button>
              ))}
            </div>
            <div className="inv-tools" role="search">
              <div className="inv-search">
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
                  <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="1.75" />
                  <path d="m21 21-4.3-4.3" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                </svg>
                <input type="search" aria-label="Search by name, role, organisation, city or what they do" placeholder="Search by name, role, organisation or city" value={input} onChange={(e) => setInput(e.target.value)} />
              </div>
            </div>
          </>
        )}

        <div id="people-panel" role={list ? undefined : 'tabpanel'} aria-labelledby={list ? undefined : `people-tab-${shownTab}`}>
          <p className="inv-count people-count" role="status">
            {status === 'ready' && !list && (searching ? `${plural(count, noun)} match` : plural(count, noun))}
            {status === 'loading' && 'Loading…'}
          </p>

          {status === 'error' && <div className="inv-error" role="alert"><p>Could not load this right now.</p><button type="button" className="hdrbtn" onClick={() => setAttempt((n) => n + 1)}>Try again</button></div>}
          {status === 'missing' && (
            <div className="inv-none"><p>There is no such list.</p><button type="button" className="linkbtn" onClick={() => setList(null)}>See everyone</button></div>
          )}
          {status === 'ready' && items.length === 0 && (
            <div className="inv-none">
              <p>{searching ? 'No one matches that.' : current.none}</p>
              {!searching && <p>Know someone worth following? <button type="button" className="linkbtn" onClick={() => setNominating(true)}>Nominate them</button>.</p>}
            </div>
          )}

          {items.length > 0 && <IndexRow items={items.map((item) => ({ id: cardId(indexKind, item.slug || item.id || item.name), name: item.name }))} what={`the ${noun}s listed`} />}
          {items.length > 0 && (
            <ul className="inv-grid people-grid">
              {items.map((item) => (kind === 'person' ? <PersonCard key={item.id} person={item} onOpenInternal={onOpenInternal} />
                : kind === 'institution' ? <InstitutionCard key={item.id} institution={item} onOpenInternal={onOpenInternal} />
                  : <CompanyCard key={item.slug || item.name} company={item} onOpenCompany={onOpenCompany} />))}
            </ul>
          )}

          {moreFailed && <p className="form-error" role="alert">Could not load more right now.</p>}
          {hasMore && (
            <div className="inv-more">
              <button type="button" className="hdrbtn" onClick={showMore} disabled={loadingMore}>{loadingMore ? 'Loading…' : `Show more (${count - items.length} left)`}</button>
            </div>
          )}
        </div>

        <p className="inv-method">
          Every entry here was typed in by a person from public pages, and shows them under Sources. Nothing is copied from LinkedIn or any other site by machine. A vouch
          is shown only where the person agreed to it. To change or remove an entry, use Request edit or removal on its card. The lists are in the order the curator put them.
        </p>
      </main>
      {nominating && (
        <TallyDialog
          title="Nominate someone"
          intro="Someone worth following in Australian startups: yourself, or someone who has said yes."
          url={NOMINATE_URL}
          fields={NOMINATE_FIELDS}
          onClose={() => setNominating(false)}
        />
      )}
    </div>
  );
}
