import { useState } from 'react';
import { createPost } from '../../networkApi.js';
import { useSession } from '../../session.js';
import { openAuth } from '../../authUi.js';
import MemberAvatar from './MemberAvatar.jsx';
import { TOPICS } from './PostCard.jsx';

const MAX = 600;
const HINTS = {
  idea: 'What if…?',
  question: 'What do you want to know?',
  building: 'What are you building, and where are you stuck?',
  feedback: 'What would you like feedback on?',
  win: 'What went well this week?',
};

// Where a post starts. Signed in: choose what it is (an idea, a question, something you are building, a request for feedback, a small win), write it
// short, and post. Signed out: the same box says why it is closed and how to open it. Nothing is posted for anyone but the person who is signed in.
export default function Composer({ onPosted }) {
  const { member } = useSession();
  const [topic, setTopic] = useState('idea');
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!member) {
    return (
      <section className="cmp cmp-out" aria-label="Share something">
        <p className="cmp-lead">Share an idea, ask a question, or show what you are building.</p>
        <div className="cmp-actions">
          <button type="button" className="btn btn-primary" onClick={() => openAuth({ mode: 'signup', reason: 'post' })}>Join to post</button>
          <button type="button" className="btn btn-quiet" onClick={() => openAuth({ mode: 'signin', reason: 'post' })}>Sign in</button>
        </div>
      </section>
    );
  }

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { post } = await createPost({ topic, body });
      setBody('');
      onPosted(post);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="cmp" onSubmit={submit} aria-label="Share something">
      <div className="cmp-top">
        <MemberAvatar name={member.name} />
        <div className="cmp-topics" role="group" aria-label="What is this?">
          {TOPICS.map((t) => (
            <button key={t.id} type="button" className="cmp-topic" aria-pressed={topic === t.id} onClick={() => setTopic(t.id)}>{t.label}</button>
          ))}
        </div>
      </div>
      <textarea
        aria-label="Your post"
        placeholder={HINTS[topic]}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        maxLength={MAX}
      />
      <div className="cmp-foot">
        <span className="pc-count" aria-live="polite">{body.length}/{MAX}</span>
        {error && <span className="form-error" role="alert">{error}</span>}
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !body.trim()}>{busy ? 'Posting…' : 'Post'}</button>
      </div>
    </form>
  );
}
