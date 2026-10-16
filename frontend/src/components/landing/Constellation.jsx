import { OUTLINES, HUBS, project } from './australia.js';

// Australia as a constellation, for the night sky of the welcome page: the coast as a thin gold line, a star at some of its corners, a faint web of lines
// across the country, and brighter stars at the five capitals. It is drawn from the same coast the rest of the site uses (australia.js), as a live
// drawing and not a part of the picture, so the page can move it (a phone puts it above the headline). It says nothing about where a company is: it is
// decoration, and is hidden from a screen reader.
const EVERY = 3; // a star at every third point of the coast
const HUB_IDS = ['sydney', 'melbourne', 'brisbane', 'perth', 'adelaide'];

function build() {
  const [mainland, tasmania] = OUTLINES;
  const stars = [...mainland.filter((_, i) => i % EVERY === 0), ...tasmania.filter((_, i) => i % 3 === 0)];
  const hubs = HUBS.filter((h) => HUB_IDS.includes(h.id)).map((h) => project(h.lat, h.lng));
  const all = [...mainland, ...tasmania];
  const xs = all.map((p) => p.x); const ys = all.map((p) => p.y);
  const pad = 14;
  const box = { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + 2 * pad, h: Math.max(...ys) - Math.min(...ys) + 2 * pad };
  const ring = (points) => `${points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('')}Z`;
  // the web: each star to its nearest three that are not next to it on the coast, so the lines cross the country and never run along the edge
  const web = [];
  const seen = new Set();
  stars.forEach((a, i) => {
    const near = stars
      .map((b, j) => ({ j, d: (a.x - b.x) ** 2 + (a.y - b.y) ** 2 }))
      .filter(({ j }) => j !== i && Math.abs(j - i) > 1 && Math.abs(j - i) < stars.length - 1)
      .sort((p, q) => p.d - q.d)
      .slice(0, 3);
    for (const { j } of near) {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (!seen.has(key)) { seen.add(key); web.push([a, stars[j]]); }
    }
  });
  return { box, outline: [ring(mainland), ring(tasmania)].join(' '), stars, hubs, web };
}

const SHAPE = build();

export default function Constellation({ className = '' }) {
  const { box, outline, stars, hubs, web } = SHAPE;
  return (
    <svg className={`se-constellation${className ? ` ${className}` : ''}`} viewBox={`${box.x.toFixed(1)} ${box.y.toFixed(1)} ${box.w.toFixed(1)} ${box.h.toFixed(1)}`} aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="se-star-glow">
          <stop offset="0" stopColor="#ffd98a" stopOpacity=".95" />
          <stop offset=".35" stopColor="#f6b45e" stopOpacity=".35" />
          <stop offset="1" stopColor="#f6b45e" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        {web.map(([a, b], i) => <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="se-con-web" />)}
        <path d={outline} className="se-con-coast" />
      </g>
      {stars.map((p, i) => (
        <g key={i} transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`}>
          <circle r="7" fill="url(#se-star-glow)" />
          <circle r="1.7" fill="#ffe6ac" />
        </g>
      ))}
      {hubs.map((p, i) => (
        <g key={`h${i}`} transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`}>
          <circle r="18" fill="url(#se-star-glow)" />
          <circle r="3" fill="#fff1c9" />
        </g>
      ))}
    </svg>
  );
}
