import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../src/api.js', () => ({
  submitStartup: vi.fn(),
}));

import { submitStartup } from '../../src/api.js';
import SubmitStartupForm from '../../src/components/SubmitStartupForm.jsx';

describe('SubmitStartupForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks submission and shows an error when name/description are empty', async () => {
    const { container } = render(<SubmitStartupForm onClose={() => {}} />);
    await userEvent.click(screen.getByText('Submit startup'));

    expect(await screen.findByText('Company name and one-line description are required.')).toBeInTheDocument();
    expect(container.querySelector('.form-error')).toBeInTheDocument();
    expect(submitStartup).not.toHaveBeenCalled();
  });

  it('submits the filled form and shows a thank-you state', async () => {
    submitStartup.mockResolvedValue({ id: '1', status: 'pending' });
    render(<SubmitStartupForm onClose={() => {}} />);

    await userEvent.type(screen.getByLabelText('Company name *'), 'Acme');
    await userEvent.type(screen.getByLabelText(/One-line description/), 'Does things');
    await userEvent.click(screen.getByText('Submit startup'));

    expect(await screen.findByText('Thanks!')).toBeInTheDocument();
    expect(submitStartup).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Acme', description: 'Does things' })
    );
  });

  it('shows the API error message when submission fails', async () => {
    submitStartup.mockRejectedValue(new Error('name and description are required'));
    render(<SubmitStartupForm onClose={() => {}} />);

    await userEvent.type(screen.getByLabelText('Company name *'), 'Acme');
    await userEvent.type(screen.getByLabelText(/One-line description/), 'Does things');
    await userEvent.click(screen.getByText('Submit startup'));

    expect(await screen.findByText('name and description are required')).toBeInTheDocument();
  });

  it('calls onClose when Cancel is clicked', async () => {
    const onClose = vi.fn();
    render(<SubmitStartupForm onClose={onClose} />);
    await userEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when clicking the overlay outside the panel', async () => {
    const onClose = vi.fn();
    const { container } = render(<SubmitStartupForm onClose={onClose} />);
    await userEvent.click(container.querySelector('.modal-overlay'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose on Escape', async () => {
    const onClose = vi.fn();
    render(<SubmitStartupForm onClose={onClose} />);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows the Tally form once its address is set, and the own form while it is still the placeholder', () => {
    const { container, unmount } = render(<SubmitStartupForm onClose={() => {}} tallyUrl="TALLY_SUBMIT_URL_HERE" />);
    expect(container.querySelector('iframe')).toBeNull();
    expect(screen.getByLabelText(/Company name/)).toBeInTheDocument();
    unmount();
    const tally = render(<SubmitStartupForm onClose={() => {}} tallyUrl="https://tally.so/r/abc123" />);
    expect(tally.container.querySelector('iframe')).toHaveAttribute('src', expect.stringContaining('https://tally.so/embed/abc123'));
  });
});
