import { useEffect, useState } from 'react';
import { fetchInvestor } from '../../api.js';
import { useEscapeClose } from '../../hooks/useEscapeClose.js';
import { present } from '../../freshness.js';
import { Avatar } from '../EntityCard.jsx';
import VerifiedNote from '../VerifiedNote.jsx';
import { PinIcon, GlobeIcon, BookmarkIcon, ArrowRight, ExternalIcon, CloseIcon } from './icons.jsx';

// The panel for the venture capital firm that was picked on the map: what it invests in (its focus and stages), where it is (a city, said as a city:
// the records give no address), and the companies a page says it backed, each a way into that company. It opens at once with what the mark knows and
// fills in as the investor's record arrives. Like the company's panel it is docked on the right on a wide screen and is the bottom sheet on a phone.
// `pin` is what pinPayload() makes of an investor's mark.
const hostOf = (website) => { try { return new URL(website).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };
const SHOWN = 8; // the portfolio companies listed here; the rest are on the investor's page

const listOf = (values) => present(...(values ?? [])).join(' · ');

export default function VcPanel({ pin, saved = false, onToggleSaved, onClose, onOpenProfile, onOpenCompany, variant = 'panel' }) {
  const [record, setRecord] = useState(null);
  const [failed, setFailed] = useState(false);
  useEscapeClose(onClose);

  useEffect(() => {
    setRecord(null);
    setFailed(false);
    if (!pin?.slug) return undefined;
    const ctrl = new AbortController();
    fetchInvestor(pin.slug, { signal: ctrl.signal })
      .then((full) => { if (!ctrl.signal.aborted) setRecord(full); })
      .catch(() => { if (!ctrl.signal.aborted) setFailed(true); });
    return () => ctrl.abort();
  }, [pin?.slug]);

  const name = record?.name ?? pin.name;
  const website = record?.website || pin.website;
  const sheet = variant === 'sheet';
  const focus = listOf(record?.sectors);
  const stages = listOf(record?.stages);
  const offices = listOf(record?.other_offices);
  const addresses = record?.office_addresses ?? []; // the street addresses its own pages give, each under its city
  const portfolio = record?.portfolio ?? [];
  const connected = [...new Map(portfolio.map((row) => [row.company.slug, row.company])).values()];
  const description = record?.description || record?.investment_thesis;

  return (
    <section className={sheet ? 'xp-card xp-card-sheet xp-card-vc' : 'xp-card xp-card-vc'} aria-label={name}>
      <button type="button" className="xp-close" aria-label="Close this panel" onClick={onClose}><CloseIcon size={18} /></button>

      <div className="xp-top">
        <Avatar name={name} website={website} size={sheet ? 64 : 72} className="xp-logo" />
        <div className="xp-title">
          <h2 className="xp-name">{name}</h2>
          <div className="xp-tags">
            <span className="xp-tag xp-tag-vc">VC</span>
            <span className="xp-tag xp-tag-quiet">{record?.type_label ?? 'Venture capital'}</span>
          </div>
        </div>
      </div>

      {description && <p className="xp-blurb">{description}</p>}

      <p className="xp-where">
        <PinIcon size={18} className="xp-meta-pin" />
        <span>{pin.location?.place || pin.city}</span>
      </p>
      <p className="xp-quality">{pin.location?.quality}</p>

      <dl className="xp-facts">
        {focus && <div><dt>Focus</dt><dd>{focus}</dd></div>}
        {stages && <div><dt>Stages</dt><dd>{stages}</dd></div>}
        {offices && <div><dt>Other offices</dt><dd>{offices}</dd></div>}
        {addresses.length > 0 && (
          <div>
            <dt>Addresses</dt>
            <dd><ul className="xp-addresses">{addresses.map((a) => <li key={`${a.city}: ${a.address}`}><b>{a.city}</b> {a.address}</li>)}</ul></dd>
          </div>
        )}
        {record && !focus && !stages && <div><dt>Focus</dt><dd className="xp-none">Not stated</dd></div>}
      </dl>

      {failed && <p className="xp-note">Could not load the rest of this investor&rsquo;s details right now.</p>}

      <div className="xp-section">
        <h3 className="xp-section-title">Portfolio{record ? ` (${connected.length})` : ''}</h3>
        {!record && !failed && <p className="xp-note" role="status">Loading…</p>}
        {record && connected.length === 0 && <p className="xp-note">No company in the directory is linked to this investor by a page yet.</p>}
        {connected.length > 0 && (
          <ul className="xp-portfolio">
            {connected.slice(0, SHOWN).map((company) => (
              <li key={company.slug}>
                <button type="button" onClick={() => onOpenCompany(company)}>
                  <Avatar name={company.name} website={company.website} size={32} className="xp-mini" />
                  <span><b>{company.name}</b>{present(company.city, company.sector).length > 0 && <small>{present(company.city, company.sector).join(' · ')}</small>}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {connected.length > SHOWN && <p className="xp-note">and {connected.length - SHOWN} more on the investor&rsquo;s page.</p>}
      </div>

      {website && (
        <a className="xp-site" href={website} target="_blank" rel="noopener noreferrer">
          <GlobeIcon size={20} /><span>{hostOf(website) || website}</span><ExternalIcon size={16} className="xp-site-out" />
        </a>
      )}
      {record && <VerifiedNote at={record.verified_at} />}

      <div className="xp-actions">
        <button type="button" className="xp-cta" onClick={() => onOpenProfile(pin.slug)}>View investor profile <ArrowRight size={20} /></button>
        <div className="xp-actions-row">
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
      </div>
    </section>
  );
}
