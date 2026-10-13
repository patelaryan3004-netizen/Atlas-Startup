import { shortDate } from '../../freshness.js';
import { AppLink } from '../investors/common.jsx';
import { cardId } from '../IndexRow.jsx';
import RequestEdit from './RequestEdit.jsx';
import { ExternalLink, SourceList } from './PersonCard.jsx';

// One firm, in the same card as a person: its name (a page of its own in the app when it is one of the investors published in the
// Command Center), where it is and what it backs, its website, the pages behind it, and when it was checked.
export default function InstitutionCard({ institution, level = 2, onOpenInternal }) {
  const { id, name, city, stageFocus, sectors = [], website, sources = [], verifiedAt, href, placeholder } = institution;
  const Heading = `h${level}`;
  const verified = verifiedAt ? shortDate(verifiedAt) : null;
  return (
    <li className="person-card" id={cardId('institution', id)} tabIndex={-1}>
      {placeholder && <p className="person-placeholder">Placeholder: not a real firm. It is shown only on a machine that asks for placeholders.</p>}
      <Heading className="person-name">
        {href && onOpenInternal ? <AppLink href={href} onOpen={() => onOpenInternal(href)}>{name}</AppLink> : name}
      </Heading>
      {city && <p className="person-city">{city}</p>}
      {(stageFocus || sectors.length > 0) && (
        <dl className="person-facts">
          {stageFocus && <div><dt className="sr-only">Stage focus</dt><dd>{stageFocus}</dd></div>}
          {sectors.length > 0 && <div><dt className="sr-only">Sector focus</dt><dd>{sectors.join(', ')}</dd></div>}
        </dl>
      )}
      {website && <ul className="person-links" aria-label={`${name} online`}><li><ExternalLink href={website}>Website</ExternalLink></li></ul>}
      <SourceList sources={sources} />
      <div className="person-foot">
        {verified ? <span className="person-verified">Verified {verified}</span> : <span />}
        <RequestEdit entry={{ id, name, type: 'institution' }} />
      </div>
    </li>
  );
}
