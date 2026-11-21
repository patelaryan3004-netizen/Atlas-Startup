import { useEffect, useState } from 'react';
import { fetchStartupPage } from '../../api.js';
import { fetchMembers } from '../../networkApi.js';
import { useSession } from '../../session.js';
import { linkProps } from '../brand/nav.js';
import { Badge, EmptyState, VcBadge } from '../brand/parts.jsx';
import { Avatar } from '../EntityCard.jsx';
import { ArrowRight } from '../explore/icons.jsx';
import MemberAvatar from '../network/MemberAvatar.jsx';
import { eventWhen } from '../network/time.js';
import { freshOf, freshText } from '../../freshness.js';
import { COLLECTIONS, collectionHref } from './collections.js';
import { EVENT_WORDS, labelOf } from './intents.js';
import { foundersOf } from './useCommunity.js';

// The pieces the Community page is built from. Each reads real records (the directory, the hiring desk, the events list, the members' side) and says in a line what it is made of; none is a
// ranking, a recommendation by the site, or an endorsement. A block that has nothing says so.

// One block: a heading in the serif, the rule that fills it in words, and where the whole list is. A block is a heading and rows, never a card inside a card.
export function Block({ id, title, rule, href, more = 'See all', onMore, children }) {
  return (
    <section className="cm-block" aria-labelledby={`cm-${id}`}>
      <header className="cm-block-head">
        <div>
          <h2 id={`cm-${id}`} className="cm-h2">{title}</h2>
          {rule && <p className="cm-rule">{rule}</p>}
        </div>
        {(href || onMore) && <a className="cm-more" {...linkProps(href ?? '#', onMore)}>{more} <ArrowRight size={16} /></a>}
      </header>
      {children}
    </section>
  );
}

const sub = (c) => [c.sectorGroup ?? c.sector, c.city, c.stage && c.stage !== 'Unknown' ? c.stage : null].filter(Boolean).join(' · ');

// Companies as rows: the logo (or the first letter), the name, what it is, whether it is hiring. Opens the company's own page.
export function CompanyRows({ companies, limit = 6, extra }) {
  return (
    <ul className="cm-rows" aria-label="Companies">
      {(companies ?? []).slice(0, limit).map((c) => (
        <li key={c.slug ?? c.id} className="cm-row">
          <a className="cm-row-main" {...linkProps(`/startup/${encodeURIComponent(c.slug ?? c.id)}`)}>
            <Avatar name={c.name} website={c.website} size={44} className="cm-logo" />
            <span className="cm-row-text">
              <span className="cm-row-name">{c.name}{c.hiring && <Badge tone="green">Hiring</Badge>}{extra?.(c)}</span>
              <span className="cm-row-sub">{c.blurb || sub(c)}</span>
              {c.blurb && <span className="cm-row-meta">{sub(c)}</span>}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

function useFirstPage(filters, { limit = 12, sort = 'pictures', enabled = true } = {}) {
  const key = JSON.stringify(filters);
  const [state, setState] = useState({ status: enabled ? 'loading' : 'idle', results: [], total: 0, error: '' });
  useEffect(() => {
    if (!enabled) return undefined;
    const ctrl = new AbortController();
    setState((s) => ({ ...s, status: 'loading' }));
    fetchStartupPage(filters, { limit, sort, signal: ctrl.signal })
      .then((res) => { if (!ctrl.signal.aborted) setState({ status: 'ready', results: res.results ?? [], total: res.total ?? res.count ?? 0, error: '' }); })
      .catch((err) => { if (!ctrl.signal.aborted && err.name !== 'AbortError') setState({ status: 'error', results: [], total: 0, error: err.message }); });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, limit, sort, enabled]);
  return state;
}

const Loading = ({ what }) => <p className="cm-quiet" role="status">Loading {what}…</p>;
const Failed = ({ what, error }) => <p className="form-error" role="alert">Could not load {what}. {error}</p>;

// Products being built in Australia: verified companies in the directory, those with a picture first. It is the directory, not a ranking.
export function ProductsBlock({ resource, limit = 5, full = false, onMore }) {
  const [sector, setSector] = useState('');
  const own = useFirstPage({ sector }, { limit: 12, enabled: full && Boolean(sector) });
  const items = full && sector ? own : { status: resource.status, results: resource.data?.results ?? [], error: resource.error };
  return (
    <Block id="products" title="Products being built in Australia" rule="Verified companies in the directory, those with a picture first. This is the directory, not a ranking." href="/discover" more="Open Discover" onMore={full ? undefined : onMore}>
      {full && <SectorChips value={sector} onChange={setSector} />}
      {items.status === 'loading' && <Loading what="companies" />}
      {items.status === 'error' && <Failed what="companies" error={items.error} />}
      {items.status === 'ready' && items.results.length === 0 && <EmptyState title="No company matches.">Try another sector.</EmptyState>}
      {items.status === 'ready' && <CompanyRows companies={items.results} limit={full ? 12 : limit} />}
    </Block>
  );
}

const SECTORS = ['AI & Data', 'Software & DevTools', 'Cybersecurity', 'Fintech', 'Health & Biotech', 'Climate & Energy', 'Food & Agriculture', 'Consumer & Commerce', 'Education', 'Property & Construction', 'Industrial & Logistics', 'Deep Tech & Space'];
function SectorChips({ value, onChange }) {
  return (
    <div className="cm-chips cm-chips-scroll" role="group" aria-label="Sector">
      <button type="button" className="cm-chip" aria-pressed={!value} onClick={() => onChange('')}>All sectors</button>
      {SECTORS.map((s) => <button key={s} type="button" className="cm-chip" aria-pressed={value === s} onClick={() => onChange(s)}>{s}</button>)}
    </div>
  );
}

// New in the directory: companies added in the last week (the directory's own rule: freshness.js). Often few, sometimes none, and it says which.
export function NewBlock({ resource, limit = 4 }) {
  const items = (resource.data?.results ?? []).map((c) => ({ c, fresh: freshOf(c) })).filter((x) => x.fresh && freshText(x.fresh));
  return (
    <Block id="new" title="New in the directory" rule="Companies added or newly verified in the last week. The newest first is not a sign of quality." href="/discover?fresh=week" more="See them in Discover">
      {resource.status === 'loading' && <Loading what="new companies" />}
      {resource.status === 'error' && <Failed what="new companies" error={resource.error} />}
      {resource.status === 'ready' && items.length === 0 && <p className="cm-quiet">Nothing was added this week.</p>}
      {items.length > 0 && <CompanyRows companies={items.map((x) => x.c)} limit={limit} extra={(c) => { const f = items.find((x) => x.c === c)?.fresh; return f ? <span className="cm-fresh">{freshText(f)}</span> : null; }} />}
    </Block>
  );
}

// The companies on the hiring desk, one row each, in alphabetical order (not a ranking), from the roles the desk read from each company's own job page.
export function hiringCompanies(roles) {
  const by = new Map();
  for (const r of roles ?? []) {
    const key = r.company.slug ?? r.company.name;
    const row = by.get(key) ?? { company: r.company, roles: 0, places: new Set() };
    row.roles += 1;
    for (const c of r.work?.cities ?? []) row.places.add(c);
    by.set(key, row);
  }
  return [...by.values()].sort((a, b) => a.company.name.localeCompare(b.company.name));
}

// Who is hiring: companies whose own job page lists an open role.
export function HiringBlock({ resource, limit = 4 }) {
  const rows = hiringCompanies(resource.data?.results).slice(0, limit);
  return (
    <Block id="hiring" title="Startups hiring now" rule="Companies whose own job page lists an open role, read by the hiring desk twice a day. In alphabetical order, not a ranking." href="/jobs" more="Open the hiring desk">
      {resource.status === 'loading' && <Loading what="hiring companies" />}
      {resource.status === 'error' && <Failed what="hiring companies" error={resource.error} />}
      {resource.status === 'ready' && rows.length === 0 && <p className="cm-quiet">No company has an open role on the hiring desk at the moment.</p>}
      <ul className="cm-rows">
        {rows.map(({ company: c, roles, places }) => (
          <li key={c.slug ?? c.name} className="cm-row">
            <a className="cm-row-main" {...linkProps(c.slug ? `/startup/${encodeURIComponent(c.slug)}` : '/jobs')}>
              <Avatar name={c.name} website={c.website} size={44} className="cm-logo" />
              <span className="cm-row-text"><span className="cm-row-name">{c.name}<Badge tone="green">Hiring</Badge></span><span className="cm-row-sub">{roles} open role{roles === 1 ? '' : 's'}{places.size ? ` \u00b7 ${[...places].join(', ')}` : ''}</span></span>
            </a>
          </li>
        ))}
      </ul>
    </Block>
  );
}

// The newest roles on the hiring desk. Each links to the employer's own application page.
export function RolesBlock({ resource, limit = 5 }) {
  // One role from each company, so a few companies with many roles do not fill the block.
  const seen = new Set();
  const roles = (resource.data?.results ?? []).filter((r) => { const k = r.company.slug ?? r.company.name; if (seen.has(k)) return false; seen.add(k); return true; });
  return (
    <Block id="roles" title="Open roles at Australian startups" rule="One role from each of a few companies, from the employer's own job page, checked twice a day. A role opens on the employer's site, not ours." href="/jobs" more="See every role">
      {resource.status === 'loading' && <Loading what="roles" />}
      {resource.status === 'error' && <Failed what="roles" error={resource.error} />}
      {resource.status === 'ready' && roles.length === 0 && <p className="cm-quiet">No role is listed at the moment.</p>}
      <ul className="cm-rows">
        {roles.slice(0, limit).map((r) => (
          <li key={r.id} className="cm-row">
            <a className="cm-row-main" href={r.apply_url} rel="noopener noreferrer" target="_blank">
              <Avatar name={r.company.name} website={r.company.website} size={44} className="cm-logo" />
              <span className="cm-row-text"><span className="cm-row-name">{r.title}</span><span className="cm-row-sub">{r.company.name} · {r.location}</span></span>
            </a>
          </li>
        ))}
      </ul>
    </Block>
  );
}

// People named on public pages. They are not members, and the page says so on every one: a founder here is only someone a company's own page names.
export function PersonRow({ name, line, badge, href, onOpen }) {
  const inner = (<><MemberAvatar name={name} size="md" /><span className="cm-row-text"><span className="cm-row-name">{name}{badge}</span><span className="cm-row-sub">{line}</span></span></>);
  return <li className="cm-row">{href ? <a className="cm-row-main" {...linkProps(href, onOpen)}>{inner}</a> : <div className="cm-row-main">{inner}</div>}</li>;
}
export const DirectoryTag = () => <Badge tone="quiet">Directory, not a member</Badge>;

export function FoundersBlock({ resource, limit = 6 }) {
  const people = foundersOf(resource.data?.results, limit);
  return (
    <Block id="founders" title="Founders in the directory" rule="Founders named on the public page of a verified company. They have not joined the Community, and there is no way to message them from here." href="/discover/people" more="Open People">
      {resource.status === 'loading' && <Loading what="founders" />}
      {resource.status === 'error' && <Failed what="founders" error={resource.error} />}
      {resource.status === 'ready' && people.length === 0 && <p className="cm-quiet">No founder is named on the companies shown.</p>}
      <ul className="cm-rows">{people.map((p) => <PersonRow key={`${p.company}-${p.name}`} name={p.name} line={`Founder, ${p.company}`} badge={<DirectoryTag />} href={`/startup/${encodeURIComponent(p.slug)}`} />)}</ul>
    </Block>
  );
}

// Published investor firms. VC marks them, as everywhere on the site.
export function InvestorsBlock({ resource, limit = 5 }) {
  const firms = resource.data?.results ?? [];
  return (
    <Block id="investors" title="Investors in the directory" rule="Investor firms whose pages a person has checked and published. What they say about stage and sector comes from their own pages." href="/investors" more="Open Investors">
      {resource.status === 'loading' && <Loading what="investors" />}
      {resource.status === 'error' && <Failed what="investors" error={resource.error} />}
      <ul className="cm-rows">
        {firms.slice(0, limit).map((f) => (
          <li key={f.slug} className="cm-row">
            <a className="cm-row-main" {...linkProps(`/investors/${encodeURIComponent(f.slug)}`)}>
              <Avatar name={f.name} domain={f.domain} size={44} className="cm-logo" />
              <span className="cm-row-text"><span className="cm-row-name">{f.name}<VcBadge /></span><span className="cm-row-sub">{[f.type_label, f.stages?.length ? `Invests at ${f.stages.join(', ')}` : null].filter(Boolean).join(' · ')}</span></span>
            </a>
          </li>
        ))}
      </ul>
    </Block>
  );
}

// Collections: a question put to the directory, the rule in words, and the server's own count.
export function ListsBlock({ counts }) {
  return (
    <Block id="lists" title="Curated collections" rule="Each is a filter on the directory, with the rule beside it. They are not ranked, and the number is the directory's own count." href="/lists" more="More lists">
      <ul className="cm-rows cm-collections">
        {COLLECTIONS.map((c) => {
          const n = counts?.data?.[c.id];
          return (
            <li key={c.id} className="cm-row">
              <a className="cm-row-main cm-collection" {...linkProps(collectionHref(c))}>
                <span className="cm-row-text">
                  <span className="cm-row-name">{c.title}</span>
                  <span className="cm-row-sub">{c.rule}</span>
                </span>
                {Number.isFinite(n) && <span className="cm-num" aria-label={`${n} ${c.kind === 'investors' ? 'investors' : 'companies'}`}>{n}</span>}
              </a>
            </li>
          );
        })}
      </ul>
    </Block>
  );
}

// Upcoming events, from organisers' own pages. A choice only changes the order: an event that does not fit it is still here.
// "Tue 16 to Wed 17 Feb 2027, Times not yet announced": the date, and what is known of the time (eventWhen says when it is not known).
const whenOf = (e) => { const w = eventWhen(e); return [w.date, w.time].filter(Boolean).join(', '); };

export function EventsBlock({ resource, intent, limit = 3, rail = false }) {
  const all = resource.data?.results ?? [];
  const words = EVENT_WORDS[intent];
  const events = [...all].sort((a, b) => Number(words?.test(`${b.audience} ${b.type_label}`) ?? 0) - Number(words?.test(`${a.audience} ${a.type_label}`) ?? 0)).slice(0, limit);
  const body = (
    <>
      {resource.status === 'loading' && <Loading what="events" />}
      {resource.status === 'error' && <Failed what="events" error={resource.error} />}
      {resource.status === 'ready' && events.length === 0 && <p className="cm-quiet">No upcoming event is listed. Events are added by hand from organisers&rsquo; own pages.</p>}
      <ul className="cm-rows">
        {events.map((e) => (
          <li key={e.id} className="cm-row">
            <a className="cm-row-main" {...linkProps('/events')}>
              <span className="cm-row-text"><span className="cm-row-name">{e.name}</span><span className="cm-row-sub">{whenOf(e)}{e.city ? ` \u00b7 ${e.city}` : ''}</span>{e.audience && !rail && <span className="cm-row-meta">For {e.audience}</span>}</span>
            </a>
          </li>
        ))}
      </ul>
    </>
  );
  if (rail) return body;
  return <Block id="events" title="Upcoming events" rule={intent ? `Ordered to fit “${labelOf(intent)}” where the organiser says who it is for. None is hidden.` : 'From organisers’ own pages, added by hand.'} href="/events" more="All events">{body}</Block>;
}

// Members who chose to be listed. Only where the members' side is open; where it is not, the page says what that means.
export function MembersBlock({ limit = 6, onJoin }) {
  const { open } = useSession();
  const [state, setState] = useState({ status: 'idle', results: [], total: 0 });
  useEffect(() => {
    if (open !== true) return undefined;
    const ctrl = new AbortController();
    setState((s) => ({ ...s, status: 'loading' }));
    fetchMembers({ limit }, { signal: ctrl.signal }).then((r) => { if (!ctrl.signal.aborted) setState({ status: 'ready', results: r.results, total: r.total }); }, (e) => { if (!ctrl.signal.aborted && e.name !== 'AbortError') setState({ status: 'error', results: [], total: 0 }); });
    return () => ctrl.abort();
  }, [open, limit]);
  return (
    <Block id="members" title="Members" rule="People who joined and chose to be listed. What a profile says is what the member wrote: the site does not vouch for it." href="/discover/people" more="Open People">
      {open !== true && <ClosedNote what="Members" onJoin={onJoin} />}
      {open === true && state.status === 'loading' && <Loading what="members" />}
      {open === true && state.status === 'ready' && state.results.length === 0 && <p className="cm-quiet">No member has chosen to be listed yet.</p>}
      <ul className="cm-rows">
        {state.results.map((m) => (
          <PersonRow key={m.id} name={m.name} line={[m.role, m.city].filter(Boolean).join(' · ') || 'Member'} badge={<Badge tone="green">Member</Badge>} href={`/members/${encodeURIComponent(m.id)}`} />
        ))}
      </ul>
    </Block>
  );
}

// What a part of the page says while the members' side is closed: the fact, and the one thing a person can do about it.
export function ClosedNote({ what, onJoin }) {
  return (
    <p className="cm-closed-note">
      <strong>{what} open with the Community.</strong> Nothing can be posted or saved here until it does.
      {onJoin && <>{' '}<button type="button" className="cm-textbtn" onClick={onJoin}>Join the founding list</button></>}
    </p>
  );
}
