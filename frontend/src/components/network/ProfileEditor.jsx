import { useEffect, useState } from 'react';
import SiteHeader from '../brand/SiteHeader.jsx';
import { EmptyState } from '../brand/parts.jsx';
import { changePassword, deleteAccount, updateProfile } from '../../networkApi.js';
import { ensureStatus, setMember, signOut, useSession } from '../../session.js';
import { openAuth } from '../../authUi.js';
import { usePageMeta } from '../../hooks/usePageMeta.js';
import { OPEN_TO_LABELS } from './MemberProfile.jsx';
import MemberAvatar from './MemberAvatar.jsx';
import { IntroInbox } from '../community/Introductions.jsx';
import { INTENTS } from '../community/intents.js';

const blankProject = () => ({ title: '', url: '', note: '' });

// Your profile, at /me: a name, a role and a city, a short introduction, what you are building, where to see your work, what you are open to, and whether
// you want to be listed in Discover. Short on purpose. There is no photo (the site has nowhere to keep one) and no badge: this is what you say about yourself.
export default function ProfileEditor({ chrome = {}, onViewPublic }) {
  const { status, member, open, taxonomy } = useSession();
  usePageMeta({ title: 'Your profile · Still Early', path: '/me' });
  useEffect(() => { ensureStatus(); }, []);

  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ kind: '', text: '' });

  useEffect(() => {
    if (member && !form) {
      setForm({
        name: member.name, role: member.role, city: member.city, intro: member.intro, listed: member.listed, open_to: member.open_to,
        building: member.building.length ? member.building : [blankProject()], website: member.links.website, professional_profile: member.links.professional_profile,
        github: member.links.github ?? '', portfolio: member.links.portfolio ?? '', looking_for: member.looking_for ?? [], skills: member.skills ?? [], interests: member.interests ?? [],
        remote: Boolean(member.remote), contact: member.contact ?? '', past: member.past?.length ? member.past : [blankProject()],
      });
    }
  }, [member, form]);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const setProject = (i, key, value) => setForm((f) => ({ ...f, building: f.building.map((p, at) => (at === i ? { ...p, [key]: value } : p)) }));
  const setPast = (i, key, value) => setForm((f) => ({ ...f, past: f.past.map((p, at) => (at === i ? { ...p, [key]: value } : p)) }));
  const toggle = (key, id, max) => setForm((f) => ({ ...f, [key]: f[key].includes(id) ? f[key].filter((x) => x !== id) : f[key].length < max ? [...f[key], id] : f[key] }));

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    setMessage({ kind: '', text: '' });
    try {
      const { member: next } = await updateProfile({
        name: form.name, role: form.role, city: form.city, intro: form.intro, listed: form.listed, open_to: form.open_to,
        building: form.building.filter((p) => p.title.trim() || p.url.trim() || p.note.trim()),
        links: { website: form.website, professional_profile: form.professional_profile, github: form.github, portfolio: form.portfolio },
        looking_for: form.looking_for, skills: form.skills, interests: form.interests, remote: form.remote, contact: form.contact,
        past: form.past.filter((p) => p.title.trim() || p.url.trim() || p.note.trim()),
      });
      setMember(next);
      setForm(null);
      setMessage({ kind: 'ok', text: 'Saved.' });
    } catch (err) {
      setMessage({ kind: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div id="profileEditView" className="page-shell">
      <SiteHeader active="home" go={chrome.go} counts={chrome.counts} menu={chrome.menu} />
      <main className="home" id="main">
        <header className="home-head">
          <p className="kicker">Your profile</p>
          <h1 className="serif-h1">Tell people what you <em>do.</em></h1>
          <p className="lede">Keep it short. Show what you are building or have worked on, and how to find it.</p>
        </header>

        {open === false && <EmptyState title="The community is not open yet.">Profiles open when the community does.</EmptyState>}
        {open !== false && status !== 'in' && status !== 'loading' && (
          <EmptyState
            title="Sign in to edit your profile."
            action={<button type="button" className="btn btn-primary" onClick={() => openAuth({ mode: 'signin' })}>Sign in</button>}
          >
            Your profile is where your posts link to, and where you say what you are open to.
          </EmptyState>
        )}
        {status === 'loading' && <p className="home-quiet" role="status">Loading…</p>}

        {member && form && (
          <>
            <form className="pe" onSubmit={save} aria-label="Edit your profile">
              <div className="pe-top"><MemberAvatar name={form.name || member.name} size="xl" /><p className="pe-note">Your picture is your initials for now: the site does not store photos yet.</p></div>

              <div className="pe-grid">
                <div className="fgroup"><label htmlFor="peName">Name</label><input id="peName" value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={60} autoComplete="name" /></div>
                <div className="fgroup"><label htmlFor="peRole">Role</label><input id="peRole" value={form.role} onChange={(e) => set('role', e.target.value)} maxLength={80} placeholder="Founder at …, student at …, engineer looking for a first startup" /></div>
                <div className="fgroup"><label htmlFor="peCity">City</label><input id="peCity" value={form.city} onChange={(e) => set('city', e.target.value)} maxLength={60} placeholder="Melbourne" /></div>
              </div>

              <div className="fgroup">
                <label htmlFor="peIntro">Introduction</label>
                <textarea id="peIntro" rows={3} value={form.intro} onChange={(e) => set('intro', e.target.value)} maxLength={300} />
                <div className="hint">{form.intro.length}/300. Who you are and what you care about, in a few lines.</div>
              </div>

              <fieldset className="pe-open">
                <legend>I am open to</legend>
                {Object.entries(OPEN_TO_LABELS).map(([id, label]) => (
                  <label key={id} className="auth-check">
                    <input type="checkbox" checked={form.open_to.includes(id)} onChange={(e) => set('open_to', e.target.checked ? [...form.open_to, id] : form.open_to.filter((x) => x !== id))} />
                    <span>{label}</span>
                  </label>
                ))}
              </fieldset>

              <fieldset className="pe-open">
                <legend>What are you looking for? <span className="hint">Up to four. This is what matches use.</span></legend>
                <div className="cm-chips">{INTENTS.map((i) => <button key={i.id} type="button" className="cm-chip" aria-pressed={form.looking_for.includes(i.id)} onClick={() => toggle('looking_for', i.id, 4)}>{i.label}</button>)}</div>
              </fieldset>
              <fieldset className="pe-open">
                <legend>What can you bring? <span className="hint">Up to eight.</span></legend>
                <div className="cm-chips">{(taxonomy?.skills ?? []).map((s) => <button key={s.id} type="button" className="cm-chip" aria-pressed={form.skills.includes(s.id)} onClick={() => toggle('skills', s.id, 8)}>{s.label}</button>)}</div>
              </fieldset>
              <fieldset className="pe-open">
                <legend>Sectors you care about <span className="hint">Up to six.</span></legend>
                <div className="cm-chips">{(taxonomy?.interests ?? []).map((s) => <button key={s} type="button" className="cm-chip" aria-pressed={form.interests.includes(s)} onClick={() => toggle('interests', s, 6)}>{s}</button>)}</div>
              </fieldset>
              <label className="auth-check pe-listed"><input type="checkbox" checked={form.remote} onChange={(e) => set('remote', e.target.checked)} /><span>I am open to working remotely.</span></label>

              <fieldset className="pe-projects">
                <legend>What you are building or have worked on</legend>
                {form.building.map((p, i) => (
                  <div key={i} className="pe-project">
                    <div className="fgroup"><label htmlFor={`peP${i}t`}>Project {i + 1}</label><input id={`peP${i}t`} value={p.title} onChange={(e) => setProject(i, 'title', e.target.value)} maxLength={80} placeholder="Name" /></div>
                    <div className="fgroup"><label htmlFor={`peP${i}u`}>Link</label><input id={`peP${i}u`} value={p.url} onChange={(e) => setProject(i, 'url', e.target.value)} maxLength={300} placeholder="https://" inputMode="url" /></div>
                    <div className="fgroup"><label htmlFor={`peP${i}n`}>A line about it</label><input id={`peP${i}n`} value={p.note} onChange={(e) => setProject(i, 'note', e.target.value)} maxLength={200} /></div>
                    {form.building.length > 1 && <button type="button" className="btn btn-quiet btn-sm" onClick={() => set('building', form.building.filter((_, at) => at !== i))}>Remove</button>}
                  </div>
                ))}
                {form.building.length < 5 && <button type="button" className="btn btn-secondary btn-sm" onClick={() => set('building', [...form.building, blankProject()])}>Add another</button>}
              </fieldset>

              <fieldset className="pe-projects">
                <legend>Previous projects and contributions</legend>
                {form.past.map((p, i) => (
                  <div key={i} className="pe-project">
                    <div className="fgroup"><label htmlFor={`peQ${i}t`}>Project or contribution {i + 1}</label><input id={`peQ${i}t`} value={p.title} onChange={(e) => setPast(i, 'title', e.target.value)} maxLength={80} placeholder="Open-source library, a startup you worked at, a talk" /></div>
                    <div className="fgroup"><label htmlFor={`peQ${i}u`}>Link</label><input id={`peQ${i}u`} value={p.url} onChange={(e) => setPast(i, 'url', e.target.value)} maxLength={300} placeholder="https://" inputMode="url" /></div>
                    <div className="fgroup"><label htmlFor={`peQ${i}n`}>Your part in it</label><input id={`peQ${i}n`} value={p.note} onChange={(e) => setPast(i, 'note', e.target.value)} maxLength={200} /></div>
                    {form.past.length > 1 && <button type="button" className="btn btn-quiet btn-sm" onClick={() => set('past', form.past.filter((_, at) => at !== i))}>Remove</button>}
                  </div>
                ))}
                {form.past.length < 5 && <button type="button" className="btn btn-secondary btn-sm" onClick={() => set('past', [...form.past, blankProject()])}>Add another previous project</button>}
              </fieldset>

              <div className="pe-grid">
                <div className="fgroup"><label htmlFor="peWeb">Website</label><input id="peWeb" value={form.website} onChange={(e) => set('website', e.target.value)} maxLength={300} placeholder="https://" inputMode="url" /></div>
                <div className="fgroup"><label htmlFor="peLi">Professional profile</label><input id="peLi" value={form.professional_profile} onChange={(e) => set('professional_profile', e.target.value)} maxLength={300} placeholder="https://" inputMode="url" /></div>
              </div>

              <div className="pe-grid">
                <div className="fgroup"><label htmlFor="peGh">GitHub</label><input id="peGh" value={form.github} onChange={(e) => set('github', e.target.value)} maxLength={300} placeholder="https://github.com/…" inputMode="url" /></div>
                <div className="fgroup"><label htmlFor="pePf">Portfolio</label><input id="pePf" value={form.portfolio} onChange={(e) => set('portfolio', e.target.value)} maxLength={300} placeholder="https://" inputMode="url" /></div>
              </div>
              <div className="fgroup">
                <label htmlFor="peContact">Contact for introductions</label>
                <input id="peContact" value={form.contact} onChange={(e) => set('contact', e.target.value)} maxLength={120} placeholder="An email address or a link" />
                <div className="hint">Private. It is shown only to someone you both agree to be introduced to, and only after they accept. Your email is never shown.</div>
              </div>

              <label className="auth-check pe-listed">
                <input type="checkbox" checked={form.listed} onChange={(e) => set('listed', e.target.checked)} />
                <span><strong>List me in Discover, under People.</strong> Anyone can open your profile from a post either way. Listing makes you findable by search.</span>
              </label>

              <div className="form-actions">
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save profile'}</button>
                <button type="button" className="btn btn-quiet" onClick={() => onViewPublic(member.id)}>View my public profile</button>
                {message.text && <span className={message.kind === 'error' ? 'form-error' : 'pe-saved'} role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</span>}
              </div>
            </form>

            <IntroInbox />

            <AccountSection />
          </>
        )}
      </main>
    </div>
  );
}

// Your password, and leaving. Leaving takes your account, posts, replies and saved things with it, and cannot be undone.
function AccountSection() {
  const { member } = useSession();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [pwMessage, setPwMessage] = useState({ kind: '', text: '' });
  const [leaving, setLeaving] = useState(false);
  const [password, setPassword] = useState('');
  const [leaveError, setLeaveError] = useState('');

  const savePassword = async (event) => {
    event.preventDefault();
    setPwMessage({ kind: '', text: '' });
    try { await changePassword(current, next); setCurrent(''); setNext(''); setPwMessage({ kind: 'ok', text: 'Password changed. Other devices have been signed out.' }); } catch (err) { setPwMessage({ kind: 'error', text: err.message }); }
  };
  const leave = async (event) => {
    event.preventDefault();
    setLeaveError('');
    try { await deleteAccount(password); await signOut(); window.location.assign('/home'); } catch (err) { setLeaveError(err.message); }
  };

  return (
    <section className="pe-account" aria-labelledby="pe-account-h">
      <h2 id="pe-account-h" className="mp-h">Your account</h2>
      <p className="pe-note">Signed in as {member.email}. Only you can see your email.</p>
      <form className="pe-pw" onSubmit={savePassword} aria-label="Change your password">
        <div className="fgroup"><label htmlFor="pwCur">Current password</label><input id="pwCur" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></div>
        <div className="fgroup"><label htmlFor="pwNew">New password</label><input id="pwNew" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></div>
        <div className="form-actions">
          <button type="submit" className="btn btn-secondary btn-sm" disabled={!current || !next}>Change password</button>
          {pwMessage.text && <span className={pwMessage.kind === 'error' ? 'form-error' : 'pe-saved'} role={pwMessage.kind === 'error' ? 'alert' : 'status'}>{pwMessage.text}</span>}
        </div>
      </form>
      <div className="pe-leave">
        {!leaving ? (
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => setLeaving(true)}>Delete my account</button>
        ) : (
          <form onSubmit={leave} aria-label="Delete your account">
            <p className="pe-note">This deletes your account, your posts and replies, your likes and everything you saved. It cannot be undone. Enter your password to go ahead.</p>
            <div className="fgroup"><label htmlFor="leavePw">Password</label><input id="leavePw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
            {leaveError && <div className="form-error" role="alert">{leaveError}</div>}
            <div className="form-actions">
              <button type="submit" className="btn btn-secondary btn-sm" disabled={!password}>Delete everything</button>
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => { setLeaving(false); setPassword(''); setLeaveError(''); }}>Keep my account</button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
