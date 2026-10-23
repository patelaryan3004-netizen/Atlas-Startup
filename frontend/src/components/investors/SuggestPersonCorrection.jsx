import { useState } from 'react';
import { submitPersonCorrection } from '../../api.js';
import { useEscapeClose } from '../../hooks/useEscapeClose.js';

// A correction to a person's profile, or a request to remove it. It is staged for a person to check; nothing changes by itself, and nothing is shown
// about the person who asks beyond what they choose to write.
export default function SuggestPersonCorrection({ person, onClose }) {
  useEscapeClose(onClose);
  const [message, setMessage] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!message.trim()) { setError('Say what is wrong or missing.'); return; }
    if (sourceUrl.trim() && !/^https?:\/\/\S+$/.test(sourceUrl.trim())) { setError('The page must be an address that starts with http:// or https://.'); return; }
    if (email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim())) { setError('That does not look like an email address. Leave it empty if you would rather not give one.'); return; }
    setError('');
    setSending(true);
    try {
      await submitPersonCorrection(person.slug, { message: message.trim(), source_url: sourceUrl.trim(), email: email.trim() });
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="inv-suggest-title" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" aria-label="Close" onClick={onClose}>✕</button>
        {done ? (
          <div className="submit-done">
            <h2 id="inv-suggest-title">Thank you.</h2>
            <p>A person reads every suggestion, and checks it against a page where there is one, before anything on this profile changes.</p>
            <button className="taskbtn" onClick={onClose}>Close</button>
          </div>
        ) : (
          <form onSubmit={submit} noValidate>
            <h2 id="inv-suggest-title">Suggest a correction or removal</h2>
            <p className="modal-sub">
              Something wrong on <b>{person.name}</b>&rsquo;s profile, or is it about you and you would rather it was not here? Tell us, and give a page that shows it if you can.
              A person reads it before anything changes. Nothing is changed automatically.
            </p>
            <div className="fgroup">
              <label htmlFor="invMessage">What is wrong or missing? *</label>
              <textarea id="invMessage" rows={4} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="For example: they left the firm in March, as their page now says. Or: please remove this profile." />
            </div>
            <div className="fgroup">
              <label htmlFor="invSource">A page that shows it, optional</label>
              <input id="invSource" type="url" placeholder="https://…" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} />
              <div className="hint">Their own page, or their firm&rsquo;s, is best. A suggestion with a page is checked first.</div>
            </div>
            <div className="fgroup">
              <label htmlFor="invEmail">Your email, optional</label>
              <input id="invEmail" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              <div className="hint">Only used to ask a question about your suggestion. It is not shown anywhere.</div>
            </div>
            {error && <div className="form-error" role="alert">{error}</div>}
            <div className="form-actions">
              <button type="submit" className="taskbtn" disabled={sending}>{sending ? 'Sending…' : 'Send suggestion'}</button>
              <button type="button" className="linkbtn" onClick={onClose}>Cancel</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
