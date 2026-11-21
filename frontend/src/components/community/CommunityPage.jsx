import { useEffect, useRef, useState } from 'react';
import SiteHeader from '../brand/SiteHeader.jsx';
import { linkProps } from '../brand/nav.js';
import { usePageMeta } from '../../hooks/usePageMeta.js';
import { ensureStatus, useSession } from '../../session.js';
import { openAuth } from '../../authUi.js';
import IntentPicker from './IntentPicker.jsx';
import FoundingForm from './FoundingForm.jsx';
import FeedPanel from './FeedPanel.jsx';
import ProjectsPanel from './ProjectsPanel.jsx';
import { Recommended } from './Introductions.jsx';
import { Block, ClosedNote, DirectoryTag, EventsBlock, FoundersBlock, HiringBlock, InvestorsBlock, ListsBlock, MembersBlock, NewBlock, PersonRow, ProductsBlock, RolesBlock } from './blocks.jsx';
import { COLLECTIONS, collectionHref } from './collections.js';
import { planFor, readIntent, writeIntent } from './intents.js';
import { foundersOf, useCommunityData } from './useCommunity.js';

const SECTIONS = [
  { id: 'for-you', label: 'For you' },
  { id: 'people', label: 'People' },
  { id: 'projects', label: 'Projects & ideas' },
  { id: 'products', label: 'Products' },
  { id: 'lists', label: 'Curated lists' },
];
const SECTION_IDS = SECTIONS.map((s) => s.id);

const readSection = () => { const s = new URLSearchParams(window.location.search).get('section'); return SECTION_IDS.includes(s) ? s : 'for-you'; };
function writeSection(id) {
  const url = new URL(window.location.href);
  if (id === 'for-you') url.searchParams.delete('section'); else url.searchParams.set('section', id);
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

// The Community (at /home): a place to find people to build with and ways to contribute to Australia's startups.
//
// What is live today is the directory side, all of it real: the companies, founders named on their pages, investors, collections, roles and events. What needs somewhere to keep what people write
// (profiles, projects, "I'm interested", introductions, the short posts) is built and tested, and opens when the server has a disk that survives a restart; until then the page says so plainly and
// offers a founding-member list instead, which is a waiting list and nothing more.
export default function CommunityPage({ chrome = {} }) {
  const { open, member } = useSession();
  const [intent, setIntent] = useState(() => readIntent());
  const [section, setSection] = useState(() => readSection());
  const [foundingOpen, setFoundingOpen] = useState(false);
  const foundingRef = useRef(null);
  const plan = planFor(intent);
  const data = useCommunityData({ wantRoles: plan.blocks.some((b) => b === 'roles' || b === 'hiring') });

  usePageMeta({ title: 'Community · Still Early', description: 'Find people to build with and ways to contribute to Australia’s startups: products, founders, investors, projects and events.', path: '/home' });
  useEffect(() => { ensureStatus(); }, []);

  const choose = (id) => { setIntent(id); writeIntent(id); };
  const go = (id) => { setSection(id); writeSection(id); if (typeof window !== 'undefined') window.scrollTo?.({ top: document.getElementById('cm-start')?.offsetTop ?? 0, behavior: 'smooth' }); };
  const joinFounding = () => {
    setFoundingOpen(true);
    requestAnimationFrame(() => foundingRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' }));
  };
  const closed = open === false;

  const ideas = open === true
    ? <Block id="ideas" title="Ideas and discussions" rule="Short posts members wrote: ideas, questions, things they are building, requests for feedback, small wins." onMore={() => go('projects')} more="Open the discussion"><p className="cm-quiet">Open the discussion to read what members shared and to add your own.</p></Block>
    : <Block id="ideas" title="Ideas and discussions" rule="Short posts members write: ideas, questions, things they are building."><ClosedNote what="Ideas and discussions" onJoin={joinFounding} /></Block>;

  const renderBlock = (id) => {
    switch (id) {
      case 'projects': return (
        <Block key={id} id="projects" title="Projects and collaboration requests" rule="Projects members shared, newest first, with the help each is looking for. The site does not rank or vouch for any of them." onMore={() => go('projects')}>
          {open === true ? <ProjectsPanel compact limit={3} helpWanted={plan.help ?? ''} /> : <ClosedNote what="Projects and collaboration requests" onJoin={joinFounding} />}
        </Block>
      );
      case 'members': return <MembersBlock key={id} limit={5} onJoin={joinFounding} />;
      case 'ideas': return <div key={id}>{ideas}</div>;
      case 'products': return <ProductsBlock key={id} resource={data.products} limit={5} onMore={() => go('products')} />;
      case 'new': return <NewBlock key={id} resource={data.fresh} />;
      case 'hiring': return <HiringBlock key={id} resource={data.roles} />;
      case 'roles': return <RolesBlock key={id} resource={data.roles} />;
      case 'founders': return <FoundersBlock key={id} resource={data.products} />;
      case 'investors': return <InvestorsBlock key={id} resource={data.investors} />;
      case 'lists': return <ListsBlock key={id} counts={data.counts} />;
      case 'events': return <EventsBlock key={id} resource={data.events} intent={intent} />;
      default: return null;
    }
  };

  const centre = (() => {
    if (section === 'people') return (
      <>
        <MembersBlock limit={12} onJoin={joinFounding} />
        <FoundersBlock resource={data.products} limit={12} />
        <InvestorsBlock resource={data.investors} limit={6} />
      </>
    );
    if (section === 'projects') return (
      <>
        <Block id="projects" title="Projects and collaboration requests" rule="Projects members shared, newest first, with the help each is looking for. The site does not rank or vouch for any of them.">
          {open === true ? <ProjectsPanel limit={12} helpWanted={plan.help ?? ''} /> : <ClosedNote what="Projects and collaboration requests" onJoin={joinFounding} />}
        </Block>
        <Block id="ideas" title="Ideas and discussions" rule="Short posts members wrote: ideas, questions, things they are building, requests for feedback, small wins.">
          {open === true ? <FeedPanel /> : <ClosedNote what="Ideas and discussions" onJoin={joinFounding} />}
        </Block>
      </>
    );
    if (section === 'products') return <ProductsBlock resource={data.products} full />;
    if (section === 'lists') return (
      <>
        <ListsBlock counts={data.counts} />
        <InvestorsBlock resource={data.investors} limit={6} />
      </>
    );
    return (
      <>
        <section className="cm-lead" aria-label="What this choice brings">
          <p>{plan.lead}</p>
        </section>
        {plan.blocks.slice(0, 3).map(renderBlock)}
      </>
    );
  })();

  const founders = foundersOf(data.products.data?.results, 4);

  return (
    <div id="homeView" className="page-shell cm-shell">
      <SiteHeader active="home" go={chrome.go} counts={chrome.counts} menu={chrome.menu} />
      <main id="main" className="cm">
        <IntentPicker value={intent} onChange={choose} />
        <div className="cm-body" id="cm-start">
          <nav className="cm-nav" aria-label="Community sections">
            <ul>
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a href={s.id === 'for-you' ? '/home' : `/home?section=${s.id}`} aria-current={section === s.id ? 'page' : undefined} onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); go(s.id); }}>{s.label}</a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="cm-main">
            {closed && (
              <section className="cm-banner" aria-labelledby="cm-banner-h" ref={foundingRef}>
                <h2 id="cm-banner-h" className="cm-h2">The Community is not open yet.</h2>
                <p>Everything about companies, founders, investors, jobs and events below is live and real. Profiles, projects, &ldquo;I&rsquo;m interested&rdquo; and introductions are built, but they need a place that keeps what people write, and this site does not have one yet. So nothing can be posted here today, and nothing pretends to work.</p>
                <details open={foundingOpen} onToggle={(e) => setFoundingOpen(e.currentTarget.open)}>
                  <summary className="btn btn-primary">Join the founding list</summary>
                  <FoundingForm intent={intent} compact />
                </details>
              </section>
            )}
            {open === true && !member && (
              <section className="cm-banner cm-banner-open" aria-label="Join">
                <p><strong>The Community is open.</strong> Join to share a project, say you are interested in one, get matched with people and ask for introductions.</p>
                <button type="button" className="btn btn-primary" onClick={() => openAuth({ mode: 'signup', reason: 'join the Community' })}>Join</button>
              </section>
            )}
            {centre}
          </div>

          <aside className="cm-rail" aria-label="People, connections, collections and events">
            <section className="cm-rail-sec" aria-labelledby="cm-r-people">
              <h2 id="cm-r-people" className="cm-rail-h">People to meet</h2>
              {founders.length === 0 && data.products.status === 'ready' && <p className="cm-rail-note">No founder is named on the companies loaded.</p>}
              <ul className="cm-rows cm-rows-tight">
                {founders.map((p) => <PersonRow key={`${p.company}-${p.name}`} name={p.name} line={`Founder, ${p.company}`} badge={<DirectoryTag />} href={`/startup/${encodeURIComponent(p.slug)}`} />)}
              </ul>
              <p className="cm-rail-note">Named on a public company page. They have not joined, and there is no way to message them from here.</p>
            </section>
            <section className="cm-rail-sec" aria-labelledby="cm-r-conn">
              <h2 id="cm-r-conn" className="cm-rail-h">Recommended connections</h2>
              <Recommended intent={intent} />
            </section>
            <section className="cm-rail-sec" aria-labelledby="cm-r-cols">
              <h2 id="cm-r-cols" className="cm-rail-h">Curated collections</h2>
              <ul className="cm-rail-list">
                {COLLECTIONS.map((c) => (
                  <li key={c.id}><a {...linkProps(collectionHref(c))}><span>{c.title}</span>{Number.isFinite(data.counts.data?.[c.id]) && <span className="cm-num">{data.counts.data[c.id]}</span>}</a></li>
                ))}
              </ul>
            </section>
            <section className="cm-rail-sec" aria-labelledby="cm-r-ev">
              <h2 id="cm-r-ev" className="cm-rail-h">Upcoming events</h2>
              <EventsBlock resource={data.events} intent={intent} limit={3} rail />
              <a className="cm-more" {...linkProps('/events')}>All events</a>
            </section>
          </aside>
        </div>
        <p className="cm-fine">Nobody here is vetted or endorsed by Still Early. Members write their own profiles and projects, collections are filters on the directory with the rule beside each, and being a member does not promise an introduction, a co-founder or a job.</p>
      </main>
    </div>
  );
}
