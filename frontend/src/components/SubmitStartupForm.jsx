import { useState } from 'react';
import { submitStartup } from '../api.js';

const EMPTY = { name: '', website: '', description: '', stage: '', email: '', hiringUrl: '' };
const STAGES = ['Pre-seed', 'Seed', 'Series A', 'Series B', 'Series C+', 'Growth', 'Unknown'];

export default function SubmitStartupForm({ onClose }) {
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.description.trim()) {
      setError('Company name and one-line description are required.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await submitStartup(form);
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
            <p>We review every submission before it goes live.</p>
            <button className="taskbtn" onClick={onClose}>Close</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <h2>Submit a startup</h2>
            <p className="modal-sub">
              Know an AU startup that should be on the map? Fill in what you know — only the name
              and a one-line description are required. We review every submission before it goes live.
            </p>

            <div className="form-row">
              <div className="fgroup">
                <label htmlFor="subName">Company name *</label>
                <input id="subName" type="text" value={form.name} onChange={set('name')} />
              </div>
              <div className="fgroup">
                <label htmlFor="subWebsite">Website</label>
                <input id="subWebsite" type="text" placeholder="https://..." value={form.website} onChange={set('website')} />
              </div>
            </div>

            <div className="fgroup">
              <label htmlFor="subDescription">One-line description * — what they do, in a sentence</label>
              <input id="subDescription" type="text" value={form.description} onChange={set('description')} />
            </div>

            <div className="form-row">
              <div className="fgroup">
                <label htmlFor="subStage">Stage</label>
                <select id="subStage" value={form.stage} onChange={set('stage')}>
                  <option value="">Select a stage...</option>
                  {STAGES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div className="fgroup">
                <label htmlFor="subEmail">Your email</label>
                <input id="subEmail" type="email" placeholder="you@example.com" value={form.email} onChange={set('email')} />
              </div>
            </div>

            <div className="fgroup">
              <label htmlFor="subHiring">Hiring? — optional</label>
              <input id="subHiring" type="text" placeholder="https://yourcompany.com/careers" value={form.hiringUrl} onChange={set('hiringUrl')} />
              <div className="hint">Link to where the roles are actually listed — careers page, LinkedIn, Wellfound.</div>
            </div>

            {error && <div className="form-error">{error}</div>}

            <div className="form-actions">
              <button type="submit" className="taskbtn" disabled={submitting}>
                {submitting ? 'Submitting…' : 'Submit startup'}
              </button>
              <button type="button" className="linkbtn" onClick={onClose}>Cancel</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
