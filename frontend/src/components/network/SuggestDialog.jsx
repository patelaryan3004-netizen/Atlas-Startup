import { useState } from 'react';
import { submitSuggestion } from '../../networkApi.js';
import { useDialog } from '../../hooks/useDialog.js';
import { CloseIcon } from '../explore/icons.jsx';

const EVENT_TYPES = [['founder_meetup', 'Founder gathering'], ['demo_day', 'Demo day'], ['workshop', 'Workshop'], ['pitch_night', 'Pitch night'], ['conference', 'Conference'], ['other', 'Other']];
const FORMATS = [['in_person', 'In person'], ['online', 'Online'], ['hybrid', 'In person and online']];
const JOB_TYPES = [['', 'Not sure'], ['full_time', 'Full-time'], ['part_time', 'Part-time'], ['contract', 'Contract'], ['internship', 'Internship'], ['fixed_term', 'Fixed term']];

// Suggesting a job or an event. It goes into a queue: nothing is listed until a person has read it, checked it against the employer's or the organiser's own
// page, and filled in what the page needs. So the form asks only for what you know, and for the page it is on.
export default function SuggestDialog({ kind, onClose }) {
  const { titleId, overlayProps, panelProps } = useDialog(onClose);
  const job = kind === 'job';
  const [f, setF] = useState(job
    ? { title: '', company: '', location: '', remote: false, employment_type: '', apply_url: '', note: '' }
    : { name: '', organiser: '', type: 'founder_meetup', format: 'in_person', city: '', venue: '', starts: '', ends: '', registration_url: '', note: '' });
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const set = (key) => (event) => setF((x) => ({ ...x, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try { await submitSuggestion(kind, f, email); setDone(true); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" {...overlayProps}>
      <div className="modal-panel" {...panelProps}>
        <button type="button" className="modal-close" aria-label="Close" onClick={onClose}><CloseIcon size={20} /></button>
        {done ? (
          <div className="submit-done">
            <h2 id={titleId}>Thank you.</h2>
            <p>A person reads every suggestion and checks it against the {job ? 'employer' : 'organiser'}&rsquo;s own page before anything is listed. Nothing is shown until they have.</p>
            <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
          </div>
        ) : (
          <form onSubmit={submit} noValidate>
            <h2 id={titleId}>{job ? 'Suggest a role' : 'Suggest an event'}</h2>
            <p className="modal-sub">{job ? 'A real role at a startup, with the employer’s own link to apply.' : 'A real Australian startup event, with the organiser’s own page.'} A person checks it before it is listed.</p>

            {job ? (
              <>
                <div className="fgroup"><label htmlFor="sgTitle">Role *</label><input id="sgTitle" value={f.title} onChange={set('title')} maxLength={120} /></div>
                <div className="fgroup"><label htmlFor="sgCompany">Company *</label><input id="sgCompany" value={f.company} onChange={set('company')} maxLength={100} /></div>
                <div className="fgroup"><label htmlFor="sgUrl">Link to apply, on the employer&rsquo;s site *</label><input id="sgUrl" value={f.apply_url} onChange={set('apply_url')} placeholder="https://" inputMode="url" maxLength={300} /></div>
                <div className="fgroup"><label htmlFor="sgLoc">Location</label><input id="sgLoc" value={f.location} onChange={set('location')} maxLength={100} placeholder="Sydney, or Remote" /></div>
                <label className="auth-check"><input type="checkbox" checked={f.remote} onChange={set('remote')} /><span>The listing says it can be done remotely</span></label>
                <div className="fgroup"><label htmlFor="sgType">Employment type</label><select id="sgType" value={f.employment_type} onChange={set('employment_type')}>{JOB_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
              </>
            ) : (
              <>
                <div className="fgroup"><label htmlFor="sgName">Event name *</label><input id="sgName" value={f.name} onChange={set('name')} maxLength={120} /></div>
                <div className="fgroup"><label htmlFor="sgOrg">Organiser *</label><input id="sgOrg" value={f.organiser} onChange={set('organiser')} maxLength={100} /></div>
                <div className="fgroup"><label htmlFor="sgUrl">Registration page *</label><input id="sgUrl" value={f.registration_url} onChange={set('registration_url')} placeholder="https://" inputMode="url" maxLength={300} /></div>
                <div className="fgroup"><label htmlFor="sgStarts">Starts *</label><input id="sgStarts" value={f.starts} onChange={set('starts')} placeholder="2026-12-03 or 2026-12-03T18:00" maxLength={20} /><div className="hint">The day, and the time if you know it, as the organiser&rsquo;s page says (local time).</div></div>
                <div className="fgroup"><label htmlFor="sgEnds">Ends</label><input id="sgEnds" value={f.ends} onChange={set('ends')} placeholder="Optional" maxLength={20} /></div>
                <div className="fgroup"><label htmlFor="sgType">Kind of event</label><select id="sgType" value={f.type} onChange={set('type')}>{EVENT_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
                <div className="fgroup"><label htmlFor="sgFormat">Format</label><select id="sgFormat" value={f.format} onChange={set('format')}>{FORMATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
                <div className="fgroup"><label htmlFor="sgCity">City</label><input id="sgCity" value={f.city} onChange={set('city')} maxLength={60} /></div>
                <div className="fgroup"><label htmlFor="sgVenue">Venue</label><input id="sgVenue" value={f.venue} onChange={set('venue')} maxLength={120} /></div>
              </>
            )}

            <div className="fgroup"><label htmlFor="sgNote">Why is it worth listing? Optional</label><textarea id="sgNote" rows={3} value={f.note} onChange={set('note')} maxLength={400} /></div>
            <div className="fgroup"><label htmlFor="sgEmail">Your email, optional</label><input id="sgEmail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /><div className="hint">Only used to ask a question about your suggestion. It is not shown anywhere.</div></div>

            {error && <div className="form-error" role="alert">{error}</div>}
            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Send suggestion'}</button>
              <button type="button" className="btn btn-quiet" onClick={onClose}>Cancel</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
