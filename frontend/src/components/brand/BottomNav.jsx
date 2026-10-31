import { HomeIcon, CompassIcon, MapIcon, BriefcaseIcon } from '../explore/icons.jsx';
import { NAV, linkProps } from './nav.js';

const ICONS = { home: HomeIcon, discover: CompassIcon, map: MapIcon, opportunities: BriefcaseIcon };

// The places as a bar along the bottom of a phone, where a thumb reaches: the same links as the header's pill, which a phone does not have room for.
export default function BottomNav({ active = null, go = {} }) {
  return (
    <nav className="bn" aria-label="Main (phone)">
      {NAV.map(({ id, label, href }) => {
        const Icon = ICONS[id];
        return (
          <a
            key={id}
            className="bn-link"
            aria-current={active === id ? 'page' : undefined}
            {...linkProps(href, go[id])}
          >
            <Icon size={24} />
            <span>{label}</span>
          </a>
        );
      })}
    </nav>
  );
}
