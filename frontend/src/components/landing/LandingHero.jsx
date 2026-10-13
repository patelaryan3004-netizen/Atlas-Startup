import { shortDate } from '../../freshness.js';
import EcosystemGraphic from './EcosystemGraphic.jsx';
import SectionRule from './SectionRule.jsx';
import Reveal from '../Reveal.jsx';

function Arrow() {
  return (
    <svg className="landing-btn-arrow" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const figure = new Intl.NumberFormat('en-AU');

// The three figures under the headline, each with what it counts. They come from the server's own counts; one it has not sent, or that
// is zero, is left out (a zero says nothing a visitor can use, and a missing one would be a guess). "Open roles" are the roles read from
// the pages of the companies that are hiring now, so it is zero (and gone) when nothing has been confirmed lately.
export function heroStats(stats) {
  return [
    { key: 'startups', value: stats?.count, label: 'Startups tracked', definition: 'Companies in the directory.' },
    { key: 'people', value: stats?.founders, label: 'Founders named', definition: 'People named as founders on a company record.' },
    { key: 'roles', value: stats?.openRoles, label: 'Open roles', definition: 'Read from the pages of the companies hiring now.' },
  ].filter((stat) => Number.isFinite(stat.value) && stat.value > 0);
}

// The pill above the headline: a real count, or nothing. Companies hiring now first (a page confirmed their roles in the last 14 days);
// with none, how many startups are tracked; with neither, no pill.
export function heroBadge(stats) {
  if (Number.isFinite(stats?.hiring) && stats.hiring > 0) return `${figure.format(stats.hiring)} ${stats.hiring === 1 ? 'company' : 'companies'} hiring now`;
  if (Number.isFinite(stats?.count) && stats.count > 0) return `${figure.format(stats.count)} startups tracked`;
  return null;
}

// The headline across the page in display type, with one word in italic; what this is and where to go beside the directory drawn on
// Australia; and the figures under both.
export default function LandingHero({ stats, pins, areas, companies, number }) {
  const figures = heroStats(stats);
  const badge = heroBadge(stats);
  // The most recent check of any company, from the data itself; left out when the server has none.
  const updated = shortDate(stats?.lastVerifiedAt);

  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="l-grid hero-grid">
        <SectionRule number={number} name="Map" />
        {badge && (
          <Reveal className="hero-badge-wrap">
            <p className="hero-badge"><span className="hero-badge-dot" aria-hidden="true" />{badge}</p>
          </Reveal>
        )}
        <Reveal as="h1" className="hero-title" id="hero-title">
          Australia&rsquo;s startup ecosystem, <em>mapped.</em>
        </Reveal>

        <Reveal className="hero-copy" index={1}>
          <p className="hero-lede">Discover startups, founders, investors and jobs across Australia &mdash; all in one place.</p>
          {updated && <p className="hero-updated">Updated {updated}</p>}
          <div className="landing-cta-row">
            <a className="landing-btn-primary" href="/">
              Explore the map
              <Arrow />
            </a>
            <a className="landing-btn-secondary" href="/?view=waitlist">Join waitlist</a>
          </div>
        </Reveal>

        <EcosystemGraphic pins={pins} areas={areas} companies={companies} />

        {figures.length > 0 && (
          <ul className="hero-stats">
            {figures.map((stat, i) => (
              <li className="hero-stat" key={stat.key}>
                <Reveal index={i} className="hero-stat-reveal">
                  <span className="hero-stat-num">{figure.format(stat.value)}</span>
                  <span className="hero-stat-label">{stat.label}</span>
                  <span className="hero-stat-def">{stat.definition}</span>
                </Reveal>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
