import { HOME_PATH, MAP_PATH } from '../paths.js';

// A plain click, not one that means "open it somewhere else" (a new tab, a new window, a download).
export const isPlainClick = (event) => !(event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);

// The site's name at the top of a page, and the way to the map. The name is a link to the home page (the landing page), on every page
// that has a header; "Map" is a small link beside it to the map. `onMap` is how a page that sits over the map goes back to it
// without loading the app again; without it (or for a click that opens a new tab) the link is just a link.
export default function SiteBrand({ onMap }) {
  return (
    <div className="site-brand">
      <a className="site-brand-link" href={HOME_PATH} aria-label="Go to home">AU Startup Map</a>
      <a
        className="site-brand-map"
        href={MAP_PATH}
        onClick={(event) => {
          if (!onMap || !isPlainClick(event)) return;
          event.preventDefault();
          onMap();
        }}
      >
        Map
      </a>
    </div>
  );
}
