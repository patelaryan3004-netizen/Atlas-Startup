import { useCallback, useState } from 'react';

// The investors' page has two looks of one design: light (the one it opens in) and dark (the map page's own colours). The visitor's choice is
// kept in this browser, and switching between the cards and the table never changes it.
const KEY = 'auStartupInvestorTheme';
export const THEMES = ['light', 'dark'];

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return THEMES.includes(raw) ? raw : 'light';
  } catch (e) {
    return 'light';
  }
}

export function useInvestorTheme() {
  const [theme, setTheme] = useState(load);

  const toggle = useCallback(() => {
    setTheme((now) => {
      const next = now === 'light' ? 'dark' : 'light';
      try { localStorage.setItem(KEY, next); } catch (e) { /* ignore */ }
      return next;
    });
  }, []);

  return { theme, toggle };
}
