import { useCallback, useState } from 'react';

// The investors a visitor saved, as their addresses (slugs), kept in this browser and nowhere else: there are no accounts. A browser that will not
// keep them (a private window) still saves for the visit.
const KEY = 'auStartupSavedInvestors';

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw) ? [...new Set(raw.filter((s) => typeof s === 'string' && s))] : [];
  } catch (e) {
    return [];
  }
}

function keep(slugs) {
  try { localStorage.setItem(KEY, JSON.stringify(slugs)); } catch (e) { /* ignore */ }
}

export function useSavedInvestors() {
  const [saved, setSaved] = useState(load);

  const toggle = useCallback((slug) => {
    setSaved((now) => {
      const next = now.includes(slug) ? now.filter((s) => s !== slug) : [...now, slug];
      keep(next);
      return next;
    });
  }, []);

  const isSaved = useCallback((slug) => saved.includes(slug), [saved]);

  return { saved, isSaved, toggle };
}
