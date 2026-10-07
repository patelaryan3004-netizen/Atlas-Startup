import { useMemo } from 'react';
import { DOT_SIZE, GRID_PATH, VIEW, layoutEcosystem } from './australia.js';

const percent = (value, of) => `${((value / of) * 100).toFixed(3)}%`;
const at = (x, y) => ({ left: percent(x, VIEW.width), top: percent(y, VIEW.height) });
const companyHref = (name) => `/?view=list&search=${encodeURIComponent(name)}`;

// The directory as dots on Australia: lit where startups with a known place are, bigger where there are more, the
// capitals joined by routes, and a few real companies named. Nothing here is typed in by hand: until the pins arrive it is
// only the country in dots, and with none it says nothing about startups at all. See australia.js for what a dot stands for.
export default function EcosystemGraphic({ pins, areas, companies }) {
  const art = useMemo(() => layoutEcosystem({ pins, areas, companies }), [pins, areas, companies]);
  const drawn = art.lit.length > 0 || art.hubs.length > 0;

  return (
    <figure className="eco" aria-hidden={drawn ? undefined : 'true'}>
      <div className="eco-stage">
        <svg className="eco-svg" viewBox={`0 0 ${VIEW.width} ${VIEW.height}`} focusable="false" aria-hidden="true">
          <path className="eco-grid" d={GRID_PATH} strokeWidth={DOT_SIZE} />
          <g className="eco-routes">
            {art.links.map((link, i) => (
              <path key={link.id} className="eco-route" d={link.d} pathLength="1" style={{ '--i': i }} />
            ))}
          </g>
          <g className="eco-leaders">
            {art.chips.map((chip, i) => (
              <line key={chip.hubId} className="eco-leader" x1={chip.fromX} y1={chip.fromY} x2={chip.x} y2={chip.y} style={{ '--i': i }} />
            ))}
          </g>
          <g className="eco-lit">
            {art.lit.map((dot, i) => (
              <circle key={`${dot.x}-${dot.y}`} className="eco-dot" cx={dot.x} cy={dot.y} r={dot.r} style={{ '--i': i }} />
            ))}
            {art.hubs.filter((hub) => hub.cityOnly).map((hub) => (
              <circle key={hub.id} className="eco-ring" cx={hub.x} cy={hub.y} r="6.5" />
            ))}
          </g>
        </svg>

        <ul className="eco-cities">
          {art.hubs.map((hub) => (
            <li
              key={hub.id}
              className="eco-city"
              data-label={hub.label}
              data-crowded={hub.crowded ? '' : undefined}
              style={{ ...at(hub.x, hub.y), '--r': hub.r || 6.5 }}
            >
              {hub.name}{' '}
              <span className="eco-city-count">
                {hub.count}
                <span className="landing-sr">{hub.count === 1 ? ' startup' : ' startups'}</span>
              </span>
            </li>
          ))}
        </ul>

        <ul className="eco-chips">
          {art.chips.map((chip, i) => (
            <li key={chip.hubId} className="eco-chip" data-side={chip.side} style={{ ...at(chip.x, chip.y), '--i': i }}>
              <a
                className="eco-chip-link"
                href={companyHref(chip.company.name)}
                aria-label={`${chip.company.name}, ${chip.company.city}${chip.hiring ? ', hiring now' : ''}`}
              >
                {chip.hiring && <span className="eco-chip-dot" aria-hidden="true" />}
                {chip.company.name}
              </a>
            </li>
          ))}
        </ul>
      </div>

      {drawn && (
        <figcaption className="eco-caption">
          Each dot is about 90&nbsp;km across; larger means more startups with a known location.
          {art.chips.some((chip) => chip.hiring) && ' Amber marks a company that is hiring now.'}
        </figcaption>
      )}
    </figure>
  );
}
