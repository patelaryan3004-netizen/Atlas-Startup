import Cover from './Cover.jsx';
import { hiringLabel, present } from '../../freshness.js';
import { UnverifiedBadge } from '../VerifiedNote.jsx';
import { appPath } from '../../appRoute.js';

// One company in the gallery: its picture, its name, one short line about it, and "Sector · City · Stage" (what is not known is left out, never written as
// "Unknown"). The whole card is one link to the company's own address (/startup/<slug>), so it opens in a new tab, is reached with the Tab key and is
// pressed with Enter, like any link; a plain press opens the company over the gallery without loading the page again (`onOpen`), so the gallery, its
// filters and the place in it are still there when the company is closed.
function plainPress(event) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

export default function GalleryCard({ startup, onOpen, tracked = false, selected = false }) {
  const { name, slug, website, blurb, cover } = startup;
  const meta = present(startup.sectorFull || startup.sector, startup.city, startup.stage);
  const hiring = hiringLabel(startup).state === 'hiring';
  const href = slug ? appPath({ kind: 'startup', slug }) : undefined;
  const open = (event) => {
    if (!onOpen || !plainPress(event)) return;
    event.preventDefault();
    onOpen(startup);
  };
  return (
    <li className="gc">
      <a className={selected ? 'gc-link gc-link-on' : 'gc-link'} href={href} onClick={open} aria-current={selected ? 'true' : undefined}>
        <span className="gc-media">
          <Cover name={name} website={website} cover={cover} />
          {hiring && <span className="gc-tag"><span className="gc-dot" aria-hidden="true" />Hiring now</span>}
        </span>
        <span className="gc-body">
          <h3 className="gc-name">{name}{tracked && <span className="gc-saved" title="Saved"><span aria-hidden="true">★</span><span className="sr-only"> Saved</span></span>}</h3>
          {blurb && <span className="gc-blurb">{blurb}</span>}
          {meta.length > 0 && <span className="gc-meta">{meta.join(' · ')}</span>}
          <UnverifiedBadge company={startup} />
        </span>
      </a>
    </li>
  );
}
