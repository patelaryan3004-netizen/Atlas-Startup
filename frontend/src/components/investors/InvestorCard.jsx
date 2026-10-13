import { AppLink, VerifiedMark, listText, plural, stageText } from './common.jsx';
import { investorHref } from './route.js';
import { cardId } from '../IndexRow.jsx';
import EntityCard, { Avatar } from '../EntityCard.jsx';

// One investor in the directory, on the app's one card: who it is, what it invests in and where, and how much of its portfolio a page
// backs. Only what is known is written: a line with nothing behind it is left out, never filled in. The name is the one link; it reaches
// over the whole card, so the card is one target and one tab stop ("View investor →" is its label for the eye, and is not read out twice).
export default function InvestorCard({ investor, onOpen }) {
  const { slug, name, domain, type_label: type, location, stages, sectors, portfolio_count: portfolio, status, active_status: active, verified_at: verifiedAt } = investor;
  const stopped = status === 'inactive' || active === 'inactive';
  return (
    <EntityCard
      as="li"
      level={2}
      className="inv-card"
      id={cardId('investor', slug)}
      tabIndex={-1}
      avatar={<Avatar name={name} domain={domain} />}
      name={<AppLink className="inv-card-link" href={investorHref(slug)} onOpen={() => onOpen(slug)}>{name}</AppLink>}
      aside={<VerifiedMark at={verifiedAt} compact />}
      blurb={type}
      meta={[listText(sectors), stageText(stages), location?.label]}
      metaLabel="Sector focus, stage focus and place"
    >
      <div className="inv-card-foot">
        {portfolio > 0 && <span className="inv-card-count">{plural(portfolio, 'connected company', 'connected companies')}</span>}
        {stopped && <span className="inv-tag">No longer investing</span>}
        <span className="inv-card-cta" aria-hidden="true">View investor <span className="inv-card-arrow">→</span></span>
      </div>
    </EntityCard>
  );
}
