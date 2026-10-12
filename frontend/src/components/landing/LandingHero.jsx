import { shortDate } from '../../freshness.js';
import EcosystemGraphic from './EcosystemGraphic.jsx';

function Arrow() {
  return (
    <svg className="landing-btn-arrow" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Two columns: what this is and where to go on the left, the directory drawn on Australia on the right. The facts under the
// headline are the server's own counts; one it has not sent is left out, never shown as a zero.
export default function LandingHero({ stats, pins, areas, companies }) {
  const count = Number.isFinite(stats?.count) ? stats.count : null;
  const hiring = Number.isFinite(stats?.hiring) ? stats.hiring : null;
  // The most recent check of any company, from the data itself; left out when the server has none.
  const updated = shortDate(stats?.lastVerifiedAt);

  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-copy">
        <h1 id="hero-title">Australia&rsquo;s startup ecosystem, mapped.</h1>
        {(count !== null || updated || hiring !== null) && (
          <p className="hero-facts">
            {count !== null && <span>{count} startups</span>}
            {updated && <span>Updated {updated}</span>}
            {hiring !== null && <span className="hero-facts-hiring">{hiring} hiring now</span>}
          </p>
        )}
        <p className="hero-lede">
          Discover startups, founders, investors and jobs across Australia &mdash; all in one place.
        </p>
        <div className="landing-cta-row">
          <a className="landing-btn-primary" href="/">
            Explore the map
            <Arrow />
          </a>
          <a className="landing-btn-secondary" href="/?view=list">Browse startups</a>
        </div>
      </div>

      <EcosystemGraphic pins={pins} areas={areas} companies={companies} />
    </section>
  );
}
