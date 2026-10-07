import { useEscapeClose } from '../hooks/useEscapeClose.js';

// The waitlist is a Tally form (its share link is https://tally.so/r/kdVrGo). This is its embed address, which Tally lets
// a page show in a frame; hideTitle leaves the heading to this panel, and the form brings its own dark background.
const TALLY_URL = 'https://tally.so/embed/kdVrGo?hideTitle=1&alignLeft=1';

// `formUrl` is for tests and for pointing the panel at another form; with none it says so rather than showing a broken frame.
export default function WaitlistForm({ onClose, formUrl = TALLY_URL }) {
  useEscapeClose(onClose);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" aria-label="Close" onClick={onClose}>✕</button>
        <h2>Join the waitlist</h2>
        <p className="modal-sub">Get early access to task-gated startup applications.</p>

        {formUrl ? (
          <iframe
            className="waitlist-iframe"
            src={formUrl}
            title="Waitlist signup"
            loading="lazy"
          />
        ) : (
          <p className="modal-sub form-error">
            Waitlist form is not set up yet — no Tally form has been created for this. Come back soon.
          </p>
        )}
      </div>
    </div>
  );
}
