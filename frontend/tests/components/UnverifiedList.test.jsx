import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../src/api.js', () => ({ fetchStartupPage: vi.fn() }));

import { fetchStartupPage } from '../../src/api.js';
import UnverifiedList from '../../src/components/UnverifiedList.jsx';

function s(name, overrides = {}) {
  return { name, slug: name.toLowerCase(), sector: 'AI', sectorFull: 'AI', stage: 'Seed', verified: false, ...overrides };
}

describe('UnverifiedList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchStartupPage.mockResolvedValue({ total: 300, count: 2, results: [s('A'), s('C')] });
  });

  it('asks the server for the unconfirmed ones among the current filters, by name, and lists what it sends with the count', async () => {
    render(<UnverifiedList filters={{ city: 'Sydney', search: '' }} onClose={() => {}} />);
    expect(await screen.findByText('A')).toBeInTheDocument();
    expect(screen.getByText('C')).toBeInTheDocument();
    expect(screen.getByText('Unconfirmed location (2)')).toBeInTheDocument();
    expect(fetchStartupPage).toHaveBeenCalledWith({ city: 'Sydney', search: '', verified: 'no' }, expect.objectContaining({ limit: 200, sort: 'name' }));
  });

  it('asks once when no filters are given, and does not go on asking after every render', async () => {
    render(<UnverifiedList onClose={() => {}} />);
    await screen.findByText('A');
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchStartupPage).toHaveBeenCalledTimes(1);
  });

  it('says it is loading, and says so when it could not load', async () => {
    fetchStartupPage.mockRejectedValue(new Error('down'));
    render(<UnverifiedList onClose={() => {}} />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(await screen.findByText('Could not load this list right now.')).toBeInTheDocument();
  });

  it('says it shows only the first part when there are more than it lists', async () => {
    fetchStartupPage.mockResolvedValue({ total: 900, count: 450, results: [s('A'), s('B')] });
    render(<UnverifiedList onClose={() => {}} />);
    expect(await screen.findByText('Showing the first 2 of 450.')).toBeInTheDocument();
  });

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn();
    render(<UnverifiedList onClose={onClose} />);
    await screen.findByText('A');
    await userEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
