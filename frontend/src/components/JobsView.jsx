import { useEffect, useState } from 'react';
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

export default function JobsView({ sectorColors, onClose }) {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchStartups({ hiring: 'yes' })
      .then(({ results }) => setJobs(results))
      .catch(() => setError('Could not load jobs right now.'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div id="jobsView">
      <header className="jobs-header">
        <h1>
          Jobs <span className="beta-tag">{jobs.length}</span>
        </h1>
        <button className="hdrbtn" onClick={onClose}>← Back to map</button>
      </header>

      <div className="jobs-body">
        {loading && <p className="modal-sub">Loading…</p>}
        {error && <p className="form-error">{error}</p>}
        {!loading && !error && jobs.length === 0 && (
          <p className="modal-sub">No companies are marked as hiring right now.</p>
        )}

        <div className="jobs-grid">
          {jobs.map((s) => (
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

              {s.blurb && <p className="pc-desc">{s.blurb}</p>}

              <div className="job-card-footer">
                {s.taskGate?.enabled ? (
                  <span className="taskgate-badge">TASK-GATE · {s.taskGate.type}</span>
                ) : (
                  <span className="taskgate-badge taskgate-locked">NO GATE</span>
                )}
                <button className="taskbtn">{s.taskGate?.enabled ? 'Start task → Apply' : 'Apply now'}</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
