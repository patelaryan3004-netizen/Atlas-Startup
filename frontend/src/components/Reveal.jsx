import { useEffect, useRef, useState } from 'react';

// A visitor who has asked for less motion, or a browser that cannot say when something is on screen, gets the content at once.
const canReveal = () => typeof IntersectionObserver !== 'undefined' && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Content that rises into place the first time it is on screen. It wraps what rises (a card, a figure, a heading), and never is the
// card itself, so the card keeps its own hover. `index` staggers a row of them by 70 ms each.
//
// It always starts as "not yet shown", on the server, in the first render of a page that was pre-rendered and in any other, so the page the
// server sent and the first render of the browser agree (a page is hydrated, not drawn again). A browser that cannot (or may not) animate it
// shows it as soon as the page is up; the stylesheet hides a "not yet shown" element only for a visitor who has not asked for less motion
// and a page whose scripts run (a <noscript> rule in index.html shows everything to a visitor with none).
export default function Reveal({ as: Tag = 'div', index = 0, className = '', children, ...rest }) {
  const ref = useRef(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!canReveal()) { setShown(true); return undefined; }
    const watcher = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setShown(true); watcher.disconnect(); }
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.06 });
    watcher.observe(ref.current);
    return () => watcher.disconnect();
  }, []);

  return (
    <Tag ref={ref} className={`reveal${shown ? ' is-in' : ''}${className ? ` ${className}` : ''}`} style={{ '--i': Math.min(index, 8) }} {...rest}>
      {children}
    </Tag>
  );
}
