import { useCallback, useState } from 'react';
import SiteHeader from '../brand/SiteHeader.jsx';
import { EmptyState } from '../brand/parts.jsx';
import {
  adminApprove, adminDecideReport, adminMembers, adminReject, adminReports, adminSuggestions, adminSummary, adminSuspend,
} from '../../networkApi.js';
import { usePageMeta } from '../../hooks/usePageMeta.js';
import { dayLabel, timeAgo } from './time.js';

const today = () => new Date().toISOString().slice(0, 10);
const REASONS = { spam: 'Spam or an advert', abuse: 'Rude, hateful or threatening', misleading: 'Misleading or untrue', off_topic: 'Off topic', other: 'Something else' };

function ReportCard({ row, onDecide }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const decide = async (action) => { setBusy(true); try { await onDecide(row, action, note); } finally { setBusy(false); } };
  return (
    <li className="mod-card">
      <p className="mod-meta">{row.target_kind === 'post' ? 'Post' : 'Reply'} by <strong>{row.author?.name ?? 'a former member'}</strong>{row.author?.suspended ? ' (suspended)' : ''} · written {timeAgo(row.created_at)} · {row.status === 'hidden' ? 'hidden now' : 'visible'}</p>
      <blockquote className="mod-body">{row.body || '(no words left)'}</blockquote>
      <ul className="mod-reports">{row.reports.map((r) => <li key={r.id}><strong>{REASONS[r.reason] ?? r.reason}</strong>{r.note ? `: ${r.note}` : ''} <span className="mod-dim">· {timeAgo(r.created_at)}</span></li>)}</ul>
      <div className="fgroup"><label htmlFor={`note-${row.target_id}`}>A note for the record, optional</label><input id={`note-${row.target_id}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} /></div>
      <div className="form-actions">
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => decide('dismiss')}>Leave it up</button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy || row.status === 'hidden'} onClick={() => decide('hide')}>Hide for now</button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => decide('remove')}>Remove</button>
        <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={() => decide('suspend_author')}>Remove and suspend the author</button>
      </div>
    </li>
  );
}

function SuggestionCard({ row, zones, onApprove, onReject }) {
  const event = row.kind === 'event';
  const d = row.data;
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(event
    ? { timezone: zones[0], audience: '', why_selected: '', source_checked_at: today(), source_url: d.registration_url, cost_status: 'unconfirmed', cost_note: '' }
    : { retrieved_at: today(), why: '' });
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const approve = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await onApprove(row.id, event
        ? { timezone: f.timezone, audience: f.audience, why_selected: f.why_selected, source_checked_at: f.source_checked_at, source_url: f.source_url, cost: { status: f.cost_status, ...(f.cost_note ? { note: f.cost_note } : {}) }, review_note: note }
        : { retrieved_at: f.retrieved_at, why: f.why, review_note: note });
    } catch (err) { setError(err.message); }
  };

  return (
    <li className="mod-card">
      <p className="mod-meta"><strong>{event ? 'Event' : 'Role'}</strong> suggested {timeAgo(row.created_at)}{row.contact_email ? ` · ${row.contact_email}` : ''}</p>
      <dl className="mod-facts">
        {Object.entries(d).filter(([, v]) => v !== '' && v !== null && v !== false).map(([k, v]) => (
          <div key={k}><dt>{k.replace(/_/g, ' ')}</dt><dd>{typeof v === 'string' && /^https:\/\//.test(v) ? <a href={v} target="_blank" rel="noopener noreferrer">{v}</a> : String(v)}</dd></div>
        ))}
      </dl>
      {!open ? (
        <div className="form-actions">
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>Check and approve…</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onReject(row.id, note)}>Reject</button>
          <input aria-label="Why it was rejected (optional)" className="mod-note" placeholder="Reason, optional" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
        </div>
      ) : (
        <form onSubmit={approve} className="mod-form">
          <p className="mod-dim">Open the page, check every fact against it, and fill in what the page says. Nothing is listed until this is saved.</p>
          {event ? (
            <>
              <div className="fgroup"><label htmlFor={`tz-${row.id}`}>Time zone</label><select id={`tz-${row.id}`} value={f.timezone} onChange={set('timezone')}>{zones.map((z) => <option key={z}>{z}</option>)}</select></div>
              <div className="fgroup"><label htmlFor={`au-${row.id}`}>Who it is useful for</label><input id={`au-${row.id}`} value={f.audience} onChange={set('audience')} /></div>
              <div className="fgroup"><label htmlFor={`wy-${row.id}`}>Why it is listed (a reason, not a ranking)</label><input id={`wy-${row.id}`} value={f.why_selected} onChange={set('why_selected')} /></div>
              <div className="fgroup"><label htmlFor={`su-${row.id}`}>The page the details were read from</label><input id={`su-${row.id}`} value={f.source_url} onChange={set('source_url')} /></div>
              <div className="fgroup"><label htmlFor={`sc-${row.id}`}>The day you read it</label><input id={`sc-${row.id}`} value={f.source_checked_at} onChange={set('source_checked_at')} /></div>
              <div className="fgroup"><label htmlFor={`cs-${row.id}`}>Cost</label><select id={`cs-${row.id}`} value={f.cost_status} onChange={set('cost_status')}><option value="free">Free (the page says so)</option><option value="paid">Paid</option><option value="unconfirmed">Not confirmed</option></select></div>
              <div className="fgroup"><label htmlFor={`cn-${row.id}`}>Cost note, optional</label><input id={`cn-${row.id}`} value={f.cost_note} onChange={set('cost_note')} /></div>
            </>
          ) : (
            <>
              <div className="fgroup"><label htmlFor={`rd-${row.id}`}>The day you read the employer&rsquo;s page</label><input id={`rd-${row.id}`} value={f.retrieved_at} onChange={set('retrieved_at')} /></div>
              <div className="fgroup"><label htmlFor={`wh-${row.id}`}>Why it is listed (a fact, not praise)</label><input id={`wh-${row.id}`} value={f.why} onChange={set('why')} /></div>
            </>
          )}
          {error && <div className="form-error" role="alert">{error}</div>}
          <div className="form-actions">
            <button type="submit" className="btn btn-primary btn-sm">Approve and list</button>
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => setOpen(false)}>Back</button>
          </div>
        </form>
      )}
    </li>
  );
}

// The moderators' page: the reports to read, the suggestions to check, and the members. It is not linked from anywhere. It asks for the moderator key, keeps it in
// this page's memory only (never in storage), and sends it with each request: every decision is made, and checked, by the server.
export default function ModerationPage({ chrome = {} }) {
  usePageMeta({ title: 'Moderation · Still Early', path: '/moderation' });
  const [key, setKey] = useState('');
  const [typed, setTyped] = useState('');
  const [summary, setSummary] = useState(null);
  const [tab, setTab] = useState('reports');
  const [reports, setReports] = useState([]);
  const [suggestions, setSuggestions] = useState({ results: [], zones: [] });
  const [members, setMembers] = useState([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async (k = key) => {
    const [s, r, g] = await Promise.all([adminSummary(k), adminReports(k), adminSuggestions(k)]);
    setSummary(s); setReports(r.results); setSuggestions(g);
  }, [key]);

  const open = async (event) => {
    event.preventDefault();
    setError('');
    try { await refresh(typed); setKey(typed); setTyped(''); } catch (err) { setError(err.message); }
  };

  const findMembers = async (event) => { event?.preventDefault(); setMembers((await adminMembers(key, search)).results); };

  return (
    <div id="moderationView" className="page-shell">
      <SiteHeader active={null} go={chrome.go} counts={chrome.counts} menu={chrome.menu} />
      <main className="disc" id="main">
        <header className="disc-head"><h1 className="serif-h1">Moderation</h1><p className="lede">Reports, suggestions and members. Every decision is checked by the server.</p></header>

        {!key ? (
          <form className="mod-key" onSubmit={open} aria-label="Moderator key">
            <div className="fgroup"><label htmlFor="modKey">Moderator key</label><input id="modKey" type="password" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} /><div className="hint">Held in this page&rsquo;s memory only. Closing the tab forgets it.</div></div>
            {error && <div className="form-error" role="alert">{error}</div>}
            <div className="form-actions"><button type="submit" className="btn btn-primary" disabled={!typed}>Open</button></div>
          </form>
        ) : (
          <>
            {summary && <p className="disc-count" role="status">{summary.members} members · {summary.posts} posts · {summary.open_reports} open reports · {summary.pending_suggestions} suggestions waiting{summary.suspended ? ` · ${summary.suspended} suspended` : ''}</p>}
            <div className="tabs" role="tablist" aria-label="Moderation">
              {[['reports', `Reports (${reports.length})`], ['suggestions', `Suggestions (${suggestions.results.length})`], ['members', 'Members']].map(([id, label]) => (
                <button key={id} type="button" role="tab" className="tab" aria-selected={tab === id} onClick={() => { setTab(id); if (id === 'members') findMembers(); }}>{label}</button>
              ))}
            </div>

            {tab === 'reports' && (reports.length === 0 ? <EmptyState title="Nothing to read.">No open reports.</EmptyState> : (
              <ul className="mod-list">{reports.map((row) => <ReportCard key={`${row.target_kind}:${row.target_id}`} row={row} onDecide={async (r, action, note) => { await adminDecideReport(key, r.target_kind, r.target_id, action, note); await refresh(); }} />)}</ul>
            ))}

            {tab === 'suggestions' && (suggestions.results.length === 0 ? <EmptyState title="Nothing to check.">No suggestions are waiting.</EmptyState> : (
              <ul className="mod-list">{suggestions.results.map((row) => <SuggestionCard key={row.id} row={row} zones={suggestions.zones} onApprove={async (id, completed) => { await adminApprove(key, id, completed); await refresh(); }} onReject={async (id, note) => { await adminReject(key, id, note); await refresh(); }} />)}</ul>
            ))}

            {tab === 'members' && (
              <>
                <form className="disc-filters" onSubmit={findMembers}><label className="field"><input type="search" aria-label="Search members" placeholder="Name or email" value={search} onChange={(e) => setSearch(e.target.value)} /></label><button type="submit" className="btn btn-secondary btn-sm">Search</button></form>
                <ul className="mod-list">
                  {members.map((m) => (
                    <li key={m.id} className="mod-card mod-member">
                      <div><strong>{m.name}</strong> <span className="mod-dim">{m.email} · joined {dayLabel(m.created_at)}</span>{m.suspended && <span className="mod-flag"> · suspended</span>}</div>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={async () => { await adminSuspend(key, m.id, !m.suspended, ''); await findMembers(); await refresh(); }}>{m.suspended ? 'Lift suspension' : 'Suspend'}</button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
