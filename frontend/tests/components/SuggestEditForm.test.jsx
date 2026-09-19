import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../src/api.js', () => ({
  submitEdit: vi.fn(),
}));

import { submitEdit } from '../../src/api.js';
import SuggestEditForm from '../../src/components/SuggestEditForm.jsx';

describe('SuggestEditForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the company name read-only, not as an editable field', () => {
    render(<SuggestEditForm company="Acme AI" onClose={() => {}} />);
    expect(screen.getByText('Acme AI')).toBeInTheDocument();
    expect(screen.queryByLabelText(/company/i)).not.toBeInTheDocument();
  });

  it('blocks submission and shows an error when the message is empty', async () => {
    const { container } = render(<SuggestEditForm company="Acme AI" onClose={() => {}} />);
    await userEvent.click(screen.getByText('Send suggestion'));

    expect(container.querySelector('.form-error')).toBeInTheDocument();
    expect(submitEdit).not.toHaveBeenCalled();
  });

  it('submits company, message and email, then shows a thank-you state', async () => {
    submitEdit.mockResolvedValue({ id: '1', status: 'pending' });
    render(<SuggestEditForm company="Acme AI" onClose={() => {}} />);

    await userEvent.type(screen.getByLabelText(/What.s wrong/), 'Address is outdated');
    await userEvent.type(screen.getByLabelText(/Your email/), 'me@example.com');
    await userEvent.click(screen.getByText('Send suggestion'));

    expect(await screen.findByText('Thanks!')).toBeInTheDocument();
    expect(submitEdit).toHaveBeenCalledWith({
      company: 'Acme AI',
      message: 'Address is outdated',
      email: 'me@example.com',
    });
  });

  it('allows submitting with no email', async () => {
    submitEdit.mockResolvedValue({ id: '1', status: 'pending' });
    render(<SuggestEditForm company="Acme AI" onClose={() => {}} />);

    await userEvent.type(screen.getByLabelText(/What.s wrong/), 'Wrong logo');
    await userEvent.click(screen.getByText('Send suggestion'));

    expect(await screen.findByText('Thanks!')).toBeInTheDocument();
    expect(submitEdit).toHaveBeenCalledWith({ company: 'Acme AI', message: 'Wrong logo', email: '' });
  });

  it('shows the API error message when submission fails', async () => {
    submitEdit.mockRejectedValue(new Error('company and message are required'));
    render(<SuggestEditForm company="Acme AI" onClose={() => {}} />);

    await userEvent.type(screen.getByLabelText(/What.s wrong/), 'Wrong logo');
    await userEvent.click(screen.getByText('Send suggestion'));

    expect(await screen.findByText('company and message are required')).toBeInTheDocument();
  });

  it('calls onClose when Cancel is clicked', async () => {
    const onClose = vi.fn();
    render(<SuggestEditForm company="Acme AI" onClose={onClose} />);
    await userEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when clicking the overlay outside the panel', async () => {
    const onClose = vi.fn();
    const { container } = render(<SuggestEditForm company="Acme AI" onClose={onClose} />);
    await userEvent.click(container.querySelector('.modal-overlay'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

