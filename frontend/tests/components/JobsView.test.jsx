import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../src/api.js', () => ({
  fetchStartupPage: vi.fn(),
}));

import { fetchStartupPage } from '../../src/api.js';
import JobsView from '../../src/components/JobsView.jsx';

function job(overrides = {}) {
  return {
    name: 'Acme AI',
    slug: 'acme-ai',
    sector: 'AI',
    city: 'Sydney',
    stage: 'Seed',
    hiring: true,
    verified: true,
    website: 'https://example.com',
    blurb: 'Does things',
    taskGate: { enabled: true, type: 'Coding task' },
    ...overrides,
  };
}

// A stand-in for the server: filters the hiring companies it has, pages them, and counts facets over the matches.
function fakeServer(all) {
  fetchStartupPage.mockImplementation(async (filters, { limit = 48, offset = 0, facets } = {}) => {
    const matches = all.filter((j) => (!filters.sector || j.sector === filters.sector) && (!filters.city || j.city === filters.city) && (!filters.stage || j.stage === filters.stage));
    const out = { total: 216, count: matches.length, results: matches.slice(offset, offset + limit), offset, limit, hasMore: offset + limit < matches.length };
    if (facets) {
      out.facets = Object.fromEntries(facets.split(',').map((f) => {
        const counts = new Map();
        for (const j of matches) counts.set(j[f], (counts.get(j[f]) ?? 0) + 1);
        return [f, { distinct: counts.size, values: [...counts].map(([value, count]) => ({ value, count })) }];
      }));
    }
    return out;
  });
}

describe('JobsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requests only hiring companies, a page at a time in name order, with the options for its filters, regardless of map filters', async () => {
    fakeServer([]);
    render(<JobsView sectorColors={{}} onClose={() => {}} />);
    await screen.findByText('No companies are marked as hiring right now.');
    expect(fetchStartupPage.mock.calls[0][0]).toMatchObject({ hiring: 'yes' });
    expect(fetchStartupPage.mock.calls[0][1]).toMatchObject({ limit: 24, offset: 0, sort: 'name', facets: 'sector,city,stage' });
  });

  it('shows a strong header with a live count of companies hiring now', async () => {
    fakeServer([job({ name: 'A', slug: 'a' }), job({ name: 'B', slug: 'b' })]);
    render(<JobsView sectorColors={{}} onClose={() => {}} />);
    expect(await screen.findByText('Startup jobs in Australia')).toBeInTheDocument();
    expect(await screen.findByText('2 companies are hiring now')).toBeInTheDocument();
  });

  it('uses singular phrasing for exactly one hiring company', async () => {
    fakeServer([job()]);
    render(<JobsView sectorColors={{}} onClose={() => {}} />);
    expect(await screen.findByText('1 company is hiring now')).toBeInTheDocument();
  });

  it('renders a card per job with name, sector, city, stage and blurb', async () => {
    fakeServer([job()]);
    render(<JobsView sectorColors={{ AI: '#abcdef' }} onClose={() => {}} />);

    expect(await screen.findByText('Acme AI')).toBeInTheDocument();
    expect(screen.getByText('AI', { selector: '.pc-badge' })).toBeInTheDocument();
    expect(screen.getByText('Sydney · Seed')).toBeInTheDocument();
    expect(screen.getByText('Does things')).toBeInTheDocument();
    expect(screen.queryByText('Unverified')).not.toBeInTheDocument();
  });

  it('shows an Unverified badge for companies with verified:false, without hiding the card', async () => {
    fakeServer([job({ verified: false })]);
    render(<JobsView sectorColors={{}} onClose={() => {}} />);

    expect(await screen.findByText('Acme AI')).toBeInTheDocument();
    expect(screen.getByText('Unverified')).toBeInTheDocument();
  });

  it('shows a task-gate badge and CTA copy when task-gated, plain Apply otherwise', async () => {
    fakeServer([
      job({ name: 'Gated Co', slug: 'gated', taskGate: { enabled: true, type: 'Design task' } }),
      job({ name: 'Open Co', slug: 'open', taskGate: { enabled: false, type: null } }),
    ]);
    render(<JobsView sectorColors={{}} onClose={() => {}} />);

    await screen.findByText('Gated Co');
    expect(screen.getByText('TASK-GATE · Design task')).toBeInTheDocument();
    expect(screen.getByText('Start task → Apply')).toBeInTheDocument();
    expect(screen.getByText('NO GATE')).toBeInTheDocument();
    expect(screen.getByText('Apply now')).toBeInTheDocument();
  });

  it('makes the apply CTA a real link to the company website, not a dead button', async () => {
    fakeServer([job({ website: 'https://acme.example' })]);
    render(<JobsView sectorColors={{}} onClose={() => {}} />);
    const cta = await screen.findByText('Start task → Apply');
    expect(cta.tagName).toBe('A');
    expect(cta).toHaveAttribute('href', 'https://acme.example');
    expect(cta).toHaveAttribute('target', '_blank');
  });

  it('omits the apply CTA entirely when a company has no website on file, rather than linking nowhere', async () => {
    fakeServer([job({ website: null })]);
    render(<JobsView sectorColors={{}} onClose={() => {}} />);
    await screen.findByText('Acme AI');
    expect(screen.queryByText('Start task → Apply')).not.toBeInTheDocument();
  });

  it('shows an empty state when nobody is hiring', async () => {
    fakeServer([]);
    render(<JobsView sectorColors={{}} onClose={() => {}} />);
    expect(await screen.findByText('No companies are marked as hiring right now.')).toBeInTheDocument();
  });

  it('shows an error message when the fetch fails', async () => {
    fetchStartupPage.mockRejectedValue(new Error('network error'));
    render(<JobsView sectorColors={{}} onClose={() => {}} />);
    expect(await screen.findByText('Could not load jobs right now.')).toBeInTheDocument();
  });

  it('calls onClose when Back to map is clicked', async () => {
    fakeServer([]);
    const onClose = vi.fn();
    render(<JobsView sectorColors={{}} onClose={onClose} />);
    await userEvent.click(await screen.findByText('← Back to map'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe('filters', () => {
    const jobs = [
      job({ name: 'Sydney AI Co', slug: 'sydney-ai', sector: 'AI', city: 'Sydney', stage: 'Seed' }),
      job({ name: 'Melbourne Fintech Co', slug: 'melbourne-fintech', sector: 'Fintech', city: 'Melbourne', stage: 'Series A' }),
    ];

    it('only offers filter options that appear in the whole hiring set, not the whole site and not just the page on screen', async () => {
      fakeServer(jobs);
      render(<JobsView sectorColors={{}} onClose={() => {}} />);
      await screen.findByText('Sydney AI Co');

      expect(screen.getByRole('option', { name: 'AI' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Fintech' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Series A' })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'Healthtech' })).not.toBeInTheDocument();
    });

    it('asks the server again for the chosen filter, without asking for the options a second time, and shows how many match', async () => {
      fakeServer(jobs);
      render(<JobsView sectorColors={{}} onClose={() => {}} />);
      await screen.findByText('Sydney AI Co');

      await userEvent.selectOptions(screen.getByLabelText('Filter by industry'), 'AI');
      await waitFor(() => expect(screen.queryByText('Melbourne Fintech Co')).not.toBeInTheDocument());
      expect(screen.getByText('Sydney AI Co')).toBeInTheDocument();
      expect(screen.getByText('1 match your filters')).toBeInTheDocument();
      const last = fetchStartupPage.mock.calls.at(-1);
      expect(last[0]).toMatchObject({ hiring: 'yes', sector: 'AI' });
      expect(last[1].facets).toBeUndefined();
      // choosing a sector does not take the other sectors away from the dropdown
      expect(screen.getByRole('option', { name: 'Fintech' })).toBeInTheDocument();
    });

    it('shows Clear filters only once a filter is active, and it resets the grid', async () => {
      fakeServer(jobs);
      render(<JobsView sectorColors={{}} onClose={() => {}} />);
      await screen.findByText('Sydney AI Co');
      expect(screen.queryByText('Clear filters')).not.toBeInTheDocument();

      await userEvent.selectOptions(screen.getByLabelText('Filter by location'), 'Melbourne');
      await waitFor(() => expect(screen.queryByText('Sydney AI Co')).not.toBeInTheDocument());

      await userEvent.click(screen.getByText('Clear filters'));
      expect(await screen.findByText('Sydney AI Co')).toBeInTheDocument();
      expect(screen.getByText('Melbourne Fintech Co')).toBeInTheDocument();
    });

    it('shows an honest empty state when filters match nothing, without fabricating a listing', async () => {
      fakeServer(jobs);
      render(<JobsView sectorColors={{}} onClose={() => {}} />);
      await screen.findByText('Sydney AI Co');

      await userEvent.selectOptions(screen.getByLabelText('Filter by industry'), 'AI');
      await userEvent.selectOptions(screen.getByLabelText('Filter by location'), 'Melbourne');
      expect(await screen.findByText('No open roles match those filters.')).toBeInTheDocument();
    });
  });

  describe('a long list', () => {
    const many = Array.from({ length: 30 }, (_, i) => job({ name: `Co ${String(i).padStart(2, '0')}`, slug: `co-${i}` }));

    it('shows the first 24 and adds the rest when "Show more" is pressed', async () => {
      fakeServer(many);
      render(<JobsView sectorColors={{}} onClose={() => {}} />);
      const more = await screen.findByRole('button', { name: 'Show more (6 left)' });
      expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(24);

      await userEvent.click(more);
      await waitFor(() => expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(30));
      expect(fetchStartupPage.mock.calls.at(-1)[1]).toMatchObject({ offset: 24, limit: 24 });
      expect(screen.queryByRole('button', { name: /Show more/ })).not.toBeInTheDocument();
    });

    it('says so when the next page cannot be loaded, and keeps what it has', async () => {
      fakeServer(many);
      render(<JobsView sectorColors={{}} onClose={() => {}} />);
      const more = await screen.findByRole('button', { name: /Show more/ });
      fetchStartupPage.mockRejectedValueOnce(new Error('down'));
      await userEvent.click(more);
      expect(await screen.findByText('Could not load more jobs right now.')).toBeInTheDocument();
      expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(24);
    });
  });
});
