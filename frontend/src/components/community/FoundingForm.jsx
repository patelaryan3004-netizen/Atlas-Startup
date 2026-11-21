import { useId, useState } from 'react';
import { submitFounding } from '../../networkApi.js';
import { useSession } from '../../session.js';
import { INTENTS } from './intents.js';

const SKILLS_FALLBACK = [];

// The founding-member list: a waiting list for the people who want to be part of the Community when it opens. It makes no account, lets no one post, and starts no introduction, and it says so.
// What the person gives is an email, a name and a few lines about what they want; the page says where it is kept, that no email is sent automatically, and, where the place it is kept can be
// erased by a restart, that it can be lost. Nothing here pretends the members' side works.
export default function FoundingForm({ intent = '', compact = false, onDone }) {
  const id = useId();
  const { taxonomy, founding } = useSession();
  const skills = taxonomy?.skills ?? SKILLS_FALLBACK;
  const [form, setForm] = useState({ name: '', email: '', city: '', intents: intent ? [intent] : [], skills: [], building: '', looking_for: '', link: '', consent: false, company_website: '' });
  const [state, setState] = useState({ status: 'idle', message: '', durable: null });
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const toggle = (key, value, max) => setForm((f) => {
    const has = f[key].includes(value);
    if (!has && f[key].length >= max) return f;
    return { ...f, [key]: has ? f[key].filter((x) => x !== value) : [...f[key], value] };
  });

  if (state.status === 'done') {
    return (
      <div className="cm-found cm-found-done" role="status">
        <h3>You are on the founding list.</h3>
        <p>No account has been made and nothing is posted. We read this list by hand and will use it to invite people when the Community opens. We do not send email automatically yet, so there is no date to promise.</p>
        {state.durable === false && <p className="cm-found-warn">The server that holds this list can restart and lose what it holds. If you have not heard from us by the time the Community opens, sign up again.</p>}
      </div>
    );
  }

  const submit = async (event) => {
    event.preventDefault();
    setState({ status: 'sending', message: '', durable: null });
    try {
      const res = await submitFounding(form);
      setState({ status: 'done', message: '', durable: res.durable });
      onDone?.();
    } catch (err) {
      setState({ status: 'error', message: err.message, durable: null });
    }
  };

  return (
    <form className={`cm-found${compact ? ' cm-found-compact' : ''}`} onSubmit={submit} aria-label="Join the founding list">
      <h3>Join the founding list</h3>
      <p className="cm-found-lede">The Community is not open yet. This is a waiting list, not an account: leave your details and say what you would like to do, and we will invite you when there is somewhere safe to keep what members write.</p>

      <div className="cm-found-grid">
        <div className="fgroup"><label htmlFor={`${id}-name`}>Name</label><input id={`${id}-name`} value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={60} autoComplete="name" required /></div>
        <div className="fgroup"><label htmlFor={`${id}-email`}>Email</label><input id={`${id}-email`} type="email" value={form.email} onChange={(e) => set('email', e.target.value)} maxLength={254} autoComplete="email" required /><div className="hint">Never shown to anyone.</div></div>
        <div className="fgroup"><label htmlFor={`${id}-city`}>City</label><input id={`${id}-city`} value={form.city} onChange={(e) => set('city', e.target.value)} maxLength={60} autoComplete="address-level2" placeholder="Melbourne" /></div>
      </div>

      <fieldset className="cm-found-set">
        <legend>What would you like to do? <span className="hint">Up to three.</span></legend>
        <div className="cm-chips">
          {INTENTS.map((i) => (
            <button key={i.id} type="button" className="cm-chip" aria-pressed={form.intents.includes(i.id)} onClick={() => toggle('intents', i.id, 3)}>{i.label}</button>
          ))}
        </div>
      </fieldset>

      {skills.length > 0 && (
        <fieldset className="cm-found-set">
          <legend>What can you bring? <span className="hint">Optional, up to six.</span></legend>
          <div className="cm-chips">
            {skills.map((s) => <button key={s.id} type="button" className="cm-chip" aria-pressed={form.skills.includes(s.id)} onClick={() => toggle('skills', s.id, 6)}>{s.label}</button>)}
          </div>
        </fieldset>
      )}

      <div className="cm-found-grid cm-found-two">
        <div className="fgroup"><label htmlFor={`${id}-building`}>What are you building?</label><textarea id={`${id}-building`} rows={3} value={form.building} onChange={(e) => set('building', e.target.value)} maxLength={300} /></div>
        <div className="fgroup"><label htmlFor={`${id}-looking`}>What are you looking for?</label><textarea id={`${id}-looking`} rows={3} value={form.looking_for} onChange={(e) => set('looking_for', e.target.value)} maxLength={300} /></div>
      </div>
      <div className="fgroup"><label htmlFor={`${id}-link`}>A link to your work <span className="hint">Optional</span></label><input id={`${id}-link`} value={form.link} onChange={(e) => set('link', e.target.value)} maxLength={300} placeholder="https://" inputMode="url" /></div>

      {/* A field only a script fills in: people never see it. */}
      <div className="cm-hp" aria-hidden="true"><label>Company website<input tabIndex={-1} autoComplete="off" value={form.company_website} onChange={(e) => set('company_website', e.target.value)} /></label></div>

      <label className="auth-check cm-found-consent">
        <input type="checkbox" checked={form.consent} onChange={(e) => set('consent', e.target.checked)} />
        <span>You may keep these details to invite me to the Community. I understand this makes no account and that nothing is shared with other people.</span>
      </label>
      <p className="cm-found-fine">
        {founding?.durable === false
          ? 'Where this list is kept is erased when the server restarts, so a very recent sign-up can be lost.'
          : 'This list is kept on the server and read by hand.'}
        {' '}It is never public. To have your details removed, say so in the site’s feedback form.
      </p>
      {state.status === 'error' && <div className="form-error" role="alert">{state.message}</div>}
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={state.status === 'sending' || !form.consent}>{state.status === 'sending' ? 'Sending…' : 'Join the founding list'}</button>
      </div>
    </form>
  );
}
