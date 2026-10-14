import { AppLink, InvestorLogo, SaveButton, listText, plural, stageText } from './common.jsx';
import { investorHref } from './route.js';
import { cardId } from '../IndexRow.jsx';

// A blank is shown as a dash, and read out as what it is: nothing is known, which is not the same as none.
const Dash = () => (
  <>
    <span aria-hidden="true">–</span>
    <span className="sr-only">Not stated</span>
  </>
);

// The same investors as the cards, in rows: for comparing them. The investor that is open beside the results is the row that is lit. A row is a
// target all over (the name is its link, for the keyboard), the focus is the sectors as chips, and the bookmark is the last column. When the
// results are narrow (a panel is open) the focus and the companies give way, so the table never scrolls sideways; on a phone each row stacks into
// a block (the headings come from each cell's data-label).
export default function InvestorTable({ investors, onOpen, selected = null, isSaved, onToggleSaved }) {
  return (
    <div className="inv-table-wrap">
      <table className="inv-table">
        <caption className="sr-only">Investors</caption>
        <thead>
          <tr>
            <th scope="col">Investor</th>
            <th scope="col" className="inv-col-focus">Focus</th>
            <th scope="col">Stage</th>
            <th scope="col">Location</th>
            <th scope="col" className="inv-col-companies">Connected companies</th>
            <th scope="col" className="inv-col-save"><span className="sr-only">Save</span></th>
          </tr>
        </thead>
        <tbody>
          {investors.map((i) => {
            const stage = stageText(i.stages);
            const on = i.slug === selected;
            return (
              <tr
                key={i.slug}
                id={cardId('investor', i.slug)}
                tabIndex={-1}
                className={on ? 'inv-row-on' : undefined}
                onClick={(e) => { if (!e.target.closest('a,button')) onOpen(i.slug); }}
              >
                <th scope="row" className="inv-table-name">
                  <div className="inv-table-id">
                    <InvestorLogo domain={i.domain} name={i.name} />
                    <span className="inv-table-who">
                      <AppLink className="inv-table-link" href={investorHref(i.slug)} onOpen={() => onOpen(i.slug)} aria-current={on ? 'true' : undefined}>{i.name}</AppLink>
                      {i.type_label && <span className="inv-table-type">{i.type_label}</span>}
                      {(i.status === 'inactive' || i.active_status === 'inactive') && <span className="inv-tag">No longer investing</span>}
                    </span>
                  </div>
                </th>
                <td data-label="Focus" className="inv-col-focus" title={i.sectors.join(', ') || undefined}>
                  {i.sectors.length ? (
                    <ul className="inv-chips" aria-label="Sector focus">
                      {i.sectors.slice(0, 3).map((s) => <li key={s} className="inv-chip">{s}</li>)}
                      {i.sectors.length > 3 && <li className="inv-chip inv-chip-more">+{i.sectors.length - 3}</li>}
                    </ul>
                  ) : <Dash />}
                </td>
                <td data-label="Stage" className="inv-col-stage">{stage || <Dash />}</td>
                <td data-label="Location">{i.location?.label || <Dash />}</td>
                <td data-label="Connected companies" className="inv-col-companies">{i.portfolio_count > 0 ? plural(i.portfolio_count, 'company', 'companies') : <Dash />}</td>
                <td className="inv-col-save"><SaveButton name={i.name} saved={isSaved(i.slug)} onToggle={() => onToggleSaved(i.slug)} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
