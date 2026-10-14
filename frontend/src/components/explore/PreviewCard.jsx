import { useEffect, useState } from 'react';
import { fetchStartup } from '../../api.js';
import { useEscapeClose } from '../../hooks/useEscapeClose.js';
import { hiringLabel } from '../../freshness.js';
import { Avatar } from '../EntityCard.jsx';
import HiringBadge from '../HiringBadge.jsx';
import VerifiedNote, { UnverifiedBadge } from '../VerifiedNote.jsx';
import { PinIcon, BookmarkIcon, ArrowRight, CloseIcon } from './icons.jsx';

// The card for the company that was picked on the map (or in the list under the phone's sheet): its picture, name, where and what it is, the one
// line it says about itself, whether it is hiring, and the two things to do with it: open it and save it. It opens at once with what the pin
// knows (the name, the city, the sector, whether it is hiring) and fills in as the company's record arrives, so a pin is never a wait.
// `pin` is what pinPayload() makes of a pin; `variant` "sheet" is the same card inside the phone's bottom sheet.
export default function PreviewCard({ pin, saved = false, onToggleSaved, onOpen, onClose, onReport, variant = 'card' }) {
  const [record, setRecord] = useState(null);
  useEscapeClose(onClose);

  useEffect(() => {
    setRecord(null);
    if (!pin?.slug) return undefined;
    const ctrl = new AbortController();
    fetchStartup(pin.slug, { signal: ctrl.signal })
      .then((full) => { if (!ctrl.signal.aborted) setRecord(full); })
      .catch(() => { /* the card keeps what the pin knew */ });
    return () => ctrl.abort();
  }, [pin?.slug]);

  const company = record ?? pin;
  const state = record ? hiringLabel(record).state : pin.hiring ? 'hiring' : null;
  const what = [pin.city || record?.city, record?.sectorFull || record?.sector || pin.sector].filter((v) => v && String(v).trim().toLowerCase() !== 'unknown');
  const quality = pin.location?.quality;
  const name = company.name;

  return (
    <section className={variant === 'sheet' ? 'xp-card xp-card-sheet' : 'xp-card'} aria-label={name}>
      <button type="button" className="xp-close" aria-label="Close this card" onClick={onClose}><CloseIcon size={18} /></button>

      <div className="xp-top">
        <Avatar name={name} website={company.website || pin.website} size={variant === 'sheet' ? 64 : 82} className="xp-logo" />
        <div className="xp-title">
          <h2 className="xp-name">{name}</h2>
          {what.length > 0 && (
            <p className="xp-meta">
              <PinIcon size={16} className="xp-meta-pin" />
              {what.map((text, i) => <span key={`${i}-${text}`}>{text}</span>)}
            </p>
          )}
          {quality && <p className="xp-quality">{quality}</p>}
        </div>
      </div>

      {record?.blurb && <p className="xp-blurb">{record.blurb}</p>}

      {(state || record) && (
        <div className="xp-tags">
          {state && <HiringBadge company={company} />}
          <UnverifiedBadge company={record} />
        </div>
      )}
      {record && <VerifiedNote at={record.last_verified_at} />}

      <div className="xp-actions">
        <button type="button" className="xp-cta" onClick={onOpen}>
          View company <ArrowRight size={20} />
        </button>
        <button
          type="button"
          className={saved ? 'xp-save xp-save-on' : 'xp-save'}
          aria-pressed={saved}
          aria-label={saved ? `Remove ${name} from saved` : `Save ${name}`}
          title={saved ? 'Saved in this browser' : 'Save (kept in this browser)'}
          onClick={onToggleSaved}
        >
          <BookmarkIcon size={22} fill={saved ? 'currentColor' : 'none'} />
        </button>
      </div>

      {onReport && (state === 'hiring' || state === 'checked') && (
        <button type="button" className="xp-report" onClick={onReport}>Report: role closed</button>
      )}
    </section>
  );
}
