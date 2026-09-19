import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../src/api.js', () => ({
  submitFeedback: vi.fn(),
}));

import { submitFeedback } from '../../src/api.js';
import FeedbackForm from '../../src/components/FeedbackForm.jsx';

describe('FeedbackForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defaults the type selector to Feedback', () => {
    render(<FeedbackForm onClose={() => {}} />);
    expect(screen.getByLabelText('Type')).toHaveValue('feedback');
  });

  it('blocks submission and shows an error when the message is empty', async () => {
    const { container } = render(<FeedbackForm onClose={() => {}} />);
    await userEvent.click(screen.getByText('Send feedback'));

    expect(container.querySelector('.form-error')).toBeInTheDocument();
    expect(submitFeedback).not.toHaveBeenCalled();
  });

  it('submits the selected type, message and email, then shows a thank-you state', async () => {
    submitFeedback.mockResolvedValue({ id: '1', status: 'pending' });
    render(<FeedbackForm onClose={() => {}} />);

    await userEvent.selectOptions(screen.getByLabelText('Type'), 'bug');
    await userEvent.type(screen.getByLabelText(/Message/), 'Map tiles fail to load on Safari');
    await userEvent.type(screen.getByLabelText(/Your email/), 'me@example.com');
    await userEvent.click(screen.getByText('Send feedback'));

    expect(await screen.findByText('Thanks!')).toBeInTheDocument();
    expect(submitFeedback).toHaveBeenCalledWith({
      type: 'bug',
      message: 'Map tiles fail to load on Safari',
      email: 'me@example.com',
    });
  });

  it('allows submitting with no email', async () => {
    submitFeedback.mockResolvedValue({ id: '1', status: 'pending' });
    render(<FeedbackForm onClose={() => {}} />);

    await userEvent.type(screen.getByLabelText(/Message/), 'Love the map');
    await userEvent.click(screen.getByText('Send feedback'));

    expect(await screen.findByText('Thanks!')).toBeInTheDocument();
    expect(submitFeedback).toHaveBeenCalledWith({ type: 'feedback', message: 'Love the map', email: '' });
  });

  it('shows the API error message when submission fails', async () => {
    submitFeedback.mockRejectedValue(new Error('message is required'));
    render(<FeedbackForm onClose={() => {}} />);

    await userEvent.type(screen.getByLabelText(/Message/), 'x');
    await userEvent.click(screen.getByText('Send feedback'));

    expect(await screen.findByText('message is required')).toBeInTheDocument();
  });

  it('calls onClose when Cancel is clicked', async () => {
    const onClose = vi.fn();
    render(<FeedbackForm onClose={onClose} />);
    await userEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when clicking the overlay outside the panel', async () => {
    const onClose = vi.fn();
    const { container } = render(<FeedbackForm onClose={onClose} />);
    await userEvent.click(container.querySelector('.modal-overlay'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
