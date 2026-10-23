import { splitValues } from '../MultiSelect.jsx';

// A few starting points drawn from the directory itself: the biggest state, the biggest stages and the biggest sector among the investors listed, each a
// filter with the number of investors it holds. A list is offered only where the records make a real collection (two or more investors, and not simply
// everyone), and none is ever a ranking or a pick: they are the places the investors are, said in plain words. Pressing one that is on takes it off.
const STATE_NAMES = { NSW: 'New South Wales', VIC: 'Victoria', QLD: 'Queensland', SA: 'South Australia', WA: 'Western Australia', TAS: 'Tasmania', NT: 'Northern Territory', ACT: 'the ACT' };
const MIN = 2;

export function listsFrom(meta) {
  if (!meta) return [];
  const bigger = (a, b) => b.count - a.count;
  const real = (o) => o.count >= MIN && o.count < meta.total;
  const states = meta.locations.filter((o) => STATE_NAMES[o.value] && real(o)).sort(bigger).slice(0, 2).map((o) => ({ key: `location:${o.value}`, filter: 'location', value: o.value, count: o.count, label: `${STATE_NAMES[o.value]} investors` }));
  const stages = meta.stages.filter(real).sort(bigger).slice(0, 2).map((o) => ({ key: `stage:${o.value}`, filter: 'stage', value: o.value, count: o.count, label: `${o.value} investors` }));
  const sectors = meta.sectors.filter(real).sort(bigger).slice(0, 1).map((o) => ({ key: `sector:${o.value}`, filter: 'sector', value: o.value, count: o.count, label: `${o.value} investors` }));
  const all = [...states, ...stages, ...sectors];
  return all.length >= 2 ? all : [];
}

export default function InvestorLists({ meta, filters, onPick }) {
  const lists = listsFrom(meta);
  if (!lists.length) return null;
  return (
    <section className="inv-lists" aria-labelledby="inv-lists-title">
      <h2 id="inv-lists-title" className="inv-lists-title">Start with</h2>
      <ul className="inv-lists-row">
        {lists.map((l) => {
          const on = splitValues(filters[l.filter]).length === 1 && filters[l.filter] === l.value;
          return (
            <li key={l.key}>
              <button type="button" className={on ? 'inv-list-chip inv-list-chip-on' : 'inv-list-chip'} aria-pressed={on} onClick={() => onPick(l.filter, on ? '' : l.value)}>
                <span>{l.label}</span>
                <span className="inv-list-count">{l.count}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
