import { useEffect, useRef, useState } from 'react';
import SiteHeader from '../brand/SiteHeader.jsx';
import SectionTabs from '../brand/SectionTabs.jsx';
import { EmptyState } from '../brand/parts.jsx';
import { OPPORTUNITY_TABS } from '../brand/nav.js';
import { calendarUrl, fetchEvents } from '../../networkApi.js';
import { useSavedKind } from '../../savedStore.js';
import { usePageMeta } from '../../hooks/usePageMeta.js';
import { lazyView, Lazy } from '../../lazyLoad.jsx';
import { BookmarkIcon, CalendarIcon, ExternalIcon, PinIcon, SearchIcon } from '../explore/icons.jsx';
import { dayLabel, eventWhen } from './time.js';

const SuggestDialog = lazyView(() => import('./SuggestDialog.jsx'));
const EMPTY = { search: '', city: '', type: '', format: '' };
const FORMAT_LABELS = { in_person: 'In person', online: 'Online', hybrid: 'In person and online' };

const costText = (cost) => {
  if (cost.status === 'free') return 'Free';
  if (cost.status === 'paid') return `Paid${cost.note ? `: ${cost.note}` : ''}`;
  return `Cost not confirmed${cost.note ? `. ${cost.note}` : ''}`;
};

// "Add to Google Calendar": a link Google's own page understands. Times are moments in UTC, which is how Google wants them.
const googleCalendar = (e) => {
  const stamp = (iso) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = (d) => d.slice(0, 10).replace(/-/g, '');
  const nextDay = (d) => new Date(Date.parse(`${d.slice(0, 10)}T00:00:00Z`) + 86400000).toISOString().slice(0, 10).replace(/-/g, '');
  const dates = e.time_confirmed ? `${stamp(e.starts_at)}/${stamp(e.ends_at ?? new Date(Date.parse(e.starts_at) + 3600000).toISOString())}` : `${day(e.starts)}/${nextDay(e.ends ?? e.starts)}`;
  const where = e.format === 'online' ? e.online_url : [e.venue, e.city].filter(Boolean).join(', ');
  const params = new URLSearchParams({ action: 'TEMPLATE', text: e.name, dates, location: where || '', details: `Run by ${e.organiser}. Register: ${e.registration_url}` });
  return `https://calendar.google.com/calendar/render?${params}`;
};

function EventCard({ event: e, saved, onToggle }) {
  const when = eventWhen(e);
  const cancelled = e.status === 'cancelled';
  return (
    <li className={`ec${cancelled ? ' ec-cancelled' : ''}`}>
      <div className="ec-date" aria-hidden="true">
        <span className="ec-mon">{new Date(`${e.starts.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-AU', { timeZone: 'UTC', month: 'short' })}</span>
        <span className="ec-day">{e.starts.slice(8, 10).replace(/^0/, '')}</span>
      </div>
      <div className="ec-main">
        <div className="ec-top">
          <div>
            <p className="ec-kind"><span className="ec-type">{e.type_label}</span>{cancelled && <span className="ec-flag"> · Cancelled</span>}</p>
            <h3 className="ec-title">{e.name}</h3>
            <p className="ec-org">{e.organiser}</p>
          </div>
          <button type="button" className="bm" aria-pressed={saved} aria-label={saved ? `Remove ${e.name} from saved` : `Save ${e.name}`} onClick={() => onToggle(e.id)}>
            <BookmarkIcon size={22} fill={saved ? 'currentColor' : 'none'} />
          </button>
        </div>

        <dl className="ec-facts">
          <div><dt>When</dt><dd>{when.date}<span className="ec-dim">{when.time ? `, ${when.time}` : ''}</span></dd></div>
          <div>
            <dt>Where</dt>
            <dd>
              {e.format === 'online' ? 'Online' : <><PinIcon size={16} /> {[e.venue, e.city].filter(Boolean).join(', ')}</>}
              {e.format === 'hybrid' && ' and online'}
              <span className="ec-dim"> · {FORMAT_LABELS[e.format]}</span>
            </dd>
          </div>
          <div><dt>Cost</dt><dd>{costText(e.cost)}</dd></div>
          <div><dt>Useful for</dt><dd>{e.audience}</dd></div>
        </dl>

        <p className="jc-why"><strong>Why it is listed.</strong> {e.why_selected}</p>
        {e.note && <p className="ec-note">{e.note}</p>}

        <div className="ec-foot">
          <p className="jc-checked">
            Details read {dayLabel(e.source_checked_at)} from{' '}
            <a href={e.source_url} target="_blank" rel="noopener noreferrer">the organiser&rsquo;s page<span className="sr-only"> (opens in a new tab)</span></a>. Check it before you go.
          </p>
          <div className="ec-actions">
            {!cancelled && (
              <a className="btn btn-primary btn-sm" href={e.registration_url} target="_blank" rel="noopener noreferrer">
                Register on the organiser&rsquo;s page<ExternalIcon size={16} /><span className="sr-only"> (opens in a new tab)</span>
              </a>
            )}
            <a className="btn btn-secondary btn-sm" href={calendarUrl(e.id)} download><CalendarIcon size={16} />Add reminder (.ics)</a>
            <a className="btn btn-quiet btn-sm" href={googleCalendar(e)} target="_blank" rel="noopener noreferrer">Google Calendar<span className="sr-only"> (opens in a new tab)</span></a>
          </div>
        </div>
      </div>
    </li>
  );
}

// Opportunities → Events. Australian startup events, each read from the organiser's own page: the day and time in the event's own time zone, what it costs when
// that is confirmed, who it is useful for and why it is listed. Past events disappear by themselves. Nothing is invented: a time not yet announced says so.
export default function EventsBoard({ chrome = {} }) {
  const saved = useSavedKind('event');
  const [filters, setFilters] = useState(EMPTY);
  const [typed, setTyped] = useState('');
  const [data, setData] = useState({ results: [], facets: null, total: 0, count: 0, hasMore: false });
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const offset = useRef(0);

  usePageMeta({ title: 'Events · Opportunities · Still Early', description: 'Australian startup events, each read from the organiser’s own page.', path: '/events' });
  useEffect(() => { const t = setTimeout(() => setFilters((f) => (f.search === typed ? f : { ...f, search: typed })), 250); return () => clearTimeout(t); }, [typed]);

  useEffect(() => {
    const ctrl = new AbortController();
    setStatus('loading');
    offset.current = 0;
    fetchEvents({ ...filters, limit: 30, offset: 0 }, { signal: ctrl.signal })
      .then((res) => { if (!ctrl.signal.aborted) { setData((d) => ({ ...res, facets: d.facets ?? res.facets })); setStatus('ready'); } })
      .catch((err) => { if (!ctrl.signal.aborted && err.name !== 'AbortError') { setError(err.message); setStatus('error'); } });
    return () => ctrl.abort();
  }, [filters]);

  const more = async () => {
    offset.current += 30;
    const res = await fetchEvents({ ...filters, limit: 30, offset: offset.current });
    setData((d) => ({ ...d, results: [...d.results, ...res.results], hasMore: res.hasMore }));
  };

  const facets = data.facets;
  const set = (key) => (event) => setFilters((f) => ({ ...f, [key]: event.target.value }));
  const active = Object.values(filters).some(Boolean);

  return (
    <div id="eventsView" className="page-shell">
      <SiteHeader active="opportunities" go={chrome.go} counts={chrome.counts} menu={chrome.menu} onAdd={() => setSuggesting(true)} addLabel="Suggest an event" />
      <main className="disc" id="main">
        <SectionTabs label="Opportunities" tabs={OPPORTUNITY_TABS} active="events" go={chrome.tabs} />
        <header className="disc-head">
          <h1 className="serif-h1">Events worth <em>showing up to.</em></h1>
          <p className="lede">Founder gatherings, demo days, workshops, pitch nights and conferences across Australia, each read from the organiser&rsquo;s own page. Past events drop off by themselves.</p>
        </header>

        <div className="disc-filters disc-filters-wide">
          <label className="field"><SearchIcon size={20} /><input type="search" aria-label="Search events" placeholder="Search by name, organiser or place" value={typed} onChange={(e) => setTyped(e.target.value)} /></label>
          {facets && (
            <>
              <select className="select" aria-label="City" value={filters.city} onChange={set('city')}><option value="">Any city</option>{facets.cities.map((c) => <option key={c.value} value={c.value}>{c.value} ({c.count})</option>)}</select>
              <select className="select" aria-label="Kind of event" value={filters.type} onChange={set('type')}><option value="">Any kind</option>{facets.types.map((c) => <option key={c.value} value={c.value}>{c.label} ({c.count})</option>)}</select>
              <select className="select" aria-label="Format" value={filters.format} onChange={set('format')}><option value="">In person or online</option>{facets.formats.map((c) => <option key={c.value} value={c.value}>{FORMAT_LABELS[c.value]} ({c.count})</option>)}</select>
            </>
          )}
          {active && <button type="button" className="btn btn-quiet btn-sm" onClick={() => { setFilters(EMPTY); setTyped(''); }}>Clear filters</button>}
        </div>

        {status === 'loading' && <p className="home-quiet" role="status">Loading events…</p>}
        {status === 'error' && <div className="home-error" role="alert"><p>Could not load events. {error}</p></div>}
        {status === 'ready' && (
          <>
            <p className="disc-count" role="status">{data.count === 1 ? '1 upcoming event' : `${data.count} upcoming events`}{active ? ` of ${data.total}` : ''}</p>
            {data.results.length === 0 ? (
              <EmptyState title={active ? 'No events match.' : 'No upcoming events are listed right now.'}>
                {active ? 'Try fewer filters.' : 'Events appear here once an organiser’s page confirms them.'} Know of a real one?{' '}
                <button type="button" className="mp-link" onClick={() => setSuggesting(true)}>Suggest it</button>.
              </EmptyState>
            ) : (
              <ul className="ec-list">{data.results.map((e) => <EventCard key={e.id} event={e} saved={saved.has(e.id)} onToggle={saved.toggle} />)}</ul>
            )}
            {data.hasMore && <div className="home-more"><button type="button" className="btn btn-secondary" onClick={more}>Show more events</button></div>}
          </>
        )}
        <p className="home-fine">Dates, venues and prices are read from the organisers&rsquo; own pages on the day shown and can change: check the organiser before you go. A listing is not a partnership or an endorsement.</p>
      </main>
      {suggesting && <Lazy><SuggestDialog kind="event" onClose={() => setSuggesting(false)} /></Lazy>}
    </div>
  );
}
