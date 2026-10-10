import { AppLink, InvestorLogo, VerifiedMark, listText, plural, stageText } from './common.jsx';
import { investorHref } from './route.js';

// One investor in the directory: who it is, what it invests in and where, and how much of its portfolio a page backs. Only what
// is known is written: a line with nothing behind it is left out, never filled in. The name is the one link; it reaches over the
// whole card, so the card is one target and one tab stop ("View investor →" is its label for the eye, and is not read out twice).
export default function InvestorCard({ investor, onOpen }) {
  const { slug, name, domain, type_label: type, location, stages, sectors, portfolio_count: portfolio, status, active_status: active, verified_at: verifiedAt } = investor;
  const stopped = status === 'inactive' || active === 'inactive';
  const stage = stageText(stages);
  const sector = listText(sectors);
  const where = location?.label;
  return (
    <li className="inv-card">
      <div className="inv-card-top">
        <InvestorLogo domain={domain} name={name} />
        <VerifiedMark at={verifiedAt} compact />
      </div>
      <div className="inv-card-id">
        <h2 className="inv-card-name">
          <AppLink className="inv-card-link" href={investorHref(slug)} onOpen={() => onOpen(slug)}>{name}</AppLink>
        </h2>
        {type && <p className="inv-card-type">{type}</p>}
      </div>
      {(stage || sector || where) && (
        <dl className="inv-card-facts">
          {stage && <div><dt className="sr-only">Stage focus</dt><dd className="inv-card-stage">{stage}</dd></div>}
          {sector && <div><dt className="sr-only">Sector focus</dt><dd className="inv-card-sector" title={sectors.join(', ')}>{sector}</dd></div>}
          {where && <div><dt className="sr-only">Location</dt><dd className="inv-card-where">{where}</dd></div>}
        </dl>
      )}
      <div className="inv-card-foot">
        {portfolio > 0 && <span className="inv-card-count">{plural(portfolio, 'connected company', 'connected companies')}</span>}
        {stopped && <span className="inv-tag">No longer investing</span>}
        <span className="inv-card-cta" aria-hidden="true">View investor <span className="inv-card-arrow">→</span></span>
      </div>
    </li>
  );
}
