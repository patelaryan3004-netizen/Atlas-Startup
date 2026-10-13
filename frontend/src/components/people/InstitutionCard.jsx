import { shortDate } from '../../freshness.js';
import { AppLink } from '../investors/common.jsx';
import { cardId } from '../IndexRow.jsx';
import EntityCard, { Avatar } from '../EntityCard.jsx';
import RequestEdit from './RequestEdit.jsx';
import { ExternalLink, SourceList } from './PersonCard.jsx';

// One firm, in the same card as a person and a company: its name (a page of its own in the app when it is one of the investors published
// in the Command Center), what it backs and where it is, its website, the pages behind it, and when it was checked. A firm has no
// description line: none has been written for it, and none is made up.
export default function InstitutionCard({ institution, as = 'li', level = 2, onOpenInternal }) {
  const { id, name, city, stageFocus, sectors = [], website, sources = [], verifiedAt, href, placeholder } = institution;
  const verified = verifiedAt ? shortDate(verifiedAt) : null;
  return (
    <EntityCard
      as={as}
      level={level}
      className="person-card"
      id={cardId('institution', id)}
      tabIndex={-1}
      avatar={<Avatar name={name} website={website} />}
      name={href && onOpenInternal ? <AppLink href={href} onOpen={() => onOpenInternal(href)}>{name}</AppLink> : name}
      meta={[sectors.join(', '), stageFocus, city]}
      metaLabel="Sector focus, stage focus and place"
    >
      {placeholder && <p className="person-placeholder">Placeholder: not a real firm. It is shown only on a machine that asks for placeholders.</p>}
      {website && <ul className="person-links" aria-label={`${name} online`}><li><ExternalLink href={website}>Website</ExternalLink></li></ul>}
      <SourceList sources={sources} />
      <div className="person-foot">
        {verified ? <span className="person-verified">Verified {verified}</span> : <span />}
        <RequestEdit entry={{ id, name, type: 'institution' }} />
      </div>
    </EntityCard>
  );
}
