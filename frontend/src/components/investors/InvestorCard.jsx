import { AppLink, InvestorLogo, PersonAvatar, SaveButton, Stated, VerifiedMark, entryKey, isPerson, listText, plural, roleTagOf, stageText } from './common.jsx';
import { investorHref, personHref } from './route.js';
import { cardId } from '../IndexRow.jsx';
import EntityCard, { Avatar } from '../EntityCard.jsx';

// One investor in the directory, on the app's one card: a firm (its logo and name, what it invests in, at which stage and where, and how much of its
// portfolio a page backs) or a person (their initials or picture, name, role, firm, place and focus). The facts are always there, a dash where none is stated:
// a blank is never filled in. The name is the one link; it reaches over the whole card, so the card is one target and one tab stop ("View profile →" is its
// label for the eye, and is not read out twice). The bookmark sits above that link, so saving never opens the investor.
export default function InvestorCard({ investor, onOpen, onOpenFirm, selected = false, saved = false, onToggleSaved }) {
  const person = isPerson(investor);
  const key = entryKey(investor);
  const { slug, name, domain, type_label: type, location, stages, sectors, portfolio_count: portfolio, status, active_status: active, verified_at: verifiedAt } = investor;
  const stopped = !person && (status === 'inactive' || active === 'inactive');
  const roleTag = roleTagOf(investor);
  const firm = person ? investor.organisation : null;
  return (
    <EntityCard
      as="li"
      level={2}
      className={selected ? 'inv-card inv-card-on' : 'inv-card'}
      id={cardId('investor', key)}
      tabIndex={-1}
      avatar={person ? <PersonAvatar name={name} photo={investor.photo} size="card" /> : <Avatar name={name} domain={domain} size={60} className="inv-avatar" />}
      name={(
        <AppLink className="inv-card-link" href={person ? personHref(slug) : investorHref(slug)} onOpen={() => onOpen(key)} aria-current={selected ? 'true' : undefined}>
          {name}
        </AppLink>
      )}
      aside={<SaveButton name={name} saved={saved} onToggle={() => onToggleSaved(key)} />}
    >
      {person ? (
        <p className="inv-card-type">
          <span className="inv-card-role"><Stated>{investor.title}</Stated></span>
          {roleTag && <span className="inv-tag">{roleTag}</span>}
          <VerifiedMark at={verifiedAt} compact />
        </p>
      ) : (type || verifiedAt) && (
        <p className="inv-card-type">
          {type && <span>{type}</span>}
          <VerifiedMark at={verifiedAt} compact />
        </p>
      )}
      <dl className="inv-card-facts">
        {person && (
          <div>
            <dt>Firm</dt>
            <dd>
              {firm ? (
                <span className="inv-inline-firm">
                  <InvestorLogo domain={firm.domain} name={firm.name} />
                  <AppLink className="inv-card-firmlink" href={investorHref(firm.slug)} onOpen={() => onOpenFirm(firm.slug)}>{firm.name}</AppLink>
                </span>
              ) : <Stated>{null}</Stated>}
            </dd>
          </div>
        )}
        <div><dt>Focus</dt><dd title={sectors.join(', ') || undefined}><Stated>{listText(sectors, 3)}</Stated></dd></div>
        <div><dt>Stage</dt><dd><Stated>{stageText(stages)}</Stated></dd></div>
        <div><dt>Location</dt><dd><Stated>{location?.label}</Stated></dd></div>
      </dl>
      <div className="inv-card-foot">
        {!person && portfolio > 0 && <span className="inv-card-count">{plural(portfolio, 'connected company', 'connected companies')}</span>}
        {stopped && <span className="inv-tag">No longer investing</span>}
        <span className="inv-card-cta" aria-hidden="true">View profile <span className="inv-card-arrow">→</span></span>
      </div>
    </EntityCard>
  );
}
