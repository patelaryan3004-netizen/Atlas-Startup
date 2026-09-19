import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import AboutSources from '../../src/components/AboutSources.jsx';

describe('AboutSources', () => {
  it('discloses that data comes from public sources and direct submissions', () => {
    render(<AboutSources onClose={() => {}} />);
    expect(screen.getByText(/Based on public sources/)).toBeInTheDocument();
    expect(screen.getByText(/direct submissions/)).toBeInTheDocument();
  });

  it('states it is independent and unofficial', () => {
    render(<AboutSources onClose={() => {}} />);
    expect(screen.getByText(/independent, unofficial directory/)).toBeInTheDocument();
  });

  it('links to the no-JS directory', () => {
    render(<AboutSources onClose={() => {}} />);
    const link = screen.getByText(/Browse every company without JavaScript/);
    expect(link.closest('a')).toHaveAttribute('href', '/directory');
  });

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn();
    render(<AboutSources onClose={onClose} />);
    await userEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when clicking the overlay outside the panel', async () => {
    const onClose = vi.fn();
    const { container } = render(<AboutSources onClose={onClose} />);
    await userEvent.click(container.querySelector('.modal-overlay'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close when clicking inside the panel', async () => {
    const onClose = vi.fn();
    const { container } = render(<AboutSources onClose={onClose} />);
    await userEvent.click(container.querySelector('.modal-panel'));
    expect(onClose).not.toHaveBeenCalled();
  });
});
