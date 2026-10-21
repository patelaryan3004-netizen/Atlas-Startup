import { useEffect, useState } from 'react';
import { fetchStartup } from '../../api.js';
import { useEscapeClose } from '../../hooks/useEscapeClose.js';
import { hiringLabel, present, shortDate } from '../../freshness.js';
import { Avatar } from '../EntityCard.jsx';
import HiringBadge from '../HiringBadge.jsx';
import VerifiedNote, { UnverifiedBadge } from '../VerifiedNote.jsx';
import { PinIcon, GlobeIcon, BookmarkIcon, ArrowRight, ExternalIcon, CloseIcon } from './icons.jsx';

// The panel for the company that was picked on the map (or in the list under the phone's sheet): on a wide screen it is docked on the map's right, on a
// phone it is the bottom sheet. It opens at once with what the pin knows (the name, the city, the sector, whether it is hiring) and fills in as the
// company's record arrives, so a pin is never a wait. Two tabs: what the company is, and its jobs (what a page says about its open roles, and the
// way to them). `pin` is what pinPayload() makes of a pin; `variant` "sheet" is the same panel inside the phone's bottom sheet.
const hostOf = (website) => { try { return new URL(website).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };

function JobsTab({ record, state, board, rolesLink }) {
  const read = shortDate(record?.hiring_source?.checked_at ?? record?.hiring_verified_at);
  const earlier = shortDate(record?.hiring_checked_at);
  return (
    <div className="xp-tabpanel" role="tabpanel" id="xp-panel-jobs" aria-labelledby="xp-tab-jobs">
      {!record && <p className="xp-note" role="status">Loading…</p>}
      {record && state === 'hiring' && (
        <p className="xp-note">
          {record.open_roles > 0 ? `${record.open_roles} open ${record.open_roles === 1 ? 'role' : 'roles'}, ` : 'Open roles '}
          confirmed from the company&rsquo;s own pages{board ? <>, <a href={board} target="_blank" rel="noopener noreferrer">{hostOf(board)}</a></> : ''}{read ? `, on ${read}` : ''}.
        </p>
      )}
      {record && state === 'checked' && (
        <p className="xp-note">Open roles were read {earlier ? `on ${earlier}` : 'earlier'}, but a company is only called hiring now when its own pages confirmed them in the last 14 days. It is not counted as hiring now.</p>
      )}
      {record && state === 'none' && <p className="xp-note">The company&rsquo;s job board was read{earlier ? ` on ${earlier}` : ''} and listed no open roles.</p>}
      {record && state === 'unverified' && <p className="xp-note">No open roles have been read for this company, so we do not say whether it is hiring.</p>}
      {record && (state === 'hiring' || state === 'checked') && rolesLink && (
        <a className="xp-linkbtn" href={rolesLink} target="_blank" rel="noopener noreferrer">{board ? 'View open roles' : 'Apply now'} <ExternalIcon size={18} /></a>
      )}
    </div>
  );
}

export default function StartupPanel({ pin, saved = false, onToggleSaved, onOpen, onClose, onReport, variant = 'panel' }) {
  const [record, setRecord] = useState(null);
  const [tab, setTab] = useState('overview');
  useEscapeClose(onClose);

  useEffect(() => {
    setRecord(null);
    setTab('overview');
    if (!pin?.slug) return undefined;
    const ctrl = new AbortController();
    fetchStartup(pin.slug, { signal: ctrl.signal })
      .then((full) => { if (!ctrl.signal.aborted) setRecord(full); })
      .catch(() => { /* the panel keeps what the pin knew */ });
    return () => ctrl.abort();
  }, [pin?.slug]);

  const company = record ?? pin;
  const name = company.name;
  const state = record ? hiringLabel(record).state : pin.hiring ? 'hiring' : null;
  const sector = present(record?.sectorFull || record?.sector || pin.sector)[0];
  const place = pin.location?.place || pin.city || record?.city;
  const website = company.website || pin.website;
  const board = record?.hiring_source?.url ?? record?.hiring_source_url ?? null;
  const rolesLink = board ?? (record?.website_status === 'unavailable' ? null : website) ?? null;
  const roles = (state === 'hiring' || state === 'checked') && rolesLink ? { href: rolesLink, text: board ? 'View open roles' : 'Apply now' } : null;
  const sheet = variant === 'sheet';

  return (
    <section className={sheet ? 'xp-card xp-card-sheet' : 'xp-card'} aria-label={name}>
      <button type="button" className="xp-close" aria-label="Close this panel" onClick={onClose}><CloseIcon size={18} /></button>

      <div className="xp-top">
        <Avatar name={name} website={website} size={sheet ? 64 : 72} className="xp-logo" />
        <div className="xp-title">
          <h2 className="xp-name">{name}</h2>
          <div className="xp-tags">
            <span className="xp-tag">Startup</span>
            {sector && <span className="xp-tag xp-tag-quiet">{sector}</span>}
            {state && <HiringBadge company={company} />}
            <UnverifiedBadge company={record} />
          </div>
        </div>
      </div>

      {record?.blurb && <p className="xp-blurb">{record.blurb}</p>}

      {place && (
        <p className="xp-where">
          <PinIcon size={18} className="xp-meta-pin" />
          <span>{place}</span>
        </p>
      )}
      {pin.location?.quality && <p className="xp-quality">{pin.location.quality}</p>}

      <div className="xp-tabs" role="tablist" aria-label={`${name}: what to show`}>
        <button type="button" role="tab" id="xp-tab-overview" aria-selected={tab === 'overview'} aria-controls="xp-panel-overview" className={tab === 'overview' ? 'xp-tab xp-tab-on' : 'xp-tab'} onClick={() => setTab('overview')}>Overview</button>
        <button type="button" role="tab" id="xp-tab-jobs" aria-selected={tab === 'jobs'} aria-controls="xp-panel-jobs" className={tab === 'jobs' ? 'xp-tab xp-tab-on' : 'xp-tab'} onClick={() => setTab('jobs')}>Jobs{state === 'hiring' && <span className="xp-tab-dot" aria-label="hiring now" />}</button>
      </div>

      {tab === 'overview' ? (
        <div className="xp-tabpanel" role="tabpanel" id="xp-panel-overview" aria-labelledby="xp-tab-overview">
          {website && (
            <a className="xp-site" href={website} target="_blank" rel="noopener noreferrer">
              <GlobeIcon size={20} /><span>{hostOf(website) || website}</span><ExternalIcon size={16} className="xp-site-out" />
            </a>
          )}
          {record && (record.founders?.length > 0 || record.programs?.length > 0 || present(record.stage).length > 0) && (
            <dl className="xp-facts">
              {record.founders?.length > 0 && <div><dt>{record.founders.length === 1 ? 'Founder' : 'Founders'}</dt><dd>{record.founders.join(', ')}</dd></div>}
              {record.programs?.map((p) => (
                <div key={p.id}>
                  <dt>Accelerator</dt>
                  <dd>{p.label}{p.source_url && <> · <a href={p.source_url} target="_blank" rel="noopener noreferrer">{p.accelerator} page</a></>}</dd>
                </div>
              ))}
              {present(record.stage).length > 0 && <div><dt>Stage</dt><dd>{record.stage}</dd></div>}
            </dl>
          )}
          {record && <VerifiedNote at={record.last_verified_at} />}
        </div>
      ) : (
        <JobsTab record={record} state={state} board={board} rolesLink={rolesLink} />
      )}

      <div className="xp-actions">
        {roles ? (
          <a className="xp-cta" href={roles.href} target="_blank" rel="noopener noreferrer">{roles.text} <ExternalIcon size={19} /></a>
        ) : (
          <button type="button" className="xp-cta" onClick={onOpen}>View company <ArrowRight size={20} /></button>
        )}
        <div className="xp-actions-row">
          {roles && <button type="button" className="xp-secondary" onClick={onOpen}>View company</button>}
          <button
            type="button"
            className={saved ? 'xp-secondary xp-save xp-save-on' : 'xp-secondary xp-save'}
            aria-pressed={saved}
            aria-label={saved ? `Remove ${name} from saved` : `Save ${name}`}
            title={saved ? 'Saved in this browser' : 'Save (kept in this browser)'}
            onClick={onToggleSaved}
          >
            <BookmarkIcon size={20} fill={saved ? 'currentColor' : 'none'} /> {saved ? 'Saved' : 'Save'}
          </button>
        </div>
        {onReport && (state === 'hiring' || state === 'checked') && <button type="button" className="xp-report" onClick={onReport}>Report: role closed</button>}
      </div>
    </section>
  );
}
