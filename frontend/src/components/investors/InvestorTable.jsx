import { AppLink, InvestorLogo, listText, plural, stageText } from './common.jsx';
import { investorHref } from './route.js';

// A blank is shown as a dash, and read out as what it is: nothing is known, which is not the same as none.
const Dash = () => (
  <>
    <span aria-hidden="true">–</span>
    <span className="sr-only">Not stated</span>
  </>
);

// The same investors as the cards, in rows: for comparing them. On a phone each row stacks into a block (the headings come from
// each cell's data-label), so the page never scrolls sideways.
export default function InvestorTable({ investors, onOpen }) {
  return (
    <div className="inv-table-wrap">
      <table className="inv-table">
        <caption className="sr-only">Investors</caption>
        <thead>
          <tr>
            <th scope="col">Investor</th>
            <th scope="col">Type</th>
            <th scope="col">Stage focus</th>
            <th scope="col">Sector focus</th>
            <th scope="col">Location</th>
            <th scope="col">Connected companies</th>
          </tr>
        </thead>
        <tbody>
          {investors.map((i) => {
            const stage = stageText(i.stages);
            const sector = listText(i.sectors);
            return (
              <tr key={i.slug}>
                <th scope="row" className="inv-table-name">
                  <div className="inv-table-id">
                    <InvestorLogo domain={i.domain} name={i.name} />
                    <span className="inv-table-who">
                      <AppLink className="inv-table-link" href={investorHref(i.slug)} onOpen={() => onOpen(i.slug)}>{i.name}</AppLink>
                      {(i.status === 'inactive' || i.active_status === 'inactive') && <span className="inv-tag">No longer investing</span>}
                    </span>
                  </div>
                </th>
                <td data-label="Type">{i.type_label || <Dash />}</td>
                <td data-label="Stage focus">{stage || <Dash />}</td>
                <td data-label="Sector focus" title={i.sectors.join(', ')}>{sector || <Dash />}</td>
                <td data-label="Location">{i.location?.label || <Dash />}</td>
                <td data-label="Connected companies">{i.portfolio_count > 0 ? plural(i.portfolio_count, 'company', 'companies') : <Dash />}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
