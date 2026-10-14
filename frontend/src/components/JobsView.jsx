import { useEffect, useRef, useState } from 'react';
import { fetchStartupPage } from '../api.js';
import ConceptPreview from './ConceptPreview.jsx';
import VerifiedNote, { UnverifiedBadge } from './VerifiedNote.jsx';
import EntityCard, { Avatar } from './EntityCard.jsx';
import IndexRow, { cardId } from './IndexRow.jsx';
import SiteBrand from './SiteBrand.jsx';
import { JOBS_PAGE as PAGE } from '../snapshotRequests.js';
import { peek } from '../peek.js';

const EMPTY_JOB_FILTERS = { sector: '', city: '', stage: '' };

// The filters the address opens the board with (/jobs?sector=AI&city=Sydney), so a filtered board is a link.
function filtersFromAddress() {
  try {
    const params = new URLSearchParams(window.location.search);
    return Object.fromEntries(Object.keys(EMPTY_JOB_FILTERS).map((key) => [key, params.get(key) ?? '']));
  } catch (e) {
    return EMPTY_JOB_FILTERS;
  }
}
const NO_OPTIONS = { sector: [], city: [], stage: [] };

// The companies that are hiring, a page at a time. The filter options come from the whole hiring set (asked for
// with the first page, before any filter is chosen), not from the site-wide meta endpoint and not from the page
// on screen: every option shown is guaranteed to match at least one currently-open listing.
const FACETS = 'sector,city,stage';
const optionsOf = (page) => ({ sector: page.facets.sector.values.map((v) => v.value).sort(), city: page.facets.city.values.map((v) => v.value).sort(), stage: page.facets.stage.values.map((v) => v.value).sort() });
// The first request of the board: the hiring companies' first page, with the options to filter by.
const firstRequest = (filters) => peek.startupPage({ hiring: 'yes', ...filters }, { limit: PAGE, offset: 0, sort: 'name', facets: FACETS });

export default function JobsView({ onClose }) {
  const [filters, setFilters] = useState(filtersFromAddress);
  // The first page of the board is in the snapshot file (snapshot.js): when it has arrived it is what the board first draws, so there is no
  // wait and nothing moves when the server's answer comes (and an unreachable server leaves the board as the snapshot drew it).
  const [first] = useState(() => firstRequest(filters));
  const [jobs, setJobs] = useState(first?.results ?? []);
  const [matches, setMatches] = useState(first?.count ?? 0);
  const [hiringTotal, setHiringTotal] = useState(first?.facets ? first.count : 0);
  const [options, setOptions] = useState(first?.facets ? optionsOf(first) : NO_OPTIONS);
  const [hasMore, setHasMore] = useState(first?.hasMore ?? false);
  const [loading, setLoading] = useState(!first);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [haveOptions, setHaveOptions] = useState(Boolean(first?.facets)); // the options to filter by have arrived (they are asked with the first page only)
  const needOptions = useRef(true); // the first request asks for the options; once they are in, the next ones do not
  const generation = useRef(0);

  useEffect(() => {
    const ctrl = new AbortController();
    generation.current += 1;
    const known = needOptions.current ? firstRequest(filters) : null;
    setLoading(!known);
    setError('');
    let shown = Boolean(known);
    const draw = (page) => {
      if (ctrl.signal.aborted) return;
      setJobs(page.results);
      setMatches(page.count);
      setHasMore(page.hasMore);
      if (page.facets) { // only a request that asked for them gets them: the first, before any filter is chosen (the snapshot's and then the server's)
        needOptions.current = false;
        setHaveOptions(true);
        setHiringTotal(page.count);
        if (page !== first) setOptions(optionsOf(page)); // (the snapshot's own are already in)
      }
    };
    fetchStartupPage({ hiring: 'yes', ...filters }, {
      limit: PAGE, offset: 0, sort: 'name', facets: needOptions.current ? FACETS : undefined, signal: ctrl.signal,
      onSnapshot: (page) => { shown = true; draw(page); if (!ctrl.signal.aborted) setLoading(false); },
    })
      .then(draw)
      .catch((err) => { if (!ctrl.signal.aborted && err.name !== 'AbortError' && !shown) setError('Could not load jobs right now.'); })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });
    return () => ctrl.abort();
  }, [filters]);

  const showMore = async () => {
    const mine = generation.current;
    setLoadingMore(true);
    try {
      const page = await fetchStartupPage({ hiring: 'yes', ...filters }, { limit: PAGE, offset: jobs.length, sort: 'name' });
      if (mine === generation.current) {
        setJobs((prev) => [...prev, ...page.results]);
        setHasMore(page.hasMore);
        setMatches(page.count);
      }
    } catch (e) {
      if (mine === generation.current) setError('Could not load more jobs right now.');
    } finally {
      setLoadingMore(false);
    }
  };

  // The address follows the filters (replacing, not adding a step per choice).
  useEffect(() => {
    try {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
      const query = params.toString();
      const url = `${window.location.pathname}${query ? `?${query}` : ''}`;
      if (url !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(window.history.state, '', url);
    } catch (e) { /* ignore */ }
  }, [filters]);

  const filtersActive = Object.values(filters).some(Boolean);
  const set = (key) => (e) => setFilters((prev) => ({ ...prev, [key]: e.target.value }));
  const shownFirstLoad = loading && jobs.length === 0;

  return (
    <div id="jobsView">
      <header className="site-bar">
        <button className="hdrbtn" onClick={onClose}>← Back to map</button>
        <SiteBrand onMap={onClose} />
      </header>
      <div className="jobs-header">
        <div>
          <h1>Startup jobs in Australia</h1>
          {haveOptions && !error && <p className="jobs-subhead">{hiringTotal} {hiringTotal === 1 ? 'company is' : 'companies are'} hiring now</p>}
          {haveOptions && !error && <p className="jobs-subhead">Only companies whose open roles were read from a page are listed. A company marked as hiring that no page backs is not.</p>}
        </div>
      </div>

      <div className="jobs-body">
        {shownFirstLoad && <p className="modal-sub">Loading…</p>}
        {error && <p className="form-error">{error}</p>}

        {!error && hiringTotal > 0 && (
          <div className="jobs-filters">
            <select value={filters.sector} onChange={set('sector')} aria-label="Filter by industry">
              <option value="">All industries</option>
              {options.sector.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
            <select value={filters.city} onChange={set('city')} aria-label="Filter by location">
              <option value="">All locations</option>
              {options.city.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
            <select value={filters.stage} onChange={set('stage')} aria-label="Filter by startup stage">
              <option value="">All stages</option>
              {options.stage.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
            {filtersActive && (
              <button className="linkbtn" onClick={() => setFilters(EMPTY_JOB_FILTERS)}>Clear filters</button>
            )}
            {filtersActive && !loading && <span className="jobs-filter-count">{matches} match your filters</span>}
          </div>
        )}

        {!loading && !error && haveOptions && hiringTotal === 0 && (
          <p className="modal-sub">No company has open roles checked against its own pages right now.</p>
        )}
        {!loading && !error && hiringTotal > 0 && jobs.length === 0 && (
          <p className="modal-sub">No open roles match those filters.</p>
        )}

        <IndexRow items={jobs.map((s) => ({ id: cardId('job', s.slug || s.name), name: s.name }))} what="the companies hiring" />

        <div className="jobs-grid">
          {jobs.map((s) => (
            <EntityCard
              key={s.slug || s.name}
              level={2}
              className="job-card"
              id={cardId('job', s.slug || s.name)}
              tabIndex={-1}
              avatar={<Avatar name={s.name} website={s.website} />}
              name={s.name}
              aside={<UnverifiedBadge company={s} />}
              blurb={s.blurb}
              meta={[s.sectorFull || s.sector, s.stage, s.city]}
            >
              <VerifiedNote at={s.last_verified_at} />
              <div className="job-card-footer">
                <ConceptPreview company={s} />
                {(s.hiring_source_url || s.website) && (
                  <a className="taskbtn" href={s.hiring_source_url || s.website} target="_blank" rel="noopener noreferrer">{s.hiring_source_url ? 'View open roles' : 'Apply now'}</a>
                )}
              </div>
            </EntityCard>
          ))}
        </div>

        {hasMore && !error && (
          <div className="jobs-more">
            <button className="hdrbtn" onClick={showMore} disabled={loadingMore}>
              {loadingMore ? 'Loading…' : `Show more (${matches - jobs.length} left)`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
