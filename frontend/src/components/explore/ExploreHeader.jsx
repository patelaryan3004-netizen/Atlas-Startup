import HeaderMenu from '../HeaderMenu.jsx';
import { AustraliaMark, PlusIcon } from './icons.jsx';
import { HOME_PATH } from '../../paths.js';

// The bar across the top of the map: the site's name (a link to the landing page), the four places the app has (Explore is the map and the
// list; Jobs and Investors are pages; Saved is the companies the visitor starred, kept in this browser), the one action (Add startup), and a menu
// with everything else. On a phone the four places move into the menu and the action becomes a button with only its plus.
export default function ExploreHeader({ hiringCount, trackedCount, onExplore, onShowJobs, onShowInvestors, onShowTracked, onAdd, menu }) {
  return (
    <header className="xh">
      <a className="xh-brand" href={HOME_PATH} aria-label="Go to home">
        <AustraliaMark size={38} className="xh-mark" />
        <h1 className="xh-title">AU Startup Map</h1>
      </a>

      <nav className="xh-nav" aria-label="Main">
        <button type="button" className="xh-link" aria-current="page" onClick={onExplore}>Explore</button>
        <button type="button" className="xh-link" onClick={onShowJobs} title={hiringCount > 0 ? `${hiringCount} hiring now` : undefined}>Jobs</button>
        <button type="button" className="xh-link" onClick={onShowInvestors}>Investors</button>
        <button type="button" className="xh-link" onClick={onShowTracked}>
          Saved{trackedCount > 0 && <span className="xh-count">{trackedCount}</span>}
        </button>
      </nav>

      <div className="xh-end">
        <button type="button" className="xh-add" onClick={onAdd}>
          <PlusIcon size={20} />
          <span className="xh-add-text">Add startup</span>
        </button>
        <HeaderMenu {...menu} />
      </div>
    </header>
  );
}
