import { fetchSummary, fetchMeta, fetchMarkers, fetchStartupPage, fetchCounts, fetchInvestors } from './api.js';
import { curatedLists } from './curatedLists.js';

// What the first views of the busiest pages ask the API, in one place. The pages ask with these sizes and these lists, and the snapshot file
// (snapshot.js) is made by asking exactly these questions (backend/scripts/snapshot.mjs runs FIRST_VIEWS and keeps each answer under the
// request that was made), so a page's first question is always one the file can answer. tests/snapshot.test.js holds the file to this list.

// The companies hiring now that the landing page asks for once (enough to name some in most capitals in its picture).
export const HIRING_SAMPLE = 80;
// A page of the list of startups, and of the jobs board.
export const LIST_PAGE = 48;
export const JOBS_PAGE = 24;
// The curated lists the landing page shows, and so counts: the first six of those that filter companies.
export const LANDING_LISTS_SHOWN = 6;
export const LANDING_LISTS = curatedLists.filter((list) => list.type === 'filter').slice(0, LANDING_LISTS_SHOWN);

export const FIRST_VIEWS = [
  () => fetchSummary({}), // the counts: the landing page's figures, the map's header, the Jobs link
  () => fetchMeta(), // the filters' options
  () => fetchMarkers({}), // the map's pins, and the landing page's picture
  () => fetchStartupPage({ hiring: 'yes' }, { limit: HIRING_SAMPLE, sort: 'file' }), // the landing page's hiring section and picture
  () => fetchCounts(LANDING_LISTS.map((list) => list.filters)), // the landing page's lists
  () => fetchStartupPage({}, { limit: LIST_PAGE, offset: 0, sort: 'name' }), // the list of startups
  () => fetchStartupPage({ hiring: 'yes' }, { limit: JOBS_PAGE, offset: 0, sort: 'name', facets: 'sector,city,stage' }), // the jobs board
];

// What the pre-render needs besides the snapshot (scripts/prerender.mjs): the static pages for /lists and /investors are made from these at
// build time. They are kept in frontend/prerender-data.json, which the site does not serve (the snapshot, which it serves, holds only
// FIRST_VIEWS). Every curated list that filters companies, with its count; and every published investor.
export const ALL_LISTS = curatedLists.filter((list) => list.type === 'filter');
export const INVESTORS_ALL = 100;
export const PRERENDER_VIEWS = [
  () => fetchCounts(ALL_LISTS.map((list) => list.filters)),
  () => fetchInvestors({}, { limit: INVESTORS_ALL, offset: 0, sort: 'name' }),
];
