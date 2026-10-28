import { usePopover } from '../../hooks/usePopover.js';
import { useSession, signOut } from '../../session.js';
import { openAuth } from '../../authUi.js';
import { linkProps } from '../brand/nav.js';
import { UserIcon } from '../explore/icons.jsx';

export const initialsOf = (name) => String(name ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => [...w][0].toUpperCase()).join('');

// The person's corner of the header. Signed out: one quiet button that opens the sign-in dialog. Signed in: their initials, and under them what belongs to
// them (their profile, what they saved) and signing out. There is no photo: a profile has initials until the site has somewhere to keep pictures.
export default function AccountMenu({ go = {}, savedCount = 0 }) {
  const { status, member } = useSession();
  const { open, setOpen, ref } = usePopover();

  if (status !== 'in' || !member) {
    return (
      <button type="button" className="sh-signin" onClick={() => openAuth({ mode: 'signin' })} aria-haspopup="dialog">
        <UserIcon size={20} /><span>Sign in</span>
      </button>
    );
  }

  const item = (id, href, label, extra = null) => (
    <a
      className="am-item"
      role="menuitem"
      {...linkProps(href, go[id])}
      onClickCapture={() => setOpen(false)}
    >
      {label}{extra}
    </a>
  );

  return (
    <div className="am" ref={ref}>
      <button type="button" className="am-btn" aria-label={`Your account, ${member.name}`} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((v) => !v)}>
        <span className="avatar avatar-sm" aria-hidden="true">{initialsOf(member.name)}</span>
      </button>
      {open && (
        <div className="am-panel" role="menu">
          <div className="am-who">
            <strong>{member.name}</strong>
            {member.role && <span>{member.role}</span>}
          </div>
          {item('me', '/me', 'Your profile')}
          {item('saved', '/saved', 'Saved', savedCount > 0 ? <span className="am-count">{savedCount}</span> : null)}
          <button type="button" className="am-item" role="menuitem" onClick={() => { setOpen(false); signOut(); }}>Sign out</button>
        </div>
      )}
    </div>
  );
}
