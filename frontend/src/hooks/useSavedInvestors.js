import { useSavedKind } from '../savedStore.js';

// The investors a visitor saved, as their addresses (slugs): in this browser until they sign in, with their account after (savedStore.js). A browser
// that will not keep them (a private window) still saves for the visit.
export function useSavedInvestors() {
  const { items, has, toggle } = useSavedKind('investor');
  return { saved: items, isSaved: has, toggle };
}
