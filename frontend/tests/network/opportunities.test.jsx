import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within, act, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../src/networkApi.js', async () => (await import('./helpers.js')).apiMock());

import * as api from '../../src/networkApi.js';
import JobsBoard from '../../src/components/network/JobsBoard.jsx';
import EventsBoard from '../../src/components/network/EventsBoard.jsx';
import { resetSession } from '../../src/session.js';
import { resetSaved } from '../../src/savedStore.js';
import { closeAuth } from '../../src/authUi.js';
import { job, jobFacets, event, eventFacets, deskRole, deskBoard } from './helpers.js';

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

describe('Opportunities: the hiring desk', () => {
  const NOW_ISO = '2026-11-13T04:00:00Z';
  const melb = (id, over = {}) => deskRole({ id, title: `Role ${id}`, ...over });
  const syd = (id, over = {}) => deskRole({ id, title: `Role ${id}`, work: { places: [{ label: 'Sydney, NSW', au: true, city: 'Sydney' }], cities: ['Sydney'], remote_au: false, remote_evidence: null, arrangement: null }, location: 'Sydney, NSW', ...over });
  const both = (id, over = {}) => deskRole({ id, title: `Role ${id}`, work: { places: [{ label: 'Sydney', au: true, city: 'Sydney' }, { label: 'Melbourne', au: true, city: 'Melbourne' }], cities: ['Sydney', 'Melbourne'], remote_au: false, remote_evidence: null, arrangement: 'hybrid' }, ...over });
  const remote = (id, over = {}) => deskRole({ id, title: `Role ${id}`, company: { name: 'Immutable', slug: 'immutable', city: 'Sydney', sector: 'Web3', stage: '', website: 'https://www.immutable.com' }, work: { places: [{ label: 'Remote - Australia', au: true, city: null }], cities: [], remote_au: true, remote_evidence: 'Remote - Australia', arrangement: 'remote' }, location: 'Remote - Australia', ...over });
  const roles = () => [melb('m1'), melb('m2', { company: { name: 'Bellroy', slug: 'bellroy', city: 'Melbourne', sector: 'Unknown', stage: '', website: 'https://bellroy.com' } }), syd('s1'), both('b1'), remote('r1')];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW_ISO));
    api.fetchJobBoard.mockResolvedValue(deskBoard(roles()));
    api.fetchJobs.mockResolvedValue({ results: [] });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  const openDesk = async () => { render(<JobsBoard chrome={{ go: {} }} />); await screen.findByText('Role m1'); };
  const card = (name) => screen.getByRole('button', { name: new RegExp(`^${name},`) });

  it('is under Opportunities with Jobs as its tab and Events beside it, and says what the desk is', async () => {
    await openDesk();
    expect(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Opportunities' })).toHaveAttribute('aria-current', 'page');
    const tabs = within(screen.getByRole('navigation', { name: 'Opportunities' }));
    expect(tabs.getByRole('link', { name: 'Jobs' })).toHaveAttribute('aria-current', 'page');
    expect(tabs.getByRole('link', { name: 'Events' })).toHaveAttribute('href', '/events');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('The hiring desk.');
    expect(screen.getByText('Find your next team in Australia. Apply directly with the people hiring.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Suggest a role/ })).toBeInTheDocument();
  });

  it('counts each card from the roles that match: a role open in two cities is in both cards and once in the national figure', async () => {
    await openDesk();
    expect(card('Melbourne')).toHaveAccessibleName('Melbourne, 3 open roles'); // m1, m2, b1
    expect(card('Sydney')).toHaveAccessibleName('Sydney, 2 open roles'); // s1, b1
    expect(card('Perth')).toHaveAccessibleName('Perth, 0 open roles');
    expect(card('Remote AU')).toHaveAccessibleName('Remote AU, 1 open role');
    expect(screen.getByRole('combobox', { name: 'Where the role is worked' })).toHaveDisplayValue('All Australia (5)'); // five roles, not 3 + 2 + 1
    expect(screen.getByRole('heading', { level: 2, name: /Open roles/ })).toHaveTextContent('5');
  });

  it('shows the roles that can be worked in a city when its card is pressed, writes it in the address, and clears it when pressed again', async () => {
    await openDesk();
    await userEvent.click(card('Melbourne'));
    expect(window.location.search).toBe('?place=Melbourne');
    expect(screen.getByRole('heading', { level: 2, name: /Open roles in Melbourne/ })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').map((li) => li.textContent).filter((t) => /Role (m1|m2|b1|s1|r1)/.test(t)).length).toBe(3);
    expect(screen.queryByText('Role s1')).not.toBeInTheDocument();
    await userEvent.click(card('Melbourne'));
    expect(window.location.search).toBe('');
    expect(await screen.findByText('Role s1')).toBeInTheDocument();
  });

  it('uses where the role is worked, never where the company is: a Melbourne company\'s Sydney role is Sydney\'s, and Remote AU is only what the employer says is remote from Australia', async () => {
    await openDesk();
    await userEvent.click(card('Sydney'));
    expect(screen.getByText('Role s1')).toBeInTheDocument();
    expect(screen.getByText('Role b1')).toBeInTheDocument();
    expect(screen.queryByText('Role m1')).not.toBeInTheDocument();
    await userEvent.click(card('Remote AU'));
    expect(screen.getByText('Role r1')).toBeInTheDocument();
    expect(screen.queryByText('Role s1')).not.toBeInTheDocument();
  });

  it('has the other Australian places in the location menu, and the old ?city= address opens the board on that place', async () => {
    window.history.replaceState(null, '', '/jobs?city=Sydney');
    await openDesk().catch(() => {});
    await screen.findByText('Role s1');
    const menu = screen.getByRole('combobox', { name: 'Where the role is worked' });
    expect(menu).toHaveDisplayValue('Sydney (2)');
    expect([...menu.options].map((o) => o.textContent)).toEqual(expect.arrayContaining(['All Australia (5)', 'Melbourne (3)', 'Perth (0)', 'Remote AU (1)', 'Elsewhere in Australia (0)']));
  });

  it('filters by a company from the index, shows it as a chip, and the company\'s roles only', async () => {
    await openDesk();
    const index = within(screen.getByRole('complementary', { name: 'Who is hiring' }));
    expect(index.getByRole('heading', { name: /Who.s hiring/ })).toBeInTheDocument();
    await userEvent.click(index.getByRole('button', { name: /Bellroy/ }));
    expect(window.location.search).toBe('?company=bellroy');
    expect(screen.getByText('Role m2')).toBeInTheDocument();
    expect(screen.queryByText('Role m1')).not.toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Active filters' })).getByRole('button', { name: /Bellroy/ })).toBeInTheDocument();
    await userEvent.click(index.getByRole('button', { name: /Bellroy/ }));
    expect(screen.getByText('Role m1')).toBeInTheDocument();
  });

  it('each row shows the role, the company, where it is worked, how, and when it was last confirmed: and leaves out what the employer did not say', async () => {
    api.fetchJobBoard.mockResolvedValue(deskBoard([melb('m1'), syd('s1')]));
    await openDesk();
    const first = screen.getByText('Role m1').closest('li');
    expect(within(first).getByText('Zeller · Melbourne · Hybrid')).toBeInTheDocument();
    expect(within(first).getAllByText('Confirmed today').length).toBeGreaterThan(0);
    const second = screen.getByText('Role s1').closest('li');
    expect(within(second).getByText('Zeller · Sydney')).toBeInTheDocument(); // no arrangement stated: nothing is written in its place
    expect(screen.queryByText(/Not stated/i)).not.toBeInTheDocument();
  });

  it('opens a role in full with a clear way to apply on the employer\'s own site, and the dates kept apart', async () => {
    await openDesk();
    await userEvent.click(screen.getByRole('button', { name: /Role m1, Zeller, Melbourne, Hybrid/ }));
    const d = within(await screen.findByRole('dialog', { name: 'Role m1' }));
    const apply = d.getByRole('link', { name: /Apply at Zeller/ });
    expect(apply).toHaveAttribute('href', 'https://jobs.lever.co/Zeller/abc');
    expect(apply).toHaveAttribute('target', '_blank');
    expect(apply).toHaveAttribute('rel', 'noopener noreferrer');
    expect(d.getByText('Posted by the employer').nextSibling).toHaveTextContent('10 November 2026');
    expect(d.getByText('First listed here').nextSibling).toHaveTextContent('13 November 2026');
    expect(d.getByText('Last confirmed').nextSibling).toHaveTextContent('13 November 2026 (today)');
    expect(d.getByText('Working arrangement').nextSibling).toHaveTextContent('Hybrid');
    expect(d.queryByText('Salary')).not.toBeInTheDocument();
    expect(window.location.search).toContain('role=m1');
    await userEvent.click(d.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('shows no posted date when the employer gave none: a role merely checked today is not "posted today"', async () => {
    api.fetchJobBoard.mockResolvedValue(deskBoard([melb('m1', { posted_at: null })]));
    await openDesk();
    await userEvent.click(screen.getByRole('button', { name: /^Role m1,/ }));
    const d = within(await screen.findByRole('dialog'));
    expect(d.queryByText('Posted by the employer')).not.toBeInTheDocument();
    expect(d.getByText('First listed here')).toBeInTheDocument();
  });

  it('says Remote AU with the employer\'s own words as the evidence', async () => {
    await openDesk();
    await userEvent.click(screen.getByRole('button', { name: /^Role r1,/ }));
    const d = within(await screen.findByRole('dialog'));
    expect(d.getByText('Remote from Australia').nextSibling).toHaveTextContent('Yes, the employer says: “Remote - Australia”');
  });

  it('saves a role on this device and keeps it across a reload', async () => {
    const first = render(<JobsBoard chrome={{ go: {} }} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Save Role m1 at Zeller' }));
    expect(JSON.parse(localStorage.getItem('stillEarlySavedJobs'))).toEqual(['m1']);
    first.unmount();
    render(<JobsBoard chrome={{ go: {} }} />);
    expect(await screen.findByRole('button', { name: 'Remove Role m1 at Zeller from saved' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps a saved role that has gone, with its true status and no way to apply; and one that needs a recheck says so', async () => {
    localStorage.setItem('stillEarlySavedJobs', JSON.stringify(['m1', 'gone-1', 'closed-1']));
    api.fetchJobBoard.mockResolvedValue(deskBoard([melb('m1', { confirmation: 'recheck', last_confirmed_at: '2026-11-09T02:00:00Z' })], {
      lapsed: [
        { id: 'gone-1', title: 'Filled Role', company: { name: 'Zeller', slug: 'zeller', website: 'https://www.myzeller.com' }, location: 'Melbourne', apply_url: 'https://jobs.lever.co/Zeller/old', lifecycle: 'archived', confirmation: null, last_confirmed_at: '2026-11-05T02:00:00Z', posted_at: null, region: 'au' },
        { id: 'closed-1', title: 'Closed Role', company: { name: 'Bellroy', slug: 'bellroy', website: 'https://bellroy.com' }, location: 'Melbourne', apply_url: 'https://job-boards.greenhouse.io/bellroy/jobs/1', lifecycle: 'closed', confirmation: null, last_confirmed_at: '2026-11-01T02:00:00Z', posted_at: null, region: 'au' },
      ],
    }));
    await openDesk();
    await userEvent.click(screen.getByRole('button', { name: /^Saved/ }));
    expect(await screen.findByText('Filled Role')).toBeInTheDocument();
    expect(screen.getAllByText('No longer listed by the employer').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Closed by the employer').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Not rechecked since 9 Nov').length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: /^Filled Role,/ }));
    const d = within(await screen.findByRole('dialog'));
    expect(d.queryByRole('link', { name: /Apply at/ })).not.toBeInTheDocument();
    expect(d.getByText(/off the employer.s board for at least two checks/)).toBeInTheDocument();
  });

  it('says honestly when a place has no roles, and when nothing matches, and offers to clear the filters', async () => {
    await openDesk();
    await userEvent.click(card('Perth'));
    expect(await screen.findByRole('heading', { level: 3, name: 'No open roles in Perth right now.' })).toBeInTheDocument();
    await userEvent.click(card('Perth'));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search roles or companies' }), 'zzzz');
    expect(await screen.findByRole('heading', { level: 3, name: 'No roles match.' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByText('Role m1')).toBeInTheDocument();
  });

  it('opens the board on every sector by default, and ?sector=Unknown still works, called "Sector not supplied"', async () => {
    await openDesk();
    expect(screen.getByText('Role m1')).toBeInTheDocument();
    expect(screen.getByText('Role m2')).toBeInTheDocument();
    expect(window.location.search).toBe('');
    cleanup();
    window.history.replaceState(null, '', '/jobs?sector=Unknown');
    render(<JobsBoard chrome={{ go: {} }} />);
    await screen.findByText('Role m2');
    expect(screen.queryByText('Role m1')).not.toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Active filters' })).getByRole('button', { name: /Sector not supplied/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Filters/ }));
    expect(screen.getByRole('combobox', { name: /Sector/ })).toHaveDisplayValue('Sector not supplied (1)');
  });

  it('puts the secondary filters behind one Filters button and narrows by them', async () => {
    api.fetchJobBoard.mockResolvedValue(deskBoard([melb('m1', { level: 'senior' }), melb('m2', { level: null, employment_type: 'contract' })]));
    await openDesk();
    expect(screen.queryByLabelText('Level in the title')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Filters/ }));
    await userEvent.selectOptions(screen.getByLabelText('Level in the title'), 'senior');
    expect(screen.queryByText('Role m2')).not.toBeInTheDocument();
    expect(window.location.search).toContain('level=senior');
    expect(screen.getByRole('button', { name: /Filters\s*1/ })).toBeInTheDocument();
  });

  it('draws the saved copy that comes with the site first and says so when the live board cannot be reached', async () => {
    api.fetchJobBoard.mockRejectedValue(Object.assign(new Error('offline'), { code: 'offline' }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(deskBoard([melb('m1')])), { status: 200, headers: { 'content-type': 'application/json' } })));
    await openDesk();
    expect(await screen.findByText(/the saved copy from 13 Nov/)).toBeInTheDocument();
    expect(screen.getByText('Role m1')).toBeInTheDocument(); // the roles are still there, and still link to their employers
  });

  it('does not draw a saved copy that is more than two weeks old', async () => {
    api.fetchJobBoard.mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(deskBoard([melb('m1')], { generated_at: '2026-10-01T00:00:00Z' })), { status: 200 })));
    render(<JobsBoard chrome={{ go: {} }} />);
    expect(await screen.findByText(/The board could not be loaded/)).toBeInTheDocument();
    expect(screen.queryByText('Role m1')).not.toBeInTheDocument();
  });

  it('says how current the board is, from the sync\'s last whole read: and says so when the hourly check has not run', async () => {
    await openDesk();
    expect(screen.getByText(/Employer boards last read 13 Nov 2026/)).toBeInTheDocument();
    cleanup();
    api.fetchJobBoard.mockResolvedValue(deskBoard(roles(), { sync: { ...deskBoard([]).sync, last_success_at: '2026-11-11T02:00:00Z' } }));
    render(<JobsBoard chrome={{ go: {} }} />);
    expect(await screen.findByText(/The hourly check has not run since/)).toBeInTheDocument();
  });

  it('lists what the board reads, what it cannot yet and what waits for a person, and says a new role appears after the next successful check', async () => {
    await openDesk();
    await userEvent.click(screen.getByRole('button', { name: /See feed coverage/ }));
    const d = within(await screen.findByRole('dialog', { name: 'Feed coverage' }));
    expect(d.getByText(/after the next successful check, not the moment the employer posts it/)).toBeInTheDocument();
    expect(d.getByText('Zeller')).toBeInTheDocument();
    expect(d.getByText(/ashby: no reader yet/)).toBeInTheDocument();
    expect(d.getByText(/not confirmed from the company.s own site/)).toBeInTheDocument();
  });

  it('suggests a role: the form asks for the employer\'s own link, says a person checks it first, and sends what was typed', async () => {
    api.submitSuggestion.mockResolvedValue({ id: 'sg_1', status: 'pending' });
    await openDesk();
    await userEvent.click(screen.getByRole('button', { name: /Suggest a role/ }));
    const d = within(await screen.findByRole('dialog', { name: 'Suggest a role' }));
    expect(d.getByText(/A person checks it before it is listed/)).toBeInTheDocument();
    await userEvent.type(d.getByLabelText('Role *'), 'Founding Engineer');
    await userEvent.type(d.getByLabelText('Company *'), 'Example Startup');
    await userEvent.type(d.getByLabelText(/Link to apply/), 'https://example.org/jobs/1');
    await userEvent.click(d.getByRole('button', { name: 'Send suggestion' }));
    expect(api.submitSuggestion).toHaveBeenCalledWith('job', expect.objectContaining({ title: 'Founding Engineer', company: 'Example Startup', apply_url: 'https://example.org/jobs/1' }), '');
  });

  it('credits the photography', async () => {
    await openDesk();
    await userEvent.click(screen.getByRole('button', { name: 'Photography' }));
    expect(await screen.findByRole('dialog', { name: 'Photography' })).toHaveTextContent(/Unsplash/);
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
