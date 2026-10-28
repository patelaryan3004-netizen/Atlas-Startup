import { useEffect, useState } from 'react';
import SiteHeader from '../brand/SiteHeader.jsx';
import { EmptyState } from '../brand/parts.jsx';
import { fetchMember } from '../../networkApi.js';
import { ensureStatus, useSession } from '../../session.js';
import { useSavedKind } from '../../savedStore.js';
import { usePageMeta } from '../../hooks/usePageMeta.js';
import { BookmarkIcon, ExternalIcon, PencilIcon } from '../explore/icons.jsx';
import MemberAvatar from './MemberAvatar.jsx';
import PostCard from './PostCard.jsx';

export const OPEN_TO_LABELS = { collaborators: 'Collaborators', work: 'Work', feedback: 'Feedback', conversations: 'Conversations' };

// A link a member put on their own profile. Opened in a new tab, and said so.
export function OutLink({ href, children }) {
  return (
    <a className="mp-link" href={href} target="_blank" rel="noopener noreferrer">
      <span>{children}</span><ExternalIcon size={16} /><span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

// What a member's profile says: who they are, what they are building, where to see their work and what they are open to. It is what the member wrote:
// nobody at Still Early has checked it, and the page says so.
export function ProfileBody({ member, posts = [], mine = false, onEdit, onPostRemoved }) {
  const saves = useSavedKind('member');
  const links = [['Website', member.links.website], ['Professional profile', member.links.professional_profile]].filter(([, url]) => url);
  return (
    <article className="mp" aria-labelledby="mp-name">
      <header className="mp-head">
        <MemberAvatar name={member.name} size="xl" />
        <div className="mp-id">
          <h1 id="mp-name" className="serif-h1">{member.name}</h1>
          <p className="mp-sub">{[member.role, member.city].filter(Boolean).join(' · ') || (mine ? 'Add your role and city to your profile.' : '')}</p>
          <p className="mp-meta">Member since {new Date(`${member.joined_at}-01T12:00:00Z`).toLocaleDateString('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</p>
        </div>
        <div className="mp-actions">
          {mine ? (
            <button type="button" className="btn btn-secondary" onClick={onEdit}><PencilIcon size={18} />Edit profile</button>
          ) : (
            <button type="button" className="btn btn-secondary" aria-pressed={saves.has(member.id)} onClick={() => saves.toggle(member.id)}>
              <BookmarkIcon size={18} fill={saves.has(member.id) ? 'currentColor' : 'none'} />{saves.has(member.id) ? 'Saved' : 'Save'}
            </button>
          )}
        </div>
      </header>

      {member.intro && <section className="mp-sec" aria-label="Introduction"><p className="mp-intro">{member.intro}</p></section>}

      {member.open_to.length > 0 && (
        <section className="mp-sec" aria-labelledby="mp-open">
          <h2 id="mp-open" className="mp-h">Open to</h2>
          <ul className="mp-chips">{member.open_to.map((o) => <li key={o} className="mp-chip">{OPEN_TO_LABELS[o] ?? o}</li>)}</ul>
        </section>
      )}

      {member.building.length > 0 && (
        <section className="mp-sec" aria-labelledby="mp-building">
          <h2 id="mp-building" className="mp-h">Building and worked on</h2>
          <ul className="mp-projects">
            {member.building.map((p) => (
              <li key={`${p.title}-${p.url}`} className="mp-project">
                <div className="mp-project-title">{p.url ? <OutLink href={p.url}>{p.title}</OutLink> : <span>{p.title}</span>}</div>
                {p.note && <p>{p.note}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {links.length > 0 && (
        <section className="mp-sec" aria-labelledby="mp-links">
          <h2 id="mp-links" className="mp-h">Find them</h2>
          <ul className="mp-linklist">{links.map(([label, url]) => <li key={label}><OutLink href={url}>{label}</OutLink></li>)}</ul>
        </section>
      )}

      {!member.intro && !member.building.length && !links.length && !member.open_to.length && (
        <p className="mp-empty">{mine ? 'Your profile is still empty. A short introduction and one project is a good start.' : 'This member has not added anything to their profile yet.'}</p>
      )}

      {posts.length > 0 && (
        <section className="mp-sec" aria-labelledby="mp-posts">
          <h2 id="mp-posts" className="mp-h">Recent posts</h2>
          <ul className="home-feed">{posts.map((post) => <li key={post.id}><PostCard post={post} onRemoved={onPostRemoved} /></li>)}</ul>
        </section>
      )}

      <p className="home-fine">This profile is what {mine ? 'you have' : 'the member has'} written. Still Early has not checked it, and a profile is not a reference, an endorsement or a promise of an introduction.</p>
    </article>
  );
}

// A member's public page, at /members/<id>.
export default function MemberProfile({ id, chrome = {}, onEdit }) {
  const { member: me } = useSession();
  const [state, setState] = useState({ status: 'loading' });
  usePageMeta({ title: state.member ? `${state.member.name} · Still Early` : 'Member · Still Early', path: `/members/${id}` });
  useEffect(() => { ensureStatus(); }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    setState({ status: 'loading' });
    fetchMember(id, { signal: ctrl.signal })
      .then((res) => { if (!ctrl.signal.aborted) setState({ status: 'ready', member: res.member, posts: res.posts }); })
      .catch((err) => {
        if (ctrl.signal.aborted || err.name === 'AbortError') return;
        setState({ status: err.status === 404 ? 'missing' : err.code === 'network_unavailable' ? 'closed' : 'error', message: err.message });
      });
    return () => ctrl.abort();
  }, [id, me?.id]);

  return (
    <div id="profileView" className="page-shell">
      <SiteHeader active="home" go={chrome.go} counts={chrome.counts} menu={chrome.menu} />
      <main className="home" id="main">
        {state.status === 'loading' && <p className="home-quiet" role="status">Loading…</p>}
        {state.status === 'missing' && <EmptyState title="This member is not here.">The link may be mistyped, or they may have left.</EmptyState>}
        {state.status === 'closed' && <EmptyState title="The community is not open yet.">Profiles open when the community does.</EmptyState>}
        {state.status === 'error' && <EmptyState title="Could not load this profile.">{state.message}</EmptyState>}
        {state.status === 'ready' && (
          <ProfileBody
            member={state.member}
            posts={state.posts}
            mine={me?.id === state.member.id}
            onEdit={onEdit}
            onPostRemoved={(postId) => setState((s) => ({ ...s, posts: s.posts.filter((p) => p.id !== postId) }))}
          />
        )}
      </main>
    </div>
  );
}
