import { useEffect, useRef, useState } from 'react';

// A visitor who has asked for less motion, or a browser that cannot say when something is on screen, gets the content at once.
const canReveal = () => typeof IntersectionObserver !== 'undefined' && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Content that rises into place the first time it is on screen. It wraps what rises (a card, a figure, a heading), and never is the
// card itself, so the card keeps its own hover. `index` staggers a row of them by 70 ms each.
export default function Reveal({ as: Tag = 'div', index = 0, className = '', children, ...rest }) {
  const ref = useRef(null);
  const [shown, setShown] = useState(() => !canReveal());

  useEffect(() => {
    if (shown) return undefined;
    const watcher = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setShown(true); watcher.disconnect(); }
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.06 });
    watcher.observe(ref.current);
    return () => watcher.disconnect();
  }, [shown]);

  return (
    <Tag ref={ref} className={`reveal${shown ? ' is-in' : ''}${className ? ` ${className}` : ''}`} style={{ '--i': Math.min(index, 8) }} {...rest}>
      {children}
    </Tag>
  );
}
