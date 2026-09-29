import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../src/api.js', () => ({
  fetchStartups: vi.fn().mockResolvedValue({ results: [] }),
}));

vi.mock('../../src/curatedLists.js', () => ({
  curatedLists: [
    {
      id: 'people-to-follow',
      type: 'people',
      name: 'AU Startup People to Follow',
      description: 'Founders, operators and investors worth following.',
      people: [
        { name: 'Jane Smith', role: 'Founder', company: 'Acme AI', why: 'Built a category leader from Melbourne.', link: 'https://example.com/jane' },
        { name: 'Sam Lee', role: 'Investor', company: '', why: '', link: '' },
      ],
    },
  ],
}));

import CuratedLists from '../../src/components/CuratedLists.jsx';

describe('CuratedLists people-list rendering (populated)', () => {
  it('shows the person count in the collapsed summary', async () => {
    render(<CuratedLists currentFilters={{}} onApply={() => {}} onClose={() => {}} />);
    expect(await screen.findByText('2 people')).toBeInTheDocument();
  });

  it('expands to show name, role, company, why and an external link when given', async () => {
    render(<CuratedLists currentFilters={{}} onApply={() => {}} onClose={() => {}} />);
    await userEvent.click(await screen.findByText('AU Startup People to Follow'));

    expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    expect(screen.getByText('Founder · Acme AI')).toBeInTheDocument();
    expect(screen.getByText('Built a category leader from Melbourne.')).toBeInTheDocument();
    expect(screen.getByTitle('Open link for Jane Smith')).toHaveAttribute('href', 'https://example.com/jane');
  });

  it('omits the link and why for a person missing them, without crashing', async () => {
    render(<CuratedLists currentFilters={{}} onApply={() => {}} onClose={() => {}} />);
    await userEvent.click(await screen.findByText('AU Startup People to Follow'));

    expect(screen.getByText('Sam Lee')).toBeInTheDocument();
    expect(screen.getByText('Investor')).toBeInTheDocument();
    expect(screen.queryByTitle('Open link for Sam Lee')).not.toBeInTheDocument();
  });
});
