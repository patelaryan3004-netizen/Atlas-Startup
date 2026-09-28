import { useEffect, useMemo, useState } from 'react';
import { fetchStartups, fetchMeta, DIRECTORY_URL } from './api.js';
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
  '#1f5f4f', '#c05a2e', '#b8862a', '#5a6f8c', '#7a3b8a', '#3a8a5a', '#a03a3a', '#8a4a1f',
  '#6a5a3a', '#2f7a3a', '#a0466a', '#3a5a8a', '#8a1f3a', '#5a5a3a', '#7a5a2f', '#4a4a6a',
];

export default function LandingPage() {
  const [startups, setStartups] = useState([]);
  const [meta, setMeta] = useState({ sectors: [] });
  const [total, setTotal] = useState(null);

  useEffect(() => {
    fetchMeta().then(setMeta).catch(() => {});
    fetchStartups({}).then(({ results, total }) => {
      setStartups(results);
      setTotal(total);
    }).catch(() => {});
  }, []);

  const sectorColors = useMemo(() => {
    const colors = {};
    [...meta.sectors].sort().forEach((s, i) => { colors[s] = PALETTE[i % PALETTE.length]; });
    return colors;
  }, [meta.sectors]);

  const hiringCount = startups.filter((s) => s.hiring).length;
  const hiringSample = startups.filter((s) => s.hiring).slice(0, 4);
  const listCounts = curatedLists.map((list) => ({
    ...list,
    count: startups.filter(list.match).length,
  }));

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
          <p className="landing-lede">
            {total == null
              ? 'A living map of VC-backed Australian companies, checked against real sources.'
              : `${total} VC-backed companies, checked against real sources, with live hiring status${hiringCount ? ` for ${hiringCount} of them` : ''} right now.`}
          </p>
          <div className="landing-cta-row">
            <a className="landing-btn-primary" href="/">Explore the map</a>
            <a className="landing-btn-secondary" href={DIRECTORY_URL}>Browse the list</a>
          </div>
        </div>
        <div className="landing-hero-visual">
          <MapView startups={startups} sectorColors={sectorColors} />
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
