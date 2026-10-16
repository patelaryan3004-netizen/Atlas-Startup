import { useRef, useState } from 'react';
import { submitFeedback } from '../api.js';

// The one implementation behind both email forms of the welcome page (the hero's and the footer's): the address is checked in the browser, sent to the
// site's own server (the feedback endpoint, type "subscribe": api.js, backend/src/routes/feedback.js) and the form says it worked only once that server
// has answered that it stored it. `source` is where the address was left ("hero", "footer"); it goes in the note that is stored with it.
//
// status: 'idle' | 'invalid' | 'submitting' | 'success' | 'error'; message: what the form says about it, '' when it has nothing to say.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const isEmail = (text) => text.length <= 254 && EMAIL.test(text);

// What a failure says to the visitor: the server's own refusal of the address in plain words, or that it could not be reached, or a general line.
export function failureText(error) {
  const said = String(error?.message ?? '');
  if (/valid email/i.test(said)) return 'That does not look like an email address. Check it and try again.';
  if (error instanceof TypeError || /failed to fetch|network/i.test(said)) return 'We could not reach the server. Check your connection and try again.';
  return 'Something went wrong saving that. Please try again in a moment.';
}

export function useSubscribe(source) {
  const [email, setEmailState] = useState('');
  const [state, setState] = useState({ status: 'idle', message: '' });
  const busy = useRef(false);

  // Typing again clears a complaint about the last attempt, and nothing else (a success stays until the next try).
  const setEmail = (value) => {
    setEmailState(value);
    setState((now) => (now.status === 'invalid' || now.status === 'error' ? { status: 'idle', message: '' } : now));
  };

  const submit = async (event) => {
    event?.preventDefault?.();
    if (busy.current) return;
    const address = email.trim();
    if (!isEmail(address)) {
      setState({ status: 'invalid', message: address ? 'That does not look like an email address. Check it and try again.' : 'Enter your email address first.' });
      return;
    }
    busy.current = true;
    setState({ status: 'submitting', message: 'Sending…' });
    try {
      await submitFeedback({ type: 'subscribe', email: address, message: `Signup: ${source}` });
      setEmailState('');
      setState({ status: 'success', message: 'You are on the list. We will be in touch.' });
    } catch (error) {
      setState({ status: 'error', message: failureText(error) });
    } finally {
      busy.current = false;
    }
  };

  return { email, setEmail, status: state.status, message: state.message, submit };
}
