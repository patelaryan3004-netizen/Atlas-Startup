import { useEffect, useMemo, useState } from 'react';
import { fetchStartupPage, fetchSummary, fetchMarkers, fetchCount, fetchMeta, DIRECTORY_URL } from './api.js';
import MapView from './components/MapView.jsx';
import { curatedLists } from './curatedLists.js';
import './landing.css';

function domainOf(website) {
  if (!website) return null;
  try {
    return new URL(website).hostname.replace(/^www\./, '');
  } catch (e) {
    return null;
  }
}

function CompanyLogo({ website, name }) {
  const domain = domainOf(website);
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  const [failed, setFailed] = useState(false);
  const [triedFallback, setTriedFallback] = useState(false);

  if (!domain || failed) return <span className="landing-logo-fallback">{initial}</span>;
  const src = triedFallback
    ? `https://www.google.com/s2/favicons?domain=${domain}&sz=64`
    : `https://logo.clearbit.com/${domain}?size=64`;
  return (
    <img
      className="landing-logo"
      src={src}
      alt=""
      onError={() => (triedFallback ? setFailed(true) : setTriedFallback(true))}
    />
  );
}

const PALETTE = [
  '#5fb894', '#e08a5a', '#d4a24e', '#7a95b8', '#a878c4', '#6ac48a', '#d4726a', '#c4864e',
  '#a89468', '#6ab87a', '#d47aa0', '#7a94c4', '#c4507a', '#9a9a7a', '#c4966a', '#8686b8',
];

// Only the startup-filtering lists fit this showcase; the static people-to-follow list has no company count and
// is not a live filter.
const FILTER_LISTS = curatedLists.filter((list) => list.type === 'filter');

// The page asks for what it shows (counts, four companies that are hiring, the map's pins), never for every company.
export default function LandingPage() {
  const [stats, setStats] = useState(null);
  const [hiringSample, setHiringSample] = useState([]);
  const [markers, setMarkers] = useState([]);
  const [areas, setAreas] = useState([]);
  const [counts, setCounts] = useState({});
  const [meta, setMeta] = useState({ sectors: [] });

  useEffect(() => {
    fetchMeta().then(setMeta).catch(() => {});
    fetchSummary({}).then(setStats).catch(() => {});
    fetchStartupPage({ hiring: 'yes' }, { limit: 4, sort: 'file' }).then(({ results }) => setHiringSample(results)).catch(() => {});
    fetchMarkers({}).then(({ items, areas: groups }) => { setMarkers(items); setAreas(groups ?? []); }).catch(() => {});
    Promise.all(FILTER_LISTS.map(async (list) => {
      try { return [list.id, (await fetchCount(list.filters)).count]; } catch (e) { return [list.id, 0]; }
    })).then((pairs) => setCounts(Object.fromEntries(pairs)));
  }, []);

  const sectorColors = useMemo(() => {
    const colors = {};
    [...meta.sectors].sort().forEach((s, i) => { colors[s] = PALETTE[i % PALETTE.length]; });
    return colors;
  }, [meta.sectors]);

  const total = stats ? stats.count : null;
  const hiringCount = stats?.hiring ?? 0;
  const cityCount = stats?.cities ?? 0;
  const taskGatedCount = stats?.taskGated ?? 0;
  const listCounts = FILTER_LISTS.map((list) => ({ ...list, count: counts[list.id] ?? 0 }));

  return (
    <div className="landing">
      <header className="landing-nav">
        <span className="landing-wordmark">AU <span>Startup</span> Map</span>
        <a className="landing-navlink" href="/">Open the map</a>
      </header>

      <section className="landing-hero">
        <div className="landing-hero-text">
          <div className="landing-eyebrow">BETA · AUSTRALIA</div>
          <h1>Australia&rsquo;s startups, mapped and verified.</h1>
          {total == null ? (
            <p className="landing-lede">
              A living map of VC-backed Australian companies, checked against real sources.
            </p>
          ) : (
            <ul className="landing-stats">
              <li><strong>{total}</strong> VC-backed companies tracked</li>
              <li><strong>{hiringCount}</strong> hiring right now</li>
              <li><strong>{cityCount}</strong> cities across Australia</li>
              {taskGatedCount > 0 && (
                <li><strong>{taskGatedCount}</strong> with a real work-sample task instead of a form</li>
              )}
            </ul>
          )}
          <div className="landing-cta-row">
            <a className="landing-btn-primary" href="/">Explore the map</a>
            <a className="landing-btn-secondary" href={DIRECTORY_URL}>Browse the list</a>
          </div>
        </div>
        <div className="landing-hero-visual">
          <MapView markers={markers} areas={areas} sectorColors={sectorColors} />
        </div>
      </section>

      <section className="landing-section">
        <div className="landing-section-head">
          <h2>See who&rsquo;s hiring, right now.</h2>
          <p>
            {hiringCount
              ? `${hiringCount} companies on the map are hiring today. Some gate applications behind a real work-sample task instead of a form.`
              : 'Companies on the map show live hiring status, pulled from the same data as their pin.'}
          </p>
        </div>
        {hiringSample.length > 0 && (
          <div className="landing-job-grid">
            {hiringSample.map((s) => (
              <div className="landing-job-card" key={s.name}>
                <CompanyLogo website={s.website} name={s.name} />
                <div>
                  <div className="landing-job-name">{s.name}</div>
                  <div className="landing-job-meta">{s.city} · {s.sector}</div>
                </div>
                {s.taskGate?.enabled && <span className="landing-tag">Task-gated</span>}
              </div>
            ))}
          </div>
        )}
        <a className="landing-inline-link" href="/?view=jobs">See every open role →</a>
      </section>

      <section className="landing-section">
        <div className="landing-section-head">
          <h2>Curated, shareable views.</h2>
          <p>Preset filters for common questions, so you do not have to rebuild them yourself.</p>
        </div>
        <div className="landing-list-grid">
          {listCounts.map((list) => (
            <div className="landing-list-card" key={list.id}>
              <div className="landing-list-name">{list.name}</div>
              <div className="landing-list-desc">{list.description}</div>
              <div className="landing-list-count">{list.count} companies</div>
            </div>
          ))}
        </div>
        <a className="landing-inline-link" href="/?view=lists">Open curated lists →</a>
      </section>

      <section className="landing-section landing-trust">
        <div className="landing-section-head">
          <h2>Reviewed before it is published.</h2>
          <p>
            Built from public sources — company websites, LinkedIn, press coverage, and VC or
            accelerator portfolio pages — plus direct submissions from founders and the public.
            Every submission is reviewed by a person before it changes the map; nothing is
            auto-published. Where only a city is confirmed rather than a street address, the pin
            says so rather than guessing.
          </p>
          <p>
            This is a beta, independent project. It is not affiliated with, endorsed by, or
            operated on behalf of any company listed. Company names and logos are used for
            identification only, under fair use.
          </p>
        </div>
      </section>

      <section className="landing-final-cta">
        <h2>Start exploring.</h2>
        <div className="landing-cta-row">
          <a className="landing-btn-primary" href="/">Explore the map</a>
          <a className="landing-btn-secondary" href={DIRECTORY_URL}>Browse the list</a>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="landing-footer-links">
          <a href="#privacy">Privacy</a>
          <a href="#terms">Terms</a>
          <a href={DIRECTORY_URL}>Full list (no JS)</a>
        </div>

        <div id="privacy" className="landing-legal">
          <h3>Privacy</h3>
          <p><strong>What we collect.</strong> The &ldquo;Submit a startup&rdquo; and &ldquo;Suggest an
            edit&rdquo; forms send whatever you type, including your email if you choose to give one,
            to our review queue. We use it only to follow up on that submission and to consider it for
            the map. We do not sell it, and we do not use it for marketing.</p>
          <p><strong>What we do not collect.</strong> No account, no tracking cookies, no analytics
            pixel. Your browser may cache map data locally purely to remember interface preferences.</p>
          <p><strong>Business details.</strong> Placeholder: operator name, ABN, and contact details go
            here before this site is public. Not filled in yet.</p>
        </div>

        <div id="terms" className="landing-legal">
          <h3>Terms</h3>
          <p><strong>Draft, for review before this site is public.</strong> AU Startup Map is an
            independent, best-effort directory. Listings are sourced from public information and
            unverified user submissions, and may contain errors or go out of date; nothing here is
            a guarantee of accuracy. Links to company websites and job applications lead to
            third-party sites we do not control and are not responsible for. Company names and logos
            belong to their respective owners and are shown for identification only. This section
            does not yet reflect final legal review or a registered business entity.</p>
        </div>
      </footer>
    </div>
  );
}
