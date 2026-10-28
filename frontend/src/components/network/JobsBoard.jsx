import { useEffect, useMemo, useRef, useState } from 'react';
import SiteHeader from '../brand/SiteHeader.jsx';
import SectionTabs from '../brand/SectionTabs.jsx';
import { EmptyState } from '../brand/parts.jsx';
import { OPPORTUNITY_TABS, linkProps } from '../brand/nav.js';
import { Avatar } from '../EntityCard.jsx';
import { fetchJobs } from '../../networkApi.js';
import { useSavedKind } from '../../savedStore.js';
import { usePageMeta } from '../../hooks/usePageMeta.js';
import { lazyView, Lazy } from '../../lazyLoad.jsx';
import { BookmarkIcon, ExternalIcon, SearchIcon } from '../explore/icons.jsx';
import { dayLabel } from './time.js';

const SuggestDialog = lazyView(() => import('./SuggestDialog.jsx'));
const PAGE = 24;
// The board starts on roles in Australia (the directory is Australian startups, whose roles are sometimes in an overseas office); "Anywhere" shows every one.
const EMPTY = { search: '', where: 'au', city: '', sector: '', stage: '', type: '', level: '', remote: '' };
const sameAsStart = (f) => Object.keys(EMPTY).every((k) => f[k] === EMPTY[k]);

// The filters the address opens the board with (/jobs?city=Sydney&remote=yes, and where=any for roles anywhere), so a filtered board is a link.
const fromAddress = () => {
  try { const p = new URLSearchParams(window.location.search); return Object.fromEntries(Object.keys(EMPTY).map((k) => [k, p.get(k) ?? (k === 'where' ? 'au' : '')])); } catch (e) { return EMPTY; }
};

const checkedWords = (job) => {
  if (job.days_since_checked == null) return 'Last read: date not recorded';
  if (job.days_since_checked <= 0) return 'Read today';
  return `Read ${job.days_since_checked} ${job.days_since_checked === 1 ? 'day' : 'days'} ago`;
};

function JobCard({ job, saved, onToggle }) {
  const closed = job.status === 'closed';
  const host = (() => { try { return new URL(job.company.website).hostname.replace(/^www\./, ''); } catch (e) { return null; } })();
  return (
    <li className={`jc${closed ? ' jc-closed' : ''}`}>
      <div className="jc-top">
        <Avatar name={job.company.name} domain={host} size={48} className="jc-logo" />
        <div className="jc-id">
          <h3 className="jc-title">{job.title}</h3>
          <p className="jc-company">
            {job.company.slug ? <a {...linkProps(`/startup/${job.company.slug}`)}>{job.company.name}</a> : job.company.name}
            {[job.company.city, job.company.sector].filter(Boolean).length > 0 && <span className="jc-dim"> · {[job.company.city, job.company.sector].filter(Boolean).join(' · ')}</span>}
          </p>
        </div>
        <button type="button" className="bm" aria-pressed={saved} aria-label={saved ? `Remove ${job.title} at ${job.company.name} from saved` : `Save ${job.title} at ${job.company.name}`} onClick={() => onToggle(job.id)}>
          <BookmarkIcon size={22} fill={saved ? 'currentColor' : 'none'} />
        </button>
      </div>

      <dl className="jc-facts">
        <div><dt>Where</dt><dd>{job.location || 'Not stated'}</dd></div>
        <div><dt>Working arrangement</dt><dd>{job.remote ? 'Remote' : 'Not stated'}</dd></div>
        <div><dt>Employment</dt><dd>{job.employment_type ? { full_time: 'Full-time', part_time: 'Part-time', contract: 'Contract', internship: 'Internship', fixed_term: 'Fixed term' }[job.employment_type] : 'Not stated'}</dd></div>
        <div><dt>Level in the title</dt><dd>{job.level ? { intern: 'Intern', graduate: 'Graduate', junior: 'Junior', mid: 'Mid-level', senior: 'Senior', lead: 'Lead or principal', head: 'Head or director' }[job.level] : 'Not named'}</dd></div>
        {job.salary && <div><dt>Salary</dt><dd>{job.salary}</dd></div>}
      </dl>

      <p className="jc-why"><strong>Why it is listed.</strong> {job.why_listed}</p>

      <div className="jc-foot">
        <p className={`jc-checked${job.stale ? ' jc-stale' : ''}`}>
          {closed ? 'Closed: the employer has taken it down.' : <>{checkedWords(job)}{job.last_checked_at && <> ({dayLabel(job.last_checked_at)})</>}{job.stale ? '. Confirm it is still open on the employer’s page.' : '.'}</>}
        </p>
        {!closed && (
          <a className="btn btn-primary btn-sm" href={job.apply_url} target="_blank" rel="noopener noreferrer">
            Apply on the employer&rsquo;s site<ExternalIcon size={16} /><span className="sr-only"> (opens in a new tab)</span>
          </a>
        )}
      </div>
    </li>
  );
}

// Opportunities → Jobs. Real roles, each read from a company's own careers page, at a company in the directory. Applications go straight to the employer.
// A role says what its listing says and "not stated" where it does not: no salary unless one is published, no experience requirement unless we have one. The
// reading date is shown on every role, and a reading older than the site's two-week window says to check the employer's page.
export default function JobsBoard({ chrome = {} }) {
  const saved = useSavedKind('job');
  const [filters, setFilters] = useState(fromAddress);
  const [typed, setTyped] = useState(filters.search);
  const [data, setData] = useState({ results: [], facets: null, total: 0, count: 0, hasMore: false });
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const offset = useRef(0);

  usePageMeta({ title: 'Jobs · Opportunities · Still Early', description: 'Real roles at Australian startups, each read from the company’s own careers page, with the date it was read.', path: '/jobs' });
  useEffect(() => { const t = setTimeout(() => setFilters((f) => (f.search === typed ? f : { ...f, search: typed })), 250); return () => clearTimeout(t); }, [typed]);

  useEffect(() => {
    const ctrl = new AbortController();
    setStatus('loading');
    offset.current = 0;
    fetchJobs({ ...filters, where: filters.where === 'any' ? '' : filters.where, limit: PAGE, offset: 0 }, { signal: ctrl.signal })
      .then((res) => { if (!ctrl.signal.aborted) { setData((d) => ({ ...res, facets: d.facets ?? res.facets })); setStatus('ready'); } })
      .catch((err) => { if (!ctrl.signal.aborted && err.name !== 'AbortError') { setError(err.message); setStatus('error'); } });
    return () => ctrl.abort();
  }, [filters]);

  // The address follows the filters, so any board can be shared.
  useEffect(() => {
    try {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(filters)) if (v && !(k === 'where' && v === 'au')) params.set(k, v);
      const q = params.toString();
      const url = `/jobs${q ? `?${q}` : ''}`;
      if (url !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(window.history.state, '', url);
    } catch (e) { /* ignore */ }
  }, [filters]);

  const more = async () => {
    offset.current += PAGE;
    const res = await fetchJobs({ ...filters, where: filters.where === 'any' ? '' : filters.where, limit: PAGE, offset: offset.current });
    setData((d) => ({ ...d, results: [...d.results, ...res.results], hasMore: res.hasMore }));
  };

  const facets = data.facets;
  const set = (key) => (event) => setFilters((f) => ({ ...f, [key]: event.target.value }));
  const active = useMemo(() => !sameAsStart(filters), [filters]);
  const allStale = Boolean(facets) && facets.stale > 0 && facets.stale === data.total;

  return (
    <div id="jobsView" className="page-shell">
      <SiteHeader active="opportunities" go={chrome.go} counts={chrome.counts} menu={chrome.menu} onAdd={() => setSuggesting(true)} addLabel="Suggest a role" />
      <main className="disc" id="main">
        <SectionTabs label="Opportunities" tabs={OPPORTUNITY_TABS} active="jobs" go={chrome.tabs} />
        <header className="disc-head">
          <h1 className="serif-h1">Roles read from <em>their own pages.</em></h1>
          <p className="lede">Each role is on a startup&rsquo;s own careers page, at a company in the directory, and shows the day we read it. You apply on the employer&rsquo;s site. Nothing here is ranked.</p>
        </header>

        <div className="disc-filters disc-filters-wide">
          <label className="field"><SearchIcon size={20} /><input type="search" aria-label="Search roles" placeholder="Search by role, company or place" value={typed} onChange={(e) => setTyped(e.target.value)} /></label>
          {facets && (
            <>
              <select className="select" aria-label="Where the role is" value={filters.where} onChange={set('where')}>
                <option value="au">In Australia ({facets.regions.au})</option>
                <option value="other">Elsewhere ({facets.regions.other})</option>
                <option value="any">Anywhere ({facets.regions.au + facets.regions.other})</option>
              </select>
              <select className="select" aria-label="City" value={filters.city} onChange={set('city')}><option value="">Company city</option>{facets.cities.map((c) => <option key={c.value} value={c.value}>{c.value} ({c.count})</option>)}</select>
              <select className="select" aria-label="Sector" value={filters.sector} onChange={set('sector')}><option value="">Any sector</option>{facets.sectors.map((c) => <option key={c.value} value={c.value}>{c.value} ({c.count})</option>)}</select>
              <select className="select" aria-label="Stage" value={filters.stage} onChange={set('stage')}><option value="">Any stage</option>{facets.stages.map((c) => <option key={c.value} value={c.value}>{c.value} ({c.count})</option>)}</select>
              <select className="select" aria-label="Employment type" value={filters.type} onChange={set('type')}><option value="">Any employment type</option>{facets.types.map((c) => <option key={c.value} value={c.value}>{c.label} ({c.count})</option>)}</select>
              <select className="select" aria-label="Level in the title" value={filters.level} onChange={set('level')}><option value="">Any level</option>{facets.levels.map((c) => <option key={c.value} value={c.value}>{c.label} ({c.count})</option>)}</select>
              {facets.remote > 0 && <label className="auth-check disc-check"><input type="checkbox" checked={filters.remote === 'yes'} onChange={(e) => setFilters((f) => ({ ...f, remote: e.target.checked ? 'yes' : '' }))} /><span>Remote ({facets.remote})</span></label>}
            </>
          )}
          {active && <button type="button" className="btn btn-quiet btn-sm" onClick={() => { setFilters(EMPTY); setTyped(''); }}>Reset filters</button>}
        </div>

        {status === 'loading' && <p className="home-quiet" role="status">Loading roles…</p>}
        {status === 'error' && <div className="home-error" role="alert"><p>Could not load roles. {error}</p></div>}
        {status === 'ready' && (
          <>
            <p className="disc-count" role="status">
              {data.count === 1 ? '1 role' : `${data.count} roles`}{active ? ` of ${data.total}` : ''}
              {filters.where === 'au' ? ' in Australia' : filters.where === 'other' ? ' elsewhere' : ''}
            </p>
            {allStale && (
              <p className="jc-banner" role="note">
                Every role here was last read more than two weeks ago (the newest reading is {dayLabel(facets.latest_checked_at)}). Each one links to the employer&rsquo;s own page: check it is still open before you apply.
              </p>
            )}
            {data.results.length === 0 ? (
              <EmptyState title={active ? 'No roles match.' : 'No open roles are listed right now.'}>
                {active ? 'Try fewer filters.' : 'Roles appear here when a company in the directory lists them on its own careers page.'} Know of a real one?{' '}
                <button type="button" className="mp-link" onClick={() => setSuggesting(true)}>Suggest it</button>.
              </EmptyState>
            ) : (
              <ul className="jc-list">{data.results.map((job) => <JobCard key={job.id} job={job} saved={saved.has(job.id)} onToggle={saved.toggle} />)}</ul>
            )}
            {data.hasMore && <div className="home-more"><button type="button" className="btn btn-secondary" onClick={more}>Show more roles</button></div>}
          </>
        )}
        <p className="home-fine">Roles are read from the employers&rsquo; own pages by a polite, scheduled reader and checked against the directory. Membership does not make anyone vetted and does not promise an interview.</p>
      </main>
      {suggesting && <Lazy><SuggestDialog kind="job" onClose={() => setSuggesting(false)} /></Lazy>}
    </div>
  );
}
