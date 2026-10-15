import { hiringLabel, present } from '../../freshness.js';
import { CompanyRow } from '../brand/parts.jsx';

// A startup, and an investor, as the one row both lists beside the map use (the results column on a wide screen, the bottom sheet on a phone). The row
// says what it is in the words the records give: a startup its sector and city, an investor "Venture capital" and the cities its offices are in.
export function startupSub(startup) {
  return present(startup.sectorFull || startup.sector, startup.city).join(' · ');
}
export function vcSub(firm) {
  return ['Venture capital', [...new Set(firm.places)].join(', ')].filter(Boolean).join(' · ');
}

export function StartupRow({ startup, selected, onPick, saved, onToggleSaved, rowRef }) {
  return (
    <CompanyRow
      rowRef={rowRef}
      name={startup.name}
      website={startup.website}
      sub={startupSub(startup)}
      hiring={hiringLabel(startup).state === 'hiring'}
      selected={selected}
      onSelect={() => onPick(startup)}
      saved={saved}
      onToggleSaved={onToggleSaved}
    />
  );
}

export function VcRow({ firm, selected, onPick, saved, onToggleSaved, rowRef }) {
  return (
    <CompanyRow
      rowRef={rowRef}
      name={firm.name}
      domain={firm.domain}
      sub={vcSub(firm)}
      vc
      selected={selected}
      onSelect={() => onPick(firm.pin)}
      saved={saved}
      onToggleSaved={onToggleSaved}
    />
  );
}
