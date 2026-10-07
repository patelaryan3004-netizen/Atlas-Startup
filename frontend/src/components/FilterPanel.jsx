import { useState } from 'react';
import { useEscapeClose } from '../hooks/useEscapeClose.js';
import Leaderboard from './Leaderboard.jsx';
import NotableStartups from './NotableStartups.jsx';
import MostVouched from './MostVouched.jsx';

const STATES = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'];
// How well a company's place is known. A pin is only drawn for the first two; a city or a state alone is a group on the map.
const PRECISIONS = [
  ['EXACT', 'Exact office'],
  ['SUBURB', 'Suburb only (approximate)'],
  ['CITY', 'City only (no pin)'],
  ['STATE', 'State only (no pin)'],
];

const TABS = [
  { id: 'filters', label: 'Filters' },
  { id: 'leaderboard', label: 'Leaderboard' },
  { id: 'notable', label: 'Notable' },
  { id: 'vouched', label: 'Vouched' },
];

// `summary` is what the server says about the current results (see fetchSummary): the leaderboard, the oldest
// and the most vouched come from it, so this panel never needs the companies themselves.
export default function FilterPanel({ filters, onChange, onReset, meta, resultCount, summary }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('filters');
  const set = (key) => (e) => onChange({ ...filters, [key]: e.target.value });
  const activeCount = Object.values(filters).filter(Boolean).length;

  useEscapeClose(() => setOpen(false));

  const hasVouched = (summary?.vouched?.total ?? 0) > 0;

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
              {TABS.map((t) => (
                <button
                  key={t.id}
                  className={tab === t.id ? 'fdrawer-tab fdrawer-tab-active' : 'fdrawer-tab'}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {tab === 'filters' && (
              <div className="fdrawer-content">
                <div className="fsection">
                  <div className="fsection-label">Location</div>
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
                    <label htmlFor="fState">State</label>
                    <select id="fState" value={filters.state ?? ''} onChange={set('state')}>
                      <option value="">All states</option>
                      {STATES.map((v) => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                    </select>
                  </div>
                  <div className="fgroup">
                    <label htmlFor="fPrecision">How exactly the place is known</label>
                    <select id="fPrecision" value={filters.precision ?? ''} onChange={set('precision')}>
                      <option value="">Any</option>
                      {PRECISIONS.map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="fsection">
                  <div className="fsection-label">Industry</div>
                  <div className="fgroup">
                    <label htmlFor="fSector">Sector</label>
                    <select id="fSector" value={filters.sector} onChange={set('sector')}>
                      <option value="">All sectors</option>
                      {meta.sectors.map((v) => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="fsection">
                  <div className="fsection-label">Investor</div>
                  <div className="fgroup">
                    <label htmlFor="fInvestor">Investor</label>
                    <select id="fInvestor" value={filters.investor} onChange={set('investor')}>
                      <option value="">All investors</option>
                      {meta.investors.map((v) => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="fsection">
                  <div className="fsection-label">Startup stage</div>
                  <div className="fgroup">
                    <label htmlFor="fStage">Stage</label>
                    <select id="fStage" value={filters.stage} onChange={set('stage')}>
                      <option value="">All stages</option>
                      {meta.stages.map((v) => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="fsection">
                  <div className="fsection-label">Hiring</div>
                  <div className="fgroup">
                    <label htmlFor="fHiring">Hiring status</label>
                    <select id="fHiring" value={filters.hiring} onChange={set('hiring')}>
                      <option value="">All</option>
                      <option value="yes">Hiring now</option>
                      <option value="no">Not currently hiring</option>
                    </select>
                  </div>
                </div>

                <div id="resultCount">{resultCount} {resultCount === 1 ? 'startup matches' : 'startups match'} your filters</div>

                <div className="fdrawer-actions">
                  <button id="resetBtn" onClick={onReset}>Clear all</button>
                  <button id="applyBtn" className="taskbtn" onClick={() => setOpen(false)}>Apply filters</button>
                </div>
              </div>
            )}

            {tab === 'leaderboard' && (
              <div className="fdrawer-content">
                <Leaderboard cities={summary?.topCities ?? []} />
              </div>
            )}

            {tab === 'notable' && (
              <div className="fdrawer-content">
                <NotableStartups notable={summary?.notable} />
              </div>
            )}

            {tab === 'vouched' && (
              <div className="fdrawer-content">
                {hasVouched ? <MostVouched vouched={summary.vouched} /> : <p className="fdrawer-empty">No vouches yet.</p>}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
