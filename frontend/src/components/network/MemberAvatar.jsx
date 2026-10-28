import { initialsOf } from './AccountMenu.jsx';

// A person's picture is their initials: the site has nowhere to keep photos yet, and never makes up a face. `size` is sm, md or lg.
export default function MemberAvatar({ name, size = 'md', className = '' }) {
  return <span className={`avatar avatar-${size}${className ? ` ${className}` : ''}`} aria-hidden="true">{initialsOf(name) || '·'}</span>;
}
