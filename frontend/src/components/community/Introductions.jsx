import { useCallback, useEffect, useState } from 'react';
import { answerIntroduction, fetchIntroductions, fetchMatches, requestIntroduction } from '../../networkApi.js';
import { useSession } from '../../session.js';
import { openAuth } from '../../authUi.js';
import { useDialog } from '../../hooks/useDialog.js';
import { linkProps } from '../brand/nav.js';
import { CloseIcon } from '../explore/icons.jsx';
import MemberAvatar from '../network/MemberAvatar.jsx';

const STATUS_WORDS = { requested: 'Waiting for an answer', accepted: 'Agreed', declined: 'Declined', withdrawn: 'Withdrawn' };

// People and projects that might suit a signed-in member, each with the reason in words. The rules are in backend/src/network/matching.js and written out in docs/community.md: the goals you
// chose, the skills you bring or want, the sectors you both care about, the place, and how you like to work. Nobody is ranked by anything else, and nothing here is shared with them.
export function Recommended({ intent }) {
  const { member, open } = useSession();
  const [state, setState] = useState({ status: 'idle', people: [], projects: [] });
  const [asking, setAsking] = useState(null);
  const [sent, setSent] = useState({});

  const load = useCallback((signal) => {
    setState((s) => ({ ...s, status: 'loading' }));
    return fetchMatches({ signal }).then((res) => { if (!signal?.aborted) setState({ status: 'ready', people: res.people, projects: res.projects }); })
      .catch((err) => { if (!signal?.aborted && err.name !== 'AbortError') setState({ status: 'error', people: [], projects: [], error: err.message }); });
  }, []);
  useEffect(() => {
    if (!member || open !== true) { setState({ status: 'idle', people: [], projects: [] }); return undefined; }
    const ctrl = new AbortController(); load(ctrl.signal); return () => ctrl.abort();
  }, [member?.id, open, load]);

  const rules = 'Matches use what members say about themselves: the goals they chose, the skills they bring or want, the sectors they care about, the place and how they like to work. Each says why.';

  if (open !== true) {
    return <p className="cm-rail-note">{rules} They start when members can join, and they never use anything but what a member wrote.</p>;
  }
  if (!member) {
    return (
      <div>
        <p className="cm-rail-note">{rules}</p>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => openAuth({ mode: 'signup', reason: 'see who fits what you want' })}>Join to see who fits</button>
      </div>
    );
  }
  const unfinished = !(member.looking_for?.length || member.skills?.length);
  return (
    <div>
      {state.status === 'loading' && <p className="cm-quiet" role="status">Looking…</p>}
      {state.status === 'error' && <p className="form-error" role="alert">{state.error}</p>}
      {unfinished && <p className="cm-rail-note">Say what you are looking for and what you bring in <a {...linkProps('/me')}>your profile</a>, and matches appear here.</p>}
      {state.status === 'ready' && !unfinished && state.people.length === 0 && state.projects.length === 0 && (
        <p className="cm-rail-note">No one fits yet. People appear here when a member who chose to be listed shares a goal or a skill with you. Nothing is made up to fill the space.</p>
      )}
      {state.people.length > 0 && (
        <ul className="cm-rows cm-rows-tight" aria-label="People who might suit you">
          {state.people.map(({ member: m, why }) => (
            <li key={m.id} className="cm-match">
              <a className="cm-by" {...linkProps(`/members/${encodeURIComponent(m.id)}`)}><MemberAvatar name={m.name} size="sm" /><span>{m.name}{m.role ? `, ${m.role}` : ''}</span></a>
              <ul className="cm-why" aria-label={`Why ${m.name}`}>{why.map((w) => <li key={w}>{w}</li>)}</ul>
              {sent[m.id] ? <p className="cm-quiet">Asked. They will see it in their introductions.</p>
                : <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAsking({ member: m, why })}>Ask for an introduction</button>}
            </li>
          ))}
        </ul>
      )}
      {state.projects.length > 0 && (
        <>
          <h4 className="cm-rail-sub">Projects that might suit you</h4>
          <ul className="cm-rows cm-rows-tight">
            {state.projects.map(({ project: p, why }) => (
              <li key={p.id} className="cm-match"><strong className="cm-match-name">{p.name}</strong>
                <ul className="cm-why">{why.map((w) => <li key={w}>{w}</li>)}</ul></li>
            ))}
          </ul>
        </>
      )}
      {asking && <IntroDialog target={asking.member} why={asking.why} onClose={() => setAsking(null)} onSent={() => { setSent((s) => ({ ...s, [asking.member.id]: true })); setAsking(null); }} />}
    </div>
  );
}

// Asking to be introduced. The other person sees the note and the reasons; contact details move only if they accept, and your own contact line has to be set first.
export function IntroDialog({ target, why = [], onClose, onSent }) {
  const { member } = useSession();
  const { titleId, overlayProps, panelProps } = useDialog(onClose);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true); setError('');
    try { await requestIntroduction({ to: target.id, note, why }); onSent(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <div className="modal-overlay" {...overlayProps}>
      <div className="modal-panel cm-dialog" {...panelProps}>
        <button type="button" className="modal-close" aria-label="Close" onClick={onClose}><CloseIcon size={20} /></button>
        <h2 id={titleId}>Ask {target.name} for an introduction</h2>
        <p className="modal-sub">They see your note, your public profile and why you were suggested. Your contact is shown to them only if they accept, and theirs to you only then. The site sends no email.</p>
        {why.length > 0 && <ul className="cm-why cm-why-dialog">{why.map((w) => <li key={w}>{w}</li>)}</ul>}
        {!member?.contact ? (
          <div className="cm-need">
            <p>Before you ask, set how people can reach you. It is shown only to someone you both agree to meet.</p>
            <a className="btn btn-primary btn-sm" {...linkProps('/me')}>Add my contact in my profile</a>
          </div>
        ) : (
          <form onSubmit={submit}>
            <div className="fgroup"><label htmlFor="introNote">A short note</label><textarea id="introNote" rows={4} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Why you would like to talk, and about what." required /><div className="hint">{note.length}/300</div></div>
            {error && <div className="form-error" role="alert">{error}</div>}
            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={busy || note.trim().length < 10}>{busy ? 'Sending…' : 'Ask for an introduction'}</button>
              <button type="button" className="btn btn-quiet" onClick={onClose}>Cancel</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// Your introductions, on your profile page: what you asked, what you were asked, and, for the ones both agreed, the other person's contact.
export function IntroInbox() {
  const { member, open } = useSession();
  const [state, setState] = useState({ status: 'loading', results: [], error: '' });
  const [busy, setBusy] = useState('');
  const load = useCallback(() => fetchIntroductions().then((res) => setState({ status: 'ready', results: res.results, error: '' })).catch((err) => setState({ status: 'error', results: [], error: err.message })), []);
  useEffect(() => { if (member && open === true) load(); }, [member?.id, open, load]);
  if (!member || open !== true) return null;
  const act = async (id, action) => { setBusy(id); try { await answerIntroduction(id, action); await load(); } catch (err) { setState((s) => ({ ...s, error: err.message })); } finally { setBusy(''); } };
  const waiting = state.results.filter((i) => i.direction === 'received' && i.status === 'requested');
  const rest = state.results.filter((i) => !waiting.includes(i));
  return (
    <section className="pe-intros" aria-labelledby="pe-intros-h">
      <h2 id="pe-intros-h" className="mp-h">Introductions</h2>
      <p className="pe-note">Both of you have to agree before either sees the other&rsquo;s contact. The site sends no email: you see requests here.</p>
      {state.status === 'loading' && <p className="cm-quiet" role="status">Loading…</p>}
      {state.error && <p className="form-error" role="alert">{state.error}</p>}
      {state.status === 'ready' && state.results.length === 0 && <p className="cm-quiet">No introductions yet. You can ask for one from the people suggested on the Community page.</p>}
      {waiting.length > 0 && <h3 className="cm-rail-sub">Waiting for your answer</h3>}
      <ul className="cm-rows cm-rows-tight">
        {[...waiting, ...rest].map((i) => (
          <li key={i.id} className="cm-match">
            <p><a {...linkProps(`/members/${encodeURIComponent(i.member?.id ?? '')}`)}>{i.member?.name ?? 'A former member'}</a> <span className="cm-count">{i.direction === 'sent' ? 'You asked' : 'Asked you'} · {STATUS_WORDS[i.status]}</span></p>
            <p className="cm-note">{i.note}</p>
            {i.why?.length > 0 && <ul className="cm-why">{i.why.map((w) => <li key={w}>{w}</li>)}</ul>}
            {i.status === 'accepted' && <p className="cm-contact">Their contact: <strong>{i.contact || 'they have not set one'}</strong></p>}
            {i.direction === 'received' && i.status === 'requested' && (
              <div className="form-actions">
                <button type="button" className="btn btn-primary btn-sm" disabled={busy === i.id} onClick={() => act(i.id, 'accept')}>Accept and share contacts</button>
                <button type="button" className="btn btn-quiet btn-sm" disabled={busy === i.id} onClick={() => act(i.id, 'decline')}>Decline</button>
              </div>
            )}
            {i.direction === 'sent' && ['requested', 'accepted'].includes(i.status) && (
              <button type="button" className="btn btn-quiet btn-sm" disabled={busy === i.id} onClick={() => act(i.id, 'withdraw')}>Withdraw</button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
