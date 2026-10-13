import { useState } from 'react';
import { submitStartup } from '../api.js';
import { useDialog } from '../hooks/useDialog.js';
import { TALLY_SUBMIT_URL, tallyEmbed } from '../tally.js';

const EMPTY = { name: '', website: '', city: '', role: '', claim: '', description: '', stage: '', email: '', hiringUrl: '' };
const STAGES = ['Pre-seed', 'Seed', 'Series A', 'Series B', 'Series C+', 'Growth', 'Unknown'];

// Submissions go to a Tally form (company name, website, city, your role, and whether you want to claim the profile) once its address is
// set in tally.js; until then the site's own form below takes them, so the button never opens a broken frame.
export default function SubmitStartupForm({ onClose, tallyUrl = TALLY_SUBMIT_URL }) {
  const { titleId, overlayProps, panelProps } = useDialog(onClose);
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

  const embed = tallyEmbed(tallyUrl);
  if (embed) {
    return (
      <div className="modal-overlay" {...overlayProps}>
        <div className="modal-panel" {...panelProps}>
          <button className="modal-close" aria-label="Close" onClick={onClose}>✕</button>
          <h2 id={titleId}>Submit a startup</h2>
          <iframe className="waitlist-iframe" src={embed} title="Submit a startup" loading="lazy" />
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" {...overlayProps}>
      <div className="modal-panel" {...panelProps}>
        <button className="modal-close" aria-label="Close" onClick={onClose}>✕</button>

        {done ? (
          <div className="submit-done">
            <h2 id={titleId}>Thanks!</h2>
            <p>We review every submission before it goes live.</p>
            <button className="taskbtn" onClick={onClose}>Close</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <h2 id={titleId}>Submit a startup</h2>
            <p className="modal-sub">
              Know an AU startup that should be on the map? Fill in what you know — only the name
              and a one-line description are required. We review every submission before it goes live.
            </p>

            <div className="form-row">
              <div className="fgroup">
                <label htmlFor="subName">Company name *</label>
                <input id="subName" type="text" autoComplete="organization" value={form.name} onChange={set('name')} />
              </div>
              <div className="fgroup">
                <label htmlFor="subWebsite">Website</label>
                <input id="subWebsite" type="text" inputMode="url" placeholder="https://..." value={form.website} onChange={set('website')} />
              </div>
            </div>

            <div className="form-row">
              <div className="fgroup">
                <label htmlFor="subCity">City</label>
                <input id="subCity" type="text" placeholder="e.g. Melbourne" value={form.city} onChange={set('city')} />
              </div>
              <div className="fgroup">
                <label htmlFor="subRole">Your role</label>
                <input id="subRole" type="text" placeholder="e.g. Founder, employee, investor" value={form.role} onChange={set('role')} />
              </div>
            </div>

            <div className="fgroup">
              <label htmlFor="subDescription">One-line description * — what they do, in a sentence</label>
              <input id="subDescription" type="text" value={form.description} onChange={set('description')} />
            </div>

            <div className="fgroup">
              <label htmlFor="subClaim">Do you want to claim this profile?</label>
              <select id="subClaim" value={form.claim} onChange={set('claim')}>
                <option value="">Select...</option>
                <option value="yes">Yes — I run or work at this company</option>
                <option value="no">No — I am only suggesting it</option>
              </select>
              <div className="hint">Your answer is kept with the submission for whoever reviews it. Nothing changes on the profile until it is reviewed.</div>
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
                <input id="subEmail" type="email" autoComplete="email" placeholder="you@example.com" value={form.email} onChange={set('email')} />
              </div>
            </div>

            <div className="fgroup">
              <label htmlFor="subHiring">Hiring? — optional</label>
              <input id="subHiring" type="text" inputMode="url" placeholder="https://yourcompany.com/careers" value={form.hiringUrl} onChange={set('hiringUrl')} />
              <div className="hint">Link to where the roles are actually listed — careers page, LinkedIn, Wellfound.</div>
            </div>

            {error && <div className="form-error" role="alert">{error}</div>}

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
