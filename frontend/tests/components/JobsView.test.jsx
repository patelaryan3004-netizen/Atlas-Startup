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

describe('the bar of the jobs page', () => {
  it('has the brand as a link home, and a Map link that takes the page back to the map, beside the back button', async () => {
    fakeServer([job()]);
    const onClose = vi.fn();
    render(<JobsView sectorColors={{}} onClose={onClose} />);
    expect(screen.getByRole('link', { name: 'Go to home' })).toHaveAttribute('href', '/welcome');
    await userEvent.click(screen.getByRole('link', { name: 'Map' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: '← Back to map' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('JobsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, '', '/jobs'); // the board writes its filters in the address
  });

  it('opens with the filters the address names, and writes the filters it is given into the address', async () => {
    window.history.replaceState(null, '', '/jobs?sector=AI&city=Sydney');
    fakeServer([job({ name: 'A', slug: 'a' }), job({ name: 'B', slug: 'b', sector: 'Fintech' })]);
    render(<JobsView sectorColors={{}} onClose={() => {}} />);
    await screen.findByRole('heading', { name: 'A' });
    expect(fetchStartupPage.mock.calls[0][0]).toEqual({ hiring: 'yes', sector: 'AI', city: 'Sydney', stage: '' });
    expect(screen.queryByRole('heading', { name: 'B' })).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Filter by startup stage'), 'Seed');
    await waitFor(() => expect(window.location.search).toBe('?sector=AI&city=Sydney&stage=Seed'));
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(window.location.search).toBe(''));
    expect(window.location.pathname).toBe('/jobs');
  });

  it('requests only hiring companies, a page at a time in name order, with the options for its filters, regardless of map filters', async () => {
    fakeServer([]);
    render(<JobsView sectorColors={{}} onClose={() => {}} />);
    await screen.findByText('No company has open roles checked against its own pages right now.');
    expect(fetchStartupPage.mock.calls[0][0]).toMatchObject({ hiring: 'yes' });
    expect(fetchStartupPage.mock.calls[0][1]).toMatchObject({ limit: 24, offset: 0, sort: 'name', facets: 'sector,city,stage' });
  });

  it('sends a card to the page that backs the company\'s hiring, its own job board, and to the company site when none is known', async () => {
    fakeServer([
      job({ name: 'Board Co', slug: 'board-co', website: 'https://board.example', hiring_source_url: 'https://boards.greenhouse.io/board' }),
      job({ name: 'Site Co', slug: 'site-co', website: 'https://site.example' }),
    ]);
    render(<JobsView sectorColors={{}} onClose={() => {}} />);
    const roles = await screen.findByText('View open roles');
    expect(roles).toHaveAttribute('href', 'https://boards.greenhouse.io/board');
    expect(roles).toHaveAttribute('target', '_blank');
    expect(screen.getByText('Apply now')).toHaveAttribute('href', 'https://site.example');
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

  it('renders a card per job on the one card: name, a row of sector, stage and city, and the blurb', async () => {
    fakeServer([job()]);
    const { container } = render(<JobsView onClose={() => {}} />);

    expect(await screen.findByRole('heading', { name: 'Acme AI' })).toBeInTheDocument();
    expect(container.querySelector('.job-card')).toHaveClass('card', 'entity-card');
    expect([...container.querySelectorAll('.job-card .meta-row li')].map((li) => li.textContent)).toEqual(['AI', 'Seed', 'Sydney']);
    expect(screen.getByText('Does things')).toHaveClass('entity-blurb');
    expect(screen.queryByText('Unverified')).not.toBeInTheDocument();
  });

  it('shows an Unverified badge for companies with verified:false, without hiding the card', async () => {
    fakeServer([job({ verified: false })]);
    render(<JobsView sectorColors={{}} onClose={() => {}} />);

    expect(await screen.findByText('Acme AI')).toBeInTheDocument();
    expect(screen.getByText('Unverified')).toBeInTheDocument();
  });

  it('says when each company was last checked: "Verified 3 days ago", a muted "Needs re-check" once over 60 days, and nothing without a date', async () => {
    const ago = (days) => new Date(Date.now() - days * 86400000).toISOString();
    fakeServer([
      job({ name: 'Fresh Co', slug: 'fresh', last_verified_at: ago(3) }),
      job({ name: 'Old Co', slug: 'old', last_verified_at: ago(90) }),
      job({ name: 'Never Co', slug: 'never' }),
    ]);
    const { container } = render(<JobsView sectorColors={{}} onClose={() => {}} />);
    await screen.findByRole('heading', { name: 'Fresh Co' });
    expect(screen.getByText('Verified 3 days ago')).toBeInTheDocument();
    expect(screen.getByText('Needs re-check')).toHaveClass('verified-note-stale');
    expect(container.querySelectorAll('.job-card .verified-note')).toHaveLength(2);
    expect(container.textContent).not.toMatch(/N\/A|undefined|null/);
  });

  it('shows no task-gate badge and no "Start task" button, even for a company flagged as task-gated: the same plain Apply for every card', async () => {
    fakeServer([
      job({ name: 'Gated Co', slug: 'gated', taskGate: { enabled: true, type: 'Design task' } }),
      job({ name: 'Open Co', slug: 'open', taskGate: { enabled: false, type: null } }),
    ]);
    render(<JobsView sectorColors={{}} onClose={() => {}} />);

    await screen.findByRole('heading', { name: 'Gated Co' });
    expect(screen.queryByText(/TASK-GATE/i)).not.toBeInTheDocument();
    expect(screen.queryByText('NO GATE')).not.toBeInTheDocument();
    expect(screen.queryByText('Start task → Apply')).not.toBeInTheDocument();
    expect(screen.getAllByText('Apply now')).toHaveLength(2);
  });

  it('labels a company that opted in to task-gated applications as a concept preview, and no other', async () => {
    fakeServer([job({ name: 'Opted Co', slug: 'opted', taskGate: { enabled: true, optedIn: true } }), job({ name: 'Plain Co', slug: 'plain' })]);
    render(<JobsView sectorColors={{}} onClose={() => {}} />);
    await screen.findByRole('heading', { name: 'Opted Co' });
    const labels = screen.getAllByText('Concept preview');
    expect(labels).toHaveLength(1);
    expect(labels[0].closest('.job-card')).toHaveTextContent('Opted Co');
  });

  it('says which companies are listed: only those whose open roles were read from a page', async () => {
    fakeServer([job()]);
    render(<JobsView sectorColors={{}} onClose={() => {}} />);
    expect(await screen.findByText(/Only companies whose open roles were read from a page are listed/)).toBeInTheDocument();
  });

  it('makes the apply CTA a real link to the company website, not a dead button', async () => {
    fakeServer([job({ website: 'https://acme.example' })]);
    render(<JobsView sectorColors={{}} onClose={() => {}} />);
    const cta = await screen.findByText('Apply now');
    expect(cta.tagName).toBe('A');
    expect(cta).toHaveAttribute('href', 'https://acme.example');
    expect(cta).toHaveAttribute('target', '_blank');
  });

  it('omits the apply CTA entirely when a company has no website on file, rather than linking nowhere', async () => {
    fakeServer([job({ website: null })]);
    render(<JobsView sectorColors={{}} onClose={() => {}} />);
    await screen.findByText('Acme AI');
    expect(screen.queryByText('Apply now')).not.toBeInTheDocument();
  });

  it('shows an empty state when nobody is hiring', async () => {
    fakeServer([]);
    render(<JobsView sectorColors={{}} onClose={() => {}} />);
    expect(await screen.findByText('No company has open roles checked against its own pages right now.')).toBeInTheDocument();
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
      await screen.findByRole('heading', { name: 'Sydney AI Co' });

      expect(screen.getByRole('option', { name: 'AI' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Fintech' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Series A' })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'Healthtech' })).not.toBeInTheDocument();
    });

    it('asks the server again for the chosen filter, without asking for the options a second time, and shows how many match', async () => {
      fakeServer(jobs);
      render(<JobsView sectorColors={{}} onClose={() => {}} />);
      await screen.findByRole('heading', { name: 'Sydney AI Co' });

      await userEvent.selectOptions(screen.getByLabelText('Filter by industry'), 'AI');
      await waitFor(() => expect(screen.queryByRole('heading', { name: 'Melbourne Fintech Co' })).not.toBeInTheDocument());
      expect(screen.getByRole('heading', { name: 'Sydney AI Co' })).toBeInTheDocument();
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
      await screen.findByRole('heading', { name: 'Sydney AI Co' });
      expect(screen.queryByText('Clear filters')).not.toBeInTheDocument();

      await userEvent.selectOptions(screen.getByLabelText('Filter by location'), 'Melbourne');
      await waitFor(() => expect(screen.queryByRole('heading', { name: 'Sydney AI Co' })).not.toBeInTheDocument());

      await userEvent.click(screen.getByText('Clear filters'));
      expect(await screen.findByRole('heading', { name: 'Sydney AI Co' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Melbourne Fintech Co' })).toBeInTheDocument();
    });

    it('shows an honest empty state when filters match nothing, without fabricating a listing', async () => {
      fakeServer(jobs);
      render(<JobsView sectorColors={{}} onClose={() => {}} />);
      await screen.findByRole('heading', { name: 'Sydney AI Co' });

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
