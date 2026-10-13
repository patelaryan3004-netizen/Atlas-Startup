import { useEscapeClose } from '../../hooks/useEscapeClose.js';
import { embedUrl, isConfigured } from '../../tally.js';

// A form in a panel over the page: the Tally form in a frame when one is set up, and otherwise a plain account that it is not,
// with what it will ask, so a visitor is never shown a broken frame or sent to an address that does not exist.
export default function TallyDialog({ title, intro, url, fields = [], onClose }) {
  useEscapeClose(onClose);
  const ready = isConfigured(url);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="tally-dialog-title" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" aria-label="Close" onClick={onClose}>✕</button>
        <h2 id="tally-dialog-title">{title}</h2>
        {intro && <p className="modal-sub">{intro}</p>}
        {ready ? (
          <iframe className="waitlist-iframe" src={embedUrl(url)} title={title} loading="lazy" />
        ) : (
          <div className="modal-sub form-error" role="status">
            <p>This form is not set up yet: no Tally form has been made for it, so there is nowhere to send this from here.</p>
            {fields.length > 0 && (
              <>
                <p>When it is, it will ask for:</p>
                <ul>{fields.map((field) => <li key={field}>{field}</li>)}</ul>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
