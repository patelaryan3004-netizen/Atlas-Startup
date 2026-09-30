import { useEffect, useMemo, useState } from 'react';
import { fetchStartups } from '../api.js';

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
      onError={() => (triedFallback ? setFailed(true) : setTriedFallback(true))}
    />
  );
}

const EMPTY_JOB_FILTERS = { sector: '', city: '', stage: '' };

// Options are derived from the hiring-now set itself, not the site-wide
// meta endpoint - every option shown here is guaranteed to match at least
// one currently-open listing.
function optionsFrom(jobs, field) {
  return [...new Set(jobs.map((j) => j[field]).filter(Boolean))].sort();
}

export default function JobsView({ sectorColors, onClose }) {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState(EMPTY_JOB_FILTERS);

  useEffect(() => {
    fetchStartups({ hiring: 'yes' })
      .then(({ results }) => setJobs(results))
      .catch(() => setError('Could not load jobs right now.'))
      .finally(() => setLoading(false));
  }, []);

  const sectorOptions = useMemo(() => optionsFrom(jobs, 'sector'), [jobs]);
  const cityOptions = useMemo(() => optionsFrom(jobs, 'city'), [jobs]);
  const stageOptions = useMemo(() => optionsFrom(jobs, 'stage'), [jobs]);

  const filteredJobs = useMemo(
    () => jobs.filter((j) =>
      (!filters.sector || j.sector === filters.sector)
      && (!filters.city || j.city === filters.city)
      && (!filters.stage || j.stage === filters.stage)
    ),
    [jobs, filters]
  );
  const filtersActive = Object.values(filters).some(Boolean);
  const set = (key) => (e) => setFilters((prev) => ({ ...prev, [key]: e.target.value }));

  return (
    <div id="jobsView">
      <header className="jobs-header">
        <div>
          <h1>Startup jobs in Australia</h1>
          {!loading && !error && <p className="jobs-subhead">{jobs.length} {jobs.length === 1 ? 'company is' : 'companies are'} hiring now</p>}
        </div>
        <button className="hdrbtn" onClick={onClose}>← Back to map</button>
      </header>

      <div className="jobs-body">
        {loading && <p className="modal-sub">Loading…</p>}
        {error && <p className="form-error">{error}</p>}

        {!loading && !error && jobs.length > 0 && (
          <div className="jobs-filters">
            <select value={filters.sector} onChange={set('sector')} aria-label="Filter by industry">
              <option value="">All industries</option>
              {sectorOptions.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
            <select value={filters.city} onChange={set('city')} aria-label="Filter by location">
              <option value="">All locations</option>
              {cityOptions.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
            <select value={filters.stage} onChange={set('stage')} aria-label="Filter by startup stage">
              <option value="">All stages</option>
              {stageOptions.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
            {filtersActive && (
              <button className="linkbtn" onClick={() => setFilters(EMPTY_JOB_FILTERS)}>Clear filters</button>
            )}
            {filtersActive && <span className="jobs-filter-count">{filteredJobs.length} match your filters</span>}
          </div>
        )}

        {!loading && !error && jobs.length === 0 && (
          <p className="modal-sub">No companies are marked as hiring right now.</p>
        )}
        {!loading && !error && jobs.length > 0 && filteredJobs.length === 0 && (
          <p className="modal-sub">No open roles match those filters.</p>
        )}

        <div className="jobs-grid">
          {filteredJobs.map((s) => (
            <div className="job-card" key={s.name}>
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
                {s.taskGate?.enabled ? (
                  <span className="taskgate-badge">TASK-GATE · {s.taskGate.type}</span>
                ) : (
                  <span className="taskgate-badge taskgate-locked">NO GATE</span>
                )}
                {s.website && (
                  <a className="taskbtn" href={s.website} target="_blank" rel="noopener noreferrer">
                    {s.taskGate?.enabled ? 'Start task → Apply' : 'Apply now'}
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
