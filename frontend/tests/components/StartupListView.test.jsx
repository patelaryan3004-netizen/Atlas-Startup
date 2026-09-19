import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StartupListView from '../../src/components/StartupListView.jsx';

function s(name, overrides = {}) {
  return { name, sector: 'AI', city: 'Sydney', stage: 'Seed', verified: true, ...overrides };
}

describe('StartupListView', () => {
  it('lists every passed-in startup with city and stage', () => {
    const startups = [s('A'), s('B', { city: 'Melbourne', stage: 'Series A' })];
    render(<StartupListView startups={startups} sectorColors={{ AI: '#abcdef' }} onClose={() => {}} />);

    expect(screen.getByText('Startups in view (2)')).toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('Sydney · Seed')).toBeInTheDocument();
    expect(screen.getByText('Melbourne · Series A')).toBeInTheDocument();
  });

  it('flags unverified (unpinned) startups with a NO PIN badge', () => {
    const startups = [s('Pinned', { verified: true }), s('Unpinned', { verified: false })];
    render(<StartupListView startups={startups} sectorColors={{}} onClose={() => {}} />);

    expect(screen.getByText('NO PIN')).toBeInTheDocument();
  });

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn();
    render(<StartupListView startups={[]} sectorColors={{}} onClose={onClose} />);
    await userEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
