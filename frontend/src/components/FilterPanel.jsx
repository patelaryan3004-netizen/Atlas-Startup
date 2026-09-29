import { useState } from 'react';
import { useEscapeClose } from '../hooks/useEscapeClose.js';
import Leaderboard from './Leaderboard.jsx';

export default function FilterPanel({ filters, onChange, onReset, meta, resultCount, total, startups }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('filters');
  const set = (key) => (e) => onChange({ ...filters, [key]: e.target.value });
  const activeCount = Object.values(filters).filter(Boolean).length;

  useEscapeClose(() => setOpen(false));

  return (
    <>
      <button id="fToggle" className="hdrbtn hdrbtn-accent" onClick={() => setOpen((v) => !v)}>
        &#9776; Filters{activeCount ? ` (${activeCount})` : ''}
      </button>

      {open && (
        <div className="modal-overlay fdrawer-overlay" onClick={() => setOpen(false)}>
          <div id="filters" className="fdrawer-panel" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" aria-label="Close" onClick={() => setOpen(false)}>&#10005;</button>

            <div className="fdrawer-tabs">
              <button
                className={tab === 'filters' ? 'fdrawer-tab fdrawer-tab-active' : 'fdrawer-tab'}
                onClick={() => setTab('filters')}
              >
                Filters
              </button>
              <button
                className={tab === 'leaderboard' ? 'fdrawer-tab fdrawer-tab-active' : 'fdrawer-tab'}
                onClick={() => setTab('leaderboard')}
              >
                Leaderboard
              </button>
            </div>

            {tab === 'filters' && (
              <div className="fdrawer-content">
                <div className="fgroup">
                  <label htmlFor="fSearch">Search</label>
                  <input
                    id="fSearch"
                    type="text"
                    placeholder="Company name..."
                    value={filters.search}
                    onChange={set('search')}
                  />
                </div>
                <div className="fgroup">
                  <label htmlFor="fSector">Sector</label>
                  <select id="fSector" value={filters.sector} onChange={set('sector')}>
                    <option value="">All sectors</option>
                    {meta.sectors.map((v) => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                </div>
                <div className="fgroup">
                  <label htmlFor="fCity">City</label>
                  <select id="fCity" value={filters.city} onChange={set('city')}>
                    <option value="">All cities</option>
                    {meta.cities.map((v) => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                </div>
                <div className="fgroup">
                  <label htmlFor="fInvestor">Investor</label>
                  <select id="fInvestor" value={filters.investor} onChange={set('investor')}>
                    <option value="">All investors</option>
                    {meta.investors.map((v) => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                </div>
                <div className="fgroup">
                  <label htmlFor="fStage">Stage</label>
                  <select id="fStage" value={filters.stage} onChange={set('stage')}>
                    <option value="">All stages</option>
                    {meta.stages.map((v) => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                </div>
                <div className="fgroup">
                  <label htmlFor="fHiring">Hiring</label>
                  <select id="fHiring" value={filters.hiring} onChange={set('hiring')}>
                    <option value="">All</option>
                    <option value="yes">Hiring now</option>
                    <option value="no">Not hiring</option>
                  </select>
                </div>
                <button id="resetBtn" onClick={onReset}>Reset filters</button>
                <div id="resultCount">{resultCount} of {total} shown</div>
              </div>
            )}

            {tab === 'leaderboard' && (
              <div className="fdrawer-content">
                <Leaderboard startups={startups} />
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
