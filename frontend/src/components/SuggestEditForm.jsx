import { useState } from 'react';
import { submitEdit } from '../api.js';

export default function SuggestEditForm({ company, onClose }) {
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!message.trim()) {
      setError('Tell us what’s wrong or out of date.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await submitEdit({ company, message, email });
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" aria-label="Close" onClick={onClose}>✕</button>

        {done ? (
          <div className="submit-done">
            <h2>Thanks!</h2>
            <p>We review every change before it goes live.</p>
            <button className="taskbtn" onClick={onClose}>Close</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <h2>Suggest an edit</h2>
            <p className="modal-sub">
              Something wrong with <b>{company}</b>&rsquo;s listing — address, logo, sector, anything?
              Tell us and we&rsquo;ll review before publishing. No auto-changes.
            </p>

            <div className="fgroup">
              <label htmlFor="editMessage">What&rsquo;s wrong? *</label>
              <input id="editMessage" type="text" placeholder="e.g. address is out of date, wrong logo..." value={message} onChange={(e) => setMessage(e.target.value)} />
            </div>

            <div className="fgroup">
              <label htmlFor="editEmail">Your email — optional</label>
              <input id="editEmail" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              <div className="hint">Only if you want us to follow up.</div>
            </div>

            {error && <div className="form-error">{error}</div>}

            <div className="form-actions">
              <button type="submit" className="taskbtn" disabled={submitting}>
                {submitting ? 'Sending…' : 'Send suggestion'}
              </button>
              <button type="button" className="linkbtn" onClick={onClose}>Cancel</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
