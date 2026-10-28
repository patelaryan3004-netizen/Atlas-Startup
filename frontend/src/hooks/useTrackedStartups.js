import { useMemo } from 'react';
import { useSavedKind } from '../savedStore.js';

// The startups a visitor saved, by name (savedStore.js): in this browser until they sign in, with their account after.
export function useTrackedStartups() {
  const { items, toggle, has } = useSavedKind('startup');
  const tracked = useMemo(() => new Set(items), [items]);
  return { tracked, toggleTracked: toggle, isTracked: has };
}
