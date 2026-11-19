import { useEffect, useState } from 'react';
import { fetchStartup } from '../../api.js';
import { useEscapeClose } from '../../hooks/useEscapeClose.js';
import { oneSentence, cardSector, cardPlace } from '../../popupText.js';
import { Avatar } from '../EntityCard.jsx';
import { ArrowRight, CloseIcon } from './icons.jsx';

// The card of the company that was picked on the map, in the phone's bottom sheet (`variant` "sheet"; on a wide screen the same words are the compact card beside the pin,
// PreviewCard). It opens at once with what the pin knows (the name, the sector, the city) and the sentence arrives with the company's record. It says only what a visitor choosing
// between pins needs: the logo and the name, one plain sentence on what the company does, its sector and where it is (the suburb and the city), and the one way on, "View company".
// A part that is not known is left out. Where the facts came from, the website, the open roles, the verification dates and the location's precision are on the company's own page.
// `pin` is what pinPayload() makes of a pin.
export default function StartupPanel({ pin, onOpen, onClose, variant = 'panel' }) {
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

  const name = (record ?? pin).name;
  const website = (record ?? pin).website || pin.website;
  const sentence = oneSentence(record?.blurb);
  const facts = [cardSector(record, pin), cardPlace(record, pin)].filter(Boolean).join(' · ');
  const sheet = variant === 'sheet';

  return (
    <section className={sheet ? 'xp-card xp-card-sheet' : 'xp-card'} aria-label={name}>
      <button type="button" className="xp-close" aria-label="Close this panel" onClick={onClose}><CloseIcon size={18} /></button>

      <div className="xp-top">
        <Avatar name={name} website={website} size={sheet ? 64 : 72} className="xp-logo" />
        <div className="xp-title">
          <h2 className="xp-name">{name}</h2>
          {facts && <p className="xp-sub">{facts}</p>}
        </div>
      </div>

      {sentence && <p className="xp-blurb">{sentence}</p>}

      <div className="xp-actions">
        <button type="button" className="xp-cta" onClick={onOpen}>View company <ArrowRight size={20} /></button>
      </div>
    </section>
  );
}
