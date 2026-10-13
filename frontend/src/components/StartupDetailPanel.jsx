import { nextEvent, eventDay, isBlank, hiringLabel, partialDateText, shortDate } from '../freshness.js';
import { remoteLabel } from '../directory.js';
import VerifiedNote, { UnverifiedBadge } from './VerifiedNote.jsx';
import HiringBadge from './HiringBadge.jsx';
import { useEffect, useState } from 'react';
import { fetchNews, fetchInvestorsByName } from '../api.js';
import { logoUrl } from '../logo.js';
import Vouch from './Vouch.jsx';
import { useEscapeClose } from '../hooks/useEscapeClose.js';
import { nameKey } from './investors/common.jsx';
import ConceptPreview from './ConceptPreview.jsx';

const CHECKED = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
// "Roles checked 5 Oct 2026": when a page last showed this company had open roles (the full record carries it).
const checkedOn = (iso) => { const t = Date.parse(iso); return Number.isNaN(t) ? null : CHECKED.format(new Date(t)); };

function domainOf(website) {
  if (!website) return null;
  try {
    return new URL(website).hostname.replace(/^www\./, '');
  } catch (e) {
    return null;
  }
}

function initialsOf(name) {
  const words = (name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (name || '?').slice(0, 2).toUpperCase();
}

// The company's logo, or nothing (the initial rendered underneath shows). A failure removes the picture. A handler that swapped
// `src` for another address would be called again by every failure of that one - React keeps its own error listener on an
// <img>, whatever `onerror` is set to - and for a visitor whose browser blocks the address (an ad blocker, no network) it never
// stopped: the panel redrew its logo thousands of times a second for as long as it was open. The panel opens on a click, so
// its logo is wanted at once: it is decoded off the main thread but not held back.
function PanelLogo({ domain }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return <img className="pc-avatar-logo" src={logoUrl(domain, 96)} alt="" decoding="async" onError={() => setFailed(true)} />;
}

// What a source backs, in the words a visitor uses (a field the list does not know is shown as it is named).
const BACKS = {
  description: 'what it does', website: 'its website', address: 'its address', city: 'its city', state: 'its state', founded_year: 'the year it started',
  hiring_status: 'whether it is hiring', founders: 'its founders', investors: 'its investors', stage: 'its stage', company_status: 'whether it is operating',
  last_funding_date: 'its funding', last_funding_round: 'its funding', funding_total: 'its funding', employee_range: 'its team size',
  team_size: 'its team size', remote_policy: 'how it works remotely', tech_stack: 'what it builds with', last_role_seen_at: 'when it last had a role',
};
const backsText = (fields) => [...new Set(fields.map((f) => BACKS[f] ?? f))].join(', ');

// The page a fact comes from and when it was checked, under the fact: only for a fact a public page backs (the server serves no other).
function FactSource({ fact }) {
  if (!fact?.source_url) return null;
  const when = checkedOn(fact.verified_at);
  return (
    <div className="sdp-fact-source">
      <a href={fact.source_url} target="_blank" rel="noopener noreferrer">{domainOf(fact.source_url) ?? 'source'}</a>{when ? ` · checked ${when}` : ''}
    </div>
  );
}

const APPROXIMATE_NOTE = {
  SUBURB: () => 'Approximate: the pin is at the suburb, not the office.',
  CITY: (s) => `No pin: shown as a group in ${s.city || 'its city'} on the map.`,
  STATE: () => 'No pin: shown as a group in its state on the map.',
  UNKNOWN: () => 'Not shown on the map.',
};

// Where the company is, and how well that is known, in the words the site uses everywhere: "Verified office",
// "Location: suburb-level", "Location: city-level". `s.location` comes from the server (or from the pin the panel was
// opened from); a record without it is described as it always was, by whether it has an address.
function LocationCell({ s, loading }) {
  const where = s.location;
  if (!where) {
    return (
      <>
        <div className="sdp-meta-value">{s.city}</div>
        {!loading && <div className="sdp-meta-note">{s.address ? '✓ Address on file' : '◐ City-level only'}</div>}
      </>
    );
  }
  const precision = where.precision;
  const mark = precision === 'EXACT' ? '✓' : precision === 'UNKNOWN' ? '○' : '◐';
  const note = APPROXIMATE_NOTE[precision]?.(s);
  return (
    <>
      <div className="sdp-meta-value">{where.place || s.city}</div>
      <div className={`sdp-meta-note sdp-loc sdp-loc-${precision.toLowerCase()}`}>{mark} {where.quality}</div>
      {note && <div className="sdp-meta-note">{note}</div>}
    </>
  );
}

// News items are free-text headlines with no company field to join on, so a
// startup's name appearing in the headline/meta text is the only honest
// signal of relevance - anything weaker would risk mismatches we can't verify.
function relatedNews(news, startupName) {
  const q = startupName.toLowerCase();
  return news.filter((d) => d.headline.toLowerCase().includes(q) || (d.meta || '').toLowerCase().includes(q));
}

export default function StartupDetailPanel({ startup: s, sectorColor, isTracked, onToggleTracked, onSuggestEdit, onSelectPerson, onOpenInvestor, onClose }) {
  useEscapeClose(onClose);
  const [news, setNews] = useState([]);
  // The investors in the directory among this company's: by name, so only one with a page of its own becomes a link.
  const [investorSlugs, setInvestorSlugs] = useState({});
  const investorKey = (s.investors ?? []).join('\n');
  const canOpenInvestor = Boolean(onOpenInvestor);

  useEffect(() => {
    fetchNews().then(({ deals }) => setNews(deals || [])).catch(() => setNews([]));
  }, []);

  useEffect(() => {
    const names = investorKey ? investorKey.split('\n') : [];
    if (!canOpenInvestor || !names.length) { setInvestorSlugs({}); return undefined; }
    const ctrl = new AbortController();
    fetchInvestorsByName(names, { signal: ctrl.signal })
      .then(({ results }) => {
        if (ctrl.signal.aborted) return;
        const found = {};
        for (const card of results) for (const n of [card.name, ...(card.aliases ?? [])]) found[nameKey(n)] = card.slug;
        setInvestorSlugs(found);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [investorKey, canOpenInvestor]);

  // The map and the list know a company's name, place and sector; the rest arrives a moment after it opens.
  const loading = Boolean(s.partial);
  const domain = domainOf(s.website);
  const initial = (s.name || '?').trim().charAt(0).toUpperCase();
  const tracked = isTracked(s.name);
  const matchingNews = relatedNews(news, s.name);
  const investorCount = s.investors?.length || 0;
  // The page that backs "hiring now": the company's own job board when a page was read, the company's site otherwise.
  const board = s.hiring_source?.url ?? s.hiring_source_url ?? null;
  const rolesLink = board ?? (s.website_status === 'unavailable' ? null : s.website);
  const hiring = hiringLabel(s);
  const event = nextEvent(s.events);

  return (
    <div className="sdp-overlay" onClick={onClose}>
      <div className="sdp-panel" onClick={(e) => e.stopPropagation()}>
        <div className="pc-hero" style={{ background: sectorColor }}>
          <button className="modal-close sdp-close" aria-label="Close" onClick={onClose}>✕</button>
          <div className="pc-hero-top">
            <div className="pc-avatar">
              <span className="pc-avatar-fallback">{initial}</span>
              {domain && <PanelLogo key={domain} domain={domain} />}
            </div>
            <div className="pc-hero-text">
              <h4>{s.name}</h4>
              <UnverifiedBadge company={s} />
              <VerifiedNote at={s.last_verified_at} />
            </div>
          </div>
          <button
            className={tracked ? 'sdp-track sdp-track-active' : 'sdp-track'}
            onClick={() => onToggleTracked(s.name)}
          >
            {tracked ? '★ Tracked' : '☆ Track'}
          </button>
        </div>

        <div className="pc-body">
          <div className="sdp-meta-grid">
            {!isBlank(s.sectorFull || s.sector) && (
              <div className="sdp-meta-cell">
                <div className="pc-section-label">Industry</div>
                <div className="sdp-meta-value">{s.sectorFull || s.sector}</div>
              </div>
            )}
            <div className="sdp-meta-cell">
              <div className="pc-section-label">Location</div>
              <LocationCell s={s} loading={loading} />
            </div>
            {!isBlank(s.stage) && (
              <div className="sdp-meta-cell">
                <div className="pc-section-label">Stage</div>
                <div className="sdp-meta-value">{s.stage}</div>
              </div>
            )}
            <div className="sdp-meta-cell">
              <div className="pc-section-label">Hiring</div>
              <div className="sdp-meta-value">{hiringLabel(s).text}</div>
            </div>
            {/* The facts a page has to give a company: each is here only when a page backs it, with that page under it. */}
            {s.team_size != null && (
              <div className="sdp-meta-cell">
                <div className="pc-section-label">Team size</div>
                <div className="sdp-meta-value">{s.team_size}</div>
                <FactSource fact={s.facts?.team_size} />
              </div>
            )}
            {remoteLabel(s.remote_policy) && (
              <div className="sdp-meta-cell">
                <div className="pc-section-label">Remote policy</div>
                <div className="sdp-meta-value">{remoteLabel(s.remote_policy)}</div>
                <FactSource fact={s.facts?.remote_policy} />
              </div>
            )}
            {partialDateText(s.last_funding_date) && (
              <div className="sdp-meta-cell">
                <div className="pc-section-label">Last raised</div>
                <div className="sdp-meta-value">{partialDateText(s.last_funding_date)}</div>
                <FactSource fact={s.facts?.last_funding_date} />
              </div>
            )}
            {shortDate(s.last_role_seen_at) && (
              <div className="sdp-meta-cell">
                <div className="pc-section-label">Last role seen</div>
                <div className="sdp-meta-value">{shortDate(s.last_role_seen_at)}</div>
                <FactSource fact={s.facts?.last_role_seen_at} />
              </div>
            )}
          </div>

          {Array.isArray(s.tech_stack) && s.tech_stack.length > 0 && (
            <div className="sdp-section">
              <div className="pc-section-label">Tech stack</div>
              <ul className="st-tags sdp-tech" aria-label="Tech stack">
                {s.tech_stack.map((t) => <li key={t}>{t}</li>)}
              </ul>
              <FactSource fact={s.facts?.tech_stack} />
            </div>
          )}

          {loading && <p className="pc-desc sdp-loading" role="status">Loading details…</p>}

          {s.blurb && (
            <div className="sdp-section">
              <div className="pc-section-label">About</div>
              <p className="pc-desc">{s.blurb}</p>
            </div>
          )}

          {s.founders?.length > 0 && (
            <div className="sdp-section">
              <div className="pc-section-label">Founders</div>
              <div className="pc-founders">
                {s.founders.map((f) => {
                  const search = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${f} ${s.name}`)}`;
                  return (
                    <div className="pc-founder" key={f}>
                      <span className="pc-founder-avatar">{initialsOf(f)}</span>
                      <button className="pc-founder-name pc-founder-name-btn" onClick={() => onSelectPerson(f)}>{f}</button>
                      <a className="pc-founder-li" href={search} target="_blank" rel="noopener" title={`Search LinkedIn for ${f}`}>in</a>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {(investorCount > 0 || s.stage) && (
            <div className="sdp-section">
              <div className="pc-section-label">Funding</div>
              <p className="pc-desc sdp-funding-line">
                {s.stage}{investorCount > 0 ? ` · backed by ${investorCount} investor${investorCount === 1 ? '' : 's'}` : ''}
              </p>
            </div>
          )}

          {investorCount > 0 && (
            <div className="sdp-section">
              <div className="pc-section-label">Investors</div>
              <div className="pc-investors">
                {s.investors.map((i) => {
                  const slug = investorSlugs[nameKey(i)];
                  return (
                    <div className="pc-inv" key={i}>
                      <span className="pc-inv-avatar">{initialsOf(i)}</span>
                      {slug
                        ? <button type="button" className="pc-inv-name pc-inv-link" onClick={() => onOpenInvestor(slug)}>{i}</button>
                        : <span className="pc-inv-name">{i}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="sdp-section">
            <div className="pc-section-label">Hiring</div>
            <div className="pc-badges-row">
              <HiringBadge company={s} />
              {(s.hiring || hiring.state === 'checked') && rolesLink && (
                <a className="taskbtn sdp-apply-btn" href={rolesLink} target="_blank" rel="noopener noreferrer">{board ? 'View open roles' : 'Apply now'}</a>
              )}
              <ConceptPreview company={s} />
            </div>
            {s.hiring && s.hiring_source && (
              <p className="sdp-hiring-note">
                Confirmed from the company&rsquo;s own job page, <a href={s.hiring_source.url} target="_blank" rel="noopener noreferrer">{domainOf(s.hiring_source.url) ?? s.hiring_source.url}</a>
                {checkedOn(s.hiring_source.checked_at) ? `, on ${checkedOn(s.hiring_source.checked_at)}` : ''}.
              </p>
            )}
            {s.hiring && !s.hiring_source && checkedOn(s.hiring_verified_at) && <p className="sdp-hiring-note">Open roles checked on {checkedOn(s.hiring_verified_at)}.</p>}
            {hiring.state === 'checked' && (
              <p className="sdp-hiring-note">
                Open roles were read {checkedOn(s.hiring_checked_at) ? `on ${checkedOn(s.hiring_checked_at)}` : 'earlier'}, but a company is only called hiring now when a job board
                or structured postings on its own page have confirmed them in the last 14 days. It is not counted as hiring now.
              </p>
            )}
            {hiring.state === 'none' && <p className="sdp-hiring-note">The company&rsquo;s job board was read{checkedOn(s.hiring_checked_at) ? ` on ${checkedOn(s.hiring_checked_at)}` : ''} and listed no open roles.</p>}
            {hiring.state === 'unverified' && (
              <p className="sdp-hiring-note">
                {s.rolesUnverified
                  ? 'Marked as hiring, but no open role has been checked against the company’s own pages, so it is not counted as hiring.'
                  : 'No open roles have been read for this company, so we do not say whether it is hiring.'}
              </p>
            )}
            {s.hiring && (
              <p className="sdp-report">
                <button type="button" className="linkbtn" onClick={() => onSuggestEdit(s.name, `Role closed: ${s.name} is no longer hiring. `)}>Report: role closed</button>
              </p>
            )}
          </div>

          {event && (
            <div className="sdp-section">
              <div className="pc-section-label">Event</div>
              <p className="sdp-event"><span className="event-badge" style={{ marginLeft: 0 }}>{eventDay(event)}</span> {event.url ? <a href={event.url} target="_blank" rel="noopener noreferrer">{event.title}</a> : event.title}</p>
            </div>
          )}

          {matchingNews.length > 0 && (
            <div className="sdp-section">
              <div className="pc-section-label">News</div>
              <div className="sdp-news-list">
                {matchingNews.map((d) => (
                  <a className="sdp-news-item" href={d.url} target="_blank" rel="noopener noreferrer" key={d.url}>
                    {d.headline}
                  </a>
                ))}
              </div>
            </div>
          )}

          {s.vouches?.length > 0 && (
            <details className="pc-vouches sdp-section">
              <summary className="vouch-badge">Vouched by {s.vouches.length}</summary>
              <div className="vouch-list">
                {s.vouches.map((v, i) => <Vouch key={i} name={v.name} role={v.role} note={v.note} />)}
              </div>
            </details>
          )}

          {!loading && (
            <details className="sdp-sources sdp-section">
              <summary className="pc-section-label">
                Where this comes from{checkedOn(s.checked_at) ? ` · checked ${checkedOn(s.checked_at)}` : ''}
              </summary>
              {s.sources?.length > 0 ? (
                <ul className="sdp-sources-list">
                  {s.sources.map((src) => (
                    <li key={src.url}>
                      <a href={src.url} target="_blank" rel="noopener noreferrer">{src.title || domainOf(src.url) || src.url}</a>
                      <span className="sdp-source-meta">{domainOf(src.url)}{src.backs?.length ? ` · backs ${backsText(src.backs)}` : ''}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="sdp-sources-none">No public page has been checked for this company yet, so its details are unconfirmed.</p>
              )}
            </details>
          )}

          <div className="sdp-links">
            {s.website && s.website_status === 'unavailable' && (
              <span className="pc-link sdp-website-unavailable" title={`${s.website.replace(/^https?:\/\//, '')} no longer answers; the address is kept so it can be re-checked`}>Website unavailable</span>
            )}
            {s.website && s.website_status !== 'unavailable' && (
              <a className="pc-link sdp-website-link" href={s.website} target="_blank" rel="noopener noreferrer">
                {s.website.replace(/^https?:\/\//, '')} ↗
              </a>
            )}
            <a className="pc-link sdp-linkedin-link" href={`https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(s.name)}`} target="_blank" rel="noopener noreferrer" title={`Search LinkedIn for ${s.name}`}>
              Find on LinkedIn ↗
            </a>
          </div>
          <button className="pc-suggest-edit" onClick={() => onSuggestEdit(s.name)}>✎ Suggest an edit</button>
        </div>
      </div>
    </div>
  );
}
