import { AppLink, SaveButton, VerifiedMark, listText, plural, stageText } from './common.jsx';
import { investorHref } from './route.js';
import { cardId } from '../IndexRow.jsx';
import EntityCard, { Avatar } from '../EntityCard.jsx';

// What nobody states is a dash, read out as what it is: nothing is known, which is not the same as none.
function Stated({ children }) {
  return children ? <>{children}</> : (
    <>
      <span aria-hidden="true">–</span>
      <span className="sr-only">Not stated</span>
    </>
  );
}

// One investor in the directory, on the app's one card: its logo and name, what it invests in (focus), at which stage and where, and how much of its
// portfolio a page backs. The three facts are always there, a dash where none is stated: a blank is never filled in. The name is the one link; it
// reaches over the whole card, so the card is one target and one tab stop ("View profile →" is its label for the eye, and is not read out twice).
// The bookmark sits above that link, so saving never opens the investor.
export default function InvestorCard({ investor, onOpen, selected = false, saved = false, onToggleSaved }) {
  const { slug, name, domain, type_label: type, location, stages, sectors, portfolio_count: portfolio, status, active_status: active, verified_at: verifiedAt } = investor;
  const stopped = status === 'inactive' || active === 'inactive';
  return (
    <EntityCard
      as="li"
      level={2}
      className={selected ? 'inv-card inv-card-on' : 'inv-card'}
      id={cardId('investor', slug)}
      tabIndex={-1}
      avatar={<Avatar name={name} domain={domain} size={60} className="inv-avatar" />}
      name={<AppLink className="inv-card-link" href={investorHref(slug)} onOpen={() => onOpen(slug)} aria-current={selected ? 'true' : undefined}>{name}</AppLink>}
      aside={<SaveButton name={name} saved={saved} onToggle={() => onToggleSaved(slug)} />}
    >
      {(type || verifiedAt) && (
        <p className="inv-card-type">
          {type && <span>{type}</span>}
          <VerifiedMark at={verifiedAt} compact />
        </p>
      )}
      <dl className="inv-card-facts">
        <div><dt>Focus</dt><dd title={sectors.join(', ') || undefined}><Stated>{listText(sectors, 3)}</Stated></dd></div>
        <div><dt>Stage</dt><dd><Stated>{stageText(stages)}</Stated></dd></div>
        <div><dt>Location</dt><dd><Stated>{location?.label}</Stated></dd></div>
      </dl>
      <div className="inv-card-foot">
        {portfolio > 0 && <span className="inv-card-count">{plural(portfolio, 'connected company', 'connected companies')}</span>}
        {stopped && <span className="inv-tag">No longer investing</span>}
        <span className="inv-card-cta" aria-hidden="true">View profile <span className="inv-card-arrow">→</span></span>
      </div>
    </EntityCard>
  );
}
