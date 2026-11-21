import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../src/networkApi.js', async () => (await import('./helpers.js')).apiMock());
vi.mock('../../src/api.js', async (original) => ({ ...(await original()), fetchStartupPage: vi.fn(), fetchCounts: vi.fn(), fetchInvestors: vi.fn() }));

import * as net from '../../src/networkApi.js';
import * as dir from '../../src/api.js';
import CommunityPage from '../../src/components/community/CommunityPage.jsx';
import { INTENTS, PLANS, readIntent } from '../../src/components/community/intents.js';
import { COLLECTIONS, collectionHref } from '../../src/components/community/collections.js';
import { signIn, resetSession } from '../../src/session.js';
import { resetSaved } from '../../src/savedStore.js';
import { closeAuth } from '../../src/authUi.js';
import { member } from './helpers.js';

// The page draws the sign-in dialog itself (its header hosts it).
const Page = () => <CommunityPage chrome={{ go: {} }} />;
const TAXONOMY = {
  intents: INTENTS, skills: [{ id: 'engineering', label: 'Engineering' }, { id: 'design', label: 'Design' }], interests: ['Fintech', 'Climate & Energy'],
  collaboration: [{ id: 'cofounder', label: 'A co-founder' }, { id: 'contributor', label: 'A contributor, part-time or for a project' }], stages: [{ id: 'idea', label: 'An idea' }, { id: 'prototype', label: 'A prototype' }],
};
const company = (over = {}) => ({ name: 'Acme Robotics', slug: 'acme-robotics', website: 'https://acme.example', blurb: 'Robots for warehouses', sectorGroup: 'Industrial & Logistics', city: 'Sydney', stage: 'Seed', founders: ['Jane Doe', 'John Roe'], hiring: false, ...over });
const page = (results) => ({ total: results.length, count: results.length, results });
const role = (over = {}) => ({ id: 'r1', title: 'Backend Engineer', company: { name: 'Acme Robotics', slug: 'acme-robotics', website: 'https://acme.example' }, location: 'Sydney, NSW', apply_url: 'https://acme.example/jobs/1', work: { cities: ['Sydney'] }, ...over });
const closed = () => net.fetchNetworkStatus.mockResolvedValue({ available: false, reason: 'The community is not open yet: it needs a disk that survives restarts.', taxonomy: TAXONOMY, founding: { open: true, durable: false } });
const opened = () => net.fetchNetworkStatus.mockResolvedValue({ available: true, reason: null, taxonomy: TAXONOMY, founding: { open: true, durable: true } });
const project = (over = {}) => ({
  id: 'p_1', name: 'Open tide data', summary: 'A shared dataset of coastal conditions for marine startups.', problem: 'Everyone rebuilds the pipeline.', stage: 'idea', skills_needed: ['engineering'],
  collaboration: ['contributor'], interests: [], city: 'Sydney', remote: true, open: true, created_at: '2026-11-01T00:00:00Z', owner: { id: 'm_cy', name: 'Cy Demo', initials: 'CD', role: 'Engineer', city: 'Sydney' },
  interested_count: 0, mine: false, interested: false, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  window.history.replaceState(null, '', '/home');
  net.setToken(null);
  net.fetchMe.mockRejectedValue(new net.ApiError('Sign in to do that.', 401, 'unauthorized'));
  resetSession(); resetSaved(); closeAuth();
  closed();
  dir.fetchStartupPage.mockResolvedValue(page([company()]));
  dir.fetchCounts.mockResolvedValue({ total: 920, counts: [99, 144, 68] });
  dir.fetchInvestors.mockResolvedValue({ total: 19, count: 8, results: [{ slug: 'airtree', name: 'AirTree', domain: 'airtree.vc', type_label: 'Venture Capital', stages: ['Seed', 'Series A'] }] });
  net.fetchEvents.mockResolvedValue({ results: [{ id: 'e1', name: 'evokeAG. 2027', city: 'Adelaide', timezone: 'Australia/Adelaide', starts: '2027-02-16', ends: '2027-02-17', time_confirmed: false, audience: 'Agrifood startups and investors', type_label: 'Conference' }], total: 1 });
  net.fetchJobs.mockResolvedValue({ results: [role(), role({ id: 'r2', title: 'Designer', company: { name: 'Beta Labs', slug: 'beta-labs', website: 'https://beta.example' } })], count: 2, total: 2 });
  net.fetchProjects.mockResolvedValue({ results: [], total: 0 });
  net.fetchMembers.mockResolvedValue({ results: [], total: 0 });
  net.fetchFeed.mockResolvedValue({ results: [], hasMore: false, next: null });
  net.fetchMatches.mockResolvedValue({ people: [], projects: [] });
});

describe('the one question: what would you like to do today?', () => {
  it('offers the eight things, none chosen, and says everything is shown', async () => {
    render(<Page />);
    expect(await screen.findByRole('heading', { level: 1, name: 'What would you like to do today?' })).toBeInTheDocument();
    const group = within(screen.getByRole('group', { name: 'What would you like to do today?' }));
    expect(group.getAllByRole('button').map((b) => b.textContent)).toEqual(['Find people to build with', 'Find a co-founder', 'Contribute to a startup', 'Find a startup job', 'Meet founders or investors', 'Get feedback on an idea', 'Find talent for my team', 'Explore the ecosystem']);
    for (const b of group.getAllByRole('button')) expect(b).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('No choice made: everything is shown below.')).toBeInTheDocument();
  });

  it('is a toggle that can be changed or cleared at any time, is remembered in this browser and the address, and asks nothing and sends nothing', async () => {
    render(<Page />);
    const group = within(await screen.findByRole('group', { name: 'What would you like to do today?' }));
    await userEvent.click(group.getByRole('button', { name: 'Find a co-founder' }));
    expect(group.getByRole('button', { name: /Find a co-founder/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/Showing what fits/)).toHaveTextContent('Find a co-founder');
    expect(window.location.search).toBe('?for=cofounder');
    expect(localStorage.getItem('stillEarlyCommunityIntent')).toBe('cofounder');
    await userEvent.click(group.getByRole('button', { name: 'Find a startup job' })); // change
    expect(group.getByRole('button', { name: /Find a startup job/ })).toHaveAttribute('aria-pressed', 'true');
    expect(group.getByRole('button', { name: /Find a co-founder/ })).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(group.getByRole('button', { name: /Find a startup job/ })); // press again: clear
    expect(screen.getByText('No choice made: everything is shown below.')).toBeInTheDocument();
    expect(window.location.search).toBe('');
    expect(localStorage.getItem('stillEarlyCommunityIntent')).toBeNull();
    expect(net.submitFounding).not.toHaveBeenCalled();
  });

  it('starts from the address (a shared link) or what this browser remembered, and ignores a word it does not know', () => {
    expect(readIntent('?for=talent')).toBe('talent');
    expect(readIntent('?for=world-domination')).toBe('');
    localStorage.setItem('stillEarlyCommunityIntent', 'meet');
    expect(readIntent('')).toBe('meet');
    expect(readIntent('?for=job')).toBe('job'); // the address wins
    localStorage.setItem('stillEarlyCommunityIntent', 'nonsense');
    expect(readIntent('')).toBe('');
  });

  it('changes what the page leads with, and every choice has a plan written down', async () => {
    window.history.replaceState(null, '', '/home?for=job');
    render(<Page />);
    expect(await screen.findByRole('heading', { name: 'Open roles at Australian startups' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Startups hiring now' })).toBeInTheDocument();
    const roles = within(screen.getByRole('heading', { name: 'Open roles at Australian startups' }).closest('section'));
    expect(await roles.findByRole('link', { name: /Backend Engineer/ })).toHaveAttribute('href', 'https://acme.example/jobs/1'); // the employer's own page
    expect(net.fetchJobs).toHaveBeenCalledWith(expect.objectContaining({ limit: 100, where: 'au' }), expect.anything());
    for (const i of INTENTS) expect(PLANS[i.id], i.id).toMatchObject({ lead: expect.any(String), blocks: expect.any(Array) });
    expect(Object.values(PLANS).every((p) => !p.blocks.includes('lists'))).toBe(true); // the collections are the right rail's
  });
});

describe('while the Community is closed: what is live, and what is honest', () => {
  it('says the members\' side is not open and that nothing can be posted, and posts, accounts and introductions are not offered', async () => {
    render(<Page />);
    expect(await screen.findByRole('heading', { name: 'The Community is not open yet.' })).toBeInTheDocument();
    expect(screen.getByText(/nothing can be posted here today, and nothing pretends to work/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Your post' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ask for an introduction/ })).not.toBeInTheDocument();
    expect(net.fetchProjects).not.toHaveBeenCalled();
    expect(net.fetchMembers).not.toHaveBeenCalled();
    expect(net.fetchFeed).not.toHaveBeenCalled();
    expect(net.fetchMatches).not.toHaveBeenCalled();
    expect(await screen.findByText(/Projects and collaboration requests open with the Community/)).toBeInTheDocument();
  });

  it('shows real companies, founders named on their pages (and says they are not members), and says when nothing is new rather than filling the space', async () => {
    render(<Page />);
    expect((await screen.findAllByRole('link', { name: /Acme Robotics/ }))[0]).toHaveAttribute('href', '/startup/acme-robotics');
    expect(await screen.findByText('Nothing was added this week.')).toBeInTheDocument();
    const people = within(screen.getByRole('heading', { name: 'People to meet' }).closest('section'));
    expect(await people.findByText('Jane Doe')).toBeInTheDocument();
    expect(people.getAllByText('Directory, not a member').length).toBeGreaterThan(0);
    expect(people.getByText(/no way to message them from here/)).toBeInTheDocument();
  });

  it('shows the four collections with their rule and the server\'s own count, and each links to the page that applies it', async () => {
    render(<Page />);
    const rail = within(screen.getByRole('heading', { name: 'Curated collections', level: 2 }).closest('section'));
    expect(await rail.findByText('99')).toBeInTheDocument();
    expect(rail.getByText('144')).toBeInTheDocument();
    expect(rail.getByText('68')).toBeInTheDocument();
    expect(rail.getByText('8')).toBeInTheDocument();
    expect(dir.fetchCounts).toHaveBeenCalledWith([{ sector: 'Fintech' }, { city: 'Melbourne', maturity: 'Early' }, { sector: 'AI & Data' }], expect.anything());
    expect(collectionHref(COLLECTIONS[0])).toBe('/discover?sector=Fintech');
    expect(collectionHref(COLLECTIONS[3])).toBe('/investors?stage=Pre-seed%2CSeed');
    expect(COLLECTIONS.map((c) => c.title)).toEqual(['Australian fintech startups to discover', 'Emerging Melbourne founders', 'Australian AI companies', 'Investors backing early-stage founders']);
    expect(COLLECTIONS.every((c) => /\S/.test(c.rule))).toBe(true);
  });

  it('takes a founding registration without an account, needs the tick, and says what it is and that it can be lost', async () => {
    render(<Page />);
    await userEvent.click(await screen.findByText('Join the founding list', { selector: 'summary' }));
    const form = screen.getByRole('form', { name: 'Join the founding list' });
    expect(within(form).getByText(/waiting list, not an account/)).toBeInTheDocument();
    const submit = within(form).getByRole('button', { name: 'Join the founding list' });
    expect(submit).toBeDisabled(); // no tick, no registration
    await userEvent.type(within(form).getByLabelText('Name'), 'Ada Example');
    await userEvent.type(within(form).getByLabelText(/^Email/), 'ada@example.org');
    await userEvent.click(within(form).getByRole('button', { name: 'Engineering' }));
    await userEvent.click(within(form).getByRole('button', { name: 'Find a co-founder' }));
    await userEvent.click(within(form).getByRole('checkbox'));
    net.submitFounding.mockResolvedValue({ saved: true, durable: false });
    await userEvent.click(submit);
    expect(net.submitFounding).toHaveBeenCalledWith(expect.objectContaining({ name: 'Ada Example', email: 'ada@example.org', skills: ['engineering'], intents: ['cofounder'], consent: true, company_website: '' }));
    expect(await screen.findByText('You are on the founding list.')).toBeInTheDocument();
    expect(screen.getByText(/No account has been made and nothing is posted/)).toBeInTheDocument();
    expect(screen.getByText(/We do not send email automatically yet/)).toBeInTheDocument();
    expect(screen.getByText(/can restart and lose what it holds/)).toBeInTheDocument();
  });

  it('shows the server\'s reason when a registration is refused, and keeps what was typed', async () => {
    render(<Page />);
    await userEvent.click(await screen.findByText('Join the founding list', { selector: 'summary' }));
    const form = screen.getByRole('form', { name: 'Join the founding list' });
    await userEvent.type(within(form).getByLabelText('Name'), 'Ada Example');
    await userEvent.type(within(form).getByLabelText(/^Email/), 'ada@example.org');
    await userEvent.click(within(form).getByRole('checkbox'));
    net.submitFounding.mockRejectedValue(new net.ApiError('Too many sign-ups from this connection. Try again in an hour.', 429, 'rate_limited'));
    await userEvent.click(within(form).getByRole('button', { name: 'Join the founding list' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('Too many sign-ups');
    expect(within(form).getByLabelText('Name')).toHaveValue('Ada Example');
  });
});

describe('when the Community is open', () => {
  async function signedIn(who = member()) {
    net.signIn.mockResolvedValue({ token: 'se_test', member: who });
    net.fetchMe.mockResolvedValue({ member: who });
    net.fetchSaved.mockResolvedValue({ saved: { startup: [], investor: [], job: [], event: [], post: [], member: [] } });
    await act(async () => { await signIn({ email: who.email, password: 'a-long-enough-password' }); });
  }

  it('shows projects as the authors wrote them, asks a visitor to join before saying they are interested, and does not call the site an endorser', async () => {
    opened();
    net.fetchProjects.mockResolvedValue({ results: [project({ interested_count: 2 })], total: 1 });
    window.history.replaceState(null, '', '/home?section=projects');
    render(<Page />);
    const card = within(await screen.findByRole('article', { name: 'Project: Open tide data' }));
    expect(card.getByText('A shared dataset of coastal conditions for marine startups.')).toBeInTheDocument();
    expect(card.getByText('Sydney or remote')).toBeInTheDocument();
    expect(card.getByText('2 interested')).toBeInTheDocument();
    expect(screen.getByText(/does not rank or vouch for any of them/)).toBeInTheDocument();
    await userEvent.click(card.getByRole('button', { name: 'I’m interested' }));
    expect(await screen.findByRole('dialog', { name: 'Join Still Early' }, { timeout: 4000 })).toBeInTheDocument();
    expect(net.setInterest).not.toHaveBeenCalled();
  });

  it('records interest for a signed-in member, and shows it', async () => {
    opened();
    net.fetchProjects.mockResolvedValue({ results: [project()], total: 1 });
    window.history.replaceState(null, '', '/home?section=projects');
    await signedIn();
    render(<Page />);
    const card = within(await screen.findByRole('article', { name: 'Project: Open tide data' }));
    net.setInterest.mockResolvedValue({ interested: true, interested_count: 1 });
    await userEvent.click(card.getByRole('button', { name: 'I’m interested' }));
    expect(net.setInterest).toHaveBeenCalledWith('p_1', true);
    expect(await card.findByRole('button', { name: /You are interested/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('says honestly that no project has been shared, rather than showing one that is made up', async () => {
    opened();
    window.history.replaceState(null, '', '/home?section=projects');
    render(<Page />);
    expect(await screen.findByText('No project has been shared yet.')).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('shows matches with the reason in words, and asks for an introduction only with a contact set, saying who sees what', async () => {
    opened();
    net.fetchMatches.mockResolvedValue({ people: [{ member: { id: 'm_bo', name: 'Bo Demo', role: 'Designer', city: 'Melbourne' }, why: ['You both want to find a co-founder.', 'They bring design, which you do not list.'] }], projects: [] });
    await signedIn(member({ looking_for: ['cofounder'], skills: ['engineering'], contact: '' }));
    render(<Page />);
    const rail = within(await screen.findByRole('heading', { name: 'Recommended connections' }).then((h) => h.closest('section')));
    expect(await rail.findByText('You both want to find a co-founder.')).toBeInTheDocument();
    expect(rail.getByText('They bring design, which you do not list.')).toBeInTheDocument();
    await userEvent.click(rail.getByRole('button', { name: 'Ask for an introduction' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ask Bo Demo for an introduction' });
    expect(within(dialog).getByText(/Your contact is shown to them only if they accept/)).toBeInTheDocument();
    expect(within(dialog).getByText(/set how people can reach you/)).toBeInTheDocument(); // no contact set: it cannot be sent yet
    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument();
    expect(net.requestIntroduction).not.toHaveBeenCalled();
  });

  it('sends the request once the member has a contact line, with the reasons it was suggested for', async () => {
    opened();
    const why = ['You both want to find a co-founder.'];
    net.fetchMatches.mockResolvedValue({ people: [{ member: { id: 'm_bo', name: 'Bo Demo', role: 'Designer', city: 'Melbourne' }, why }], projects: [] });
    net.requestIntroduction.mockResolvedValue({ introduction: { id: 'i_1' } });
    await signedIn(member({ looking_for: ['cofounder'], contact: 'https://example.org/ada' }));
    render(<Page />);
    await userEvent.click(await screen.findByRole('button', { name: 'Ask for an introduction' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ask Bo Demo for an introduction' });
    await userEvent.type(within(dialog).getByRole('textbox'), 'I would like to talk about building together.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ask for an introduction' }));
    await waitFor(() => expect(net.requestIntroduction).toHaveBeenCalledWith({ to: 'm_bo', note: 'I would like to talk about building together.', why }));
    expect(await screen.findByText(/Asked\. They will see it in their introductions/)).toBeInTheDocument();
  });

  it('explains how matching works to a visitor and to a member with nothing to match on, and makes no suggestion up', async () => {
    opened();
    const { unmount } = render(<Page />);
    expect(await screen.findByRole('button', { name: 'Join to see who fits' })).toBeInTheDocument(); // the open state, for a visitor
    expect(screen.getByText(/Matches use what members say about themselves/)).toBeInTheDocument();
    unmount();
    await signedIn(member());
    render(<Page />);
    expect(await screen.findByText(/Say what you are looking for and what you bring/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ask for an introduction' })).not.toBeInTheDocument();
  });
});
