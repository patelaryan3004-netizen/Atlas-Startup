// Moving between the app's pages without loading the site again, from anywhere (a post's author, a tab, the account menu).
//
// The app listens for the browser's own "popstate" (the back and forward buttons) and reads the address each time, so moving to a page is: put the
// address in the history, and say it changed. That only means something where the app is on the page (App.jsx sets `window.__stillEarlyApp`); on any other
// page (the plain pages, the welcome page) a link just loads, as a link does.
export function navigate(href) {
  if (typeof window === 'undefined') return;
  if (!window.__stillEarlyApp) { window.location.assign(href); return; }
  try { window.history.pushState({ app: 'step' }, '', href); } catch (e) { window.location.assign(href); return; }
  window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
  try { window.scrollTo(0, 0); } catch (e) { /* a test's page has nothing to scroll */ }
}
