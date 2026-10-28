import { useEffect, useState } from 'react';
import { useDialog } from '../../hooks/useDialog.js';
import { ensureStatus, signIn, signUp, useSession } from '../../session.js';
import { CloseIcon } from '../explore/icons.jsx';

const WHY = {
  post: 'to share something with the community',
  reply: 'to reply',
  like: 'to like a post',
  'bookmark posts': 'to bookmark posts',
  'save people': 'to save people',
  report: 'to report something',
  suggest: 'so a suggestion has a name behind it',
};

// Signing in, or making an account. An account is a name, an email and a password; nothing else is asked for. The dialog is honest about two things a visitor
// would otherwise find out the hard way: the site does not send email yet (so a forgotten password cannot be reset), and where the community is not open
// there is nothing to sign in to.
export default function AuthDialog({ mode: initial = 'signin', reason = '', onClose }) {
  const { titleId, overlayProps, panelProps } = useDialog(onClose);
  const { open, reason: closedBecause, status } = useSession();
  const [mode, setMode] = useState(initial);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [listed, setListed] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { ensureStatus(); }, []);
  useEffect(() => { if (status === 'in') onClose(); }, [status, onClose]);

  const creating = mode === 'signup';
  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (creating) await signUp({ name, email, password, listed });
      else await signIn({ email, password });
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" {...overlayProps}>
      <div className="modal-panel auth" {...panelProps}>
        <button type="button" className="modal-close" aria-label="Close" onClick={onClose}><CloseIcon size={20} /></button>
        <h2 id={titleId}>{creating ? 'Join Still Early' : 'Sign in'}</h2>

        {open === false ? (
          <>
            <p className="modal-sub">{closedBecause || 'The community is not open yet.'}</p>
            <p className="modal-sub">You can still look around: startups, investors, jobs and events need no account, and what you save is kept in this browser.</p>
            <div className="form-actions"><button type="button" className="btn btn-secondary" onClick={onClose}>Close</button></div>
          </>
        ) : (
          <form onSubmit={submit} noValidate>
            <p className="modal-sub">
              {reason && WHY[reason] ? `Sign in ${WHY[reason]}. ` : ''}
              {creating
                ? 'A name, an email and a password. Posts are public and show your name.'
                : 'Welcome back.'}
            </p>

            {creating && (
              <div className="fgroup">
                <label htmlFor="authName">Your name</label>
                <input id="authName" type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
              </div>
            )}
            <div className="fgroup">
              <label htmlFor="authEmail">Email</label>
              <input id="authEmail" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              {creating && <div className="hint">Never shown to anyone else.</div>}
            </div>
            <div className="fgroup">
              <label htmlFor="authPassword">Password</label>
              <input id="authPassword" type="password" autoComplete={creating ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} />
              {creating && <div className="hint">At least 10 characters. We do not send email yet, so we cannot reset a forgotten password: choose one you will keep.</div>}
            </div>
            {creating && (
              <label className="auth-check">
                <input type="checkbox" checked={listed} onChange={(e) => setListed(e.target.checked)} />
                <span>List my profile in Discover, under People. You can change this any time.</span>
              </label>
            )}

            {error && <div className="form-error" role="alert">{error}</div>}

            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'One moment…' : creating ? 'Create account' : 'Sign in'}</button>
              <button type="button" className="btn btn-quiet" onClick={() => { setMode(creating ? 'signin' : 'signup'); setError(''); }}>
                {creating ? 'I already have an account' : 'Create an account'}
              </button>
            </div>
            {creating && <p className="auth-fine">Membership is not a badge: it does not mean anyone has checked you, and it does not promise an introduction or an interview. Be kind, be specific, and keep it free of spam.</p>}
          </form>
        )}
      </div>
    </div>
  );
}
