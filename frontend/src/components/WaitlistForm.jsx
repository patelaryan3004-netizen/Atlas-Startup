import { useDialog } from '../hooks/useDialog.js';
import { WAITLIST_URL, tallyEmbed } from '../tally.js';

// The waitlist is a Tally form (see WAITLIST_URL in tally.js). Its embed address is what Tally lets a page show in a frame; hideTitle
// leaves the heading to this panel, and the form brings its own dark background.
//
// `formUrl` is for tests and for pointing the panel at another form; with none it says so rather than showing a broken frame.
export default function WaitlistForm({ onClose, formUrl = tallyEmbed(WAITLIST_URL) }) {
  const { titleId, overlayProps, panelProps } = useDialog(onClose);

  return (
    <div className="modal-overlay" {...overlayProps}>
      <div className="modal-panel" {...panelProps}>
        <button className="modal-close" aria-label="Close" onClick={onClose}>✕</button>
        <h2 id={titleId}>Join the waitlist</h2>
        <p className="modal-sub">Get early access to task-gated startup applications.</p>

        {formUrl ? (
          <iframe
            className="waitlist-iframe"
            src={formUrl}
            title="Waitlist signup"
            loading="lazy"
          />
        ) : (
          <p className="modal-sub form-error" role="status">
            Waitlist form is not set up yet — no Tally form has been created for this. Come back soon.
          </p>
        )}
      </div>
    </div>
  );
}
