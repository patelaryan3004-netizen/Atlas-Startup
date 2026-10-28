import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../src/networkApi.js', async () => (await import('./helpers.js')).apiMock());

import * as api from '../../src/networkApi.js';
import JobsBoard from '../../src/components/network/JobsBoard.jsx';
import EventsBoard from '../../src/components/network/EventsBoard.jsx';
import { resetSession } from '../../src/session.js';
import { resetSaved } from '../../src/savedStore.js';
import { closeAuth } from '../../src/authUi.js';
import { job, jobFacets, event, eventFacets } from './helpers.js';

const jobsPage = (results, over = {}) => ({ total: results.length, count: results.length, results, facets: jobFacets(), hasMore: false, ...over });
const eventsPage = (results, over = {}) => ({ total: results.length, count: results.length, results, facets: eventFacets(), hasMore: false, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  window.history.replaceState(null, '', '/jobs');
  api.setToken(null);
  resetSession();
  resetSaved();
  api.fetchJobs.mockResolvedValue(jobsPage([job()]));
  api.fetchEvents.mockResolvedValue(eventsPage([event()]));
});
afterEach(() => { closeAuth(); });

describe('Opportunities: Jobs', () => {
  it('is under Opportunities, with Jobs as the tab it is on and Events beside it', async () => {
    render(<JobsBoard chrome={{ go: {} }} />);
    await screen.findByRole('heading', { level: 3, name: 'Senior Software Engineer' });
    expect(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Opportunities' })).toHaveAttribute('aria-current', 'page');
    const tabs = within(screen.getByRole('navigation', { name: 'Opportunities' }));
    expect(tabs.getByRole('link', { name: 'Jobs' })).toHaveAttribute('aria-current', 'page');
    expect(tabs.getByRole('link', { name: 'Events' })).toHaveAttribute('href', '/events');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Roles read from their own pages.');
  });

  it('starts on roles in Australia, and says so; Anywhere asks for all of them, and the address says which', async () => {
    render(<JobsBoard chrome={{ go: {} }} />);
    await screen.findByText('Senior Software Engineer');
    expect(api.fetchJobs).toHaveBeenCalledWith(expect.objectContaining({ where: 'au', limit: 24, offset: 0 }), expect.anything());
    expect(screen.getByRole('status')).toHaveTextContent('1 role in Australia');
    expect(window.location.search).toBe('');
    await userEvent.selectOptions(screen.getByLabelText('Where the role is'), 'any');
    await waitFor(() => expect(api.fetchJobs).toHaveBeenLastCalledWith(expect.objectContaining({ where: '' }), expect.anything()));
    expect(window.location.search).toBe('?where=any');
  });

  it('shows what the listing says and "Not stated" for what it does not: no salary, no guess at the working arrangement or the experience, and the level only as the title names it', async () => {
    api.fetchJobs.mockResolvedValue(jobsPage([job({ employment_type: null, level: null, location: '' })]));
    render(<JobsBoard chrome={{ go: {} }} />);
    const card = within((await screen.findByRole('heading', { level: 3, name: 'Senior Software Engineer' })).closest('li'));
    expect(card.getByText('Working arrangement').nextSibling).toHaveTextContent('Not stated');
    expect(card.getByText('Employment').nextSibling).toHaveTextContent('Not stated');
    expect(card.getByText('Level in the title').nextSibling).toHaveTextContent('Not named');
    expect(card.getByText('Where').nextSibling).toHaveTextContent('Not stated');
    expect(card.queryByText('Salary')).not.toBeInTheDocument();
  });

  it('shows a salary only when one is published, in its own words', async () => {
    api.fetchJobs.mockResolvedValue(jobsPage([job({ salary: 'A$140,000 to A$160,000 a year' })]));
    render(<JobsBoard chrome={{ go: {} }} />);
    const card = within((await screen.findByRole('heading', { level: 3, name: 'Senior Software Engineer' })).closest('li'));
    expect(card.getByText('Salary').nextSibling).toHaveTextContent('A$140,000 to A$160,000 a year');
  });

  it('applies on the employer\'s own page, in a new tab that cannot reach back, says why the role is listed and when it was read', async () => {
    render(<JobsBoard chrome={{ go: {} }} />);
    const card = within((await screen.findByRole('heading', { level: 3, name: 'Senior Software Engineer' })).closest('li'));
    const apply = card.getByRole('link', { name: /Apply on the employer.s site/ });
    expect(apply).toHaveAttribute('href', 'https://job-boards.greenhouse.io/cobalt/jobs/1');
    expect(apply).toHaveAttribute('target', '_blank');
    expect(apply).toHaveAttribute('rel', 'noopener noreferrer');
    expect(card.getByText(/own careers page on Greenhouse, last read 2026-10-27/)).toBeInTheDocument();
    expect(card.getByText(/Read 1 day ago \(27 Oct 2026\)\./)).toBeInTheDocument();
    expect(card.getByRole('link', { name: 'Cobalt Labs' })).toHaveAttribute('href', '/startup/cobalt-labs');
    expect(card.queryByText(/Confirm it is still open/)).not.toBeInTheDocument();
  });

  it('says a reading older than two weeks is old, on the role and once for the whole board when every reading is', async () => {
    api.fetchJobs.mockResolvedValue(jobsPage([job({ days_since_checked: 15, stale: true })], { facets: jobFacets({ stale: 1 }) }));
    render(<JobsBoard chrome={{ go: {} }} />);
    expect(await screen.findByRole('note')).toHaveTextContent(/Every role here was last read more than two weeks ago \(the newest reading is 27 Oct 2026\)/);
    expect(screen.getByText(/Read 15 days ago/)).toBeInTheDocument();
    expect(screen.getByText(/Confirm it is still open on the employer.s page/)).toBeInTheDocument();
  });

  it('marks a closed role as closed and gives no way to apply', async () => {
    api.fetchJobs.mockResolvedValue(jobsPage([job({ status: 'closed' })]));
    render(<JobsBoard chrome={{ go: {} }} />);
    const card = within((await screen.findByRole('heading', { level: 3, name: 'Senior Software Engineer' })).closest('li'));
    expect(card.getByText(/Closed: the employer has taken it down/)).toBeInTheDocument();
    expect(card.queryByRole('link', { name: /Apply/ })).not.toBeInTheDocument();
  });

  it('searches and filters, asking the server for what is chosen, and offers only what some role has', async () => {
    render(<JobsBoard chrome={{ go: {} }} />);
    await screen.findByText('Senior Software Engineer');
    const city = screen.getByLabelText('City');
    expect([...city.options].map((o) => o.textContent)).toEqual(['Company city', 'Sydney (2)']);
    await userEvent.selectOptions(screen.getByLabelText('Level in the title'), 'senior');
    await waitFor(() => expect(api.fetchJobs).toHaveBeenLastCalledWith(expect.objectContaining({ level: 'senior', where: 'au' }), expect.anything()));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Remote (1)' }));
    await waitFor(() => expect(api.fetchJobs).toHaveBeenLastCalledWith(expect.objectContaining({ level: 'senior', remote: 'yes' }), expect.anything()));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search roles' }), 'engineer');
    await waitFor(() => expect(api.fetchJobs).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'engineer' }), expect.anything()));
    expect(window.location.search).toContain('level=senior');
    expect(window.location.search).toContain('remote=yes');
    await userEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
    await waitFor(() => expect(api.fetchJobs).toHaveBeenLastCalledWith(expect.objectContaining({ level: '', remote: '', search: '', where: 'au' }), expect.anything()));
  });

  it('opens with the filters the address names', async () => {
    window.history.replaceState(null, '', '/jobs?city=Sydney&remote=yes&where=any');
    render(<JobsBoard chrome={{ go: {} }} />);
    await waitFor(() => expect(api.fetchJobs).toHaveBeenCalledWith(expect.objectContaining({ city: 'Sydney', remote: 'yes', where: '' }), expect.anything()));
  });

  it('saves a role on this device (and says nothing about an account) and keeps it across a reload', async () => {
    const first = render(<JobsBoard chrome={{ go: {} }} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Save Senior Software Engineer at Cobalt Labs' }));
    expect(JSON.parse(localStorage.getItem('stillEarlySavedJobs'))).toEqual(['j-1']);
    first.unmount();
    render(<JobsBoard chrome={{ go: {} }} />);
    expect(await screen.findByRole('button', { name: 'Remove Senior Software Engineer at Cobalt Labs from saved' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('says honestly when nothing matches or nothing is listed, and offers to suggest one', async () => {
    api.fetchJobs.mockResolvedValue(jobsPage([], { count: 0, total: 0 }));
    render(<JobsBoard chrome={{ go: {} }} />);
    expect(await screen.findByText('No open roles are listed right now.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Suggest it' }));
    expect(await screen.findByRole('dialog', { name: 'Suggest a role' })).toBeInTheDocument();
  });

  it('pages: "Show more roles" asks for the next offset', async () => {
    api.fetchJobs.mockResolvedValueOnce(jobsPage([job()], { total: 30, count: 30, hasMore: true }));
    render(<JobsBoard chrome={{ go: {} }} />);
    await screen.findByText('Senior Software Engineer');
    api.fetchJobs.mockResolvedValueOnce(jobsPage([job({ id: 'j-2', title: 'Product Designer', level: null })], { total: 30, count: 30 }));
    await userEvent.click(screen.getByRole('button', { name: 'Show more roles' }));
    await screen.findByText('Product Designer');
    expect(api.fetchJobs).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 24 }));
  });

  it('suggests a role: the form asks for the employer\'s own link, says a person checks it first, and sends what was typed', async () => {
    api.submitSuggestion.mockResolvedValue({ id: 'sg_1', status: 'pending' });
    render(<JobsBoard chrome={{ go: {} }} />);
    await screen.findByText('Senior Software Engineer');
    await userEvent.click(screen.getByRole('button', { name: 'Suggest a role' }));
    const d = within(await screen.findByRole('dialog', { name: 'Suggest a role' }));
    expect(d.getByText(/A person checks it before it is listed/)).toBeInTheDocument();
    await userEvent.type(d.getByLabelText('Role *'), 'Founding Engineer');
    await userEvent.type(d.getByLabelText('Company *'), 'Example Startup');
    await userEvent.type(d.getByLabelText(/Link to apply/), 'https://example.org/jobs/1');
    await userEvent.click(d.getByRole('button', { name: 'Send suggestion' }));
    expect(api.submitSuggestion).toHaveBeenCalledWith('job', expect.objectContaining({ title: 'Founding Engineer', company: 'Example Startup', apply_url: 'https://example.org/jobs/1' }), '');
    expect(await d.findByText(/Nothing is shown until they have/)).toBeInTheDocument();
  });
});

describe('Opportunities: Events', () => {
  beforeEach(() => { window.history.replaceState(null, '', '/events'); });

  it('shows each event with who runs it, when (in its own time zone), where, what it costs, who it is for, why it is listed, and where it was read', async () => {
    render(<EventsBoard chrome={{ go: {} }} />);
    const card = within((await screen.findByRole('heading', { level: 3, name: 'Founders Night' })).closest('li'));
    expect(card.getByText('Founder gathering')).toBeInTheDocument();
    expect(card.getByText('An Example Collective')).toBeInTheDocument();
    expect(card.getByText('When').nextSibling).toHaveTextContent(/Thu, 12 Nov.*6:00pm to 9:00pm AEDT/);
    expect(card.getByText('Where').nextSibling).toHaveTextContent('The Example Hall, Melbourne');
    expect(card.getByText('Cost').nextSibling).toHaveTextContent('Free');
    expect(card.getByText('Useful for').nextSibling).toHaveTextContent('Founders at any stage');
    expect(card.getByText(/Run by a collective of Melbourne founders/)).toBeInTheDocument();
    expect(card.getByText(/Details read 27 Oct 2026 from/)).toBeInTheDocument();
    expect(card.getByRole('link', { name: /^the organiser.s page/ })).toHaveAttribute('href', 'https://example.org/founders-night');
  });

  it('registers on the organiser\'s page in a new tab, and offers a calendar reminder both as a file and as a Google Calendar link', async () => {
    render(<EventsBoard chrome={{ go: {} }} />);
    const card = within((await screen.findByRole('heading', { level: 3, name: 'Founders Night' })).closest('li'));
    const register = card.getByRole('link', { name: /Register on the organiser.s page/ });
    expect(register).toHaveAttribute('href', 'https://example.org/founders-night');
    expect(register).toHaveAttribute('target', '_blank');
    expect(register).toHaveAttribute('rel', 'noopener noreferrer');
    expect(card.getByRole('link', { name: /Add reminder/ })).toHaveAttribute('href', '/api/events/founders-night/calendar.ics');
    const google = new URL(card.getByRole('link', { name: /Google Calendar/ }).getAttribute('href'));
    expect(google.origin + google.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(google.searchParams.get('text')).toBe('Founders Night');
    expect(google.searchParams.get('dates')).toBe('20261112T070000Z/20261112T100000Z');
    expect(google.searchParams.get('location')).toBe('The Example Hall, Melbourne');
  });

  it('says what has not been announced instead of making it up: a day with no time, and a price that is not confirmed', async () => {
    api.fetchEvents.mockResolvedValue(eventsPage([event({ id: 'summit', name: 'Example Summit', type_label: 'Conference', starts: '2027-02-16', ends: '2027-02-17', time_confirmed: false, starts_at: '2027-02-15T13:00:00.000Z', ends_at: '2027-02-17T13:00:00.000Z', cost: { status: 'unconfirmed', note: 'The page shows no price.' }, timezone: 'Australia/Adelaide', city: 'Adelaide', venue: '' })]));
    render(<EventsBoard chrome={{ go: {} }} />);
    const card = within((await screen.findByRole('heading', { level: 3, name: 'Example Summit' })).closest('li'));
    expect(card.getByText('When').nextSibling).toHaveTextContent('Tue, 16 Feb to Wed, 17 Feb 2027, Times not yet announced');
    expect(card.getByText('Cost').nextSibling).toHaveTextContent('Cost not confirmed. The page shows no price.');
  });

  it('shows a price only when the organiser\'s page gave one, as its own note, and marks a cancelled event with no way to register', async () => {
    api.fetchEvents.mockResolvedValue(eventsPage([
      event({ id: 'paid', name: 'Paid One', cost: { status: 'paid', note: 'Startup tickets A$1,060.' } }),
      event({ id: 'off', name: 'Called Off', status: 'cancelled' }),
    ]));
    render(<EventsBoard chrome={{ go: {} }} />);
    const paid = within((await screen.findByRole('heading', { level: 3, name: 'Paid One' })).closest('li'));
    expect(paid.getByText('Cost').nextSibling).toHaveTextContent('Paid: Startup tickets A$1,060.');
    const off = within(screen.getByRole('heading', { level: 3, name: 'Called Off' }).closest('li'));
    expect(off.getByText(/Cancelled/)).toBeInTheDocument();
    expect(off.queryByRole('link', { name: /Register/ })).not.toBeInTheDocument();
  });

  it('shows an event that is online as online, with no venue, and says an event\'s note (such as "full at last check") as it was read', async () => {
    api.fetchEvents.mockResolvedValue(eventsPage([event({ id: 'online', name: 'Online Demo Day', format: 'online', city: '', venue: '', note: 'Full at last check; the page offers a waitlist.' })]));
    render(<EventsBoard chrome={{ go: {} }} />);
    const card = within((await screen.findByRole('heading', { level: 3, name: 'Online Demo Day' })).closest('li'));
    expect(card.getByText('Where').nextSibling).toHaveTextContent('Online');
    expect(card.getByText('Full at last check; the page offers a waitlist.')).toBeInTheDocument();
  });

  it('filters by city, kind and format, searches, and only offers what some event has', async () => {
    render(<EventsBoard chrome={{ go: {} }} />);
    await screen.findByText('Founders Night');
    expect([...screen.getByLabelText('City').options].map((o) => o.textContent)).toEqual(['Any city', 'Melbourne (1)']);
    await userEvent.selectOptions(screen.getByLabelText('City'), 'Melbourne');
    await waitFor(() => expect(api.fetchEvents).toHaveBeenLastCalledWith(expect.objectContaining({ city: 'Melbourne' }), expect.anything()));
    await userEvent.selectOptions(screen.getByLabelText('Kind of event'), 'founder_meetup');
    await waitFor(() => expect(api.fetchEvents).toHaveBeenLastCalledWith(expect.objectContaining({ city: 'Melbourne', type: 'founder_meetup' }), expect.anything()));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search events' }), 'night');
    await waitFor(() => expect(api.fetchEvents).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'night' }), expect.anything()));
  });

  it('says there is nothing, rather than showing a placeholder, when no event is listed, and offers to suggest one', async () => {
    api.fetchEvents.mockResolvedValue(eventsPage([], { count: 0, total: 0 }));
    render(<EventsBoard chrome={{ go: {} }} />);
    expect(await screen.findByText('No upcoming events are listed right now.')).toBeInTheDocument();
    expect(screen.getByText('0 upcoming events')).toBeInTheDocument();
  });

  it('saves an event on this device', async () => {
    render(<EventsBoard chrome={{ go: {} }} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Save Founders Night' }));
    expect(JSON.parse(localStorage.getItem('stillEarlySavedEvents'))).toEqual(['founders-night']);
  });

  it('suggests an event with the organiser\'s own page, and says a person checks it before it is listed', async () => {
    api.submitSuggestion.mockResolvedValue({ id: 'sg_2', status: 'pending' });
    render(<EventsBoard chrome={{ go: {} }} />);
    await screen.findByText('Founders Night');
    await userEvent.click(screen.getByRole('button', { name: 'Suggest an event' }));
    const d = within(await screen.findByRole('dialog', { name: 'Suggest an event' }));
    await userEvent.type(d.getByLabelText('Event name *'), 'Climate Founders Night');
    await userEvent.type(d.getByLabelText('Organiser *'), 'An Example Group');
    await userEvent.type(d.getByLabelText('Registration page *'), 'https://example.org/climate');
    await userEvent.type(d.getByLabelText('Starts *'), '2026-12-03T18:00');
    await userEvent.type(d.getByLabelText('Your email, optional'), 'tipster@example.com');
    await userEvent.click(d.getByRole('button', { name: 'Send suggestion' }));
    expect(api.submitSuggestion).toHaveBeenCalledWith('event', expect.objectContaining({ name: 'Climate Founders Night', organiser: 'An Example Group', starts: '2026-12-03T18:00', registration_url: 'https://example.org/climate' }), 'tipster@example.com');
    expect(await d.findByText(/A person reads every suggestion/)).toBeInTheDocument();
  });

  it('shows the server\'s reason when a suggestion is refused, and keeps what was typed', async () => {
    api.submitSuggestion.mockRejectedValue(Object.assign(new Error('Start date must look like 2026-11-12.'), { status: 400 }));
    render(<EventsBoard chrome={{ go: {} }} />);
    await screen.findByText('Founders Night');
    await userEvent.click(screen.getByRole('button', { name: 'Suggest an event' }));
    const d = within(await screen.findByRole('dialog', { name: 'Suggest an event' }));
    await userEvent.type(d.getByLabelText('Event name *'), 'Something');
    await userEvent.click(d.getByRole('button', { name: 'Send suggestion' }));
    expect(await d.findByRole('alert')).toHaveTextContent('Start date must look like 2026-11-12.');
    expect(d.getByLabelText('Event name *')).toHaveValue('Something');
  });
});
