import { useCallback, useEffect, useRef, useState } from 'react';

// A small panel that opens under a button: it closes when anything outside it is pressed or Escape is, and Escape gives focus back to the
// button. `ref` goes on the element that holds both the button and the panel.
export function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return undefined;
    const onPress = (event) => { if (!ref.current?.contains(event.target)) setOpen(false); };
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      ref.current?.querySelector('button')?.focus();
    };
    document.addEventListener('pointerdown', onPress);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onPress); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return { open, setOpen, close, ref };
}
