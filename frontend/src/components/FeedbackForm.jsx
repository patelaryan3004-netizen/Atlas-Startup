import { useState } from 'react';
import { submitFeedback } from '../api.js';

const TYPES = [
  { value: 'feedback', label: 'Feedback' },
  { value: 'feature', label: 'Feature request' },
  { value: 'bug', label: 'Bug' },
];

export default function FeedbackForm({ onClose }) {
  const [type, setType] = useState('feedback');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!message.trim()) {
      setError('Tell us what’s on your mind.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await submitFeedback({ type, message, email });
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
            <h3>Thanks!</h3>
            <p>We read every submission.</p>
            <button className="taskbtn" onClick={onClose}>Close</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <h3>Feedback</h3>
            <p className="modal-sub">
              Something about the site itself — not a specific company&rsquo;s listing.
              For that, use &ldquo;Suggest an edit&rdquo; on the company&rsquo;s pin instead.
            </p>

            <div className="fgroup">
              <label htmlFor="fbType">Type</label>
              <select id="fbType" value={type} onChange={(e) => setType(e.target.value)}>
                {TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            <div className="fgroup">
              <label htmlFor="fbMessage">Message *</label>
              <input id="fbMessage" type="text" placeholder="What's on your mind?" value={message} onChange={(e) => setMessage(e.target.value)} />
            </div>

            <div className="fgroup">
              <label htmlFor="fbEmail">Your email — optional</label>
              <input id="fbEmail" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              <div className="hint">Only if you want us to follow up.</div>
            </div>

            {error && <div className="form-error">{error}</div>}

            <div className="form-actions">
              <button type="submit" className="taskbtn" disabled={submitting}>
                {submitting ? 'Sending…' : 'Send feedback'}
              </button>
              <button type="button" className="linkbtn" onClick={onClose}>Cancel</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
