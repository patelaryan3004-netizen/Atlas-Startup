import { useEffect, useState } from 'react';
import { fetchStartup } from '../../api.js';
import { useEscapeClose } from '../../hooks/useEscapeClose.js';
import { present } from '../../freshness.js';
import { Avatar } from '../EntityCard.jsx';
import { Badge, BookmarkButton, VcBadge } from '../brand/parts.jsx';
import SourceNote from './SourceNote.jsx';
import { PinIcon, ArrowRight, CloseIcon, ExternalIcon } from './icons.jsx';

const hostOf = (website) => { try { return new URL(website).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };

// The compact preview of the company or the investor that is open on the map, drawn beside its mark (MapView puts it there): the logo, the name, what it
// is, where, how well that place is known, the bookmark, and the one way on (the company's page, or the investor's profile). It says its place as the
// record does: an office at the address its own page gives, or only a city. `pin` is what pinPayload() makes of a mark. For a company it opens at once with
// what the mark knows and adds, as the record arrives, what the company does (its description), its official website and where the facts came from.
export default function PreviewCard({ pin, saved = false, onToggleSaved, onOpen, onClose, onReport }) {
  useEscapeClose(onClose);
  const [record, setRecord] = useState(null);
  useEffect(() => {
    setRecord(null);
    if (pin.kind === 'vc' || !pin.slug) return undefined;
    const ctrl = new AbortController();
    fetchStartup(pin.slug, { signal: ctrl.signal }).then((full) => { if (!ctrl.signal.aborted) setRecord(full); }).catch(() => { /* the card keeps what the mark knew */ });
    return () => ctrl.abort();
  }, [pin.slug, pin.kind]);
  const vc = pin.kind === 'vc';
  const sub = vc ? 'Venture capital' : present(record?.sectorFull || record?.sector || pin.sector)[0] ?? '';
  const website = !vc ? record?.website || pin.website : null;
  const place = pin.location?.place || pin.city;
  return (
    <section className="pv" aria-label={pin.name}>
      <div className="pv-top">
        <Avatar name={pin.name} website={vc ? null : pin.website} domain={vc ? hostOf(pin.website) || null : null} size={48} className="pv-logo" />
        <div className="pv-text">
          <b className="pv-name"><span>{pin.name}</span>{vc && <VcBadge />}{!vc && pin.hiring && <Badge tone="green">Hiring</Badge>}</b>
          {sub && <span className="pv-sub">{sub}</span>}
        </div>
        <BookmarkButton name={pin.name} saved={saved} onToggle={onToggleSaved} />
        <button type="button" className="pv-close" aria-label="Close the preview" onClick={onClose}><CloseIcon size={16} /></button>
      </div>
      {place && (
        <p className="pv-place">
          <PinIcon size={16} />
          <span>{place}{pin.location?.quality && <small>{pin.location.quality}</small>}</span>
        </p>
      )}
      {record?.blurb && <p className="pv-blurb">{record.blurb}</p>}
      {website && record?.website_status !== 'unavailable' && (
        <a className="pv-site" href={website} target="_blank" rel="noopener noreferrer">{hostOf(website) || website} <ExternalIcon size={14} /></a>
      )}
      {record && <SourceNote record={record} limit={2} className="pv-sources" />}
      <button type="button" className="pv-cta" onClick={onOpen}>{vc ? 'View investor profile' : 'Explore company'} <ArrowRight size={18} /></button>
      {!vc && pin.hiring && onReport && <button type="button" className="pv-report" onClick={onReport}>Report: role closed</button>}
    </section>
  );
}
