import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../src/networkApi.js', async () => (await import('./helpers.js')).apiMock());

import * as api from '../../src/networkApi.js';
import HomeFeed from '../../src/components/network/HomeFeed.jsx';
import { signIn, resetSession } from '../../src/session.js';
import { resetSaved } from '../../src/savedStore.js';
import { closeAuth } from '../../src/authUi.js';
import { member, post, reply } from './helpers.js';

const ADA = member();
const feed = (results, over = {}) => ({ results, hasMore: false, next: null, total: results.length, ...over });
const open = () => api.fetchNetworkStatus.mockResolvedValue({ available: true, reason: null });

async function signedIn(who = ADA) {
  api.signIn.mockResolvedValue({ token: 'se_test', member: who });
  api.fetchMe.mockResolvedValue({ member: who });
  api.fetchSaved.mockResolvedValue({ saved: { startup: [], investor: [], job: [], event: [], post: [], member: [] } });
  await act(async () => { await signIn({ email: who.email, password: 'a-long-enough-password' }); });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  window.history.replaceState(null, '', '/home');
  api.setToken(null);
  api.fetchMe.mockRejectedValue(new api.ApiError('Sign in to do that.', 401, 'unauthorized'));
  resetSession();
  resetSaved();
  open();
  api.fetchFeed.mockResolvedValue(feed([]));
  api.setSaved.mockResolvedValue({});
});
afterEach(() => { closeAuth(); });

describe('Home, for someone who is not signed in', () => {
  it('names itself and says what it is for, and asks the server for the first page of the feed in all four filters\' default', async () => {
    api.fetchFeed.mockResolvedValue(feed([post()]));
    render(<HomeFeed chrome={{ go: {} }} />);
    expect(await screen.findByRole('heading', { level: 1, name: /What are you working on\?/ })).toBeInTheDocument();
    expect(screen.getByText(/text-first space for Australia/)).toBeInTheDocument();
    await screen.findByText('What if every city had a monthly prototype night?');
    expect(api.fetchFeed).toHaveBeenCalledWith({ filter: 'all', limit: 20 }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(document.title).toBe('Home · Still Early');
  });

  it('shows each post with its author, role and place, how long ago, its topic, and a link to the author\'s profile', async () => {
    api.fetchFeed.mockResolvedValue(feed([post({ topic: 'question', topic_label: 'Question' })]));
    render(<HomeFeed chrome={{ go: {} }} />);
    const card = within(await screen.findByRole('article', { name: 'Post by Cal Demo' }));
    expect(card.getByRole('link', { name: 'Cal Demo' })).toHaveAttribute('href', '/members/m_cal');
    expect(card.getByText(/Operator · Sydney/)).toBeInTheDocument();
    expect(card.getByText('3h ago')).toBeInTheDocument();
    expect(card.getByText('Question')).toBeInTheDocument();
  });

  it('has the four filters, and asks the server for the one chosen', async () => {
    render(<HomeFeed chrome={{ go: {} }} />);
    await screen.findByText('Nothing has been shared yet.');
    const filters = within(screen.getByRole('group', { name: 'Show' }));
    expect(filters.getAllByRole('button').map((b) => b.textContent)).toEqual(['All', 'Ideas', 'Building', 'Questions']);
    expect(filters.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(filters.getByRole('button', { name: 'Building' }));
    await waitFor(() => expect(api.fetchFeed).toHaveBeenLastCalledWith({ filter: 'building', limit: 20 }, expect.anything()));
    expect(await screen.findByText('Nobody has shared what they are building yet.')).toBeInTheDocument();
  });

  it('says honestly that nothing has been shared, rather than showing anything made up', async () => {
    render(<HomeFeed chrome={{ go: {} }} />);
    expect(await screen.findByText('Nothing has been shared yet.')).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('asks a visitor to join before they post, like, reply, bookmark or report, and posts nothing', async () => {
    api.fetchFeed.mockResolvedValue(feed([post()]));
    render(<HomeFeed chrome={{ go: {} }} />);
    await screen.findByRole('article', { name: 'Post by Cal Demo' });
    expect(screen.queryByRole('textbox', { name: 'Your post' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Join to post' }));
    expect(await screen.findByRole('dialog', { name: 'Join Still Early' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: /^Like/ }));
    expect(await screen.findByRole('dialog', { name: 'Sign in' })).toBeInTheDocument();
    expect(api.setLike).not.toHaveBeenCalled();
    expect(api.createPost).not.toHaveBeenCalled();
  });

  it('says the community is not open yet, and shows no feed, where the server has nowhere to keep one', async () => {
    api.fetchNetworkStatus.mockResolvedValue({ available: false, reason: 'The community is not open yet: it needs a disk that survives restarts (NETWORK_DATA_DIR), and this server has none.' });
    render(<HomeFeed chrome={{ go: {} }} />);
    expect(await screen.findByText('The community is not open yet.')).toBeInTheDocument();
    expect(screen.getByText(/needs a disk that survives restarts/)).toBeInTheDocument();
    expect(api.fetchFeed).not.toHaveBeenCalled();
    expect(screen.queryByRole('group', { name: 'Show' })).not.toBeInTheDocument();
  });

  it('says it could not load the feed, with the reason, and tries again on request', async () => {
    api.fetchFeed.mockRejectedValueOnce(Object.assign(new Error('Could not reach the server.'), { status: 0 }));
    render(<HomeFeed chrome={{ go: {} }} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the feed. Could not reach the server.');
    api.fetchFeed.mockResolvedValue(feed([post()]));
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('article', { name: 'Post by Cal Demo' })).toBeInTheDocument();
  });

  it('pages: "Show older posts" asks for the page after the last one seen', async () => {
    api.fetchFeed.mockResolvedValueOnce(feed([post({ id: 'p_2', body: 'Newer' })], { hasMore: true, next: 'p_2' }));
    render(<HomeFeed chrome={{ go: {} }} />);
    await screen.findByText('Newer');
    api.fetchFeed.mockResolvedValueOnce(feed([post({ id: 'p_1', body: 'Older' })]));
    await userEvent.click(screen.getByRole('button', { name: 'Show older posts' }));
    await screen.findByText('Older');
    expect(api.fetchFeed).toHaveBeenLastCalledWith({ filter: 'all', limit: 20, before: 'p_2' });
    expect(screen.queryByRole('button', { name: 'Show older posts' })).not.toBeInTheDocument();
  });
});

describe('Home, signed in', () => {
  it('posts: the topic, the words and a count, and the new post appears at the top', async () => {
    api.fetchFeed.mockResolvedValue(feed([post()]));
    api.createPost.mockResolvedValue({ post: post({ id: 'p_new', body: 'Shipped the first version.', topic: 'win', topic_label: 'Small win', mine: true, like_count: 0, reply_count: 0, author: { id: ADA.id, name: ADA.name, role: ADA.role, city: ADA.city } }) });
    await signedIn();
    render(<HomeFeed chrome={{ go: {} }} />);
    const box = await screen.findByRole('textbox', { name: 'Your post' });
    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Small win' }));
    await userEvent.type(box, 'Shipped the first version.');
    expect(screen.getByText('26/600')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Post' }));
    expect(api.createPost).toHaveBeenCalledWith({ topic: 'win', body: 'Shipped the first version.' });
    const articles = await screen.findAllByRole('article');
    expect(articles[0]).toHaveAccessibleName('Post by Ada Example');
    expect(box).toHaveValue('');
  });

  it('shows the server\'s reason when a post is refused, and keeps the words', async () => {
    api.createPost.mockRejectedValue(Object.assign(new Error('Your post can hold at most 2 links.'), { status: 400 }));
    await signedIn();
    render(<HomeFeed chrome={{ go: {} }} />);
    await userEvent.type(await screen.findByRole('textbox', { name: 'Your post' }), 'a b c');
    await userEvent.click(screen.getByRole('button', { name: 'Post' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your post can hold at most 2 links.');
    expect(screen.getByRole('textbox', { name: 'Your post' })).toHaveValue('a b c');
  });

  it('does not show a new post under a filter it does not belong to', async () => {
    api.createPost.mockResolvedValue({ post: post({ id: 'p_new', topic: 'question', topic_label: 'Question', body: 'A question for the ideas filter?', mine: true }) });
    await signedIn();
    render(<HomeFeed chrome={{ go: {} }} />);
    await userEvent.click(within(await screen.findByRole('group', { name: 'Show' })).getByRole('button', { name: 'Ideas' }));
    await userEvent.click(screen.getByRole('button', { name: 'Question' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Your post' }), 'A question for the ideas filter?');
    await userEvent.click(screen.getByRole('button', { name: 'Post' }));
    await waitFor(() => expect(api.createPost).toHaveBeenCalled());
    expect(screen.queryByText('A question for the ideas filter?')).not.toBeInTheDocument();
  });

  it('likes and un-likes at once, asks the server, and shows the count it answers with; a refused like is put back', async () => {
    api.fetchFeed.mockResolvedValue(feed([post({ like_count: 2 })]));
    api.setLike.mockResolvedValueOnce({ liked: true, like_count: 3 });
    await signedIn();
    render(<HomeFeed chrome={{ go: {} }} />);
    const like = await screen.findByRole('button', { name: 'Like, 2 likes' });
    await userEvent.click(like);
    expect(api.setLike).toHaveBeenCalledWith('p_1', true);
    expect(await screen.findByRole('button', { name: 'Unlike, 3 likes' })).toHaveAttribute('aria-pressed', 'true');
    api.setLike.mockRejectedValueOnce(new Error('down'));
    await userEvent.click(screen.getByRole('button', { name: 'Unlike, 3 likes' }));
    expect(await screen.findByRole('button', { name: 'Unlike, 3 likes' })).toBeInTheDocument(); // refused: back as it was
  });

  it('opens the replies, shows them, and posts a reply that appears and raises the count', async () => {
    api.fetchFeed.mockResolvedValue(feed([post()]));
    api.fetchThread.mockResolvedValue({ post: post(), replies: [reply()] });
    api.createReply.mockResolvedValue({ reply: reply({ id: 'r_2', body: 'Happy to host one.', mine: true, author: { id: ADA.id, name: ADA.name, role: ADA.role, city: ADA.city } }) });
    await signedIn();
    render(<HomeFeed chrome={{ go: {} }} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Show replies, 1' }));
    expect(await screen.findByText('Count me in.')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: 'Write a reply' }), 'Happy to host one.');
    await userEvent.click(screen.getByRole('button', { name: 'Reply' }));
    expect(api.createReply).toHaveBeenCalledWith('p_1', 'Happy to host one.');
    expect(await screen.findByText('Happy to host one.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide replies, 2' })).toBeInTheDocument();
  });

  it('lets the author edit their own post (the words and the topic) and says it was edited', async () => {
    api.fetchFeed.mockResolvedValue(feed([post({ mine: true, author: { id: ADA.id, name: ADA.name, role: '', city: '' } })]));
    api.editPost.mockResolvedValue({ post: post({ mine: true, body: 'A sharper version.', topic: 'feedback', topic_label: 'Feedback', edited_at: new Date().toISOString(), author: { id: ADA.id, name: ADA.name, role: '', city: '' } }) });
    await signedIn();
    render(<HomeFeed chrome={{ go: {} }} />);
    await userEvent.click(await screen.findByRole('button', { name: 'More actions for this post' }));
    expect(screen.queryByRole('menuitem', { name: 'Report' })).not.toBeInTheDocument(); // your own words are edited or deleted, not reported
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    const box = screen.getByRole('textbox', { name: 'Edit your post' });
    await userEvent.clear(box);
    await userEvent.type(box, 'A sharper version.');
    await userEvent.selectOptions(screen.getByLabelText('Topic'), 'feedback');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(api.editPost).toHaveBeenCalledWith('p_1', { body: 'A sharper version.', topic: 'feedback' });
    expect(await screen.findByText('A sharper version.')).toBeInTheDocument();
    expect(screen.getByText(/edited/)).toBeInTheDocument();
  });

  it('asks before it deletes, deletes the author\'s own post, and takes it off the page; "Keep it" keeps it', async () => {
    api.fetchFeed.mockResolvedValue(feed([post({ mine: true, author: { id: ADA.id, name: ADA.name, role: '', city: '' } })]));
    api.deletePost.mockResolvedValue(null);
    await signedIn();
    render(<HomeFeed chrome={{ go: {} }} />);
    await userEvent.click(await screen.findByRole('button', { name: 'More actions for this post' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(screen.getByRole('alertdialog', { name: 'Delete this post?' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(api.deletePost).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'More actions for this post' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    expect(api.deletePost).toHaveBeenCalledWith('p_1');
    await waitFor(() => expect(screen.queryByRole('article')).not.toBeInTheDocument());
  });

  it('reports someone else\'s post with a reason and a note, and says a person will read it', async () => {
    api.fetchFeed.mockResolvedValue(feed([post()]));
    api.reportItem.mockResolvedValue({ reported: true });
    await signedIn();
    render(<HomeFeed chrome={{ go: {} }} />);
    await userEvent.click(await screen.findByRole('button', { name: 'More actions for this post' }));
    expect(screen.queryByRole('menuitem', { name: 'Edit' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Report' }));
    const dialog = await screen.findByRole('dialog', { name: 'Report this post' });
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Rude, hateful or threatening' }));
    await userEvent.type(within(dialog).getByRole('textbox'), 'Aimed at a person.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send report' }));
    expect(api.reportItem).toHaveBeenCalledWith('post', 'p_1', { reason: 'abuse', note: 'Aimed at a person.' });
    expect(await within(dialog).findByText(/A person reads every report/)).toBeInTheDocument();
  });

  it('bookmarks a post to the account, and un-bookmarks it', async () => {
    api.fetchFeed.mockResolvedValue(feed([post()]));
    await signedIn();
    render(<HomeFeed chrome={{ go: {} }} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Bookmark this post' }));
    expect(api.setSaved).toHaveBeenCalledWith('post', 'p_1', true);
    expect(await screen.findByRole('button', { name: 'Remove bookmark' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Remove bookmark' }));
    expect(api.setSaved).toHaveBeenLastCalledWith('post', 'p_1', false);
  });

  it('shows a post a moderator has hidden only to its author, with the notice, and no way to edit it', async () => {
    api.fetchFeed.mockResolvedValue(feed([post({ mine: true, status: 'hidden', author: { id: ADA.id, name: ADA.name, role: '', city: '' } })]));
    await signedIn();
    render(<HomeFeed chrome={{ go: {} }} />);
    expect(await screen.findByText(/hidden while a moderator looks at it/)).toBeInTheDocument();
  });

  it('asks for the feed again when the person signs in, because it reads differently for them', async () => {
    api.fetchFeed.mockResolvedValue(feed([post()]));
    render(<HomeFeed chrome={{ go: {} }} />);
    await screen.findByRole('article', { name: 'Post by Cal Demo' });
    const before = api.fetchFeed.mock.calls.length;
    await signedIn();
    await waitFor(() => expect(api.fetchFeed.mock.calls.length).toBeGreaterThan(before));
  });
});
