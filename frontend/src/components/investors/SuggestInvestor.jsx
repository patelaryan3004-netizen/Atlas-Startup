import { useState } from 'react';
import { submitFeedback } from '../../api.js';
import { useDialog } from '../../hooks/useDialog.js';

// "Add investor": a suggestion, not an entry. Nobody is listed on a visitor's say-so: an investor is published only after a person has checked its
// record against pages it publishes itself, so this form asks for the name and, if the visitor has one, a page, and says what happens to it. It
// goes to the same queue as the site's feedback (type "investor"), where it is read.
export const SUGGESTION_ID_PREFIX = 'Investor to add:';

export function suggestionMessage({ name, website, note }) {
  return [`${SUGGESTION_ID_PREFIX} ${name.trim()}`, `Website: ${website.trim() || 'not given'}`, note.trim()].filter(Boolean).join('\n');
}

export default function SuggestInvestor({ onClose }) {
  const { titleId, overlayProps, panelProps } = useDialog(onClose);
  const [name, setName] = useState('');
  const [website, setWebsite] = useState('');
  const [note, setNote] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) { setError('Say who the investor is.'); return; }
    if (website.trim() && !/^https?:\/\/\S+$/.test(website.trim())) { setError('The website must be an address that starts with http:// or https://.'); return; }
    if (email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim())) { setError('That does not look like an email address. Leave it empty if you would rather not give one.'); return; }
    setError('');
    setSending(true);
    try {
      await submitFeedback({ type: 'investor', message: suggestionMessage({ name, website, note }), email: email.trim() });
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="modal-overlay" {...overlayProps}>
      <div className="modal-panel" {...panelProps}>
        <button className="modal-close" aria-label="Close" onClick={onClose}>✕</button>
        {done ? (
          <div className="submit-done">
            <h2 id={titleId}>Thank you.</h2>
            <p>A person checks the investor against pages it publishes itself before it is listed. Nothing is listed on a suggestion alone.</p>
            <button type="button" className="taskbtn" onClick={onClose}>Close</button>
          </div>
        ) : (
          <form onSubmit={submit} noValidate>
            <h2 id={titleId}>Suggest an investor</h2>
            <p className="modal-sub">
              Know a fund, angel group or institution that backs Australian startups and is not listed? Tell us who. A person checks it against pages it
              publishes itself before it is listed, so a suggestion is never listed straight away.
            </p>
            <div className="fgroup">
              <label htmlFor="invAddName">Investor *</label>
              <input id="invAddName" type="text" autoComplete="off" maxLength={200} value={name} onChange={(e) => setName(e.target.value)} placeholder="For example: Blackbird Ventures" />
            </div>
            <div className="fgroup">
              <label htmlFor="invAddSite">Its website, optional</label>
              <input id="invAddSite" type="url" placeholder="https://…" value={website} onChange={(e) => setWebsite(e.target.value)} />
              <div className="hint">The investor&rsquo;s own site is the page we check it against.</div>
            </div>
            <div className="fgroup">
              <label htmlFor="invAddNote">Anything else, optional</label>
              <textarea id="invAddNote" rows={3} maxLength={1500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: it backs seed-stage climate startups in Melbourne." />
            </div>
            <div className="fgroup">
              <label htmlFor="invAddEmail">Your email, optional</label>
              <input id="invAddEmail" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
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
