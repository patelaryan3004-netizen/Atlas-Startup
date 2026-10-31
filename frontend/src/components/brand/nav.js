import { navigate } from '../../navigate.js';

// The places the site has, in the order the header names them. Map is a page of its own (a large street map with a logo for every company), apart from the
// Startups tab of Discover, which is the list. Each is a real link (so it opens in a new tab and a search engine can follow it);
// a page that is the app passes a handler for it and the link then moves inside the app without loading it again.
//   Home           the community: a short feed of ideas, questions and things people are building
//   Discover       people, startups and investors (the tabs below), and the map as one way to look at startups
//   Opportunities  jobs and events
// What belongs to a person (their profile, what they saved) is under their avatar, not in this list.
export const NAV = [
  { id: 'home', label: 'Home', href: '/home' },
  { id: 'discover', label: 'Discover', href: '/discover' },
  { id: 'map', label: 'Map', href: '/map' },
  { id: 'opportunities', label: 'Opportunities', href: '/jobs' },
];

// The tabs inside Discover and inside Opportunities. People, Startups and Investors are three views of the directory; Jobs and Events are two kinds of opportunity.
export const DISCOVER_TABS = [
  { id: 'people', label: 'People', href: '/discover/people' },
  { id: 'startups', label: 'Startups', href: '/discover' },
  { id: 'investors', label: 'Investors', href: '/investors' },
];
export const OPPORTUNITY_TABS = [
  { id: 'jobs', label: 'Jobs', href: '/jobs' },
  { id: 'events', label: 'Events', href: '/events' },
];

// Where a place of the header opens when the page is not the app.
export const ADD_HREF = '/discover?view=submit';

// A plain click, not one that means "open it somewhere else" (a new tab, a new window, a download): only that is taken over by the app.
export const isPlainClick = (event) => !(event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);

// What a link needs to be a real address that the app follows without loading the page again: the page's own handler for it when it has one, else a move
// inside the app when the app is on the page, else (a plain page, a click meant for a new tab) the browser's own.
export function linkProps(href, handler) {
  return {
    href,
    onClick: (event) => {
      if (!isPlainClick(event)) return;
      if (handler) { event.preventDefault(); handler(); } else if (typeof window !== 'undefined' && window.__stillEarlyApp) { event.preventDefault(); navigate(href); }
    },
  };
}
