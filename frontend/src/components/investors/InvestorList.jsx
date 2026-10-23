import { AppLink, InvestorLogo, PersonAvatar, SaveButton, Stated, entryKey, focusTags, isPerson, plural, roleTagOf } from './common.jsx';
import { investorHref, personHref } from './route.js';
import { cardId } from '../IndexRow.jsx';

// The compact list: one investor to a row, a person or a firm. A row says who it is (a face or initials, the name, the role), the firm, where, at most two
// tags of what they invest in, and has the bookmark and the way in. The name is the one link and reaches over the whole row, so the row is one target and
// one tab stop; the firm's name and the bookmark sit above it, so neither opens the row. Where a record states nothing there is a dash, never a guess, and a
// focus that is the firm's (the person has none of their own on record) says so on hover.
function Item({ entry: e, onOpen, onOpenFirm, selected, saved, onToggleSaved }) {
  const person = isPerson(e);
  const key = entryKey(e);
  const { tags, more, from } = focusTags(e, 2);
  const roleTag = roleTagOf(e);
  const stopped = !person && (e.status === 'inactive' || e.active_status === 'inactive');
  const href = person ? personHref(e.slug) : investorHref(e.slug);
  const firm = person ? e.organisation : null;
  return (
    <li className={selected ? 'inv-item inv-item-on' : 'inv-item'} id={cardId('investor', key)} tabIndex={-1}>
      <div className="inv-item-who">
        {person ? <PersonAvatar name={e.name} photo={e.photo} /> : <InvestorLogo domain={e.domain} name={e.name} />}
        <div className="inv-item-id">
          <span className="inv-item-name">
            <AppLink className="inv-item-link" href={href} onOpen={() => onOpen(key)} aria-current={selected ? 'true' : undefined}>
              {e.name}
            </AppLink>
            {roleTag && <span className="inv-tag">{roleTag}</span>}
            {stopped && <span className="inv-tag">No longer investing</span>}
          </span>
          <span className="inv-item-sub">{person ? <Stated>{e.title}</Stated> : e.type_label ?? <Stated>{null}</Stated>}</span>
        </div>
      </div>

      <div className="inv-item-firm" data-label={person ? 'Firm' : 'Website'}>
        {person ? (
          firm ? (
            <>
              <InvestorLogo domain={firm.domain} name={firm.name} />
              <AppLink className="inv-item-firmlink" href={investorHref(firm.slug)} onOpen={() => onOpenFirm(firm.slug)}>{firm.name}</AppLink>
            </>
          ) : <Stated>{null}</Stated>
        ) : (
          <span className="inv-item-kind">
            <span>{e.domain ?? <Stated>{null}</Stated>}</span>
            {e.portfolio_count > 0 && <span className="inv-item-count">{plural(e.portfolio_count, 'connected company', 'connected companies')}</span>}
          </span>
        )}
      </div>

      <div className="inv-item-where" data-label="Location"><Stated>{e.location?.label}</Stated></div>

      <div className="inv-item-tags" data-label="Focus" title={tags.length ? `${[...(e.sectors ?? []), ...(e.stages ?? [])].join(', ')}${from === 'firm' && firm ? ` (the focus of ${firm.name})` : ''}` : undefined}>
        {tags.length ? (
          <ul className="inv-chips" aria-label={from === 'firm' && firm ? `Focus of ${firm.name}` : 'Investment focus'}>
            {tags.map((t) => <li key={t} className="inv-chip">{t}</li>)}
            {more > 0 && <li className="inv-chip inv-chip-more">+{more}</li>}
          </ul>
        ) : <Stated>{null}</Stated>}
      </div>

      <div className="inv-item-end">
        <SaveButton name={e.name} saved={saved} onToggle={() => onToggleSaved(key)} />
        <span className="inv-item-cta" aria-hidden="true">View profile <span className="inv-card-arrow">→</span></span>
      </div>
    </li>
  );
}

export default function InvestorList({ entries, onOpen, onOpenFirm, selected = null, isSaved, onToggleSaved }) {
  return (
    <div className="inv-listwrap">
      <div className="inv-list-head" aria-hidden="true">
        <span>Investor</span><span>Firm or website</span><span>Location</span><span>Focus</span><span />
      </div>
      <ul className="inv-list" aria-label="Investors">
        {entries.map((e) => <Item key={entryKey(e)} entry={e} onOpen={onOpen} onOpenFirm={onOpenFirm} selected={entryKey(e) === selected} saved={isSaved(entryKey(e))} onToggleSaved={onToggleSaved} />)}
      </ul>
    </div>
  );
}
