import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WaitlistForm from '../../src/components/WaitlistForm.jsx';

describe('WaitlistForm', () => {
  it('shows the required copy line above the form', () => {
    render(<WaitlistForm onClose={() => {}} />);
    expect(screen.getByText('Get early access to task-gated startup applications.')).toBeInTheDocument();
  });

  it('shows the Tally form in a frame, from Tally\'s embed address, and no placeholder', () => {
    render(<WaitlistForm onClose={() => {}} />);
    const frame = screen.getByTitle('Waitlist signup');
    expect(frame.tagName).toBe('IFRAME');
    expect(frame).toHaveAttribute('src', 'https://tally.so/embed/kdVrGo?hideTitle=1&alignLeft=1');
    expect(screen.queryByText(/not set up yet/)).not.toBeInTheDocument();
  });

  it('shows an honest placeholder instead of a broken frame when there is no form address', () => {
    render(<WaitlistForm onClose={() => {}} formUrl="" />);
    expect(screen.queryByTitle('Waitlist signup')).not.toBeInTheDocument();
    expect(screen.getByText(/no Tally form has been created for this/)).toBeInTheDocument();
  });

  it('can be pointed at another form', () => {
    render(<WaitlistForm onClose={() => {}} formUrl="https://tally.so/embed/other" />);
    expect(screen.getByTitle('Waitlist signup')).toHaveAttribute('src', 'https://tally.so/embed/other');
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
