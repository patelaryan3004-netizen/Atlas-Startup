import { API_ROOT, startupPageUrl, markersUrl, summaryUrl, metaUrl, countsUrl } from './apiUrls.js';
import { peekSnapshot } from './snapshot.js';

// The snapshot's copy of an answer, read at once and without asking anyone: the answer, or null when the snapshot has not arrived or does
// not hold this question. A page uses it for the state it first draws with, so its first paint already has the figures, the cards and the
// pins (without it the page draws, then fills in, and moves everything as it does). The page still asks the API, through api.js, and the
// API's answer replaces this one. Takes the same arguments as the fetch of the same name.
const fromSnapshot = (url) => peekSnapshot(url.slice(API_ROOT.length));

export const peek = {
  startupPage: (filters, options) => fromSnapshot(startupPageUrl(filters, options)),
  markers: (filters) => fromSnapshot(markersUrl(filters)),
  summary: (filters) => fromSnapshot(summaryUrl(filters)),
  counts: (filterSets) => fromSnapshot(countsUrl(filterSets)),
  meta: () => fromSnapshot(metaUrl()),
};
