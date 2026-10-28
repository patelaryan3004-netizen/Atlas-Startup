// Shared scaffolding for the community's tests: a stand-in for the API client, and the people, posts, roles and events they show. Nothing here touches the network.
import { vi } from 'vitest';

const NAMES = [
  'fetchNetworkStatus', 'signUp', 'signIn', 'signOutRequest', 'fetchMe', 'updateProfile', 'changePassword', 'deleteAccount', 'fetchMembers', 'fetchMember', 'fetchFeed', 'fetchThread',
  'createPost', 'editPost', 'deletePost', 'createReply', 'editReply', 'deleteReply', 'setLike', 'reportItem', 'fetchSaved', 'setSaved', 'mergeSaved', 'fetchEvents', 'fetchJobs', 'submitSuggestion',
  'adminSummary', 'adminReports', 'adminDecideReport', 'adminSuggestions', 'adminApprove', 'adminReject', 'adminMembers', 'adminSuspend',
];

// The module's replacement: every call a vi.fn(), the token kept in a variable, and the same error class the real one throws.
export function apiMock() {
  const mock = Object.fromEntries(NAMES.map((n) => [n, vi.fn()]));
  let token = null;
  class ApiError extends Error {
    constructor(message, status, code) { super(message); this.status = status; this.code = code; }
  }
  return { ...mock, ApiError, getToken: () => token, setToken: (t) => { token = t; }, calendarUrl: (id) => `/api/events/${id}/calendar.ics` };
}

export const member = (over = {}) => ({
  id: 'm_ada', name: 'Ada Example', initials: 'AE', email: 'ada@example.com', email_verified: false, role: 'Founder, building a scheduling tool', city: 'Melbourne', intro: 'I make small tools.',
  building: [{ title: 'Clinic Slots', url: 'https://example.com/slots', note: 'Booking for clinics' }], links: { website: 'https://example.com/ada', professional_profile: '' },
  open_to: ['feedback'], listed: true, suspended: false, joined_at: '2026-10', ...over,
});

export const post = (over = {}) => ({
  id: 'p_1', topic: 'idea', topic_label: 'Idea', body: 'What if every city had a monthly prototype night?', created_at: new Date(Date.now() - 3 * 3600000).toISOString(), edited_at: null, status: 'visible',
  author: { id: 'm_cal', name: 'Cal Demo', initials: 'CD', role: 'Operator', city: 'Sydney' }, mine: false, like_count: 2, liked: false, bookmarked: false, reply_count: 1, ...over,
});

export const reply = (over = {}) => ({
  id: 'r_1', post_id: 'p_1', body: 'Count me in.', created_at: new Date(Date.now() - 3600000).toISOString(), edited_at: null, status: 'visible',
  author: { id: 'm_ben', name: 'Ben Sample', initials: 'BS', role: 'Student', city: 'Melbourne' }, mine: false, ...over,
});

export const job = (over = {}) => ({
  id: 'j-1', title: 'Senior Software Engineer', company: { name: 'Cobalt Labs', slug: 'cobalt-labs', city: 'Sydney', sector: 'Fintech', stage: 'Seed', website: 'https://cobalt.example' },
  location: 'Sydney, NSW', region: 'au', remote: null, employment_type: 'full_time', level: 'senior', salary: null,
  why_listed: "Listed on Cobalt Labs's own careers page on Greenhouse, last read 2026-10-27. Cobalt Labs is in the Still Early directory.",
  apply_url: 'https://job-boards.greenhouse.io/cobalt/jobs/1', source_kind: 'careers_page', last_checked_at: '2026-10-27T01:00:00Z', days_since_checked: 1, stale: false, status: 'open', ...over,
});

export const jobFacets = (over = {}) => ({
  cities: [{ value: 'Sydney', count: 2 }], sectors: [{ value: 'Fintech', count: 2 }], stages: [{ value: 'Seed', count: 2 }], types: [{ value: 'full_time', label: 'Full-time', count: 2 }],
  levels: [{ value: 'senior', label: 'Senior', count: 1 }], remote: 1, regions: { au: 2, other: 1 }, stale: 0, latest_checked_at: '2026-10-27T01:00:00Z', ...over,
});

export const event = (over = {}) => ({
  id: 'founders-night', name: 'Founders Night', organiser: 'An Example Collective', type: 'founder_meetup', type_label: 'Founder gathering', format: 'in_person', city: 'Melbourne',
  venue: 'The Example Hall', online_url: '', timezone: 'Australia/Melbourne', starts: '2026-11-12T18:00', ends: '2026-11-12T21:00', time_confirmed: true,
  starts_at: '2026-11-12T07:00:00.000Z', ends_at: '2026-11-12T10:00:00.000Z', cost: { status: 'free' }, audience: 'Founders at any stage', why_selected: 'Run by a collective of Melbourne founders.',
  note: '', registration_url: 'https://example.org/founders-night', source_url: 'https://example.org/founders-night', source_checked_at: '2026-10-27', status: 'published', origin: 'curated', ...over,
});

export const eventFacets = () => ({ cities: [{ value: 'Melbourne', count: 1 }], types: [{ value: 'founder_meetup', label: 'Founder gathering', count: 1 }], formats: [{ value: 'in_person', count: 1 }] });
