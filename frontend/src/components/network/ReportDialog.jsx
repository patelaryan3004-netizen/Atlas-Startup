import { useState } from 'react';
import { reportItem } from '../../networkApi.js';
import { useDialog } from '../../hooks/useDialog.js';
import { CloseIcon } from '../explore/icons.jsx';

const REASONS = [
  ['spam', 'Spam or an advert'],
  ['abuse', 'Rude, hateful or threatening'],
  ['misleading', 'Misleading or untrue'],
  ['off_topic', 'Off topic'],
  ['other', 'Something else'],
];

// Reporting a post or a reply: a reason and, if you like, a word. A person reads it. Enough reports from different people hide it until they have.
export default function ReportDialog({ kind, id, onClose }) {
  const { titleId, overlayProps, panelProps } = useDialog(onClose);
  const [reason, setReason] = useState('spam');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try { await reportItem(kind, id, { reason, note }); setDone(true); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" {...overlayProps}>
      <div className="modal-panel" {...panelProps}>
        <button type="button" className="modal-close" aria-label="Close" onClick={onClose}><CloseIcon size={20} /></button>
        {done ? (
          <div className="submit-done">
            <h2 id={titleId}>Thank you.</h2>
            <p>A person reads every report. Nothing happens to the {kind} until they have looked, unless several people have reported it.</p>
            <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <h2 id={titleId}>Report this {kind}</h2>
            <p className="modal-sub">Tell us what is wrong. The person who wrote it is not told who reported it.</p>
            <fieldset className="report-reasons">
              <legend>Why?</legend>
              {REASONS.map(([value, text]) => (
                <label key={value} className="report-reason"><input type="radio" name="reason" value={value} checked={reason === value} onChange={() => setReason(value)} /><span>{text}</span></label>
              ))}
            </fieldset>
            <div className="fgroup">
              <label htmlFor="reportNote">Anything we should know? Optional</label>
              <textarea id="reportNote" rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            {error && <div className="form-error" role="alert">{error}</div>}
            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={busy}>Send report</button>
              <button type="button" className="btn btn-quiet" onClick={onClose}>Cancel</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
