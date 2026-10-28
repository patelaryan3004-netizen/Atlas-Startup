import { useEffect, useState } from 'react';
import SiteHeader from '../brand/SiteHeader.jsx';
import { EmptyState } from '../brand/parts.jsx';
import { linkProps } from '../brand/nav.js';
import { fetchInvestors, fetchStartupsByName } from '../../api.js';
import { fetchEvents, fetchFeed, fetchJobs, fetchMembers } from '../../networkApi.js';
import { ensureStatus, useSession } from '../../session.js';
import { openAuth } from '../../authUi.js';
import { useSavedKind } from '../../savedStore.js';
import { usePageMeta } from '../../hooks/usePageMeta.js';
import { BookmarkIcon, ExternalIcon } from '../explore/icons.jsx';
import PostCard from './PostCard.jsx';
import { eventWhen } from './time.js';

// One saved thing as a row: what it is, a way back to it, and the bookmark that takes it off the list.
function Row({ title, sub, href, external = false, onRemove, removeLabel }) {
  return (
    <li className="sv-row">
      <div className="sv-text">
        {href ? (
          external
            ? <a className="sv-title" href={href} target="_blank" rel="noopener noreferrer">{title}<ExternalIcon size={14} /><span className="sr-only"> (opens in a new tab)</span></a>
            : <a className="sv-title" {...linkProps(href)}>{title}</a>
        ) : <span className="sv-title">{title}</span>}
        {sub && <span className="sv-sub">{sub}</span>}
      </div>
      <button type="button" className="bm" aria-pressed="true" aria-label={removeLabel} onClick={onRemove}><BookmarkIcon size={22} fill="currentColor" /></button>
    </li>
  );
}

// A section of the saved page: the saved things of one kind, looked up by what was kept (names, addresses, ids) when the page opens.
function Section({ title, kind, saved, load, render }) {
  const { items, toggle } = saved;
  const [rows, setRows] = useState(null);
  const key = items.join('\n');
  useEffect(() => {
    let live = true;
    setRows(null);
    load(items).then((found) => { if (live) setRows(found); }, () => { if (live) setRows([]); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const gone = rows ? Math.max(0, items.length - rows.length) : 0;
  return (
    <section className="sv-sec" aria-labelledby={`sv-${kind}`}>
      <h2 id={`sv-${kind}`} className="mp-h">{title}<span className="sv-n">{items.length}</span></h2>
      {rows === null ? <p className="home-quiet" role="status">Loading…</p> : (
        <>
          <ul className={kind === 'post' ? 'home-feed' : 'sv-list'}>{rows.map((row) => render(row, toggle))}</ul>
          {gone > 0 && (
            <p className="sv-gone">
              {gone} saved {gone === 1 ? 'item is' : 'items are'} no longer listed (it may be over, closed or removed).{' '}
              <button type="button" className="mp-link" onClick={() => items.filter((k) => !rows.some((r) => [r.id, r.slug, r.name].includes(k))).forEach((k) => toggle(k))}>Clear {gone === 1 ? 'it' : 'them'}</button>
            </p>
          )}
        </>
      )}
    </section>
  );
}

// What you saved, under your avatar. Signed out, startups, investors, jobs and events are kept in this browser; signed in, everything is kept with your account
// and is the same on every device, and posts and people can be saved too. Only the kinds that have something in them are shown.
export default function SavedPage({ chrome = {} }) {
  const { member, open } = useSession();
  const kinds = {
    startup: useSavedKind('startup'), investor: useSavedKind('investor'), job: useSavedKind('job'), event: useSavedKind('event'), member: useSavedKind('member'), post: useSavedKind('post'),
  };
  usePageMeta({ title: 'Saved · Still Early', path: '/saved' });
  useEffect(() => { ensureStatus(); }, []);

  const sections = [
    {
      kind: 'startup', title: 'Startups', load: async (names) => (await fetchStartupsByName(names)).results,
      render: (c, toggle) => <Row key={c.slug} title={c.name} sub={[c.city, c.sector].filter(Boolean).join(' · ')} href={`/startup/${c.slug}`} onRemove={() => toggle(c.name)} removeLabel={`Remove ${c.name} from saved`} />,
    },
    {
      kind: 'investor', title: 'Investors', load: async (slugs) => (await fetchInvestors({ slug: slugs.join(',') }, { limit: 100 })).results,
      render: (i, toggle) => <Row key={i.slug} title={i.name} sub={[i.type_label, i.location?.label].filter(Boolean).join(' · ')} href={`/investors/${i.slug}`} onRemove={() => toggle(i.slug)} removeLabel={`Remove ${i.name} from saved`} />,
    },
    {
      kind: 'job', title: 'Jobs', load: async (ids) => (await fetchJobs({ ids, limit: 100, include_closed: 'yes' })).results,
      render: (j, toggle) => <Row key={j.id} title={`${j.title}, ${j.company.name}`} sub={j.location || 'Location not stated'} href={j.apply_url} external onRemove={() => toggle(j.id)} removeLabel={`Remove ${j.title} from saved`} />,
    },
    {
      kind: 'event', title: 'Events', load: async (ids) => (await fetchEvents({ ids, limit: 100 })).results,
      render: (e, toggle) => <Row key={e.id} title={e.name} sub={`${eventWhen(e).date}${e.city ? `, ${e.city}` : ''}`} href="/events" onRemove={() => toggle(e.id)} removeLabel={`Remove ${e.name} from saved`} />,
    },
    {
      kind: 'member', title: 'People', load: async (ids) => (await fetchMembers({ ids, limit: 50 })).results,
      render: (m, toggle) => <Row key={m.id} title={m.name} sub={[m.role, m.city].filter(Boolean).join(' · ')} href={`/members/${m.id}`} onRemove={() => toggle(m.id)} removeLabel={`Remove ${m.name} from saved`} />,
    },
    {
      kind: 'post', title: 'Bookmarked posts', load: async (ids) => (await fetchFeed({ ids, limit: 50 })).results,
      render: (p) => <li key={p.id}><PostCard post={p} onRemoved={() => {}} /></li>,
    },
  ];
  const filled = sections.filter((s) => kinds[s.kind].items.length > 0);
  const empty = sections.filter((s) => kinds[s.kind].items.length === 0 && (member || (s.kind !== 'member' && s.kind !== 'post')));

  return (
    <div id="savedView" className="page-shell">
      <SiteHeader active={null} go={chrome.go} counts={chrome.counts} menu={chrome.menu} />
      <main className="disc" id="main">
        <header className="disc-head">
          <p className="kicker">Saved</p>
          <h1 className="serif-h1">Your <em>shortlist.</em></h1>
          {member ? (
            <p className="lede">Kept with your account, so it is the same on every device.</p>
          ) : (
            <p className="lede">
              Kept in this browser only.{' '}
              {open === false ? 'Accounts open when the community does.' : <><button type="button" className="mp-link" onClick={() => openAuth({ mode: 'signup' })}>Join or sign in</button> to keep it on every device and to save posts and people.</>}
            </p>
          )}
        </header>

        {filled.length === 0 && (
          <EmptyState title="Nothing saved yet.">
            Use the bookmark on a startup, an investor, a role or an event to keep it here{member ? ', or on a post or a person' : ''}.
          </EmptyState>
        )}
        {filled.map((s) => <Section key={s.kind} title={s.title} kind={s.kind} saved={kinds[s.kind]} load={s.load} render={s.render} />)}
        {filled.length > 0 && empty.length > 0 && <p className="sv-empty">Nothing saved yet under {empty.map((s) => s.title.toLowerCase()).join(', ')}.</p>}
        {!member && open !== false && <p className="sv-empty">Posts and people can only be saved with an account.</p>}
      </main>
    </div>
  );
}
