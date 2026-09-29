import { useCallback, useState } from 'react';

const STORAGE_KEY = 'auStartupTracked';

function loadTracked() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch (e) {
    return new Set();
  }
}

function saveTracked(tracked) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...tracked]));
  } catch (e) {
    // ignore
  }
}

export function useTrackedStartups() {
  const [tracked, setTracked] = useState(loadTracked);

  const toggleTracked = useCallback((name) => {
    setTracked((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      saveTracked(next);
      return next;
    });
  }, []);

  const isTracked = useCallback((name) => tracked.has(name), [tracked]);

  return { tracked, toggleTracked, isTracked };
}
