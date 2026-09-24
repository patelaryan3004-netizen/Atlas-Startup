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

  it('renders a card per job with name, sector, city, stage and blurb', async () => {
    fetchStartups.mockResolvedValue({ results: [job()] });
    render(<JobsView sectorColors={{ AI: '#abcdef' }} onClose={() => {}} />);

    expect(await screen.findByText('Acme AI')).toBeInTheDocument();
    expect(screen.getByText('AI')).toBeInTheDocument();
    expect(screen.getByText('Sydney · Seed')).toBeInTheDocument();
    expect(screen.getByText('Does things')).toBeInTheDocument();
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

  it('shows the count of hiring companies in the header', async () => {
    fetchStartups.mockResolvedValue({ results: [job({ name: 'A' }), job({ name: 'B' })] });
    render(<JobsView sectorColors={{}} onClose={() => {}} />);
    expect(await screen.findByText('2')).toBeInTheDocument();
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
});
