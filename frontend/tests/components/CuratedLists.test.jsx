import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../src/api.js', () => ({
  fetchStartups: vi.fn(),
}));

import { fetchStartups } from '../../src/api.js';
import CuratedLists from '../../src/components/CuratedLists.jsx';

function s(overrides = {}) {
  return {
    name: 'Co', sector: 'AI', city: 'Sydney', stage: 'Seed', hiring: false,
    taskGate: { enabled: false, type: null }, ...overrides,
  };
}

const ALL_STARTUPS = [
  s({ name: 'Gated Co', taskGate: { enabled: true, type: 'Coding task' } }),
  s({ name: 'Melbourne AI Co', city: 'Melbourne', sector: 'AI' }),
  s({ name: 'Melbourne Fintech Co', city: 'Melbourne', sector: 'Fintech' }),
  s({ name: 'Hiring Co', hiring: true }),
  s({ name: 'Plain Co' }),
];

const writeTextMock = vi.fn().mockResolvedValue(undefined);

describe('CuratedLists', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchStartups.mockResolvedValue({ results: ALL_STARTUPS });
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      configurable: true,
    });
    delete window.location;
    window.location = new URL('http://localhost/');
  });

  it('fetches the full unfiltered dataset, not whatever the map currently has applied', async () => {
    render(<CuratedLists currentFilters={{}} onApply={() => {}} onClose={() => {}} />);
    await waitFor(() => expect(fetchStartups).toHaveBeenCalledWith({}));
  });

  it('renders each curated list with an accurate live count', async () => {
    render(<CuratedLists currentFilters={{}} onApply={() => {}} onClose={() => {}} />);

    const gatedCard = (await screen.findByText('Task-gated only')).closest('.curated-card');
    expect(gatedCard).toHaveTextContent('1 companies'); // Gated Co only

    const melbourneCard = screen.getByText('Melbourne AI startups').closest('.curated-card');
    expect(melbourneCard).toHaveTextContent('1 companies'); // Melbourne AI Co only

    const hiringCard = screen.getByText('Currently hiring').closest('.curated-card');
    expect(hiringCard).toHaveTextContent('1 companies'); // Hiring Co only
  });

  it('applies a list’s exact filters (replacing, not merging with, whatever is currently active) and closes', async () => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    render(<CuratedLists currentFilters={{ sector: 'Fintech' }} onApply={onApply} onClose={onClose} />);

    await screen.findByText('Melbourne AI startups');
    const cards = screen.getAllByText('View this list');
    await userEvent.click(cards[1]); // Melbourne AI startups is the second card

    expect(onApply).toHaveBeenCalledWith({ city: 'Melbourne', sector: 'AI' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('copies a shareable URL built from the current filters and shows confirmation', async () => {
    render(<CuratedLists currentFilters={{ sector: 'AI', city: 'Melbourne' }} onApply={() => {}} onClose={() => {}} />);

    await userEvent.click(screen.getByText('🔗 Share current view'));

    expect(writeTextMock).toHaveBeenCalledTimes(1);
    const url = writeTextMock.mock.calls[0][0];
    expect(url).toContain('sector=AI');
    expect(url).toContain('city=Melbourne');
    expect(await screen.findByText('Copied!')).toBeInTheDocument();
  });

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn();
    render(<CuratedLists currentFilters={{}} onApply={() => {}} onClose={onClose} />);
    await userEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    render(<CuratedLists currentFilters={{}} onApply={() => {}} onClose={onClose} />);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows the real People to Follow list as empty rather than inventing names for it', async () => {
    render(<CuratedLists currentFilters={{}} onApply={() => {}} onClose={() => {}} />);
    const peopleCard = (await screen.findByText('AU Startup People to Follow')).closest('.curated-card-people');
    expect(peopleCard).toHaveTextContent('No one listed yet');
  });
});
