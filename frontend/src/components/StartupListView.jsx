import { useEscapeClose } from '../hooks/useEscapeClose.js';
import { CompanyRow, EmptyState } from './brand/parts.jsx';
import { startupSub } from './explore/rows.jsx';
import { UnverifiedBadge } from './VerifiedNote.jsx';

// What the visitor saved (kept in this browser): the companies, then the investors, each as the one row the site uses everywhere, with the bookmark to take it
// out again and a press to open it. It is a dialog over whichever page the visitor is on. With nothing saved it says how to save.
export default function StartupListView({
  startups, investors = [], onClose, title, subtitle, isTracked, onToggleTracked, isSavedInvestor, onToggleInvestor, onOpenStartup, onOpenInvestor,
}) {
  useEscapeClose(onClose);
  const heading = title || `Startups in view (${startups.length})`;
  const nothing = startups.length === 0 && investors.length === 0;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel saved-panel" role="dialog" aria-modal="true" aria-label={heading} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" aria-label="Close" onClick={onClose}>✕</button>
        <h2>{heading}</h2>
        <p className="modal-sub">{subtitle || 'Matches your current filters.'}</p>

        {nothing && (
          <EmptyState title="Nothing saved yet.">Press the bookmark on a company or an investor to keep it here. What you save stays in this browser.</EmptyState>
        )}

        {startups.length > 0 && (
          <section className="saved-group" aria-label="Companies">
            {investors.length > 0 && <h3 className="saved-heading">Companies</h3>}
            <ul className="saved-list">
              {startups.map((s) => (
                <CompanyRow
                  key={s.slug || s.name}
                  name={s.name}
                  website={s.website}
                  sub={[startupSub(s), s.stage].filter(Boolean).join(' · ')}
                  extra={<UnverifiedBadge company={s} />}
                  onSelect={() => onOpenStartup?.(s)}
                  saved={isTracked ? isTracked(s.name) : true}
                  onToggleSaved={onToggleTracked ? () => onToggleTracked(s.name) : undefined}
                />
              ))}
            </ul>
          </section>
        )}

        {investors.length > 0 && (
          <section className="saved-group" aria-label="Investors">
            <h3 className="saved-heading">Investors</h3>
            <ul className="saved-list">
              {investors.map((i) => (
                <CompanyRow
                  key={i.slug}
                  name={i.name}
                  domain={i.domain}
                  sub={[i.type_label ?? 'Investor', i.location?.label].filter(Boolean).join(' · ')}
                  vc={/venture/i.test(i.type_label ?? '')}
                  onSelect={() => onOpenInvestor?.(i.slug)}
                  saved={isSavedInvestor ? isSavedInvestor(i.slug) : true}
                  onToggleSaved={onToggleInvestor ? () => onToggleInvestor(i.slug) : undefined}
                />
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
