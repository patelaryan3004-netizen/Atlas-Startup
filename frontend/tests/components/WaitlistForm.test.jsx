import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WaitlistForm from '../../src/components/WaitlistForm.jsx';

describe('WaitlistForm', () => {
  it('shows the required copy line above the form', () => {
    render(<WaitlistForm onClose={() => {}} />);
    expect(screen.getByText('Get early access to task-gated startup applications.')).toBeInTheDocument();
  });

  it('shows an honest placeholder instead of an iframe, since no real Tally link exists yet', () => {
    render(<WaitlistForm onClose={() => {}} />);
    expect(screen.queryByTitle('Waitlist signup')).not.toBeInTheDocument();
    expect(screen.getByText(/no Tally form has been created for this/)).toBeInTheDocument();
  });

  it('closes on the X button', async () => {
    const onClose = vi.fn();
    render(<WaitlistForm onClose={onClose} />);
    await userEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on clicking outside the panel', async () => {
    const onClose = vi.fn();
    const { container } = render(<WaitlistForm onClose={onClose} />);
    await userEvent.click(container.querySelector('.modal-overlay'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    render(<WaitlistForm onClose={onClose} />);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
