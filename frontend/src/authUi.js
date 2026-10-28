// The sign-in dialog, opened from anywhere (a save button, the composer, the header) and drawn once, by the header. `reason` is what the person was
// trying to do, so the dialog can say why it appeared.
import { useSyncExternalStore } from 'react';

let state = { open: false, mode: 'signin', reason: '' };
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

export function openAuth({ mode = 'signin', reason = '' } = {}) { state = { open: true, mode, reason }; emit(); }
export function closeAuth() { state = { ...state, open: false }; emit(); }
export const useAuthUi = () => useSyncExternalStore((fn) => { listeners.add(fn); return () => listeners.delete(fn); }, () => state, () => state);
