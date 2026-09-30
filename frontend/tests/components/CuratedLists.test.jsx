import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../src/api.js', () => ({
  fetchStartups: vi.fn().mockResolvedValue({
    results: [
      { name: 'Canva', sector: 'SaaS', city: 'Sydney', hiring: true, taskGate: { enabled: false } },
      { name: 'Goterra', sector: 'AI', city: 'Canberra', hiring: true, taskGate: { enabled: true } },
    ],
  }),
}));

import CuratedLists from '../../src/components/CuratedLists.jsx';

describe('CuratedLists', () => {
  it('shows a category label and a live company count on a real filter-type list', async () => {
    render(<CuratedLists currentFilters={{}} onApply={() => {}} onClose={() => {}} />);

    expect(await screen.findByText('Startups Hiring Now')).toBeInTheDocument();
    expect(screen.getByText('2 companies')).toBeInTheDocument();

    const card = screen.getByText('Startups Hiring Now').closest('.curated-card');
    expect(card).toHaveTextContent('Status');
  });

  it('applies the list filters and closes when "View this list" is clicked', async () => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    render(<CuratedLists currentFilters={{}} onApply={onApply} onClose={onClose} />);
    await screen.findByText('Startups Hiring Now');

    const card = screen.getByText('Startups Hiring Now').closest('.curated-card');
    await userEvent.click(within(card).getByText('View this list'));

    expect(onApply).toHaveBeenCalledWith({ hiring: 'yes' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('never uses ranking language like "best" or "top" - discovery only, no unsupported quality claims', async () => {
    render(<CuratedLists currentFilters={{}} onApply={() => {}} onClose={() => {}} />);
    await screen.findByText('Startups Hiring Now');
    expect(screen.queryByText(/\bbest\b/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\btop\b/i)).not.toBeInTheDocument();
  });

  it('copies a shareable URL of the current filters when Share current view is clicked', async () => {
    const writeText = vi.fn().mockResolvedValue();
    Object.assign(navigator, { clipboard: { writeText } });
    render(<CuratedLists currentFilters={{ sector: 'AI' }} onApply={() => {}} onClose={() => {}} />);

    await userEvent.click(screen.getByText('🔗 Share current view'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('sector=AI'));
    expect(await screen.findByText('Copied!')).toBeInTheDocument();
  });
});
