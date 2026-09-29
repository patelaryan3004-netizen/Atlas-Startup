import { useEscapeClose } from '../hooks/useEscapeClose.js';

// Not filled in yet - no real Tally form has been created for this. Shown as
// an honest placeholder rather than pointing the iframe at a guessed or
// broken URL. Set this once a real form exists.
const TALLY_URL = '';

export default function WaitlistForm({ onClose }) {
  useEscapeClose(onClose);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" aria-label="Close" onClick={onClose}>✕</button>
        <h2>Join the waitlist</h2>
        <p className="modal-sub">Get early access to task-gated startup applications.</p>

        {TALLY_URL ? (
          <iframe
            className="waitlist-iframe"
            src={TALLY_URL}
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
