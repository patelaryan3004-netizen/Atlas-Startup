import Wordmark from '../brand/Wordmark.jsx';
import { SearchIcon, SlidersIcon, ArrowRight, CloseIcon, CheckIcon, BookmarkIcon, MoreIcon } from '../explore/icons.jsx';
import { SceneTurbines, SceneCoast, SceneGlasshouse, SceneIsland, SceneStudio, SceneSilhouette, SceneBuilding, SceneMountain, SproutMark } from './scenes.jsx';

// The product previews of the welcome page: what taking part is going to look like, drawn with the site's own parts. They are PREVIEWS: the names, the
// work and the pictures are illustrations made for this page (nothing here is a member, and none of it is in any database), and nothing in them does
// anything: each is wrapped by <Preview>, which hides it from a screen reader and takes it out of the tab order and out of reach of a click, and the
// section around it says in words that it is illustrative. What is real on the page is outside them: the headings, the stages' names, the links, the forms.

// The wrapper of every preview. A screen reader skips it (the section round it has one sentence in its place).
export function Preview({ className = '', children }) {
  return (
    <div className={`wp ${className}`} aria-hidden="true" {...{ inert: '' }} data-preview>
      {children}
    </div>
  );
}
export const PreviewNote = ({ children, className = '' }) => <p className={`se-demo-note ${className}`}>{children}</p>;

const Avatar = ({ initials, tone, size }) => <span className={`wp-avatar wp-tone-${tone}`} style={size ? { '--size': `${size}px` } : undefined}>{initials}</span>;
const Chips = ({ items }) => <span className="wp-chips">{items.map((item) => <i key={item}>{item}</i>)}</span>;

// People, Startups and Investors, a search, and one person's profile with a piece of their work: "Find your people. Start something."
export function DiscoveryCard() {
  return (
    <div className="wp-card wp-discovery">
      <div className="wp-d-head">
        <Wordmark className="wp-d-mark" />
        <span className="wp-tabs"><b className="is-on">People</b><b>Startups</b><b>Investors</b></span>
      </div>
      <div className="wp-search"><SearchIcon size={16} /><span>Who are you curious about?</span><span className="wp-square"><SlidersIcon size={15} /></span></div>
      <div className="wp-person">
        <Avatar initials="AC" tone="indigo" size={46} />
        <span className="wp-person-text">
          <b>Alex Chen</b>
          <small>Product designer · Melbourne</small>
          <Chips items={['Product', 'Climate', 'Design']} />
        </span>
        <span className="wp-follow">Follow</span>
        <MoreIcon size={16} className="wp-more" />
      </div>
      <SceneTurbines className="wp-work-img" />
      <b className="wp-work-title">Making energy easier to understand</b>
      <span className="wp-work-text">A visual guide to household energy and how we can build a cleaner future.</span>
    </div>
  );
}

// The small panel over its corner: "Open to collaborate".
export function CollaboratePanel() {
  const options = [['Found a startup', true], ['Join a team', false], ['Share my work', false], ['Invest or advise', false]];
  return (
    <div className="wp-card wp-collab">
      <div className="wp-collab-head"><b>Open to collaborate</b><CloseIcon size={13} /></div>
      <span className="wp-collab-icon"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="9" cy="9" r="3" /><circle cx="17" cy="10" r="2.2" /><path d="M3.5 19c.6-3 2.7-4.6 5.5-4.6s4.9 1.6 5.5 4.6M15 15.2c2.6-.5 4.8.7 5.5 3.6" /></svg></span>
      <b className="wp-collab-title">Open to collaborate</b>
      <span className="wp-collab-text">Let the right people know what you’re interested in.</span>
      <ul className="wp-checks">
        {options.map(([label, on]) => (
          <li key={label}><span className={`wp-box${on ? ' is-on' : ''}`}>{on && <CheckIcon size={11} />}</span>{label}</li>
        ))}
      </ul>
      <span className="wp-save">Save preferences <ArrowRight size={14} /></span>
    </div>
  );
}

// Projects, Work history and Collaborators, with two samples: "Let your work introduce you."
export function PortfolioPreview() {
  return (
    <div className="wp-portfolio">
      <div className="wp-tabs wp-tabs-line"><b className="is-on">Projects</b><b>Work history</b><b>Collaborators</b></div>
      <div className="wp-window">
        <span className="wp-dots-row" aria-hidden="true"><i /><i /><i /></span>
        <div className="wp-samples">
          <div className="wp-sample">
            <SceneCoast className="wp-sample-img" />
            <b>Product teardown</b>
            <span>A deep dive into a climate app’s onboarding experience.</span>
            <Chips items={['Product', 'UK', 'Analysis']} />
          </div>
          <div className="wp-sample">
            <SceneGlasshouse className="wp-sample-img" />
            <b>Climate research</b>
            <span>Notes, interviews and opportunities in the clean energy space.</span>
            <Chips items={['Research', 'Climate', 'Strategy']} />
          </div>
        </div>
      </div>
    </div>
  );
}

const PROFILES = [
  { initials: 'JP', tone: 'violet', name: 'Jamie Park', line: 'Founder · Melbourne', chips: ['Climate', 'Hardware', 'Startups'] },
  { initials: 'LS', tone: 'forest', name: 'Leah Singh', line: 'Operator · Sydney', chips: ['Growth', 'Product', 'Community'] },
  { initials: 'MK', tone: 'butter', name: 'Marcus Kim', line: 'Investor · Perth', chips: ['Early stage', 'Climate', 'B2B'] },
];

// Three people: a founder, an operator and an investor: "Meet people worth knowing."
export function ProfileStack() {
  return (
    <div className="wp-stack">
      {PROFILES.map((p) => (
        <div className="wp-profile" key={p.name}>
          <Avatar initials={p.initials} tone={p.tone} size={58} />
          <span className="wp-profile-text">
            <b>{p.name}</b>
            <small>{p.line}</small>
            <Chips items={p.chips} />
          </span>
          <span className="wp-view">View profile <ArrowRight size={12} /></span>
          <MoreIcon size={14} className="wp-more" />
        </div>
      ))}
    </div>
  );
}

const COLLECTIONS = [
  { Scene: SceneIsland, name: 'Climate builders', line: 'People working on a cleaner future' },
  { Scene: SceneStudio, name: 'First startup roles', line: 'Early opportunities, real impact' },
  { Scene: SceneSilhouette, name: 'People to watch', line: 'Interesting builders and operators' },
];

// Three collections to follow: "Follow your curiosity."
export function CollectionLinks() {
  return (
    <ul className="wp-collections">
      {COLLECTIONS.map(({ Scene, name, line }) => (
        <li key={name}>
          <span className="wp-thumb"><Scene /></span>
          <span className="wp-collection-text"><b>{name}</b><small>{line}</small></span>
          <ArrowRight size={14} />
        </li>
      ))}
    </ul>
  );
}

// A private collection of saved people: "Keep your best discoveries."
export function SavedCollection() {
  return (
    <div className="wp-saved">
      <div className="wp-saved-head"><span><b>My next chapter</b><small>A private collection</small></span><MoreIcon size={16} className="wp-more wp-more-v" /></div>
      <ul>
        <li><Avatar initials="RW" tone="indigo" size={38} /><span className="wp-saved-text"><b>Riley Watson</b><small>Founder · Melbourne</small></span><span className="wp-thumb wp-thumb-wide"><SceneBuilding /></span><BookmarkIcon size={16} fill="currentColor" /></li>
        <li><Avatar initials="NT" tone="sand" size={38} /><span className="wp-saved-text"><b>Noah Tan</b><small>Product · Sydney</small></span><span className="wp-thumb wp-thumb-wide"><SceneMountain /></span><BookmarkIcon size={16} fill="currentColor" /></li>
      </ul>
    </div>
  );
}

// The three cards of the hiring preview, one per stage: a role, a place to add a work sample, a message from a founder.
export function RoleCard() {
  return (
    <div className="wp-card wp-role">
      <SproutMark className="wp-role-mark" />
      <b>Growth associate</b>
      <small>Early-stage team · Melbourne</small>
      <span className="wp-role-text">Help us find and connect with the next wave of climate builders.</span>
      <span className="wp-dark-btn">See the brief <ArrowRight size={13} /></span>
    </div>
  );
}
export function UploadCard() {
  return (
    <div className="wp-card wp-upload">
      <svg viewBox="0 0 40 48" width="34" height="42" aria-hidden="true"><path d="M6 2h20l10 10v32a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="#e4e8e4" /><path d="M26 2v10h10" fill="#cfd5cf" /><path d="M11 22h18M11 29h18M11 36h12" stroke="#fafaf7" strokeWidth="2.4" strokeLinecap="round" /></svg>
      <b>Upload a work sample</b>
      <small>PDF, link or portfolio</small>
      <span className="wp-ghost-btn">Add file</span>
    </div>
  );
}
export function MessageCard() {
  return (
    <div className="wp-card wp-message">
      <span className="wp-message-head"><Avatar initials="AC" tone="violet" size={40} /><span><b>Alex Chen</b><small>Founder</small></span></span>
      <span className="wp-bubble">Your project caught our eye. Would love to chat!</span>
      <span className="wp-dark-btn">Send a message <ArrowRight size={13} /></span>
    </div>
  );
}
