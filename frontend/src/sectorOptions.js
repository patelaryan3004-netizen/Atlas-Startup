import { useEffect, useMemo, useState } from 'react';
import { fetchSummary } from './api.js';
import { peek } from './peek.js';

// The sectors a menu offers, on the map and on Discover alike. They are the twelve display sectors (and "Other") the server groups the source labels into
// (backend/src/models/sectors.js), never the raw labels. A menu offers only the sectors that have a company for the city and the type of organisation chosen, so
// an option never leads to an empty list; the sector (and the search, the stage...) is deliberately not part of the question, or the menu would shrink to
// the one chosen.
//
// `context` is { city, orgType, onMap }; `fallback` is what the page already knows with no city and no type chosen: the whole directory's list (meta.sectorGroups), or the map's
// (the counts of the companies the map shows). Only a city or a type narrows the question further, and only then is the server asked (so a page with neither makes no request
// for this). The fallback is also what the menu offers until the answer is in. Resolves to [{ value, count }] in the order of the list of sectors.
export function useSectorOptions({ city = '', orgType = '', onMap = '' } = {}, fallback = []) {
  const narrowed = Boolean(city || orgType);
  const key = `${city}|${orgType}|${onMap}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const context = useMemo(() => Object.fromEntries(Object.entries({ city, orgType, onMap }).filter(([, value]) => value)), [key]);
  const [found, setFound] = useState(() => (narrowed ? peek.summary(context)?.sectors ?? null : null));
  useEffect(() => {
    if (!narrowed) return undefined;
    const ctrl = new AbortController();
    const first = peek.summary(context)?.sectors;
    if (first) setFound(first);
    fetchSummary(context, { signal: ctrl.signal })
      .then((summary) => { if (!ctrl.signal.aborted) setFound(Array.isArray(summary?.sectors) ? summary.sectors : null); })
      .catch(() => { /* the menu keeps what it had */ });
    return () => ctrl.abort();
  }, [context, narrowed]);
  return narrowed ? found ?? fallback : fallback;
}
