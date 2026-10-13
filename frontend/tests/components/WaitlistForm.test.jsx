import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

  it('does not close on a click inside the panel, or on a press that began inside it and ended outside (selecting text)', async () => {
    const onClose = vi.fn();
    const { container } = render(<WaitlistForm onClose={onClose} />);
    await userEvent.click(screen.getByText('Join the waitlist'));
    expect(onClose).not.toHaveBeenCalled();
    const overlay = container.querySelector('.modal-overlay');
    fireEvent.mouseDown(screen.getByText('Join the waitlist'));
    fireEvent.click(overlay); // the browser reports the click on the common ancestor, the overlay
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    render(<WaitlistForm onClose={onClose} />);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe('as a dialog', () => {
    it('is named by its heading, and modal', () => {
      render(<WaitlistForm onClose={() => {}} />);
      const dialog = screen.getByRole('dialog', { name: 'Join the waitlist' });
      expect(dialog).toHaveAttribute('aria-modal', 'true');
    });

    it('takes focus when it opens and gives it back to what opened it when it closes', () => {
      const opener = document.createElement('button');
      document.body.append(opener);
      opener.focus();
      const { unmount } = render(<WaitlistForm onClose={() => {}} />);
      expect(screen.getByRole('dialog')).toHaveFocus();
      unmount();
      expect(opener).toHaveFocus();
      opener.remove();
    });

    it('keeps Tab inside the panel: from the last control to the first, and back with Shift+Tab', async () => {
      render(<WaitlistForm onClose={() => {}} />);
      const close = screen.getByLabelText('Close');
      const frame = screen.getByTitle('Waitlist signup');
      frame.focus();
      expect(frame).toHaveFocus();
      await userEvent.tab();
      expect(close).toHaveFocus();
      await userEvent.tab({ shift: true });
      expect(frame).toHaveFocus();
    });
  });
});
