// The job-board providers the hourly sync can read. Kept apart from adapters.js (which pulls in the compliant fetcher) so the public server can say which boards
// are read without loading anything that fetches. A test pins that this list and the adapters' own PROVIDERS agree.
export const SUPPORTED = Object.freeze(['greenhouse', 'lever', 'workable']);
