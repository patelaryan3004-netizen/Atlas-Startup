import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UnverifiedList from '../../src/components/UnverifiedList.jsx';

function s(name, overrides = {}) {
  return { name, sector: 'AI', sectorFull: 'AI', stage: 'Seed', verified: false, ...overrides };
}

describe('UnverifiedList', () => {
  it('lists only unverified startups', () => {
    const startups = [s('A'), s('B', { verified: true }), s('C')];
    render(<UnverifiedList startups={startups} onClose={() => {}} />);

    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('C')).toBeInTheDocument();
    expect(screen.queryByText('B')).not.toBeInTheDocument();
    expect(screen.getByText('Unconfirmed location (2)')).toBeInTheDocument();
  });

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn();
    render(<UnverifiedList startups={[s('A')]} onClose={onClose} />);
    await userEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
