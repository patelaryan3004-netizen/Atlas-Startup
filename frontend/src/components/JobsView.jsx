import { useEffect, useRef, useState } from 'react';
import { fetchStartupPage } from '../api.js';
import ConceptPreview from './ConceptPreview.jsx';

const PAGE = 24;

function domainOf(website) {
  if (!website) return null;
  try {
    return new URL(website).hostname.replace(/^www\./, '');
  } catch (e) {
    return null;
  }
}

function JobCardLogo({ website, name }) {
  const domain = domainOf(website);
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  const [failed, setFailed] = useState(false);
  const [triedFallback, setTriedFallback] = useState(false);

  if (!domain || failed) {
    return <span className="job-card-logo-fallback">{initial}</span>;
  }
  const src = triedFallback
    ? `https://www.google.com/s2/favicons?domain=${domain}&sz=64`
    : `https://logo.clearbit.com/${domain}?size=64`;
  return (
    <img
      className="job-card-logo"
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => (triedFallback ? setFailed(true) : setTriedFallback(true))}
    />
  );
}

const EMPTY_JOB_FILTERS = { sector: '', city: '', stage: '' };
const NO_OPTIONS = { sector: [], city: [], stage: [] };

// The companies that are hiring, a page at a time. The filter options come from the whole hiring set (asked for
// with the first page, before any filter is chosen), not from the site-wide meta endpoint and not from the page
// on screen: every option shown is guaranteed to match at least one currently-open listing.
export default function JobsView({ sectorColors, onClose }) {
  const [jobs, setJobs] = useState([]);
  const [matches, setMatches] = useState(0);
  const [hiringTotal, setHiringTotal] = useState(0);
  const [options, setOptions] = useState(NO_OPTIONS);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState(EMPTY_JOB_FILTERS);
  const haveOptions = useRef(false);
  const generation = useRef(0);

  useEffect(() => {
    const ctrl = new AbortController();
    generation.current += 1;
    setLoading(true);
    setError('');
    fetchStartupPage({ hiring: 'yes', ...filters }, { limit: PAGE, offset: 0, sort: 'name', facets: haveOptions.current ? undefined : 'sector,city,stage', signal: ctrl.signal })
      .then((page) => {
        if (ctrl.signal.aborted) return;
        setJobs(page.results);
        setMatches(page.count);
        setHasMore(page.hasMore);
        if (page.facets && !haveOptions.current) {
          haveOptions.current = true;
          setHiringTotal(page.count);
          setOptions({ sector: page.facets.sector.values.map((v) => v.value).sort(), city: page.facets.city.values.map((v) => v.value).sort(), stage: page.facets.stage.values.map((v) => v.value).sort() });
        }
      })
      .catch((err) => { if (!ctrl.signal.aborted && err.name !== 'AbortError') setError('Could not load jobs right now.'); })
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

  const filtersActive = Object.values(filters).some(Boolean);
  const set = (key) => (e) => setFilters((prev) => ({ ...prev, [key]: e.target.value }));
  const shownFirstLoad = loading && jobs.length === 0;

  return (
    <div id="jobsView">
      <header className="jobs-header">
        <div>
          <h1>Startup jobs in Australia</h1>
          {haveOptions.current && !error && <p className="jobs-subhead">{hiringTotal} {hiringTotal === 1 ? 'company is' : 'companies are'} hiring now</p>}
          {haveOptions.current && !error && <p className="jobs-subhead">Only companies whose open roles were read from a page are listed. A company marked as hiring that no page backs is not.</p>}
        </div>
        <button className="hdrbtn" onClick={onClose}>← Back to map</button>
      </header>

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

        {!loading && !error && haveOptions.current && hiringTotal === 0 && (
          <p className="modal-sub">No company has open roles checked against its own pages right now.</p>
        )}
        {!loading && !error && hiringTotal > 0 && jobs.length === 0 && (
          <p className="modal-sub">No open roles match those filters.</p>
        )}

        <div className="jobs-grid">
          {jobs.map((s) => (
            <div className="job-card" key={s.slug || s.name}>
              <div className="job-card-top">
                <JobCardLogo website={s.website} name={s.name} />
                <div>
                  <h2>{s.name}</h2>
                  <div className="job-card-meta">{s.city} · {s.stage}</div>
                </div>
              </div>

              <span className="pc-badge" style={{ background: sectorColors[s.sector] || '#444', color: '#fff' }}>
                {s.sector}
              </span>
              {!s.verified && <span className="badge-unverified">Unverified</span>}

              {s.blurb && <p className="pc-desc">{s.blurb}</p>}

              <div className="job-card-footer">
                <ConceptPreview company={s} />
                {s.website && (
                  <a className="taskbtn" href={s.website} target="_blank" rel="noopener noreferrer">Apply now</a>
                )}
              </div>
            </div>
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
