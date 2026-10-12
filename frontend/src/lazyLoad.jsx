import { Component, Suspense, lazy } from 'react';

// Pages and dialogs that are fetched when they are first wanted, not with the page: the map (and Leaflet), the jobs board, the
// investor pages, the company panel, every form. See vite.config.js for how the files are named and grouped.

// Reloading the page, as a thing the tests can replace (a test page cannot be reloaded).
export const page = { reload() { window.location.reload(); } };

const RELOADED = 'auStartupChunkReload';

const flag = {
  get() { try { return sessionStorage.getItem(RELOADED) === '1'; } catch (e) { return true; } },
  set() { try { sessionStorage.setItem(RELOADED, '1'); } catch (e) { /* no storage: the second failure is shown, not reloaded */ } },
  clear() { try { sessionStorage.removeItem(RELOADED); } catch (e) { /* nothing was set */ } },
};

// React.lazy for a view or dialog. When its file cannot be fetched, the page that asked for it is most often older than the site: a
// new version was deployed and the files it names are gone. The page is reloaded once to get the new one; if that does not help (no
// network, a blocker), the error is left for the boundary to show, and the next success clears the mark.
export function lazyView(load) {
  return lazy(() => load().then(
    (module) => { flag.clear(); return module; },
    (err) => {
      if (flag.get()) throw err;
      flag.set();
      page.reload();
      return new Promise(() => {}); // the page is going away
    },
  ));
}

// Shows a notice instead of the page if a piece it needs could not be loaded, rather than leaving a blank screen.
export class LoadBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="load-error" role="alert">
        Could not load this part of the page.
        <button type="button" className="linkbtn" onClick={() => page.reload()}>Reload</button>
      </div>
    );
  }
}

// What a lazy piece sits in: the notice if it cannot load, and `fallback` (nothing, unless given) while it does.
export function Lazy({ fallback = null, children }) {
  return <LoadBoundary><Suspense fallback={fallback}>{children}</Suspense></LoadBoundary>;
}
