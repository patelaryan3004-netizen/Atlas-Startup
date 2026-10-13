import { shortDate } from '../../freshness.js';
import { AppLink } from '../investors/common.jsx';
import { cardId } from '../IndexRow.jsx';
import EntityCard, { Avatar } from '../EntityCard.jsx';
import Vouch from '../Vouch.jsx';
import RequestEdit from './RequestEdit.jsx';
import '../../people.css';

// A link to someone else's page: a new tab, with no way for that page to reach back, and said so to a screen reader.
export function ExternalLink({ href, children }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}<span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

export function SourceList({ sources }) {
  if (!sources?.length) return null;
  return (
    <details className="person-sources">
      <summary>Sources ({sources.length})</summary>
      <ul>{sources.map((s) => <li key={s.url}><ExternalLink href={s.url}>{s.label}</ExternalLink></li>)}</ul>
    </details>
  );
}

const LINKS = [['website', 'Website'], ['linkedin', 'LinkedIn'], ['x', 'X']];

// One person, in the app's one card: who they are and where, why they are worth following, where to find them, the pages behind
// it, who vouched for them, and when it was checked. A line with nothing behind it is left out, never filled in. `href` is a page the
// app already has for this person (an investor's), opened in the app. `level` is the heading level of the name.
export default function PersonCard({ person, as: Tag = 'li', level = 2, onOpenInternal }) {
  const { id, name, title, orgName, city, whyFollow, links = {}, sources = [], verifiedAt, vouches = [], href, placeholder } = person;
  const verified = verifiedAt ? shortDate(verifiedAt) : null;
  const found = LINKS.filter(([key]) => links[key]);
  return (
    <EntityCard
      as={Tag}
      level={level}
      className="person-card"
      id={cardId('person', id)}
      tabIndex={-1}
      avatar={<Avatar name={name} />}
      name={href && onOpenInternal ? <AppLink href={href} onOpen={() => onOpenInternal(href)}>{name}</AppLink> : name}
      blurb={whyFollow}
      meta={[title, orgName, city]}
      metaLabel="Role, organisation and place"
    >
      {placeholder && <p className="person-placeholder">Placeholder: not a real person. It is shown only on a machine that asks for placeholders.</p>}
      {found.length > 0 && (
        <ul className="person-links" aria-label={`${name} online`}>
          {found.map(([key, label]) => <li key={key}><ExternalLink href={links[key]}>{label}</ExternalLink></li>)}
        </ul>
      )}
      {vouches.length > 0 && (
        <details className="person-vouches">
          <summary>Vouched by {vouches.length}</summary>
          <div className="person-vouch-list">{vouches.map((v, i) => <Vouch key={i} name={v.name} role={v.role} note={v.note} />)}</div>
        </details>
      )}
      <SourceList sources={sources} />
      <div className="person-foot">
        {verified ? <span className="person-verified">Verified {verified}</span> : <span />}
        <RequestEdit entry={{ id, name, type: 'person' }} />
      </div>
    </EntityCard>
  );
}
