import { useEffect, useRef, useState } from 'react';
import { logoUrl, isRealLogo } from '../../logo.js';
import { initialsOf, tintOf, PLACE_CARDS, confirmedWords, rowMeta, standing, whereWords, ARRANGEMENT_LABELS, TYPE_LABELS, LEVEL_LABELS } from '../../jobsBoard.js';
import { BookmarkIcon, ExternalIcon, CloseIcon, ChevronRight } from '../explore/icons.jsx';
import { useDialog } from '../../hooks/useDialog.js';
import { linkProps } from '../brand/nav.js';

const hostOf = (website) => { try { return new URL(website).hostname.replace(/^www\./, ''); } catch (e) { return null; } };

// The company's mark: its logo once that has loaded and is a real picture, and until then (or when there is none) its initials on a soft tint. The initials are always drawn
// underneath, so a logo that arrives late moves nothing.
export function CompanyMark({ name, website, size = 44 }) {
  const host = hostOf(website);
  const [state, setState] = useState('pending');
  const img = useRef(null);
  useEffect(() => { const el = img.current; if (el?.complete && el.naturalWidth > 0) setState(isRealLogo(el) ? 'loaded' : 'failed'); }, []);
  return (
    <span className="jd-mark" style={{ width: size, height: size, background: tintOf(name) }} aria-hidden="true">
      <span className="jd-mark-initials">{initialsOf(name)}</span>
      {host && state !== 'failed' && (
        <img
          ref={img} className={state === 'loaded' ? 'is-loaded' : undefined} src={logoUrl(host, size > 48 ? 96 : 64)} width={size} height={size} alt="" loading="lazy" decoding="async"
          onLoad={(e) => setState(isRealLogo(e.currentTarget) ? 'loaded' : 'failed')} onError={() => setState('failed')}
        />
      )}
    </span>
  );
}

const plural = (n, one, many) => `${n.toLocaleString('en-AU')} ${n === 1 ? one : many}`;

// The four cards: Melbourne, Sydney, Perth and Remote AU. Each shows how many open roles match, and a press narrows the list to it (a second press clears it).
export function CityCards({ counts, active, onPick }) {
  return (
    <section className="jd-tiles" aria-label="Browse by location">
      {PLACE_CARDS.map((card) => {
        const n = counts[card.id] ?? 0;
        const on = active === card.id;
        return (
          <button
            key={card.id} type="button" className={`jd-tile${on ? ' is-on' : ''}${card.outline ? ' jd-tile-outline' : ''}`} aria-pressed={on}
            aria-label={`${card.label}, ${plural(n, 'open role', 'open roles')}`} onClick={() => onPick(on ? '' : card.id)}
          >
            <img className="jd-tile-img" src={card.photo} alt="" loading="eager" decoding="async" width="450" height="160" />
            <span className="jd-tile-shade" aria-hidden="true" />
            <span className="jd-tile-open" aria-hidden="true"><ChevronRight size={16} /></span>
            <span className="jd-tile-name">{card.label}</span>
            <span className="jd-tile-count" aria-hidden="true">{n.toLocaleString('en-AU')} {n === 1 ? 'ROLE' : 'ROLES'}</span>
          </button>
        );
      })}
    </section>
  );
}

// How the national figure adds up, in words, from the same roles the cards count: roles in a named city (one role open in two cities is counted once, so the city counts can total more),
// roles remote from Australia with no city, and roles elsewhere in Australia (a town, a state, or no city given), which the button shows.
export function PlaceSum({ sum, onElsewhere }) {
  if (!sum || !sum.total) return null;
  const parts = [];
  if (sum.inCity) {
    const two = sum.inTwoCities ? ` (${sum.inTwoCities === 1 ? '1 is' : `${sum.inTwoCities} are`} open in two cities, so the city counts add up to ${sum.cityCounts})` : '';
    parts.push(<span key="city">{plural(sum.inCity, 'role', 'roles')} in a named city{two}</span>);
  }
  if (sum.remoteOnly) parts.push(<span key="remote">{plural(sum.remoteOnly, 'role', 'roles')} remote from Australia, with no city</span>);
  if (sum.elsewhere) parts.push(<span key="else"><button type="button" className="jd-link" onClick={onElsewhere}>{plural(sum.elsewhere, 'role', 'roles')} elsewhere in Australia</button> (a town, a state, or no city given)</span>);
  return (
    <p className="jd-quiet jd-sum">
      {plural(sum.total, 'open role', 'open roles')}: {parts.reduce((acc, p, i) => (i === 0 ? [p] : [...acc, ', ', p]), [])}.
    </p>
  );
}

// One role in the list: the company's mark, the role, who and where (only what the employer said), when it was last confirmed, and the bookmark.
export function RoleRow({ role, now, saved, onToggle, onOpen, selected }) {
  const stand = standing(role, now);
  const confirmed = confirmedWords(role.last_confirmed_at, now);
  const meta = rowMeta(role);
  const when = stand ? stand.label : confirmed ? `Confirmed ${confirmed}` : '';
  return (
    <li className={`jd-row${selected ? ' is-open' : ''}${stand ? ` is-${stand.tone}` : ''}`}>
      <button type="button" className="jd-row-main" onClick={() => onOpen(role)} aria-haspopup="dialog" aria-label={`${role.title}, ${meta.join(', ')}. Open the details`}>
        <CompanyMark name={role.company.name} website={role.company.website} />
        <span className="jd-row-text">
          <span className="jd-row-title">{role.title}</span>
          <span className="jd-row-meta">{meta.join(' · ')}</span>
          <span className="jd-row-when jd-row-when-sm">{when}</span>
        </span>
        <span className="jd-row-when" title={role.last_confirmed_at ? `Last confirmed ${new Date(role.last_confirmed_at).toLocaleString('en-AU')}` : undefined}>{when}</span>
      </button>
      <button
        type="button" className="bm jd-bm" aria-pressed={saved} aria-label={saved ? `Remove ${role.title} at ${role.company.name} from saved` : `Save ${role.title} at ${role.company.name}`}
        onClick={() => onToggle(role.id)}
      >
        <BookmarkIcon size={22} fill={saved ? 'currentColor' : 'none'} />
      </button>
    </li>
  );
}

// "Who's hiring.": the companies with a role among those that match, most roles first. A press filters the list to one (a second clears it).
export function CompanyIndex({ companies, active, onPick, onCoverage }) {
  return (
    <aside className="jd-rail" aria-label="Who is hiring">
      <p className="jd-rail-kicker"><span aria-hidden="true">✳</span> The company index</p>
      <h2 className="jd-rail-title">Who&rsquo;s hiring<span className="jd-dot">.</span></h2>
      <p className="jd-rail-note">Explore roles from one team.</p>
      {companies.length === 0 ? <p className="jd-rail-empty">No company has a role that matches.</p> : (
        <ul className="jd-firms">
          {companies.map((c) => (
            <li key={c.key}>
              <button type="button" className={`jd-firm${active === c.key ? ' is-on' : ''}`} aria-pressed={active === c.key} onClick={() => onPick(active === c.key ? '' : c.key)}>
                <CompanyMark name={c.name} website={c.website} size={26} />
                <span className="jd-firm-name">{c.name}</span>
                <span className="jd-firm-n">{c.count}<span className="sr-only"> {c.count === 1 ? 'role' : 'roles'}</span> <span aria-hidden="true">↗</span></span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="jd-source">
        <span className="jd-source-dot" aria-hidden="true" />
        <div>
          <b>From the source</b>
          <p>Every role links to its employer. The check date tells you when we last saw it listed.</p>
          <button type="button" className="jd-link" onClick={onCoverage}>See feed coverage <span aria-hidden="true">↗</span></button>
        </div>
      </div>
    </aside>
  );
}

const Fact = ({ label, children }) => (children ? <div><dt>{label}</dt><dd>{children}</dd></div> : null);

const fullDay = (iso) => (iso && !Number.isNaN(Date.parse(iso)) ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' }) : '');

// A role in full: where, how it is worked, the dates kept apart (posted by the employer, first listed here, last confirmed), why it is listed, and the way to apply on the employer's site.
export function RoleDetail({ role, now, saved, onToggle, onClose }) {
  const { titleId, overlayProps, panelProps } = useDialog(onClose);
  const stand = standing(role, now);
  const open = role.lifecycle === 'open';
  const where = [...new Set((role.work.places ?? []).filter((p) => p.au).map((p) => p.label))].join('; ') || whereWords(role);
  const confirmedDay = confirmedWords(role.last_confirmed_at, now);
  return (
    <div className="modal-overlay jd-overlay" {...overlayProps}>
      <div className="modal-panel jd-detail" {...panelProps}>
        <button type="button" className="modal-close" aria-label="Close" onClick={onClose}><CloseIcon size={20} /></button>
        <div className="jd-detail-head">
          <CompanyMark name={role.company.name} website={role.company.website} size={56} />
          <div>
            <p className="jd-detail-company">
              {role.company.slug ? <a {...linkProps(`/startup/${role.company.slug}`)}>{role.company.name}</a> : role.company.name}
            </p>
            <h2 id={titleId} className="jd-detail-title">{role.title}</h2>
          </div>
        </div>

        {stand && <p className={`jd-standing is-${stand.tone}`} role="note"><strong>{stand.label}.</strong> {stand.detail}</p>}

        <dl className="jd-facts">
          <Fact label="Where it is worked">{where}</Fact>
          <Fact label="Remote from Australia">{role.work.remote_au ? role.work.remote_evidence ? `Yes, the employer says: “${role.work.remote_evidence}”` : 'Yes' : ''}</Fact>
          <Fact label="Working arrangement">{role.work.arrangement ? ARRANGEMENT_LABELS[role.work.arrangement] : ''}</Fact>
          <Fact label="Employment">{role.employment_type ? TYPE_LABELS[role.employment_type] : ''}</Fact>
          <Fact label="Level in the title">{role.level ? LEVEL_LABELS[role.level] : ''}</Fact>
          <Fact label="Team">{role.team}</Fact>
          <Fact label="Salary">{role.salary}</Fact>
          <Fact label="Posted by the employer">{fullDay(role.posted_at)}</Fact>
          <Fact label="First listed here">{fullDay(role.first_seen_at)}</Fact>
          <Fact label="Last confirmed">{role.last_confirmed_at ? `${fullDay(role.last_confirmed_at)}${confirmedDay === 'today' ? ' (today)' : ''}` : ''}</Fact>
        </dl>

        <p className="jd-why">{role.why_listed}</p>

        <div className="jd-detail-foot">
          {open && (
            <a className="btn btn-primary jd-apply" href={role.apply_url} target="_blank" rel="noopener noreferrer">
              Apply at {role.company.name} <ExternalIcon size={16} /><span className="sr-only"> (opens the employer&rsquo;s site in a new tab)</span>
            </a>
          )}
          <button type="button" className="btn btn-secondary jd-save" aria-pressed={saved} onClick={() => onToggle(role.id)}>
            <BookmarkIcon size={18} fill={saved ? 'currentColor' : 'none'} /> {saved ? 'Saved' : 'Save'}
          </button>
        </div>
        {!open && <p className="jd-fine">There is no apply link here because the employer is not listing this role as open. Its own careers page is the place to check.</p>}
      </div>
    </div>
  );
}

// What the board reads from and what it cannot: for the person who wants to know whether a company is watched.
export function Coverage({ sync, onClose }) {
  const { titleId, overlayProps, panelProps } = useDialog(onClose);
  return (
    <div className="modal-overlay jd-overlay" {...overlayProps}>
      <div className="modal-panel jd-detail" {...panelProps}>
        <button type="button" className="modal-close" aria-label="Close" onClick={onClose}><CloseIcon size={20} /></button>
        <h2 id={titleId} className="jd-detail-title">Feed coverage</h2>
        <p className="jd-why">
          Still Early reads each employer&rsquo;s own public job board about once an hour, when the check is running. A new role appears after the next successful check, not the moment the employer posts it,
          and a failed check never closes a role. This is not every company in the directory: only the boards below are read.
        </p>
        <h3 className="jd-h3">Read {sync?.boards?.polled ?? 0} employer board{sync?.boards?.polled === 1 ? '' : 's'}</h3>
        <ul className="jd-cov">
          {(sync?.covered ?? []).map((b) => (
            <li key={`${b.company}-${b.provider}`}>
              <span>{b.company}</span>
              <span className="jd-cov-meta">{b.provider} · {b.roles} open {b.roles === 1 ? 'role' : 'roles'}{b.failing ? ' · could not be read at the last check' : b.last_success_at ? '' : ' · not read yet'}</span>
            </li>
          ))}
        </ul>
        {(sync?.unsupported?.length ?? 0) > 0 && (<><h3 className="jd-h3">Approved, but not read yet</h3><ul className="jd-cov">{sync.unsupported.map((b) => <li key={`${b.company}-${b.provider}`}><span>{b.company}</span><span className="jd-cov-meta">{b.provider}: no reader yet</span></li>)}</ul></>)}
        {(sync?.review?.length ?? 0) > 0 && (<><h3 className="jd-h3">Waiting for a person to confirm</h3><ul className="jd-cov">{sync.review.map((b) => <li key={`${b.company}-${b.provider}`}><span>{b.company}</span><span className="jd-cov-meta">{b.provider}: the board is not confirmed from the company&rsquo;s own site, so it is not read</span></li>)}</ul></>)}
      </div>
    </div>
  );
}

export function Credits({ onClose }) {
  const { titleId, overlayProps, panelProps } = useDialog(onClose);
  return (
    <div className="modal-overlay jd-overlay" {...overlayProps}>
      <div className="modal-panel jd-detail" {...panelProps}>
        <button type="button" className="modal-close" aria-label="Close" onClick={onClose}><CloseIcon size={20} /></button>
        <h2 id={titleId} className="jd-detail-title">Photography</h2>
        <p className="jd-why">
          City photographs are from Unsplash: Melbourne (Flinders Street Station), Sydney Harbour, and Perth at Elizabeth Quay (Urlaubstracker, urlaubstracker.de). Remote AU uses the outline of Australia
          from Natural Earth, the same coastline as the map.
        </p>
      </div>
    </div>
  );
}
