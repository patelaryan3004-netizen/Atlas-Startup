import { useEffect, useState } from 'react';

// Whether a media query matches, kept up to date. A browser that cannot say (no matchMedia) gets `fallback`.
export function useMediaQuery(query, fallback = false) {
  const read = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : fallback);
  const [matches, setMatches] = useState(read);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener?.('change', onChange);
    return () => list.removeEventListener?.('change', onChange);
  }, [query]);
  return matches;
}

// The width at which the map's chrome changes from the phone's layout (a sheet that slides up) to the desktop's (a card on the map).
export const DESKTOP = '(min-width: 900px)';
