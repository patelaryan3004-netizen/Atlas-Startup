import { useCallback, useEffect, useState } from 'react';
import { createProject, deleteProject, editProject, fetchInterested, fetchProjects, setInterest } from '../../networkApi.js';
import { useSession } from '../../session.js';
import { openAuth } from '../../authUi.js';
import { useDialog } from '../../hooks/useDialog.js';
import { CloseIcon, CheckIcon, PlusIcon } from '../explore/icons.jsx';
import { EmptyState } from '../brand/parts.jsx';
import { linkProps } from '../brand/nav.js';
import MemberAvatar from '../network/MemberAvatar.jsx';
import ReportDialog from '../network/ReportDialog.jsx';

const STAGE_FALLBACK = [{ id: 'idea', label: 'An idea' }, { id: 'prototype', label: 'A prototype' }, { id: 'building', label: 'Being built' }, { id: 'launched', label: 'Launched' }];
const labelIn = (list, id) => (list ?? []).find((x) => x.id === id)?.label ?? id;

// What a member shared to find people to work with. Projects are in the order they were shared, newest first, and are exactly what their authors wrote: the page does not rank, feature or
// vouch for any of them. "I'm interested" tells the author someone would like to talk and shares no contact; an introduction does that, and only when both agree.
export default function ProjectsPanel({ limit = 8, helpWanted = '', compact = false }) {
  const { member, taxonomy } = useSession();
  const [filters, setFilters] = useState({ stage: '', collaboration: helpWanted, skill: '', remote: false });
  const [state, setState] = useState({ status: 'loading', results: [], total: 0, error: '' });
  const [sharing, setSharing] = useState(false);
  const [reporting, setReporting] = useState(null);

  useEffect(() => { setFilters((f) => ({ ...f, collaboration: helpWanted })); }, [helpWanted]);

  const load = useCallback((signal) => {
    setState((s) => ({ ...s, status: 'loading' }));
    return fetchProjects({ ...filters, remote: filters.remote ? 'yes' : '', limit }, { signal })
      .then((res) => { if (!signal?.aborted) setState({ status: 'ready', results: res.results, total: res.total, error: '' }); })
      .catch((err) => { if (!signal?.aborted && err.name !== 'AbortError') setState({ status: 'error', results: [], total: 0, error: err.message }); });
  }, [filters, limit, member?.id]);
  useEffect(() => { const ctrl = new AbortController(); load(ctrl.signal); return () => ctrl.abort(); }, [load]);

  const replace = (project) => setState((s) => ({ ...s, results: s.results.map((p) => (p.id === project.id ? project : p)) }));
  const stages = taxonomy?.stages ?? STAGE_FALLBACK;
  const help = taxonomy?.collaboration ?? [];

  return (
    <div className="cm-projects">
      {!compact && (
        <div className="cm-filters" role="group" aria-label="Filter projects">
          <label className="cm-filter"><span>Looking for</span>
            <select value={filters.collaboration} onChange={(e) => setFilters({ ...filters, collaboration: e.target.value })}>
              <option value="">Any kind of help</option>
              {help.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
          <label className="cm-filter"><span>Stage</span>
            <select value={filters.stage} onChange={(e) => setFilters({ ...filters, stage: e.target.value })}>
              <option value="">Any stage</option>
              {stages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
          <label className="cm-filter"><span>Skill needed</span>
            <select value={filters.skill} onChange={(e) => setFilters({ ...filters, skill: e.target.value })}>
              <option value="">Any skill</option>
              {(taxonomy?.skills ?? []).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
          <label className="cm-check"><input type="checkbox" checked={filters.remote} onChange={(e) => setFilters({ ...filters, remote: e.target.checked })} /><span>Can be done remotely</span></label>
        </div>
      )}

      {state.status === 'loading' && <p className="cm-quiet" role="status">Loading projects…</p>}
      {state.status === 'error' && <div className="home-error" role="alert"><p>Could not load projects. {state.error}</p><button type="button" className="btn btn-secondary btn-sm" onClick={() => load()}>Try again</button></div>}
      {state.status === 'ready' && state.results.length === 0 && (
        <EmptyState title={filters.stage || filters.collaboration || filters.skill || filters.remote ? 'No project matches these filters.' : 'No project has been shared yet.'}
          action={member ? <button type="button" className="btn btn-primary btn-sm" onClick={() => setSharing(true)}><PlusIcon size={16} /> Share a project</button> : null}>
          {member ? 'Share the first: what it is, the problem it solves, and what help you are looking for.' : 'Members can share a project or an idea and ask for help with it.'}
        </EmptyState>
      )}
      {state.status === 'ready' && state.results.length > 0 && (
        <ul className="cm-rows" aria-label="Projects and collaboration requests">
          {state.results.map((p) => <li key={p.id}><ProjectCard project={p} taxonomy={taxonomy} compact={compact} onChange={replace} onGone={() => load()} onReport={() => setReporting(p.id)} /></li>)}
        </ul>
      )}
      {state.status === 'ready' && state.total > state.results.length && <p className="cm-quiet">{state.total - state.results.length} more. Narrow it with the filters above.</p>}

      {!compact && (
        <div className="cm-actions">
          {member
            ? <button type="button" className="btn btn-primary" onClick={() => setSharing(true)}><PlusIcon size={16} /> Share a project or an idea</button>
            : <button type="button" className="btn btn-primary" onClick={() => openAuth({ mode: 'signup', reason: 'share a project' })}>Join to share a project</button>}
        </div>
      )}
      {sharing && <ProjectDialog taxonomy={taxonomy} onClose={() => setSharing(false)} onSaved={() => { setSharing(false); load(); }} />}
      {reporting && <ReportDialog kind="project" id={reporting} onClose={() => setReporting(null)} />}
    </div>
  );
}

function ProjectCard({ project: p, taxonomy, compact, onChange, onGone, onReport }) {
  const { member } = useSession();
  const [busy, setBusy] = useState(false);
  const [who, setWho] = useState(null);
  const [error, setError] = useState('');
  const chips = [labelIn(taxonomy?.stages ?? STAGE_FALLBACK, p.stage), ...p.collaboration.map((c) => labelIn(taxonomy?.collaboration, c)), p.remote ? (p.city ? `${p.city} or remote` : 'Remote') : p.city].filter(Boolean);

  const toggleInterest = async () => {
    if (!member) { openAuth({ mode: 'signup', reason: "say you're interested" }); return; }
    setBusy(true); setError('');
    try {
      const res = await setInterest(p.id, !p.interested);
      onChange({ ...p, interested: res.interested, interested_count: res.interested_count });
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const showWho = async () => { try { setWho((await fetchInterested(p.id)).results); } catch (err) { setError(err.message); } };
  const patch = async (changes) => { setBusy(true); try { onChange((await editProject(p.id, changes)).project); } catch (err) { setError(err.message); } finally { setBusy(false); } };
  const remove = async () => { setBusy(true); try { await deleteProject(p.id); onGone(); } catch (err) { setError(err.message); setBusy(false); } };

  return (
    <article className="cm-project" aria-label={`Project: ${p.name}`}>
      <h3 className="cm-project-name">{p.name}{!p.open && <span className="cm-closed">Closed</span>}</h3>
      <p className="cm-project-sum">{p.summary}</p>
      {!compact && p.problem && <p className="cm-project-problem"><strong>The problem.</strong> {p.problem}</p>}
      <ul className="cm-meta" aria-label="About this project">{chips.map((c) => <li key={c}>{c}</li>)}</ul>
      {!compact && p.skills_needed.length > 0 && <p className="cm-project-skills">Needs {p.skills_needed.map((s) => labelIn(taxonomy?.skills, s)).join(', ')}.</p>}
      <div className="cm-project-foot">
        <a className="cm-by" {...linkProps(`/members/${encodeURIComponent(p.owner.id ?? '')}`)}>
          <MemberAvatar name={p.owner.name} size="sm" /><span>{p.owner.name}{p.owner.city ? ` · ${p.owner.city}` : ''}</span>
        </a>
        <div className="cm-project-actions">
          {!p.mine && p.open && (
            <button type="button" className="btn btn-secondary btn-sm cm-interest" aria-pressed={p.interested} onClick={toggleInterest} disabled={busy}>
              {p.interested ? <><CheckIcon size={16} /> You are interested</> : 'I’m interested'}
            </button>
          )}
          {p.mine && (
            <>
              <button type="button" className="btn btn-quiet btn-sm" onClick={showWho}>{p.interested_count} interested</button>
              <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={() => patch({ open: !p.open })}>{p.open ? 'Close' : 'Reopen'}</button>
              <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={remove}>Delete</button>
            </>
          )}
          {!p.mine && p.interested_count > 0 && <span className="cm-count">{p.interested_count} interested</span>}
          {!p.mine && member && <button type="button" className="btn btn-quiet btn-sm" onClick={onReport}>Report</button>}
        </div>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {who && (
        <div className="cm-who">
          {who.length === 0 ? <p className="cm-quiet">No one has said they are interested yet.</p> : (
            <ul>{who.map((r) => <li key={r.member.id}><a href={`/members/${encodeURIComponent(r.member.id)}`}>{r.member.name}</a>{r.member.role ? `, ${r.member.role}` : ''}</li>)}</ul>
          )}
          <p className="cm-quiet">You see their public profile only. To share contact details, ask for an introduction from their profile; it needs them to agree.</p>
        </div>
      )}
    </article>
  );
}

// Sharing a project: the fields a collaborator needs to decide whether to get in touch.
function ProjectDialog({ taxonomy, onClose, onSaved }) {
  const { titleId, overlayProps, panelProps } = useDialog(onClose);
  const [f, setF] = useState({ name: '', summary: '', problem: '', stage: 'idea', skills_needed: [], collaboration: [], interests: [], city: '', remote: false });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key, value) => setF((x) => ({ ...x, [key]: value }));
  const toggle = (key, id, max) => setF((x) => ({ ...x, [key]: x[key].includes(id) ? x[key].filter((v) => v !== id) : x[key].length < max ? [...x[key], id] : x[key] }));
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true); setError('');
    try { await createProject(f); onSaved(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const chips = (key, list, max) => (
    <div className="cm-chips">{(list ?? []).map((x) => { const id = x.id ?? x; return <button key={id} type="button" className="cm-chip" aria-pressed={f[key].includes(id)} onClick={() => toggle(key, id, max)}>{x.label ?? x}</button>; })}</div>
  );
  return (
    <div className="modal-overlay" {...overlayProps}>
      <div className="modal-panel cm-dialog" {...panelProps}>
        <button type="button" className="modal-close" aria-label="Close" onClick={onClose}><CloseIcon size={20} /></button>
        <form onSubmit={submit}>
          <h2 id={titleId}>Share a project or an idea</h2>
          <p className="modal-sub">It is public, and it is what you write: the site does not check or endorse it. Say what help you are looking for, so the right people can get in touch.</p>
          <div className="fgroup"><label htmlFor="pjName">Name</label><input id="pjName" value={f.name} onChange={(e) => set('name', e.target.value)} maxLength={80} required /></div>
          <div className="fgroup"><label htmlFor="pjSum">What is it?</label><textarea id="pjSum" rows={3} value={f.summary} onChange={(e) => set('summary', e.target.value)} maxLength={600} required /><div className="hint">{f.summary.length}/600</div></div>
          <div className="fgroup"><label htmlFor="pjProb">The problem it solves <span className="hint">Optional</span></label><textarea id="pjProb" rows={2} value={f.problem} onChange={(e) => set('problem', e.target.value)} maxLength={300} /></div>
          <div className="fgroup"><label htmlFor="pjStage">How far along is it?</label>
            <select id="pjStage" value={f.stage} onChange={(e) => set('stage', e.target.value)}>{(taxonomy?.stages ?? STAGE_FALLBACK).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></div>
          <fieldset className="cm-found-set"><legend>What help are you looking for? <span className="hint">Up to three.</span></legend>{chips('collaboration', taxonomy?.collaboration, 3)}</fieldset>
          <fieldset className="cm-found-set"><legend>Skills it needs <span className="hint">Optional, up to six.</span></legend>{chips('skills_needed', taxonomy?.skills, 6)}</fieldset>
          <fieldset className="cm-found-set"><legend>Sectors <span className="hint">Optional, up to three.</span></legend>{chips('interests', taxonomy?.interests, 3)}</fieldset>
          <div className="cm-found-grid">
            <div className="fgroup"><label htmlFor="pjCity">City</label><input id="pjCity" value={f.city} onChange={(e) => set('city', e.target.value)} maxLength={60} placeholder="Melbourne" /></div>
            <label className="auth-check cm-remote"><input type="checkbox" checked={f.remote} onChange={(e) => set('remote', e.target.checked)} /><span>It can be done remotely</span></label>
          </div>
          {error && <div className="form-error" role="alert">{error}</div>}
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Sharing…' : 'Share'}</button>
            <button type="button" className="btn btn-quiet" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}
