import { useState } from 'react';
import { createReply, deletePost, deleteReply, editPost, editReply, fetchThread, setLike } from '../../networkApi.js';
import { useSession } from '../../session.js';
import { openAuth } from '../../authUi.js';
import { useSavedKind } from '../../savedStore.js';
import { usePopover } from '../../hooks/usePopover.js';
import { BookmarkIcon, ChatIcon, HeartIcon, MoreIcon } from '../explore/icons.jsx';
import MemberAvatar from './MemberAvatar.jsx';
import ReportDialog from './ReportDialog.jsx';
import { fullDate, timeAgo } from './time.js';
import { linkProps } from '../brand/nav.js';

export const TOPICS = [
  { id: 'idea', label: 'Idea' },
  { id: 'question', label: 'Question' },
  { id: 'building', label: 'Building' },
  { id: 'feedback', label: 'Feedback' },
  { id: 'win', label: 'Small win' },
];
const MAX_POST = 600;
const MAX_REPLY = 400;

function Byline({ author, created, edited, status }) {
  const person = author.id ? <a className="pc-name" {...linkProps(`/members/${author.id}`)}>{author.name}</a> : <span className="pc-name">{author.name}</span>;
  return (
    <div className="pc-by">
      <MemberAvatar name={author.name} />
      <div className="pc-who">
        <span className="pc-line">{person}</span>
        <span className="pc-sub">
          {[author.role, author.city].filter(Boolean).join(' · ')}
          {(author.role || author.city) && ' · '}
          <time dateTime={created} title={fullDate(created)}>{timeAgo(created)}</time>
          {edited && <span title={`Edited ${fullDate(edited)}`}> · edited</span>}
          {status === 'hidden' && <span className="pc-hidden"> · hidden while a moderator looks at it</span>}
        </span>
      </div>
    </div>
  );
}

// "More" for a post or a reply: the author can change or delete it, anyone else can report it.
function ItemMenu({ label, mine, onEdit, onDelete, onReport }) {
  const { open, setOpen, ref } = usePopover();
  return (
    <div className="pc-more" ref={ref}>
      <button type="button" className="pc-act pc-act-icon" aria-label={label} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((v) => !v)}>
        <MoreIcon size={20} />
      </button>
      {open && (
        <div className="pc-menu" role="menu">
          {mine ? (
            <>
              <button type="button" role="menuitem" onClick={() => { setOpen(false); onEdit(); }}>Edit</button>
              <button type="button" role="menuitem" onClick={() => { setOpen(false); onDelete(); }}>Delete</button>
            </>
          ) : (
            <button type="button" role="menuitem" onClick={() => { setOpen(false); onReport(); }}>Report</button>
          )}
        </div>
      )}
    </div>
  );
}

// An edit box for a post or a reply: the words, a count, Save and Cancel.
function Editor({ initial, max, label, topic = null, onSave, onCancel }) {
  const [text, setText] = useState(initial);
  const [pick, setPick] = useState(topic);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try { await onSave({ body: text, ...(topic ? { topic: pick } : {}) }); } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <form className="pc-edit" onSubmit={save}>
      {topic && (
        <label className="pc-edit-topic">Topic
          <select value={pick} onChange={(e) => setPick(e.target.value)}>{TOPICS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
        </label>
      )}
      <textarea aria-label={label} value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={max} />
      <div className="pc-edit-row">
        <span className="pc-count" aria-live="polite">{text.length}/{max}</span>
        {error && <span className="form-error" role="alert">{error}</span>}
        <button type="button" className="btn btn-quiet btn-sm" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !text.trim()}>Save</button>
      </div>
    </form>
  );
}

function Reply({ reply, onChange, onRemove, onReport }) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  return (
    <li className="pc-reply">
      <Byline author={reply.author} created={reply.created_at} edited={reply.edited_at} status={reply.status} />
      {editing ? (
        <Editor initial={reply.body} max={MAX_REPLY} label="Edit your reply" onCancel={() => setEditing(false)} onSave={async ({ body }) => { const { reply: next } = await editReply(reply.id, body); onChange(next); setEditing(false); }} />
      ) : (
        <p className="pc-body">{reply.body}</p>
      )}
      {deleting ? (
        <div className="pc-confirm" role="alertdialog" aria-label="Delete this reply?">
          <span>Delete this reply?</span>
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => setDeleting(false)}>Keep it</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={async () => { await deleteReply(reply.id); onRemove(reply.id); }}>Delete</button>
        </div>
      ) : !editing && (
        <div className="pc-actions pc-actions-reply">
          <ItemMenu label="More actions for this reply" mine={reply.mine} onEdit={() => setEditing(true)} onDelete={() => setDeleting(true)} onReport={() => onReport(reply)} />
        </div>
      )}
    </li>
  );
}

// One post: who wrote it, the topic, the words, and what a person can do with it (like, reply, bookmark, and edit, delete or report).
export default function PostCard({ post: initial, onRemoved }) {
  const { member } = useSession();
  const bookmarks = useSavedKind('post');
  const [post, setPost] = useState(initial);
  const [thread, setThread] = useState(null); // null: closed; { replies, loading, error }
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reporting, setReporting] = useState(null);
  const [draft, setDraft] = useState('');
  const [replyError, setReplyError] = useState('');
  const [sending, setSending] = useState(false);
  const [liking, setLiking] = useState(false);

  const needAccount = (reason, fn) => (member ? fn() : openAuth({ mode: 'signin', reason }));

  const like = () => needAccount('like', async () => {
    if (liking) return;
    setLiking(true);
    const was = post.liked;
    setPost((p) => ({ ...p, liked: !was, like_count: p.like_count + (was ? -1 : 1) }));
    try {
      const res = await setLike(post.id, !was);
      setPost((p) => ({ ...p, liked: res.liked, like_count: res.like_count }));
    } catch (e) {
      setPost((p) => ({ ...p, liked: was, like_count: p.like_count + (was ? 1 : -1) }));
    } finally { setLiking(false); }
  });

  const toggleThread = async () => {
    if (thread) { setThread(null); return; }
    setThread({ replies: [], loading: true });
    try {
      const res = await fetchThread(post.id);
      setThread({ replies: res.replies, loading: false });
    } catch (e) {
      setThread({ replies: [], loading: false, error: e.message });
    }
  };

  const sendReply = (event) => {
    event.preventDefault();
    needAccount('reply', async () => {
      setSending(true);
      setReplyError('');
      try {
        const { reply } = await createReply(post.id, draft);
        setThread((t) => ({ ...t, replies: [...t.replies, reply] }));
        setPost((p) => ({ ...p, reply_count: p.reply_count + 1 }));
        setDraft('');
      } catch (err) { setReplyError(err.message); } finally { setSending(false); }
    });
  };

  const bookmarked = bookmarks.has(post.id);

  return (
    <article className="pc" aria-label={`Post by ${post.author.name}`}>
      <header className="pc-head">
        <Byline author={post.author} created={post.created_at} edited={post.edited_at} status={post.status} />
        <span className={`pc-topic pc-topic-${post.topic}`}>{post.topic_label}</span>
      </header>

      {editing ? (
        <Editor
          initial={post.body} max={MAX_POST} label="Edit your post" topic={post.topic}
          onCancel={() => setEditing(false)}
          onSave={async (fields) => { const { post: next } = await editPost(post.id, fields); setPost((p) => ({ ...p, ...next, liked: p.liked })); setEditing(false); }}
        />
      ) : (
        <p className="pc-body">{post.body}</p>
      )}

      {deleting ? (
        <div className="pc-confirm" role="alertdialog" aria-label="Delete this post?">
          <span>Delete this post? Its replies go with it.</span>
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => setDeleting(false)}>Keep it</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={async () => { await deletePost(post.id); onRemoved(post.id); }}>Delete</button>
        </div>
      ) : !editing && (
        <div className="pc-actions">
          <button type="button" className="pc-act" aria-pressed={post.liked} onClick={like} aria-label={`${post.liked ? 'Unlike' : 'Like'}, ${post.like_count} ${post.like_count === 1 ? 'like' : 'likes'}`}>
            <HeartIcon size={20} fill={post.liked ? 'currentColor' : 'none'} /><span>{post.like_count || ''}</span>
          </button>
          <button type="button" className="pc-act" aria-expanded={Boolean(thread)} onClick={toggleThread} aria-label={`${thread ? 'Hide' : 'Show'} replies, ${post.reply_count}`}>
            <ChatIcon size={20} /><span>{post.reply_count > 0 ? post.reply_count : 'Reply'}</span>
          </button>
          <button type="button" className="pc-act" aria-pressed={bookmarked} onClick={() => bookmarks.toggle(post.id)} aria-label={bookmarked ? 'Remove bookmark' : 'Bookmark this post'}>
            <BookmarkIcon size={20} fill={bookmarked ? 'currentColor' : 'none'} />
          </button>
          <span className="pc-spacer" />
          <ItemMenu label="More actions for this post" mine={post.mine} onEdit={() => setEditing(true)} onDelete={() => setDeleting(true)} onReport={() => needAccount('report', () => setReporting({ kind: 'post', id: post.id }))} />
        </div>
      )}

      {thread && (
        <section className="pc-thread" aria-label="Replies">
          {thread.loading && <p className="pc-quiet" role="status">Loading replies…</p>}
          {thread.error && <p className="form-error" role="alert">{thread.error}</p>}
          {!thread.loading && !thread.error && thread.replies.length === 0 && <p className="pc-quiet">No replies yet.</p>}
          {thread.replies.length > 0 && (
            <ul className="pc-replies">
              {thread.replies.map((r) => (
                <Reply
                  key={r.id}
                  reply={r}
                  onChange={(next) => setThread((t) => ({ ...t, replies: t.replies.map((x) => (x.id === next.id ? next : x)) }))}
                  onRemove={(id) => { setThread((t) => ({ ...t, replies: t.replies.filter((x) => x.id !== id) })); setPost((p) => ({ ...p, reply_count: Math.max(0, p.reply_count - 1) })); }}
                  onReport={(reply) => needAccount('report', () => setReporting({ kind: 'reply', id: reply.id }))}
                />
              ))}
            </ul>
          )}
          <form className="pc-reply-form" onSubmit={sendReply}>
            <textarea aria-label="Write a reply" placeholder={member ? 'Write a reply…' : 'Sign in to reply'} value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} maxLength={MAX_REPLY} onFocus={() => { if (!member) openAuth({ mode: 'signin', reason: 'reply' }); }} />
            <div className="pc-edit-row">
              <span className="pc-count" aria-live="polite">{draft.length}/{MAX_REPLY}</span>
              {replyError && <span className="form-error" role="alert">{replyError}</span>}
              <button type="submit" className="btn btn-primary btn-sm" disabled={sending || !draft.trim()}>Reply</button>
            </div>
          </form>
        </section>
      )}

      {reporting && <ReportDialog kind={reporting.kind} id={reporting.id} onClose={() => setReporting(null)} />}
    </article>
  );
}
