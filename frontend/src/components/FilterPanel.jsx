import { useEffect, useRef, useState } from 'react';
import Leaderboard from './Leaderboard.jsx';
import NotableStartups from './NotableStartups.jsx';
import MostVouched from './MostVouched.jsx';
import MultiSelect from './MultiSelect.jsx';
import { SEED_TO_SERIES_A, remoteLabel } from '../directory.js';

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
  { id: 'cities', label: 'Cities' },
  { id: 'notable', label: 'Notable' },
  { id: 'vouched', label: 'Vouched' },
];

// The panel starts open only on a wide screen with the map under it (App says so with defaultOpen), and only until the visitor closes it:
// that choice is kept for the next visit, on a wide screen. On a phone it always starts shut, because it covers most of the map.
const WIDE = '(min-width: 1200px)';
const PANEL_KEY = 'auStartupPanel';
const isWide = () => typeof window.matchMedia === 'function' && window.matchMedia(WIDE).matches;
function startsOpen(defaultOpen) {
  if (!defaultOpen || !isWide()) return false;
  try { return localStorage.getItem(PANEL_KEY) !== '0'; } catch (e) { return true; }
}

// `summary` is what the server says about the current results (see fetchSummary): the cities, the oldest and the most vouched come
// from it, so this panel never needs the companies themselves. `onOpenChange(open)` tells the page, which moves the map's own controls
// aside while the panel is open on a wide screen.
// Controlled by the page when `open` is given: the Filters button is then in the toolbar, `toggleRef` is that button (so focus returns to it
// when the panel closes) and the panel has no button of its own. Otherwise it keeps its own state and its own button. `mapTools`, when given,
// is a fifth tab, Map, for the map's layers and its key.
export default function FilterPanel({ filters, onChange, onReset, meta, resultCount, summary, defaultOpen = false, onOpenChange, open: openProp, toggleRef: outerToggleRef, mapTools = null }) {
  const controlled = openProp !== undefined;
  const [ownOpen, setOwnOpen] = useState(() => (controlled ? false : startsOpen(defaultOpen)));
  const open = controlled ? openProp : ownOpen;
  const setOpen = controlled ? (next) => onOpenChange?.(next) : setOwnOpen;
  const [tab, setTab] = useState('filters');
  const ownToggleRef = useRef(null);
  const toggleRef = outerToggleRef ?? ownToggleRef;
  const tabRef = useRef(null);
  const asked = useRef(false); // opened by a press, so focus moves into it (never when it opens by itself)
  const set = (key) => (e) => onChange({ ...filters, [key]: e.target.value });
  const activeCount = Object.values(filters).filter(Boolean).length;

  useEffect(() => { if (!controlled) onOpenChange?.(open); }, [controlled, open, onOpenChange]);
  // Opened by a press, so focus moves into it (never when it opens by itself). A panel the page controls is only ever opened by a press, on the
  // page's own Filters button.
  useEffect(() => { if (open && (asked.current || controlled)) tabRef.current?.focus(); }, [open, controlled]);

  const choose = (next, { refocus = false } = {}) => {
    asked.current = next;
    setOpen(next);
    if (!controlled && isWide()) {
      try { localStorage.setItem(PANEL_KEY, next ? '1' : '0'); } catch (e) { /* ignore */ }
    }
    if (!next && refocus) toggleRef.current?.focus();
  };

  const hasVouched = (summary?.vouched?.total ?? 0) > 0;
  // A company whose city is not known is not a city: it is left out of the count of cities, never listed as "Unknown".
  const cities = (summary?.topCities ?? []).filter(({ city }) => city && city.trim().toLowerCase() !== 'unknown');

  return (
    <>
      {!controlled && <button
        ref={toggleRef}
        id="fToggle"
        className="hdrbtn hdrbtn-accent"
        aria-expanded={open}
        aria-controls="filters"
        onClick={() => choose(!open)}
      >
        &#9776; Filters{activeCount ? ` (${activeCount})` : ''}
      </button>}

      {open && (
        <>
          <div className="map-panel-scrim" onClick={() => choose(false)} />
          <aside
            id="filters"
            className="map-panel"
            aria-label="Filters and cities"
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); choose(false, { refocus: true }); } }}
          >
            <button className="modal-close" aria-label="Close" onClick={() => choose(false, { refocus: true })}>&#10005;</button>

            <div className="map-panel-tabs" role="tablist" aria-label="Panel">
              {[...TABS, ...(mapTools ? [{ id: 'map', label: 'Map' }] : [])].map((t) => (
                <button
                  key={t.id}
                  ref={tab === t.id ? tabRef : undefined}
                  id={`panelTab-${t.id}`}
                  role="tab"
                  aria-selected={tab === t.id}
                  aria-controls="panelBody"
                  className={tab === t.id ? 'map-panel-tab map-panel-tab-active' : 'map-panel-tab'}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div id="panelBody" role="tabpanel" aria-labelledby={`panelTab-${tab}`}>
              {tab === 'filters' && (
                <div className="map-panel-content">
                  <div className="fsection">
                    <div className="fsection-label">Location</div>
                    <MultiSelect id="fCity" label="City" noun="cities" all="All cities" options={meta.cities} value={filters.city} onChange={(city) => onChange({ ...filters, city })} />
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
                    <MultiSelect id="fSector" label="Sector" noun="sectors" all="All sectors" options={meta.sectors} value={filters.sector} onChange={(sector) => onChange({ ...filters, sector })} />
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
                        <option value={SEED_TO_SERIES_A}>Seed to Series A</option>
                        {meta.stages.map((v) => (
                          <option key={v} value={v}>{v}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* The three filters below are for facts a page has to give a company, so each shows only once some company has one. */}
                  {meta.remotePolicies?.length > 0 && (
                    <div className="fsection">
                      <div className="fsection-label">Remote policy</div>
                      <div className="fgroup">
                        <label htmlFor="fRemote">Where people work</label>
                        <select id="fRemote" value={filters.remote ?? ''} onChange={set('remote')}>
                          <option value="">Any</option>
                          {meta.remotePolicies.map((v) => (
                            <option key={v} value={v}>{remoteLabel(v) ?? v}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}

                  {meta.techStack?.length > 0 && (
                    <div className="fsection">
                      <div className="fsection-label">Tech stack</div>
                      <MultiSelect id="fTech" label="Built with" noun="tools" all="Any tool" options={meta.techStack} value={filters.tech} onChange={(tech) => onChange({ ...filters, tech })} />
                    </div>
                  )}

                  {meta.teamSizes?.length > 0 && (
                    <div className="fsection">
                      <div className="fsection-label">Team size</div>
                      <div className="fgroup">
                        <label htmlFor="fTeam">People</label>
                        <select id="fTeam" value={filters.team ?? ''} onChange={set('team')}>
                          <option value="">Any</option>
                          {meta.teamSizes.map(({ code, label }) => (
                            <option key={code} value={code}>{label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}

                  <div className="fsection">
                    <div className="fsection-label">Hiring</div>
                    <div className="fgroup">
                      <label htmlFor="fHiring">Hiring status</label>
                      <select id="fHiring" value={filters.hiring} onChange={set('hiring')}>
                        <option value="">All</option>
                        <option value="yes">Hiring now</option>
                        <option value="no">Not verified as hiring</option>
                      </select>
                    </div>
                  </div>

                  <div id="resultCount">{resultCount} {resultCount === 1 ? 'startup matches' : 'startups match'} your filters</div>

                  <div className="map-panel-actions">
                    <button id="resetBtn" onClick={onReset}>Clear all</button>
                    <button id="applyBtn" className="taskbtn" onClick={() => choose(false, { refocus: true })}>Apply filters</button>
                  </div>
                </div>
              )}

              {tab === 'map' && mapTools && <div className="map-panel-content">{mapTools}</div>}

              {tab === 'cities' && (
                <div className="map-panel-content">
                  {cities.length > 0 ? (
                    <>
                      <p className="panel-note">Where most of these startups are.</p>
                      <Leaderboard cities={cities} />
                    </>
                  ) : <p className="panel-empty">No cities to count yet.</p>}
                </div>
              )}

              {tab === 'notable' && (
                <div className="map-panel-content">
                  <NotableStartups notable={summary?.notable} />
                </div>
              )}

              {tab === 'vouched' && (
                <div className="map-panel-content">
                  {hasVouched ? <MostVouched vouched={summary.vouched} /> : <p className="panel-empty">No vouches yet.</p>}
                </div>
              )}
            </div>
          </aside>
        </>
      )}
    </>
  );
}
