import { useEffect, useState } from 'react';
import '@fontsource/instrument-serif/latin-400-italic.css';
import { fetchStartupPage, fetchSummary, fetchMarkers, fetchCounts, fetchPeople, fetchInstitutions } from './api.js';
import PersonCard from './components/people/PersonCard.jsx';
import InstitutionCard from './components/people/InstitutionCard.jsx';
import EntityCard, { Avatar } from './components/EntityCard.jsx';
import LandingNav from './components/landing/LandingNav.jsx';
import LandingHero from './components/landing/LandingHero.jsx';
import LandingFooter from './components/landing/LandingFooter.jsx';
import SectionRule from './components/landing/SectionRule.jsx';
import Reveal from './components/Reveal.jsx';
import IndexRow, { cardId } from './components/IndexRow.jsx';
import { appPath } from './appRoute.js';
import ConceptPreview from './components/ConceptPreview.jsx';
import VerifiedNote, { UnverifiedBadge } from './components/VerifiedNote.jsx';
import { showPeople } from './flags.js';
import { CardGridSkeleton } from './components/Skeletons.jsx';
import { peek } from './peek.js';
import { HIRING_SAMPLE, LANDING_LISTS_SHOWN as LISTS_SHOWN, LANDING_LISTS as FILTER_LISTS } from './snapshotRequests.js';
import './landing.css';
import './landing-hero.css';

// Only the startup-filtering lists fit this showcase (a list of people has no company count and is not a live filter),
// and the page shows the first six, so it asks for the counts of those six and no more (snapshotRequests.js).

// The companies that are hiring now, asked for once (enough to name some in most capitals in the hero's picture; HIRING_SAMPLE). The
// section shows six cards, and six more each time "Load more" is pressed.
const HIRING_AT_FIRST = 6;
const HIRING_STEP = 6;

// How many of those worth following the page shows: three people, or three firms while no person is listed.
const PEOPLE_CARDS = 3;

// The server's counts, in the order the lists were asked in, by the list they are of; one it did not send is 0.
const countsByList = ({ counts: found }) => Object.fromEntries(FILTER_LISTS.map((list, i) => [list.id, found[i] ?? 0]));

// The sections, in the order they run and under the numbers the page always gives them: 01 Map, 02 People, 03 Lists, 04 How we verify.
// A section the page has nothing for (no people and no firms) is not drawn, and the numbers after it close the gap.
export function sectionNumbers({ people }) {
  const ids = ['map', ...(people ? ['people'] : []), 'lists', 'verify'];
  return (id) => ids.indexOf(id) + 1;
}

// The page asks for what it shows (counts, the companies that are hiring, the map's pins), never for every company.
export default function LandingPage() {
  // What the snapshot already holds is what the first paint has (peek.js), so the figures, the cards and the picture are there at once and
  // nothing moves when the server's answers come; with no snapshot the page starts empty, as before.
  const [first] = useState(() => ({
    stats: peek.summary({}),
    hiring: peek.startupPage({ hiring: 'yes' }, { limit: HIRING_SAMPLE, sort: 'file' }),
    pins: peek.markers({}),
    counts: peek.counts(FILTER_LISTS.map((list) => list.filters)),
  }));
  const [stats, setStats] = useState(first.stats);
  const [hiringSample, setHiringSample] = useState(first.hiring?.results ?? []);
  const [hiringLoading, setHiringLoading] = useState(!first.hiring); // until the companies hiring now arrive (or fail to): cards' placeholders show
  const [shownHiring, setShownHiring] = useState(HIRING_AT_FIRST);
  const [markers, setMarkers] = useState(first.pins?.items ?? []);
  const [areas, setAreas] = useState(first.pins?.areas ?? []);
  const [counts, setCounts] = useState(() => (first.counts ? countsByList(first.counts) : {}));
  const [people, setPeople] = useState([]);
  const [firms, setFirms] = useState([]);

  const peopleOn = showPeople(); // VITE_SHOW_PEOPLE (flags.js): without it the page asks for no person and no firm, and has no People section

  // Each question is asked of the API, and answered at once from the snapshot file when it holds the answer (api.js, snapshot.js): the page
  // draws its first screen without waiting on the API server, which the answer then replaces (or confirms).
  useEffect(() => {
    const applyHiring = ({ results }) => { setHiringSample(results); setHiringLoading(false); };
    const applyMarkers = ({ items, areas: groups }) => { setMarkers(items); setAreas(groups ?? []); };
    const applyCounts = (answer) => setCounts(countsByList(answer));
    fetchSummary({}, { onSnapshot: setStats }).then(setStats).catch(() => {});
    // The people worth following, if the owner has listed any. With none, the section shows the firms published in the investor
    // directory instead: real, checked, and the same card.
    if (peopleOn) {
      fetchPeople({}, { limit: PEOPLE_CARDS })
        .then(({ results }) => {
          setPeople(results ?? []);
          if ((results ?? []).length === 0) return fetchInstitutions({}, { limit: PEOPLE_CARDS }).then((found) => setFirms(found.results ?? []));
          return undefined;
        })
        .catch(() => {});
    }
    fetchStartupPage({ hiring: 'yes' }, { limit: HIRING_SAMPLE, sort: 'file', onSnapshot: applyHiring }).then(applyHiring).catch(() => setHiringLoading(false));
    fetchMarkers({}, { onSnapshot: applyMarkers }).then(applyMarkers).catch(() => {});
    // Every list's count in one request, not one each; a count that could not be had is 0, as before (the page reads a missing one as 0).
    fetchCounts(FILTER_LISTS.map((list) => list.filters), { onSnapshot: applyCounts }).then(applyCounts).catch(() => {});
  }, [peopleOn]);

  const hasPeopleSection = peopleOn && (people.length > 0 || firms.length > 0);
  const numberOf = sectionNumbers({ people: hasPeopleSection });
  const hiringCount = stats?.hiring ?? 0;
  const listCounts = FILTER_LISTS.map((list) => ({ ...list, count: counts[list.id] ?? 0 }));
  const hiringShown = hiringSample.slice(0, shownHiring);

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
                  ? `${hiringCount} ${hiringCount === 1 ? 'company has' : 'companies have'} open roles confirmed on ${hiringCount === 1 ? 'its' : 'their'} own job pages in the last 14 days.`
                  : 'A company is listed as hiring now once a job page of its own has confirmed its open roles within the last 14 days.'}
              </p>
            </Reveal>
          </div>
          {hiringShown.length === 0 && hiringLoading && (
            <div className="l-grid">
              <CardGridSkeleton className="landing-job-grid" count={HIRING_AT_FIRST} />
            </div>
          )}
          {hiringShown.length > 0 && (
            <div className="l-grid">
              <IndexRow items={hiringShown.map((s) => ({ id: cardId('hiring', s.slug || s.name), name: s.name }))} what="the companies hiring" />
              <div className="landing-job-grid">
                {hiringShown.map((s, i) => (
                  <Reveal index={i % HIRING_STEP} key={s.slug || s.name}>
                    <EntityCard
                      as="a"
                      level={3}
                      className="landing-job-card"
                      id={cardId('hiring', s.slug || s.name)}
                      href={appPath({ kind: 'startup', slug: s.slug || s.name })}
                      avatar={<Avatar name={s.name} website={s.website} />}
                      name={s.name}
                      aside={<UnverifiedBadge company={s} />}
                      blurb={s.blurb}
                      meta={[s.sectorFull || s.sector, s.stage, s.city]}
                    >
                      <ConceptPreview company={s} />
                      <VerifiedNote at={s.last_verified_at} />
                    </EntityCard>
                  </Reveal>
                ))}
              </div>
            </div>
          )}
          <div className="landing-block-foot landing-block-actions">
            {hiringSample.length > shownHiring && (
              <button type="button" className="landing-btn-secondary landing-more" onClick={() => setShownHiring((n) => n + HIRING_STEP)}>
                Load more <span className="landing-more-count">({hiringSample.length - shownHiring} left)</span>
              </button>
            )}
            <a className="landing-inline-link" href={appPath({ kind: 'jobs' })}>See every open role →</a>
          </div>
        </section>

        {hasPeopleSection && (
          <section className="landing-section" aria-labelledby="people-title">
            <SectionRule number={numberOf('people')} name="People" />
            <div className="l-grid landing-section-head">
              <Reveal as="h2" id="people-title">{people.length ? 'People worth following.' : 'People and firms worth following.'}</Reveal>
              <Reveal className="landing-section-text" index={1}>
                <p>
                  {people.length
                    ? 'Founders, operators and investors in Australian startups, each with the pages behind it.'
                    : 'The firms backing Australian startups, each with the pages behind it.'}
                </p>
              </Reveal>
            </div>
            <div className="l-grid">
              <IndexRow
                items={people.length
                  ? people.map((p) => ({ id: cardId('person', p.id), name: p.name }))
                  : firms.map((f) => ({ id: cardId('institution', f.id), name: f.name }))}
                what={people.length ? 'the people listed' : 'the firms listed'}
              />
              <ul className="landing-people-grid">
                {people.length > 0
                  ? people.map((p, i) => <Reveal as="li" index={i} key={p.id}><PersonCard as="div" level={3} person={p} /></Reveal>)
                  : firms.map((f, i) => <Reveal as="li" index={i} key={f.id}><InstitutionCard as="div" level={3} institution={f} /></Reveal>)}
              </ul>
            </div>
            <p className="landing-block-foot"><a className="landing-inline-link" href={appPath({ kind: 'people' })}>See everyone →</a></p>
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
            <IndexRow items={listCounts.map((list) => ({ id: cardId('list', list.id), name: list.name }))} what="the curated lists" max={LISTS_SHOWN} />
            <div className="landing-list-grid">
              {listCounts.map((list, i) => (
                <Reveal index={i % 3} key={list.id}>
                  <a className="landing-list-card" id={cardId('list', list.id)} href={appPath({ kind: 'list', slug: list.id })}>
                    <h3 className="landing-list-name">{list.name}</h3>
                    <div className="landing-list-desc">{list.description}</div>
                    <div className="landing-list-count">{list.count} companies</div>
                  </a>
                </Reveal>
              ))}
            </div>
          </div>
          <p className="landing-block-foot"><a className="landing-inline-link" href={appPath({ kind: 'lists' })}>Open curated lists →</a></p>
        </section>

        <section className="landing-section landing-trust" id="verify" aria-labelledby="verify-title">
          <SectionRule number={numberOf('verify')} name="How we verify" />
          <div className="l-grid landing-section-head">
            <Reveal as="h2" id="verify-title">Reviewed before it is published.</Reveal>
            <Reveal className="landing-section-text" index={1}>
              <dl className="verify-list">
                <div>
                  <dt>Where it comes from</dt>
                  <dd>Company websites, careers pages and press. Every company links to the pages behind it.</dd>
                </div>
                <div>
                  <dt>What &ldquo;hiring now&rdquo; means</dt>
                  <dd>A job board or structured postings on the company&rsquo;s own page confirmed its open roles in the last 14 days. Older readings show their date; a company nobody has read says &ldquo;Roles unverified&rdquo;.</dd>
                </div>
                <div>
                  <dt>Who reviews it</dt>
                  <dd>A person reviews every submission before it changes the map. Where only a city is known, the pin says so.</dd>
                </div>
              </dl>
            </Reveal>
          </div>
        </section>

        <section className="landing-final-cta">
          <Reveal as="h2">Start exploring.</Reveal>
          <Reveal className="landing-cta-row" index={1}>
            <a className="landing-btn-primary" href="/">Explore the map</a>
            <a className="landing-btn-secondary" href="/?view=waitlist">Join waitlist</a>
          </Reveal>
        </section>
      </main>

      <LandingFooter />
    </div>
  );
}
