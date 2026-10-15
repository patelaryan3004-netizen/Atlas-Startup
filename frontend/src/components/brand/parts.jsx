import { Avatar } from '../EntityCard.jsx';
import { BookmarkIcon } from '../explore/icons.jsx';

// The small shared pieces every page is made of (the styles are in brand.css; BRAND_GUIDELINES.md says when to use which). A page that needs one of
// these uses it and does not draw its own.

// A switch between a few ways of looking at the same thing: All / Startups / VCs, Map / List, Cards / Table. `options` is [{ id, label, badge, icon }];
// each is a button that says whether it is on (aria-pressed), so a screen reader hears the state and not only the look.
export function Segmented({ label, options, value, onChange, className = '' }) {
  return (
    <div className={className ? `seg ${className}` : 'seg'} role="group" aria-label={label}>
      {options.map(({ id, label: text, badge = null, icon = null }) => (
        <button key={id} type="button" className="seg-item" aria-pressed={value === id} onClick={() => onChange(id)}>
          {icon}
          <span className="seg-text">{text}</span>
          {badge}
        </button>
      ))}
    </div>
  );
}

// "VC" on butter yellow: what marks an investor wherever it sits among companies.
export function VcBadge({ className = '' }) {
  return <span className={className ? `badge badge-vc ${className}` : 'badge badge-vc'}>VC</span>;
}

export function Badge({ tone = 'quiet', children, className = '' }) {
  return <span className={`badge badge-${tone}${className ? ` ${className}` : ''}`}>{children}</span>;
}

// The one way to save a company or an investor (kept in this browser): a bookmark that is filled when it is saved.
export function BookmarkButton({ name, saved, onToggle, className = '' }) {
  return (
    <button
      type="button"
      className={className ? `bm ${className}` : 'bm'}
      aria-pressed={saved}
      aria-label={saved ? `Remove ${name} from saved` : `Save ${name}`}
      title={saved ? 'Saved in this browser' : 'Save (kept in this browser)'}
      onClick={onToggle}
    >
      <BookmarkIcon size={22} fill={saved ? 'currentColor' : 'none'} />
    </button>
  );
}

// What a page says when there is nothing to show: what is missing, why, and the one thing to do about it.
export function EmptyState({ title, children, action = null }) {
  return (
    <div className="empty-state" role="status">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

// A company or an investor as one line: its logo (its first letter when there is none), its name, what it is, and the bookmark. `selected` is the one
// that is open on the map; pressing the row picks it. An investor says VC beside its name.
export function CompanyRow({ name, website = null, domain = null, sub = '', vc = false, hiring = false, extra = null, selected = false, onSelect, saved = false, onToggleSaved, rowRef }) {
  return (
    <li className="crow" aria-current={selected ? 'true' : undefined} ref={rowRef}>
      <button type="button" className="crow-main" onClick={onSelect}>
        <Avatar name={name} website={website} domain={domain} size={56} className="crow-logo" />
        <span className="crow-text">
          <span className="crow-name"><span>{name}</span>{vc && <VcBadge />}{hiring && <Badge tone="green">Hiring</Badge>}{extra}</span>
          {sub && <span className="crow-sub">{sub}</span>}
        </span>
      </button>
      {onToggleSaved && <BookmarkButton name={name} saved={saved} onToggle={onToggleSaved} />}
    </li>
  );
}
