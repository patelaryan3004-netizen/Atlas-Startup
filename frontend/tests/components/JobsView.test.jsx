import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../src/api.js', () => ({
  fetchStartups: vi.fn(),
}));

import { fetchStartups } from '../../src/api.js';
import JobsView from '../../src/components/JobsView.jsx';

function job(overrides = {}) {
  return {
    name: 'Acme AI',
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

describe('JobsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requests only hiring companies, regardless of map filters', async () => {
    fetchStartups.mockResolvedValue({ results: [] });
    render(<JobsView sectorColors={{}} onClose={() => {}} />);
    expect(fetchStartups).toHaveBeenCalledWith({ hiring: 'yes' });
  });

  it('shows a strong header with a live count of companies hiring now', async () => {
    fetchStartups.mockResolvedValue({ results: [job({ name: 'A' }), job({ name: 'B' })] });
    render(<JobsView sectorColors={{}} onClose={() => {}} />);
    expect(await screen.findByText('Startup jobs in Australia')).toBeInTheDocument();
    expect(screen.getByText('2 companies are hiring now')).toBeInTheDocument();
  });

  it('uses singular phrasing for exactly one hiring company', async () => {
    fetchStartups.mockResolvedValue({ results: [job()] });
    render(<JobsView sectorColors={{}} onClose={() => {}} />);
    expect(await screen.findByText('1 company is hiring now')).toBeInTheDocument();
  });

  it('renders a card per job with name, sector, city, stage and blurb', async () => {
    fetchStartups.mockResolvedValue({ results: [job()] });
    render(<JobsView sectorColors={{ AI: '#abcdef' }} onClose={() => {}} />);

    expect(await screen.findByText('Acme AI')).toBeInTheDocument();
    expect(screen.getByText('AI', { selector: '.pc-badge' })).toBeInTheDocument();
    expect(screen.getByText('Sydney · Seed')).toBeInTheDocument();
    expect(screen.getByText('Does things')).toBeInTheDocument();
    expect(screen.queryByText('Unverified')).not.toBeInTheDocument();
  });

  it('shows an Unverified badge for companies with verified:false, without hiding the card', async () => {
    fetchStartups.mockResolvedValue({ results: [job({ verified: false })] });
    render(<JobsView sectorColors={{}} onClose={() => {}} />);

    expect(await screen.findByText('Acme AI')).toBeInTheDocument();
    expect(screen.getByText('Unverified')).toBeInTheDocument();
  });

  it('shows a task-gate badge and CTA copy when task-gated, plain Apply otherwise', async () => {
    fetchStartups.mockResolvedValue({
      results: [
        job({ name: 'Gated Co', taskGate: { enabled: true, type: 'Design task' } }),
        job({ name: 'Open Co', taskGate: { enabled: false, type: null } }),
      ],
    });
    render(<JobsView sectorColors={{}} onClose={() => {}} />);

    await screen.findByText('Gated Co');
    expect(screen.getByText('TASK-GATE · Design task')).toBeInTheDocument();
    expect(screen.getByText('Start task → Apply')).toBeInTheDocument();
    expect(screen.getByText('NO GATE')).toBeInTheDocument();
    expect(screen.getByText('Apply now')).toBeInTheDocument();
  });

  it('makes the apply CTA a real link to the company website, not a dead button', async () => {
    fetchStartups.mockResolvedValue({ results: [job({ website: 'https://acme.example' })] });
    render(<JobsView sectorColors={{}} onClose={() => {}} />);
    const cta = await screen.findByText('Start task → Apply');
    expect(cta.tagName).toBe('A');
    expect(cta).toHaveAttribute('href', 'https://acme.example');
    expect(cta).toHaveAttribute('target', '_blank');
  });

  it('omits the apply CTA entirely when a company has no website on file, rather than linking nowhere', async () => {
    fetchStartups.mockResolvedValue({ results: [job({ website: null })] });
    render(<JobsView sectorColors={{}} onClose={() => {}} />);
    await screen.findByText('Acme AI');
    expect(screen.queryByText('Start task → Apply')).not.toBeInTheDocument();
  });

  it('shows an empty state when nobody is hiring', async () => {
    fetchStartups.mockResolvedValue({ results: [] });
    render(<JobsView sectorColors={{}} onClose={() => {}} />);
    expect(await screen.findByText('No companies are marked as hiring right now.')).toBeInTheDocument();
  });

  it('shows an error message when the fetch fails', async () => {
    fetchStartups.mockRejectedValue(new Error('network error'));
    render(<JobsView sectorColors={{}} onClose={() => {}} />);
    expect(await screen.findByText('Could not load jobs right now.')).toBeInTheDocument();
  });

  it('calls onClose when Back to map is clicked', async () => {
    fetchStartups.mockResolvedValue({ results: [] });
    const onClose = vi.fn();
    render(<JobsView sectorColors={{}} onClose={onClose} />);
    await userEvent.click(await screen.findByText('← Back to map'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe('filters', () => {
    const jobs = [
      job({ name: 'Sydney AI Co', sector: 'AI', city: 'Sydney', stage: 'Seed' }),
      job({ name: 'Melbourne Fintech Co', sector: 'Fintech', city: 'Melbourne', stage: 'Series A' }),
    ];

    it('only offers filter options that appear in the current hiring set, not the whole site', async () => {
      fetchStartups.mockResolvedValue({ results: jobs });
      render(<JobsView sectorColors={{}} onClose={() => {}} />);
      await screen.findByText('Sydney AI Co');

      expect(screen.getByRole('option', { name: 'AI' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Fintech' })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'Healthtech' })).not.toBeInTheDocument();
    });

    it('filters the grid by industry, location and stage', async () => {
      fetchStartups.mockResolvedValue({ results: jobs });
      render(<JobsView sectorColors={{}} onClose={() => {}} />);
      await screen.findByText('Sydney AI Co');

      await userEvent.selectOptions(screen.getByLabelText('Filter by industry'), 'AI');
      expect(screen.getByText('Sydney AI Co')).toBeInTheDocument();
      expect(screen.queryByText('Melbourne Fintech Co')).not.toBeInTheDocument();
      expect(screen.getByText('1 match your filters')).toBeInTheDocument();
    });

    it('shows Clear filters only once a filter is active, and it resets the grid', async () => {
      fetchStartups.mockResolvedValue({ results: jobs });
      render(<JobsView sectorColors={{}} onClose={() => {}} />);
      await screen.findByText('Sydney AI Co');
      expect(screen.queryByText('Clear filters')).not.toBeInTheDocument();

      await userEvent.selectOptions(screen.getByLabelText('Filter by location'), 'Melbourne');
      expect(screen.queryByText('Sydney AI Co')).not.toBeInTheDocument();

      await userEvent.click(screen.getByText('Clear filters'));
      expect(screen.getByText('Sydney AI Co')).toBeInTheDocument();
      expect(screen.getByText('Melbourne Fintech Co')).toBeInTheDocument();
    });

    it('shows an honest empty state when filters match nothing, without fabricating a listing', async () => {
      fetchStartups.mockResolvedValue({ results: jobs });
      render(<JobsView sectorColors={{}} onClose={() => {}} />);
      await screen.findByText('Sydney AI Co');

      await userEvent.selectOptions(screen.getByLabelText('Filter by industry'), 'AI');
      await userEvent.selectOptions(screen.getByLabelText('Filter by location'), 'Melbourne');
      expect(screen.getByText('No open roles match those filters.')).toBeInTheDocument();
    });
  });
});
