import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../src/networkApi.js', async () => (await import('./helpers.js')).apiMock());

import * as api from '../../src/networkApi.js';
import SiteHeader from '../../src/components/brand/SiteHeader.jsx';
import ProfileEditor from '../../src/components/network/ProfileEditor.jsx';
import MemberProfile from '../../src/components/network/MemberProfile.jsx';
import { signIn, resetSession, getSession } from '../../src/session.js';
import { resetSaved } from '../../src/savedStore.js';
import { closeAuth, openAuth } from '../../src/authUi.js';
import { member, post } from './helpers.js';

const ADA = member();
const NONE = { startup: [], investor: [], job: [], event: [], post: [], member: [] };

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  window.history.replaceState(null, '', '/home');
  api.setToken(null);
  api.fetchMe.mockRejectedValue(new api.ApiError('Sign in to do that.', 401, 'unauthorized'));
  api.fetchNetworkStatus.mockResolvedValue({ available: true, reason: null });
  api.fetchSaved.mockResolvedValue({ saved: NONE });
  api.mergeSaved.mockResolvedValue({ added: 0, saved: NONE });
  resetSession();
  resetSaved();
});
afterEach(() => { closeAuth(); });

const dialog = () => screen.findByRole('dialog');

describe('signing up and signing in', () => {
  it('opens from the header as Sign in, with an email and a password, and signs the person in', async () => {
    api.signIn.mockResolvedValue({ token: 'se_1', member: ADA });
    render(<SiteHeader />);
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    const d = within(await dialog());
    expect(d.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    await userEvent.type(d.getByLabelText('Email'), 'ada@example.com');
    await userEvent.type(d.getByLabelText('Password'), 'a-long-enough-password');
    await userEvent.click(d.getByRole('button', { name: 'Sign in' }));
    expect(api.signIn).toHaveBeenCalledWith({ email: 'ada@example.com', password: 'a-long-enough-password' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByRole('button', { name: 'Your account, Ada Example' })).toBeInTheDocument();
    expect(api.getToken()).toBe('se_1'); // the session is kept for the next visit
  });

  it('says why a sign-in failed and leaves the dialog open', async () => {
    api.signIn.mockRejectedValue(Object.assign(new Error('That email and password do not match.'), { status: 401 }));
    render(<SiteHeader />);
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    const d = within(await dialog());
    await userEvent.type(d.getByLabelText('Email'), 'ada@example.com');
    await userEvent.type(d.getByLabelText('Password'), 'wrong');
    await userEvent.click(d.getByRole('button', { name: 'Sign in' }));
    expect(await d.findByRole('alert')).toHaveTextContent('That email and password do not match.');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('makes an account from a name, an email and a password, says the site cannot reset a password, and lists the person only if they tick the box', async () => {
    api.signUp.mockResolvedValue({ token: 'se_2', member: ADA });
    render(<SiteHeader />);
    act(() => openAuth({ mode: 'signup', reason: 'post' }));
    const d = within(await dialog());
    expect(d.getByRole('heading', { name: 'Join Still Early' })).toBeInTheDocument();
    expect(d.getByText(/Sign in to share something with the community\./)).toBeInTheDocument();
    expect(d.getByText(/we cannot reset a forgotten password/)).toBeInTheDocument();
    expect(d.getByText(/Membership is not a badge/)).toBeInTheDocument();
    expect(d.getByRole('checkbox', { name: /List my profile in Discover/ })).not.toBeChecked(); // consent is asked for, not assumed
    await userEvent.type(d.getByLabelText('Your name'), 'Ada Example');
    await userEvent.type(d.getByLabelText('Email'), 'ada@example.com');
    await userEvent.type(d.getByLabelText('Password'), 'a-long-enough-password');
    await userEvent.click(d.getByRole('checkbox', { name: /List my profile in Discover/ }));
    await userEvent.click(d.getByRole('button', { name: 'Create account' }));
    expect(api.signUp).toHaveBeenCalledWith({ name: 'Ada Example', email: 'ada@example.com', password: 'a-long-enough-password', listed: true });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('switches between signing in and joining without losing the dialog, and closes with Escape and gives focus back', async () => {
    render(<SiteHeader />);
    const opener = screen.getByRole('button', { name: 'Sign in' });
    await userEvent.click(opener);
    const d = within(await dialog());
    await userEvent.click(d.getByRole('button', { name: 'Create an account' }));
    expect(d.getByRole('heading', { name: 'Join Still Early' })).toBeInTheDocument();
    await userEvent.click(d.getByRole('button', { name: 'I already have an account' }));
    expect(d.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });

  it('says there is nothing to sign in to where the community is not open, and points to what needs no account', async () => {
    api.fetchNetworkStatus.mockResolvedValue({ available: false, reason: 'The community is not open yet: it needs a disk that survives restarts.' });
    render(<SiteHeader />);
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    const d = within(await dialog());
    expect(await d.findByText(/needs a disk that survives restarts/)).toBeInTheDocument();
    expect(d.queryByLabelText('Password')).not.toBeInTheDocument();
    expect(d.getByText(/what you save is kept in this browser/)).toBeInTheDocument();
  });

  it('picks the session up again from the token the browser kept, and drops it when the server no longer knows it', async () => {
    api.setToken('se_old');
    api.fetchMe.mockResolvedValueOnce({ member: ADA });
    resetSession();
    render(<SiteHeader />);
    expect(await screen.findByRole('button', { name: 'Your account, Ada Example' })).toBeInTheDocument();
    api.fetchMe.mockRejectedValueOnce(new api.ApiError('Sign in to do that.', 401, 'unauthorized'));
    api.setToken('se_expired');
    resetSession();
    await waitFor(() => expect(getSession().status).toBe('out'));
    expect(api.getToken()).toBeNull();
  });
});

describe('the account menu', () => {
  async function signedIn(who = ADA) {
    api.signIn.mockResolvedValue({ token: 'se_t', member: who });
    api.fetchMe.mockResolvedValue({ member: who });
    await act(async () => { await signIn({ email: who.email, password: 'a-long-enough-password' }); });
  }

  it('holds the profile, what was saved (with how many) and signing out, and not the three places', async () => {
    await signedIn();
    localStorage.setItem('auStartupTracked', JSON.stringify(['Canva']));
    render(<SiteHeader go={{}} counts={{ saved: 4 }} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Your account, Ada Example' }));
    const menu = within(screen.getByRole('menu'));
    expect(menu.getByText('Ada Example')).toBeInTheDocument();
    expect(menu.getByText('Founder, building a scheduling tool')).toBeInTheDocument();
    expect(menu.getByRole('menuitem', { name: 'Your profile' })).toHaveAttribute('href', '/me');
    expect(menu.getByRole('menuitem', { name: /^Saved/ })).toHaveAttribute('href', '/saved');
    expect(menu.getByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('signs out: the session ends here and at the server, and the header goes back to Sign in', async () => {
    await signedIn();
    api.signOutRequest.mockResolvedValue(null);
    render(<SiteHeader />);
    await userEvent.click(await screen.findByRole('button', { name: 'Your account, Ada Example' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    expect(api.signOutRequest).toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(api.getToken()).toBeNull();
  });
});

describe('your profile', () => {
  async function signedIn(who = ADA) {
    api.signIn.mockResolvedValue({ token: 'se_t', member: who });
    api.fetchMe.mockResolvedValue({ member: who });
    await act(async () => { await signIn({ email: who.email, password: 'a-long-enough-password' }); });
  }

  it('asks a visitor to sign in, and shows nothing of anyone\'s profile', async () => {
    render(<ProfileEditor chrome={{ go: {} }} onViewPublic={() => {}} />);
    expect(await screen.findByText('Sign in to edit your profile.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
  });

  it('opens with what is on record, and saves exactly what was changed: the fields, the projects without the blank ones, the links and the choice to be listed', async () => {
    await signedIn();
    api.updateProfile.mockImplementation(async (changes) => ({ member: { ...ADA, ...changes, links: changes.links } }));
    render(<ProfileEditor chrome={{ go: {} }} onViewPublic={() => {}} />);
    expect(await screen.findByLabelText('Name')).toHaveValue('Ada Example');
    expect(screen.getByLabelText('Role')).toHaveValue('Founder, building a scheduling tool');
    await userEvent.clear(screen.getByLabelText('City'));
    await userEvent.type(screen.getByLabelText('City'), 'Sydney');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Work' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add another' }));
    await userEvent.click(screen.getByRole('checkbox', { name: /List me in Discover/ })); // it was on: now off
    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(api.updateProfile).toHaveBeenCalledTimes(1);
    expect(api.updateProfile.mock.calls[0][0]).toEqual({
      name: 'Ada Example', role: 'Founder, building a scheduling tool', city: 'Sydney', intro: 'I make small tools.', listed: false, open_to: ['feedback', 'work'],
      building: [{ title: 'Clinic Slots', url: 'https://example.com/slots', note: 'Booking for clinics' }], // the empty second project is not sent
      links: { website: 'https://example.com/ada', professional_profile: '' },
    });
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    expect(getSession().member.city).toBe('Sydney'); // the header and every page now say it
  });

  it('shows the server\'s reason when a profile is refused', async () => {
    await signedIn();
    api.updateProfile.mockRejectedValue(Object.assign(new Error('Website must start with https://'), { status: 400 }));
    render(<ProfileEditor chrome={{ go: {} }} onViewPublic={() => {}} />);
    await userEvent.type(await screen.findByLabelText('Website'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Website must start with https://');
  });

  it('says plainly there is no photo (the picture is initials), and never offers a badge', async () => {
    await signedIn();
    render(<ProfileEditor chrome={{ go: {} }} onViewPublic={() => {}} />);
    expect(await screen.findByText(/Your picture is your initials for now/)).toBeInTheDocument();
    expect(screen.queryByText(/verified|vetted/i)).not.toBeInTheDocument();
  });

  it('changes a password with the current one, and says other devices were signed out', async () => {
    await signedIn();
    api.changePassword.mockResolvedValue(null);
    render(<ProfileEditor chrome={{ go: {} }} onViewPublic={() => {}} />);
    await userEvent.type(await screen.findByLabelText('Current password'), 'a-long-enough-password');
    await userEvent.type(screen.getByLabelText('New password'), 'another-long-password');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(api.changePassword).toHaveBeenCalledWith('a-long-enough-password', 'another-long-password');
    expect(await screen.findByText(/Other devices have been signed out/)).toBeInTheDocument();
  });

  it('deletes the account only after the password is entered, says what goes with it, and signs out', async () => {
    await signedIn();
    api.deleteAccount.mockResolvedValue(null);
    api.signOutRequest.mockResolvedValue(null);
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    render(<ProfileEditor chrome={{ go: {} }} onViewPublic={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Delete my account' }));
    expect(screen.getByText(/deletes your account, your posts and replies, your likes and everything you saved/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete everything' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Password'), 'a-long-enough-password');
    await userEvent.click(screen.getByRole('button', { name: 'Delete everything' }));
    expect(api.deleteAccount).toHaveBeenCalledWith('a-long-enough-password');
    await waitFor(() => expect(getSession().status).toBe('out'));
    vi.unstubAllGlobals();
  });
});

describe('a member\'s public profile', () => {
  const pub = (over = {}) => { const { email, email_verified, suspended, ...rest } = member(over); return rest; };

  it('shows who they are, what they are open to, what they are building and where to find them, with links that open safely in a new tab, and says nobody has checked it', async () => {
    api.fetchMember.mockResolvedValue({ member: pub(), posts: [post({ id: 'p_a', body: 'Their own post.' })], saved: false });
    render(<MemberProfile id="m_ada" chrome={{ go: {} }} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Ada Example' })).toBeInTheDocument();
    expect(screen.getByText('Founder, building a scheduling tool · Melbourne')).toBeInTheDocument();
    expect(screen.getByText('I make small tools.')).toBeInTheDocument();
    expect(screen.getByText('Feedback')).toBeInTheDocument();
    const project = screen.getByRole('link', { name: /Clinic Slots/ });
    expect(project).toHaveAttribute('href', 'https://example.com/slots');
    expect(project).toHaveAttribute('target', '_blank');
    expect(project).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('link', { name: /Website/ })).toHaveAttribute('href', 'https://example.com/ada');
    expect(screen.getByText('Their own post.')).toBeInTheDocument();
    expect(screen.getByText(/Still Early has not checked it/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('ada@example.com'); // an email is never on a public page
    expect(document.title).toBe('Ada Example · Still Early');
  });

  it('says there is no such member, or that the community is not open, without showing anything else', async () => {
    api.fetchMember.mockRejectedValue(Object.assign(new Error('That member is not here.'), { status: 404 }));
    const first = render(<MemberProfile id="nobody" chrome={{ go: {} }} />);
    expect(await screen.findByText('This member is not here.')).toBeInTheDocument();
    first.unmount();
    api.fetchMember.mockRejectedValue(Object.assign(new Error('closed'), { status: 503, code: 'network_unavailable' }));
    render(<MemberProfile id="nobody" chrome={{ go: {} }} />);
    expect(await screen.findByText('The community is not open yet.')).toBeInTheDocument();
  });

  it('offers Save to someone else\'s profile (which asks for an account) and Edit on one\'s own', async () => {
    api.fetchMember.mockResolvedValue({ member: pub(), posts: [], saved: false });
    const first = render(<MemberProfile id="m_ada" chrome={{ go: {} }} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('dialog', { name: 'Join Still Early' })).toBeInTheDocument(); // people can only be saved with an account
    first.unmount();
    closeAuth();
    api.signIn.mockResolvedValue({ token: 'se_t', member: ADA });
    await act(async () => { await signIn({ email: ADA.email, password: 'a-long-enough-password' }); });
    const onEdit = vi.fn();
    render(<MemberProfile id="m_ada" chrome={{ go: {} }} onEdit={onEdit} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit profile' }));
    expect(onEdit).toHaveBeenCalled();
  });
});
