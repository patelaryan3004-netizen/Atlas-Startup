import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../src/networkApi.js', async () => (await import('./helpers.js')).apiMock());

import * as api from '../../src/networkApi.js';
import ModerationPage from '../../src/components/network/ModerationPage.jsx';
import { resetSession } from '../../src/session.js';
import { resetSaved } from '../../src/savedStore.js';

const SUMMARY = { members: 4, posts: 7, open_reports: 1, pending_suggestions: 2, suspended: 0 };
const REPORT = {
  target_kind: 'post', target_id: 'p_5', body: 'Buy my course now', status: 'visible', created_at: new Date(Date.now() - 3600000).toISOString(),
  author: { id: 'm_x', name: 'Xan Spam', suspended: false },
  reports: [{ id: 'rp_1', reason: 'spam', note: 'an advert', created_at: new Date(Date.now() - 600000).toISOString() }],
};
const EVENT_SUGGESTION = {
  id: 'sg_1', kind: 'event', created_at: new Date(Date.now() - 7200000).toISOString(), contact_email: 'host@example.org',
  data: { name: 'Prototype Night', organiser: 'Example Collective', city: 'Perth', registration_url: 'https://example.org/prototype', note: '' },
};
const JOB_SUGGESTION = {
  id: 'sg_2', kind: 'job', created_at: new Date(Date.now() - 3600000).toISOString(), contact_email: '',
  data: { title: 'Designer', company: 'Cobalt Labs', apply_url: 'https://cobalt.example/jobs/9' },
};

function setup({ reports = [REPORT], suggestions = [EVENT_SUGGESTION, JOB_SUGGESTION] } = {}) {
  api.adminSummary.mockResolvedValue(SUMMARY);
  api.adminReports.mockResolvedValue({ results: reports });
  api.adminSuggestions.mockResolvedValue({ results: suggestions, zones: ['Australia/Sydney', 'Australia/Perth'] });
  api.adminMembers.mockResolvedValue({ results: [] });
  api.adminDecideReport.mockResolvedValue({});
  api.adminApprove.mockResolvedValue({});
  api.adminReject.mockResolvedValue({});
  api.adminSuspend.mockResolvedValue({});
}

async function open(key = 'a-throwaway-key') {
  render(<ModerationPage chrome={{ go: {} }} />);
  await userEvent.type(screen.getByLabelText('Moderator key', { selector: 'input' }), key);
  await userEvent.click(screen.getByRole('button', { name: 'Open' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/moderation');
  api.setToken(null);
  api.fetchNetworkStatus.mockResolvedValue({ available: true, reason: null });
  api.fetchMe.mockRejectedValue(new api.ApiError('Sign in to do that.', 401, 'unauthorized'));
  resetSession();
  resetSaved();
  setup();
});

describe('the moderators\' page', () => {
  it('asks for the key first, shows nothing until the server accepts it, and never writes it to storage', async () => {
    render(<ModerationPage chrome={{ go: {} }} />);
    expect(screen.getByLabelText('Moderator key', { selector: 'input' })).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Open' })).toBeDisabled();
    expect(api.adminSummary).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText('Moderator key', { selector: 'input' }), 'a-throwaway-key');
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(await screen.findByRole('status')).toHaveTextContent('4 members · 7 posts · 1 open reports · 2 suggestions waiting');
    expect(api.adminSummary).toHaveBeenCalledWith('a-throwaway-key');
    expect(JSON.stringify({ ...localStorage })).not.toContain('a-throwaway-key');
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('a-throwaway-key');
    expect(screen.queryByLabelText('Moderator key', { selector: 'input' })).not.toBeInTheDocument();
  });

  it('says so when the key is wrong, and keeps the page closed', async () => {
    api.adminSummary.mockRejectedValue(new api.ApiError('That key is not right.', 403, 'forbidden'));
    await open('wrong');
    expect(await screen.findByRole('alert')).toHaveTextContent('That key is not right.');
    expect(screen.getByLabelText('Moderator key', { selector: 'input' })).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('lists the reports with the words, the reason given and the author, and asks the server to act on the choice made', async () => {
    await open();
    expect(await screen.findByText('Buy my course now')).toBeInTheDocument();
    expect(screen.getByText('Spam or an advert')).toBeInTheDocument();
    expect(screen.getByText('Xan Spam')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('A note for the record, optional'), 'obvious advert');
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(api.adminDecideReport).toHaveBeenCalledWith('a-throwaway-key', 'post', 'p_5', 'remove', 'obvious advert'));
    expect(api.adminReports.mock.calls.length).toBeGreaterThan(1); // the list is read again after a decision
  });

  it('offers leave-it-up, hide and the suspension, and does not offer to hide what is already hidden', async () => {
    api.adminReports.mockResolvedValue({ results: [{ ...REPORT, status: 'hidden' }] });
    await open();
    await screen.findByText('Buy my course now');
    expect(screen.getByRole('button', { name: 'Hide for now' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Remove and suspend the author' }));
    await waitFor(() => expect(api.adminDecideReport).toHaveBeenCalledWith('a-throwaway-key', 'post', 'p_5', 'suspend_author', ''));
    await userEvent.click(screen.getByRole('button', { name: 'Leave it up' }));
    await waitFor(() => expect(api.adminDecideReport).toHaveBeenLastCalledWith('a-throwaway-key', 'post', 'p_5', 'dismiss', ''));
  });

  it('says plainly when there is nothing to read', async () => {
    setup({ reports: [] });
    await open();
    expect(await screen.findByText('No open reports.')).toBeInTheDocument();
  });

  it('lists what has been suggested, with every field the person sent and their link as a link', async () => {
    await open();
    await userEvent.click(await screen.findByRole('tab', { name: 'Suggestions (2)' }));
    expect(screen.getByText('Prototype Night')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'https://example.org/prototype' })).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText(/host@example.org/)).toBeInTheDocument();
    expect(screen.getByText('Designer')).toBeInTheDocument();
  });

  it('will not list an event until the moderator has filled in what the page says, and then sends exactly that', async () => {
    await open();
    await userEvent.click(await screen.findByRole('tab', { name: 'Suggestions (2)' }));
    const card = screen.getByText('Prototype Night').closest('li');
    await userEvent.click(within(card).getByRole('button', { name: 'Check and approve…' }));
    api.adminApprove.mockRejectedValueOnce(new api.ApiError('Say who the event is useful for.', 400, 'bad_request'));
    await userEvent.click(within(card).getByRole('button', { name: 'Approve and list' }));
    expect(await within(card).findByRole('alert')).toHaveTextContent('Say who the event is useful for.');
    await userEvent.selectOptions(within(card).getByLabelText('Time zone'), 'Australia/Perth');
    await userEvent.type(within(card).getByLabelText('Who it is useful for'), 'Perth founders');
    await userEvent.type(within(card).getByLabelText(/Why it is listed/), 'Run by a founder collective');
    await userEvent.selectOptions(within(card).getByLabelText('Cost'), 'free');
    await userEvent.click(within(card).getByRole('button', { name: 'Approve and list' }));
    await waitFor(() => expect(api.adminApprove).toHaveBeenLastCalledWith('a-throwaway-key', 'sg_1', expect.objectContaining({
      timezone: 'Australia/Perth', audience: 'Perth founders', why_selected: 'Run by a founder collective', source_url: 'https://example.org/prototype', cost: { status: 'free' },
    })));
  });

  it('asks for the day the employer\'s page was read, and why the role is listed, before a role goes up', async () => {
    await open();
    await userEvent.click(await screen.findByRole('tab', { name: 'Suggestions (2)' }));
    const card = screen.getByText('Designer').closest('li');
    await userEvent.click(within(card).getByRole('button', { name: 'Check and approve…' }));
    await userEvent.type(within(card).getByLabelText(/Why it is listed/), 'On the employer\'s own careers page');
    await userEvent.click(within(card).getByRole('button', { name: 'Approve and list' }));
    await waitFor(() => expect(api.adminApprove).toHaveBeenCalledWith('a-throwaway-key', 'sg_2', expect.objectContaining({ why: 'On the employer\'s own careers page', retrieved_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) })));
  });

  it('rejects a suggestion with the reason given', async () => {
    await open();
    await userEvent.click(await screen.findByRole('tab', { name: 'Suggestions (2)' }));
    const card = screen.getByText('Prototype Night').closest('li');
    await userEvent.type(within(card).getByLabelText('Why it was rejected (optional)'), 'no public page');
    await userEvent.click(within(card).getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(api.adminReject).toHaveBeenCalledWith('a-throwaway-key', 'sg_1', 'no public page'));
  });

  it('searches members and suspends or lifts a suspension', async () => {
    api.adminMembers.mockResolvedValue({ results: [
      { id: 'm_a', name: 'Ada Example', email: 'ada@example.com', created_at: '2026-10-01T00:00:00Z', suspended: false },
      { id: 'm_b', name: 'Bad Actor', email: 'bad@example.com', created_at: '2026-10-02T00:00:00Z', suspended: true },
    ] });
    await open();
    await userEvent.click(await screen.findByRole('tab', { name: 'Members' }));
    expect(await screen.findByText('Ada Example')).toBeInTheDocument();
    expect(screen.getByText(/suspended/)).toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search members' }), 'ada');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(api.adminMembers).toHaveBeenLastCalledWith('a-throwaway-key', 'ada'));
    await userEvent.click(screen.getByRole('button', { name: 'Suspend' }));
    await waitFor(() => expect(api.adminSuspend).toHaveBeenCalledWith('a-throwaway-key', 'm_a', true, ''));
    await userEvent.click(screen.getByRole('button', { name: 'Lift suspension' }));
    await waitFor(() => expect(api.adminSuspend).toHaveBeenLastCalledWith('a-throwaway-key', 'm_b', false, ''));
  });
});
