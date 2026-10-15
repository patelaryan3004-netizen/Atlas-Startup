import { useEscapeClose } from '../../hooks/useEscapeClose.js';
import { present } from '../../freshness.js';
import { Avatar } from '../EntityCard.jsx';
import { Badge, BookmarkButton, VcBadge } from '../brand/parts.jsx';
import { PinIcon, ArrowRight, CloseIcon } from './icons.jsx';

const hostOf = (website) => { try { return new URL(website).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };

// The compact preview of the company or the investor that is open on the map, drawn beside its mark (MapView puts it there): the logo, the name, what it
// is, where, how well that place is known, the bookmark, and the one way on (the company's page, or the investor's profile). It says its place as the
// record does: an office at the address its own page gives, or only a city. `pin` is what pinPayload() makes of a mark.
export default function PreviewCard({ pin, saved = false, onToggleSaved, onOpen, onClose, onReport }) {
  useEscapeClose(onClose);
  const vc = pin.kind === 'vc';
  const sub = vc ? 'Venture capital' : present(pin.sector)[0] ?? '';
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
      <button type="button" className="pv-cta" onClick={onOpen}>{vc ? 'View investor profile' : 'Explore company'} <ArrowRight size={18} /></button>
      {!vc && pin.hiring && onReport && <button type="button" className="pv-report" onClick={onReport}>Report: role closed</button>}
    </section>
  );
}
