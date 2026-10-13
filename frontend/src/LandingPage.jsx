import { useEffect, useState } from 'react';
import '@fontsource/instrument-serif/latin-400-italic.css';
import { fetchStartupPage, fetchSummary, fetchMarkers, fetchCounts, fetchPeople, DIRECTORY_URL } from './api.js';
import PersonCard from './components/people/PersonCard.jsx';
import { logoUrl } from './logo.js';
import LandingNav from './components/landing/LandingNav.jsx';
import LandingHero from './components/landing/LandingHero.jsx';
import SectionRule from './components/landing/SectionRule.jsx';
import Reveal from './components/Reveal.jsx';
import IndexRow, { cardId } from './components/IndexRow.jsx';
import { appPath } from './appRoute.js';
import ConceptPreview from './components/ConceptPreview.jsx';
import { curatedLists } from './curatedLists.js';
import './landing.css';
import './landing-hero.css';

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

  if (!domain || failed) return <span className="landing-logo-fallback">{initial}</span>;
  // These sit below the hero: they are asked for as they near the screen, not with the page.
  return (
    <img
      className="landing-logo"
      src={logoUrl(domain, 64)}
      width="34"
      height="34"
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

// Only the startup-filtering lists fit this showcase; the static people-to-follow list has no company count and
// is not a live filter.
const FILTER_LISTS = curatedLists.filter((list) => list.type === 'filter');

// Companies that are hiring: enough to name one in most capitals in the hero's picture. The job cards show the first few.
const HIRING_SAMPLE = 80;
const JOB_CARDS = 4;

// How many people the page shows of those worth following.
const PEOPLE_CARDS = 3;

// The page asks for what it shows (counts, the companies that are hiring, the map's pins), never for every company.
export default function LandingPage() {
  const [stats, setStats] = useState(null);
  const [hiringSample, setHiringSample] = useState([]);
  const [markers, setMarkers] = useState([]);
  const [areas, setAreas] = useState([]);
  const [counts, setCounts] = useState({});
  const [people, setPeople] = useState([]);

  useEffect(() => {
    fetchSummary({}).then(setStats).catch(() => {});
    // The people worth following, if the owner has listed any; with none, the page has no People section.
    fetchPeople({}, { limit: PEOPLE_CARDS }).then(({ results }) => setPeople(results ?? [])).catch(() => {});
    fetchStartupPage({ hiring: 'yes' }, { limit: HIRING_SAMPLE, sort: 'file' }).then(({ results }) => setHiringSample(results)).catch(() => {});
    fetchMarkers({}).then(({ items, areas: groups }) => { setMarkers(items); setAreas(groups ?? []); }).catch(() => {});
    // Every list's count in one request, not one each; a count that could not be had is 0, as before.
    fetchCounts(FILTER_LISTS.map((list) => list.filters))
      .then(({ counts: found }) => found, () => [])
      .then((found) => setCounts(Object.fromEntries(FILTER_LISTS.map((list, i) => [list.id, found[i] ?? 0]))));
  }, []);

  // The numbered sections, in the order they run. A section the page does not have (the people, when no one is listed) is not here, so the numbers never skip.
  const sections = ['map', ...(people.length ? ['people'] : []), 'lists', 'verify'];
  const numberOf = (id) => sections.indexOf(id) + 1;
  const hiringCount = stats?.hiring ?? 0;
  const listCounts = FILTER_LISTS.map((list) => ({ ...list, count: counts[list.id] ?? 0 }));

  return (
    <div className="landing">
      <a className="landing-skip" href="#main">Skip to content</a>
      <LandingNav />

      <main id="main">
        <LandingHero stats={stats} pins={markers} areas={areas} companies={hiringSample} number={numberOf('map')} />

        <section className="landing-section" aria-labelledby="hiring-title">
          <div className="l-grid landing-section-head">
            <Reveal as="h2" id="hiring-title">See who&rsquo;s hiring, right now.</Reveal>
            <Reveal className="landing-section-text" index={1}>
              <p>
                {hiringCount
                  ? `${hiringCount} ${hiringCount === 1 ? 'company has' : 'companies have'} open roles we have checked on ${hiringCount === 1 ? 'its' : 'their'} own pages.`
                  : 'A company is listed as hiring once its open roles have been checked against its own pages.'}
              </p>
            </Reveal>
          </div>
          {hiringSample.length > 0 && (
            <div className="l-grid">
              <IndexRow items={hiringSample.slice(0, JOB_CARDS).map((s) => ({ id: cardId('hiring', s.slug || s.name), name: s.name }))} what="the companies hiring" />
              <div className="landing-job-grid">
                {hiringSample.slice(0, JOB_CARDS).map((s, i) => (
                  <Reveal index={i} key={s.name}>
                    <a className="landing-job-card" id={cardId('hiring', s.slug || s.name)} href={appPath({ kind: 'startup', slug: s.slug || s.name })}>
                      <CompanyLogo website={s.website} name={s.name} />
                      <div>
                        <div className="landing-job-name">{s.name}</div>
                        <div className="landing-job-meta">{s.city} · {s.sector}</div>
                      </div>
                      <ConceptPreview company={s} />
                    </a>
                  </Reveal>
                ))}
              </div>
            </div>
          )}
          <p className="landing-block-foot"><a className="landing-inline-link" href="/?view=jobs">See every open role →</a></p>
        </section>

        {people.length > 0 && (
          <section className="landing-section" aria-labelledby="people-title">
            <SectionRule number={numberOf('people')} name="People" />
            <div className="l-grid landing-section-head">
              <Reveal as="h2" id="people-title">People worth following.</Reveal>
              <Reveal className="landing-section-text" index={1}>
                <p>Founders, operators and investors in Australian startups, each with the pages behind it.</p>
              </Reveal>
            </div>
            <div className="l-grid">
              <IndexRow items={people.map((p) => ({ id: cardId('person', p.id), name: p.name }))} what="the people listed" />
              <ul className="landing-people-grid">
                {people.map((p, i) => (
                  <Reveal as="li" index={i} key={p.id}><PersonCard as="div" level={3} person={p} /></Reveal>
                ))}
              </ul>
            </div>
            <p className="landing-block-foot"><a className="landing-inline-link" href="/people">See everyone →</a></p>
          </section>
        )}

        <section className="landing-section" aria-labelledby="lists-title">
          <SectionRule number={numberOf('lists')} name="Lists" />
          <div className="l-grid landing-section-head">
            <Reveal as="h2" id="lists-title">Curated, shareable views.</Reveal>
            <Reveal className="landing-section-text" index={1}>
              <p>Preset filters for common questions, so you do not have to rebuild them yourself.</p>
            </Reveal>
          </div>
          <div className="l-grid">
            <IndexRow items={listCounts.map((list) => ({ id: cardId('list', list.id), name: list.name }))} what="the curated lists" max={6} />
            <div className="landing-list-grid">
              {listCounts.map((list, i) => (
                <Reveal index={i % 3} key={list.id}>
                  <a className="landing-list-card" id={cardId('list', list.id)} href={appPath({ kind: 'list', slug: list.id })}>
                    <div className="landing-list-name">{list.name}</div>
                    <div className="landing-list-desc">{list.description}</div>
                    <div className="landing-list-count">{list.count} companies</div>
                  </a>
                </Reveal>
              ))}
            </div>
          </div>
          <p className="landing-block-foot"><a className="landing-inline-link" href="/?view=lists">Open curated lists →</a></p>
        </section>

        <section className="landing-section landing-trust" aria-labelledby="verify-title">
          <SectionRule number={numberOf('verify')} name="How we verify" />
          <div className="l-grid landing-section-head">
            <Reveal as="h2" id="verify-title">Reviewed before it is published.</Reveal>
            <Reveal className="landing-section-text" index={1}>
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
            </Reveal>
          </div>
        </section>

        <section className="landing-final-cta">
          <Reveal as="h2">Start exploring.</Reveal>
          <Reveal className="landing-cta-row" index={1}>
            <a className="landing-btn-primary" href="/">Explore the map</a>
            <a className="landing-btn-secondary" href="/?view=list">Browse startups</a>
          </Reveal>
        </section>
      </main>

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
          <p><strong>The waitlist.</strong> &ldquo;Join waitlist&rdquo; opens a form hosted by Tally
            (tally.so), and loads it only when you open it. What you enter there goes to Tally, and
            Tally&rsquo;s own privacy policy applies to the form.</p>
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
