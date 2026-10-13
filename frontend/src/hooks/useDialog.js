import { useEffect, useId, useRef } from 'react';
import { useEscapeClose } from './useEscapeClose.js';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),iframe,[tabindex]:not([tabindex="-1"])';

// What a panel over the page needs to be a dialog: it closes on Escape and on a click outside the panel (a press that began inside the
// panel and ended outside it, such as selecting text in a field, is not a click outside), focus moves into it when it opens and back to
// what opened it when it closes, and Tab stays inside it. Spread `overlayProps` on the dimmed overlay and `panelProps` on the panel, and
// give the panel's heading `id={titleId}`.
export function useDialog(onClose) {
  const panel = useRef(null);
  const pressedOutside = useRef(false);
  const titleId = useId();
  useEscapeClose(onClose);

  useEffect(() => {
    const el = panel.current;
    if (!el) return undefined;
    const opener = document.activeElement;
    el.focus({ preventScroll: true });
    const onKeyDown = (event) => {
      if (event.key !== 'Tab') return;
      const items = [...el.querySelectorAll(FOCUSABLE)];
      if (items.length === 0) { event.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const at = document.activeElement;
      if (event.shiftKey && (at === first || at === el)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && at === last) { event.preventDefault(); first.focus(); }
    };
    el.addEventListener('keydown', onKeyDown);
    return () => {
      el.removeEventListener('keydown', onKeyDown);
      if (opener && opener !== document.body && document.contains(opener)) opener.focus?.({ preventScroll: true });
    };
  }, []);

  return {
    titleId,
    overlayProps: {
      onMouseDown: (event) => { pressedOutside.current = event.target === event.currentTarget; },
      onClick: (event) => { if (event.target === event.currentTarget && pressedOutside.current) onClose(); },
    },
    panelProps: { ref: panel, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabIndex: -1 },
  };
}
