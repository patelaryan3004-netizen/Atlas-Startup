import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../src/networkApi.js', async () => (await import('./helpers.js')).apiMock());
vi.mock('../../src/api.js', () => ({ fetchStartupsByName: vi.fn(), fetchInvestors: vi.fn() }));

import * as api from '../../src/networkApi.js';
import * as site from '../../src/api.js';
import SavedPage from '../../src/components/network/SavedPage.jsx';
import DiscoverPeople from '../../src/components/network/DiscoverPeople.jsx';
import { useTrackedStartups } from '../../src/hooks/useTrackedStartups.js';
import { useSavedInvestors } from '../../src/hooks/useSavedInvestors.js';
import { signIn, signOut, resetSession, getSession } from '../../src/session.js';
import { resetSaved, readLocal } from '../../src/savedStore.js';
import { closeAuth } from '../../src/authUi.js';
import { member, job, event, post } from './helpers.js';

const ADA = member();
const NONE = { startup: [], investor: [], job: [], event: [], post: [], member: [] };

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  window.history.replaceState(null, '', '/saved');
  api.setToken(null);
  api.fetchNetworkStatus.mockResolvedValue({ available: true, reason: null });
  api.fetchMe.mockRejectedValue(new api.ApiError('Sign in to do that.', 401, 'unauthorized'));
  api.fetchSaved.mockResolvedValue({ saved: NONE });
  api.mergeSaved.mockResolvedValue({ added: 0, saved: NONE });
  api.setSaved.mockResolvedValue({});
  site.fetchStartupsByName.mockResolvedValue({ results: [] });
  site.fetchInvestors.mockResolvedValue({ results: [] });
  resetSession();
  resetSaved();
});
afterEach(() => { closeAuth(); });

async function signedIn(who = ADA, saved = NONE) {
  api.signIn.mockResolvedValue({ token: 'se_t', member: who });
  api.fetchMe.mockResolvedValue({ member: who });
  api.fetchSaved.mockResolvedValue({ saved });
  await act(async () => { await signIn({ email: who.email, password: 'a-long-enough-password' }); });
}

// A button pair that saves a startup and an investor, so the hooks the pages use are what is tested.
function Probe() {
  const startups = useTrackedStartups();
  const investors = useSavedInvestors();
  return (
    <div>
      <button onClick={() => startups.toggleTracked('Canva')}>save-canva</button>
      <button onClick={() => investors.toggle('airtree')}>save-airtree</button>
      <output data-testid="startups">{[...startups.tracked].join(',')}</output>
      <output data-testid="investors">{investors.saved.join(',')}</output>
    </div>
  );
}

describe('what a visitor saved, before and after they have an account', () => {
  it('keeps startups and investors in this browser, under the keys they always had, while nobody is signed in', async () => {
    render(<Probe />);
    await userEvent.click(screen.getByText('save-canva'));
    await userEvent.click(screen.getByText('save-airtree'));
    expect(JSON.parse(localStorage.getItem('auStartupTracked'))).toEqual(['Canva']);
    expect(JSON.parse(localStorage.getItem('auStartupSavedInvestors'))).toEqual(['airtree']);
    expect(api.setSaved).not.toHaveBeenCalled(); // nothing goes to a server for someone with no account
    await userEvent.click(screen.getByText('save-canva'));
    expect(screen.getByTestId('startups')).toHaveTextContent('');
  });

  it('adds what this browser had saved to the account on signing in, and from then on the account is what the buttons read and write', async () => {
    localStorage.setItem('auStartupTracked', JSON.stringify(['Canva']));
    localStorage.setItem('stillEarlySavedJobs', JSON.stringify(['j-1']));
    render(<Probe />);
    await signedIn(ADA, { ...NONE, startup: ['Canva', 'Zeller'], investor: ['blackbird'] });
    await waitFor(() => expect(api.mergeSaved).toHaveBeenCalledWith(expect.arrayContaining([{ kind: 'startup', key: 'Canva' }, { kind: 'job', key: 'j-1' }])));
    await waitFor(() => expect(screen.getByTestId('startups')).toHaveTextContent('Canva,Zeller')); // the account's own list, merged
    expect(screen.getByTestId('investors')).toHaveTextContent('blackbird');
    await userEvent.click(screen.getByText('save-airtree'));
    expect(api.setSaved).toHaveBeenCalledWith('investor', 'airtree', true);
    expect(screen.getByTestId('investors')).toHaveTextContent('airtree,blackbird');
    await userEvent.click(screen.getByText('save-canva')); // already saved: this un-saves it
    expect(api.setSaved).toHaveBeenLastCalledWith('startup', 'Canva', false);
    expect(screen.getByTestId('startups')).toHaveTextContent('Zeller');
  });

  it('goes back to what this browser holds on signing out, and takes nothing the account holds with it', async () => {
    localStorage.setItem('auStartupSavedInvestors', JSON.stringify(['blackbird']));
    render(<Probe />);
    await signedIn(ADA, { ...NONE, investor: ['airtree'] });
    await waitFor(() => expect(screen.getByTestId('investors')).toHaveTextContent('airtree'));
    api.signOutRequest.mockResolvedValue(null);
    await act(async () => { await signOut(); });
    expect(getSession().status).toBe('out');
    expect(screen.getByTestId('investors')).toHaveTextContent('blackbird');
    expect(readLocal('investor')).toEqual(['blackbird']);
  });

  it('puts the account\'s copy right when the server refuses a save, so the button shows the truth', async () => {
    render(<Probe />);
    await signedIn(ADA, { ...NONE, investor: ['airtree'] });
    await waitFor(() => expect(screen.getByTestId('investors')).toHaveTextContent('airtree'));
    api.setSaved.mockRejectedValue(new Error('down'));
    await userEvent.click(screen.getByText('save-airtree')); // un-save, refused
    await waitFor(() => expect(screen.getByTestId('investors')).toHaveTextContent('airtree'));
  });
});

describe('the saved page', () => {
  it('says what is kept, where: in this browser until there is an account', async () => {
    localStorage.setItem('auStartupTracked', JSON.stringify(['Canva']));
    site.fetchStartupsByName.mockResolvedValue({ results: [{ name: 'Canva', slug: 'canva', city: 'Sydney', sector: 'Design' }] });
    render(<SavedPage chrome={{ go: {} }} />);
    expect(await screen.findByText(/Kept in this browser only\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Join or sign in' })).toBeInTheDocument();
    const row = within(await screen.findByRole('link', { name: 'Canva' }).then((a) => a.closest('li')));
    expect(row.getByText('Sydney · Design')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Canva' })).toHaveAttribute('href', '/startup/canva');
    expect(screen.getByText(/Posts and people can only be saved with an account/)).toBeInTheDocument();
    expect(site.fetchStartupsByName).toHaveBeenCalledWith(['Canva']);
  });

  it('shows only the kinds that hold something, and says nothing is saved when nothing is', async () => {
    render(<SavedPage chrome={{ go: {} }} />);
    expect(await screen.findByText('Nothing saved yet.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Startups/ })).not.toBeInTheDocument();
  });

  it('lists roles, with the employer\'s own link, and events, with their dates, and takes one off with its bookmark', async () => {
    localStorage.setItem('stillEarlySavedJobs', JSON.stringify(['j-1']));
    localStorage.setItem('stillEarlySavedEvents', JSON.stringify(['founders-night']));
    api.fetchJobs.mockResolvedValue({ results: [job()] });
    api.fetchEvents.mockResolvedValue({ results: [event()] });
    render(<SavedPage chrome={{ go: {} }} />);
    const role = await screen.findByRole('link', { name: /Senior Software Engineer, Cobalt Labs/ });
    expect(role).toHaveAttribute('href', 'https://job-boards.greenhouse.io/cobalt/jobs/1');
    expect(role).toHaveAttribute('rel', 'noopener noreferrer');
    expect(api.fetchJobs).toHaveBeenCalledWith({ ids: ['j-1'], limit: 100, include_closed: 'yes' });
    expect(await screen.findByRole('link', { name: 'Founders Night' })).toHaveAttribute('href', '/events');
    await userEvent.click(screen.getByRole('button', { name: 'Remove Founders Night from saved' }));
    expect(readLocal('event')).toEqual([]);
  });

  it('says how many saved things are no longer listed (an event that is over, a role that closed), and clears them on request', async () => {
    localStorage.setItem('stillEarlySavedEvents', JSON.stringify(['founders-night', 'old-night']));
    api.fetchEvents.mockResolvedValue({ results: [event()] }); // the other is over, so the server no longer lists it
    render(<SavedPage chrome={{ go: {} }} />);
    expect(await screen.findByText(/1 saved item is no longer listed/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear it' }));
    expect(readLocal('event')).toEqual(['founders-night']);
  });

  it('keeps everything with the account when signed in, and shows bookmarked posts and saved people too', async () => {
    const author = { id: 'm_dee', name: 'Dee Test', initials: 'DT', role: 'Designer', city: 'Perth' };
    api.fetchFeed.mockResolvedValue({ results: [post({ id: 'p_9', body: 'A bookmarked post.', author })] });
    api.fetchMembers.mockResolvedValue({ results: [{ id: 'm_cal', name: 'Cal Demo', role: 'Operator', city: 'Sydney' }] });
    await signedIn(ADA, { ...NONE, post: ['p_9'], member: ['m_cal'] });
    render(<SavedPage chrome={{ go: {} }} />);
    expect(await screen.findByText(/Kept with your account/)).toBeInTheDocument();
    expect(await screen.findByText('A bookmarked post.')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Cal Demo' })).toHaveAttribute('href', '/members/m_cal');
    expect(api.fetchFeed).toHaveBeenCalledWith({ ids: ['p_9'], limit: 50 });
    expect(api.fetchMembers).toHaveBeenCalledWith({ ids: ['m_cal'], limit: 50 });
  });
});

describe('Discover: People', () => {
  const listed = (over = {}) => ({ id: 'm_ada', name: 'Ada Example', role: 'Founder', city: 'Melbourne', intro: 'I make small tools.', open_to: ['feedback', 'conversations'], building: [], links: { website: '', professional_profile: '' }, listed: true, ...over });
  const members = (results, over = {}) => ({ total: results.length, results, cities: ['Melbourne', 'Sydney'], offset: 0, limit: 20, hasMore: false, ...over });

  beforeEach(() => {
    window.history.replaceState(null, '', '/discover/people');
    site.fetchInvestors.mockResolvedValue({ results: [], count: 0 });
    api.fetchMembers.mockResolvedValue(members([listed()]));
  });

  it('is the People tab of Discover, with Members first, and says members wrote their own profiles and nobody has checked them', async () => {
    render(<DiscoverPeople chrome={{ go: {} }} />);
    await screen.findByText('Ada Example');
    expect(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Discover' })).toHaveAttribute('aria-current', 'page');
    expect(within(screen.getByRole('navigation', { name: 'Discover' })).getByRole('link', { name: 'People' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText(/Nobody has checked them, and being listed is not an endorsement/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Members' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('lists a member with their role, place, introduction and what they are open to, and links to their profile', async () => {
    render(<DiscoverPeople chrome={{ go: {} }} />);
    const link = await screen.findByRole('link', { name: /Ada Example/ });
    expect(link).toHaveAttribute('href', '/members/m_ada');
    expect(within(link).getByText('Founder · Melbourne')).toBeInTheDocument();
    expect(within(link).getByText('Open to feedback, conversations')).toBeInTheDocument();
    expect(screen.getByText('1 member listed')).toBeInTheDocument();
  });

  it('searches and filters by city and what they are open to, asking the server', async () => {
    render(<DiscoverPeople chrome={{ go: {} }} />);
    await screen.findByText('Ada Example');
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search members' }), 'clinic');
    await waitFor(() => expect(api.fetchMembers).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'clinic' }), expect.anything()));
    await userEvent.selectOptions(screen.getByLabelText('City'), 'Sydney');
    await waitFor(() => expect(api.fetchMembers).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'clinic', city: 'Sydney' }), expect.anything()));
    await userEvent.selectOptions(screen.getByLabelText('Open to'), 'work');
    await waitFor(() => expect(api.fetchMembers).toHaveBeenLastCalledWith(expect.objectContaining({ open_to: 'work' }), expect.anything()));
  });

  it('says honestly when no one has listed yet, and when a search finds no one', async () => {
    api.fetchMembers.mockResolvedValue(members([], { cities: [] }));
    render(<DiscoverPeople chrome={{ go: {} }} />);
    expect(await screen.findByText('No one has listed their profile yet.')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search members' }), 'zzz');
    expect(await screen.findByText('No members match.')).toBeInTheDocument();
  });

  it('saving a member needs an account: it asks a visitor to join, and saves for someone signed in', async () => {
    const first = render(<DiscoverPeople chrome={{ go: {} }} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Save Ada Example' }));
    expect(await screen.findByRole('dialog', { name: 'Join Still Early' })).toBeInTheDocument();
    expect(api.setSaved).not.toHaveBeenCalled();
    first.unmount();
    closeAuth();
    await signedIn();
    render(<DiscoverPeople chrome={{ go: {} }} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Save Ada Example' }));
    expect(api.setSaved).toHaveBeenCalledWith('member', 'm_ada', true);
  });

  it('keeps the directory\'s people apart: a Directory view that says they have not joined and a listing is not an endorsement or an introduction, and is empty until a person has published one', async () => {
    render(<DiscoverPeople chrome={{ go: {} }} />);
    await screen.findByText('Ada Example');
    await userEvent.click(screen.getByRole('button', { name: 'Directory' }));
    expect(await screen.findByText(/They have not joined Still Early, and a listing is not an endorsement, a partnership or a way to be introduced/)).toBeInTheDocument();
    expect(await screen.findByText('No one is listed here yet.')).toBeInTheDocument();
    expect(site.fetchInvestors).toHaveBeenCalledWith({ kind: 'person', scope: 'au' }, expect.objectContaining({ limit: 24 }));
    expect(screen.queryByText('Ada Example')).not.toBeInTheDocument(); // a member is never shown among the directory's people
  });

  it('shows a directory person as a listing, with their firm, linked to the directory\'s own page for them', async () => {
    site.fetchInvestors.mockResolvedValue({ count: 1, results: [{ key: 'people/sam', slug: 'sam', name: 'Sam Rivera', title: 'Partner', organisation: { name: 'Blackbird' } }] });
    render(<DiscoverPeople chrome={{ go: {} }} />);
    await screen.findByText('Ada Example');
    await userEvent.click(screen.getByRole('button', { name: 'Directory' }));
    const link = await screen.findByRole('link', { name: /Sam Rivera/ });
    expect(link).toHaveAttribute('href', '/investors/people/sam');
    expect(within(link).getByText('Partner at Blackbird')).toBeInTheDocument();
    expect(within(link).getByText('Directory listing')).toBeInTheDocument();
  });

  it('says members are not open yet where the server has nowhere to keep them', async () => {
    api.fetchNetworkStatus.mockResolvedValue({ available: false, reason: 'closed' });
    render(<DiscoverPeople chrome={{ go: {} }} />);
    expect(await screen.findByText('The community is not open yet.')).toBeInTheDocument();
    expect(api.fetchMembers).not.toHaveBeenCalled();
  });
});
