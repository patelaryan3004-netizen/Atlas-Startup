import { useId } from 'react';
import { useSubscribe } from '../../hooks/useSubscribe.js';
import { ArrowRight } from '../explore/icons.jsx';

// An email form of the welcome page. Both of them (the circular-arrow field of the opening, the pill and the yellow button at the foot) are this one
// component on the same hook, so they validate, send and report the same way; `variant` is only how it is drawn. The words under the field are a status
// region: a screen reader hears "Sending", the success and the complaints as they happen.
export default function SubscribeForm({ variant = 'hero', source }) {
  const id = useId();
  const { email, setEmail, status, message, submit } = useSubscribe(source ?? variant);
  const field = `${id}-email`;
  const note = `${id}-note`;
  const hero = variant === 'hero';
  const sending = status === 'submitting';
  return (
    <form className={`se-sub se-sub-${variant}`} onSubmit={submit} noValidate>
      <label className="sr-only" htmlFor={field}>Your email address</label>
      <div className="se-sub-field">
        <input
          id={field}
          className="se-sub-input"
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          placeholder="Your email address"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-invalid={status === 'invalid' || status === 'error' ? 'true' : undefined}
          aria-describedby={note}
          readOnly={sending}
        />
        {hero ? (
          <button className="se-sub-go" type="submit" disabled={sending} aria-label="Join the feed">
            <ArrowRight size={18} />
          </button>
        ) : (
          <button className="se-sub-btn" type="submit" disabled={sending}>
            {sending ? 'Sending…' : 'Keep me inspired'} <ArrowRight size={18} />
          </button>
        )}
      </div>
      <p id={note} className="se-sub-note" role="status" aria-live="polite" data-status={status} hidden={!message}>
        {message}
      </p>
    </form>
  );
}
