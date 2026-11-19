import { useEffect, useState } from 'react';
import { fetchStartup } from '../../api.js';
import { useEscapeClose } from '../../hooks/useEscapeClose.js';
import { oneSentence, cardSector, cardPlace } from '../../popupText.js';
import { Avatar } from '../EntityCard.jsx';
import { VcBadge } from '../brand/parts.jsx';
import { ArrowRight, CloseIcon } from './icons.jsx';

const hostOf = (website) => { try { return new URL(website).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };

// The compact card of the company or the investor that is open on the map, drawn beside its pin (MapView puts it there). It says only what a visitor choosing between pins needs:
// the logo and the name, one plain sentence on what the company does, its sector and where it is (the suburb and the city: no street, no word on how well the place is
// known), and the one way on, "View company" (or "View investor profile"). A part that is not known is left out, not filled in. Where the facts came from, the website, the
// verification dates and the location's precision are on the company's own page, not here. `pin` is what pinPayload() makes of a mark; the sentence arrives with the record.
export default function PreviewCard({ pin, onOpen, onClose }) {
  useEscapeClose(onClose);
  const [record, setRecord] = useState(null);
  useEffect(() => {
    setRecord(null);
    if (pin.kind === 'vc' || !pin.slug) return undefined;
    const ctrl = new AbortController();
    fetchStartup(pin.slug, { signal: ctrl.signal }).then((full) => { if (!ctrl.signal.aborted) setRecord(full); }).catch(() => { /* the card keeps what the pin knew */ });
    return () => ctrl.abort();
  }, [pin.slug, pin.kind]);
  const vc = pin.kind === 'vc';
  const sector = vc ? 'Venture capital' : cardSector(record, pin);
  const place = cardPlace(record, pin);
  const sentence = vc ? '' : oneSentence(record?.blurb);
  const facts = [sector, place].filter(Boolean).join(' · ');
  return (
    <section className="pv" aria-label={pin.name}>
      <div className="pv-top">
        <Avatar name={pin.name} website={vc ? null : pin.website} domain={vc ? hostOf(pin.website) || null : null} size={48} className="pv-logo" />
        <div className="pv-text">
          <b className="pv-name"><span>{pin.name}</span>{vc && <VcBadge />}</b>
        </div>
        <button type="button" className="pv-close" aria-label="Close the preview" onClick={onClose}><CloseIcon size={16} /></button>
      </div>
      {sentence && <p className="pv-blurb">{sentence}</p>}
      {facts && <p className="pv-facts">{facts}</p>}
      <button type="button" className="pv-cta" onClick={onOpen}>{vc ? 'View investor profile' : 'View company'} <ArrowRight size={18} /></button>
    </section>
  );
}
