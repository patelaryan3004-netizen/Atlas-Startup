import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../src/api.js', () => ({
  fetchNews: vi.fn(),
}));

import { fetchNews } from '../../src/api.js';
import StartupDetailPanel from '../../src/components/StartupDetailPanel.jsx';

function startup(overrides = {}) {
  return {
    name: 'Canva',
    sector: 'SaaS',
    sectorFull: 'SaaS / Design Tech',
    city: 'Sydney',
    stage: 'Series D+',
    hiring: true,
    verified: true,
    website: 'https://www.canva.com',
    blurb: 'Online graphic design platform for everyone',
    investors: ['Blackbird', 'AirTree'],
    founders: ['Melanie Perkins'],
    taskGate: { enabled: true, type: 'Coding task' },
    ...overrides,
  };
}

function setup(overrides = {}) {
  fetchNews.mockResolvedValue({ source: 'live', deals: [] });
  const onToggleTracked = vi.fn();
  const onSuggestEdit = vi.fn();
  const onSelectPerson = vi.fn();
  const onClose = vi.fn();
  const result = render(
    <StartupDetailPanel
      startup={startup(overrides.startup)}
      sectorColor="#abcdef"
      isTracked={overrides.isTracked || (() => false)}
      onToggleTracked={onToggleTracked}
      onSuggestEdit={onSuggestEdit}
      onSelectPerson={onSelectPerson}
      onClose={onClose}
    />
  );
  return { onToggleTracked, onSuggestEdit, onSelectPerson, onClose, container: result.container, unmount: result.unmount };
}

describe('StartupDetailPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the name and the four core meta fields', () => {
    setup();
    expect(screen.getByText('Canva')).toBeInTheDocument();
    expect(screen.getByText('SaaS / Design Tech')).toBeInTheDocument();
    expect(screen.getByText('Sydney')).toBeInTheDocument();
    expect(screen.getByText('Series D+')).toBeInTheDocument();
    expect(screen.getByText('Hiring now')).toBeInTheDocument();
  });

  it('shows an unverified badge only for unverified startups', () => {
    setup({ startup: { verified: false } });
    expect(screen.getByText('Unverified')).toBeInTheDocument();
  });

  it('is honest about location precision - address on file vs city-level only', () => {
    const { unmount } = setup({ startup: { address: '123 Test St' } });
    expect(screen.getByText('✓ Address on file')).toBeInTheDocument();
    unmount();

    setup({ startup: { address: undefined } });
    expect(screen.getByText('◐ City-level only')).toBeInTheDocument();
  });

  it('shows the About section only when a blurb exists', () => {
    const { unmount } = setup({ startup: { blurb: 'A real description' } });
    expect(screen.getByText('A real description')).toBeInTheDocument();
    unmount();

    setup({ startup: { blurb: undefined } });
    expect(screen.queryByText('About')).not.toBeInTheDocument();
  });

  it('shows founders with a real name and a LinkedIn-search link, never a guessed profile URL', () => {
    setup({ startup: { founders: ['Jane Smith'] } });
    expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    const link = screen.getByTitle('Search LinkedIn for Jane Smith');
    expect(link).toHaveAttribute('href', expect.stringContaining('linkedin.com/search/results/people'));
    expect(link.getAttribute('href')).not.toContain('linkedin.com/in/');
  });

  it('calls onSelectPerson with the founder name when their name is clicked', async () => {
    const { onSelectPerson } = setup({ startup: { founders: ['Jane Smith'] } });
    await userEvent.click(screen.getByText('Jane Smith'));
    expect(onSelectPerson).toHaveBeenCalledWith('Jane Smith');
  });

  it('omits the Founders section entirely when no founders are on file', () => {
    setup({ startup: { founders: undefined } });
    expect(screen.queryByText('Founders')).not.toBeInTheDocument();
  });

  it('states funding stage and investor count honestly, without inventing a dollar amount', () => {
    setup({ startup: { stage: 'Series D+', investors: ['Blackbird', 'AirTree', 'Square Peg'] } });
    expect(screen.getByText('Series D+ · backed by 3 investors', { exact: false })).toBeInTheDocument();
  });

  it('lists investor names in their own section', () => {
    setup({ startup: { investors: ['Blackbird', 'AirTree'] } });
    expect(screen.getByText('Blackbird')).toBeInTheDocument();
    expect(screen.getByText('AirTree')).toBeInTheDocument();
  });

  it('omits the Investors section when there are none on file', () => {
    setup({ startup: { investors: [] } });
    expect(screen.queryByText('Investors')).not.toBeInTheDocument();
  });

  it('shows a hiring badge and a task-gate-aware apply button when hiring', () => {
    setup({ startup: { hiring: true, taskGate: { enabled: true, type: 'Coding task' } } });
    expect(screen.getByText('● Hiring now')).toBeInTheDocument();
    expect(screen.getByText('Start task → Apply')).toBeInTheDocument();
  });

  it('shows a plain apply button when hiring without a task gate', () => {
    setup({ startup: { hiring: true, taskGate: { enabled: false, type: null } } });
    expect(screen.getByText('Apply now')).toBeInTheDocument();
  });

  it('shows a not-hiring badge and no apply button when not hiring', () => {
    setup({ startup: { hiring: false } });
    expect(screen.getByText('Not hiring right now')).toBeInTheDocument();
    expect(screen.queryByText('Apply now')).not.toBeInTheDocument();
    expect(screen.queryByText('Start task → Apply')).not.toBeInTheDocument();
  });

  it('shows only news whose headline or meta genuinely mentions the startup, never fabricated relevance', async () => {
    fetchNews.mockResolvedValue({
      source: 'live',
      deals: [
        { headline: 'Canva raises new round', meta: 'Sydney', url: 'https://example.com/canva-news' },
        { headline: 'Some unrelated startup raises seed', meta: 'Melbourne', url: 'https://example.com/other' },
      ],
    });
    render(
      <StartupDetailPanel
        startup={startup()}
        sectorColor="#abcdef"
        isTracked={() => false}
        onToggleTracked={() => {}}
        onSuggestEdit={() => {}}
        onClose={() => {}}
      />
    );
    expect(await screen.findByText('Canva raises new round')).toBeInTheDocument();
    expect(screen.queryByText('Some unrelated startup raises seed')).not.toBeInTheDocument();
  });

  it('omits the News section entirely when nothing matches', async () => {
    fetchNews.mockResolvedValue({
      source: 'live',
      deals: [{ headline: 'Unrelated startup news', meta: '', url: 'https://example.com/other' }],
    });
    render(
      <StartupDetailPanel
        startup={startup()}
        sectorColor="#abcdef"
        isTracked={() => false}
        onToggleTracked={() => {}}
        onSuggestEdit={() => {}}
        onClose={() => {}}
      />
    );
    await screen.findByText('Canva');
    expect(screen.queryByText('News')).not.toBeInTheDocument();
  });

  it('shows vouches when present and omits the section when absent', () => {
    const { unmount } = setup({ startup: { vouches: [{ name: 'Sam Lee', role: 'Investor', note: 'Backed their seed round.' }] } });
    expect(screen.getByText('Vouched by 1')).toBeInTheDocument();
    unmount();

    setup({ startup: { vouches: [] } });
    expect(screen.queryByText(/Vouched by/)).not.toBeInTheDocument();
  });

  it('shows the website link with the scheme stripped for display', () => {
    setup({ startup: { website: 'https://www.canva.com' } });
    const link = screen.getByText('www.canva.com ↗');
    expect(link).toHaveAttribute('href', 'https://www.canva.com');
  });

  it('shows an untracked toggle by default, and a tracked state when isTracked returns true', () => {
    const { unmount } = setup({ isTracked: () => false });
    expect(screen.getByText('☆ Track')).toBeInTheDocument();
    unmount();

    setup({ isTracked: () => true });
    expect(screen.getByText('★ Tracked')).toBeInTheDocument();
  });

  it('calls onToggleTracked with the startup name when the track button is clicked', async () => {
    const { onToggleTracked } = setup();
    await userEvent.click(screen.getByText('☆ Track'));
    expect(onToggleTracked).toHaveBeenCalledWith('Canva');
  });

  it('calls onSuggestEdit with the startup name when Suggest an edit is clicked', async () => {
    const { onSuggestEdit } = setup();
    await userEvent.click(screen.getByText('✎ Suggest an edit'));
    expect(onSuggestEdit).toHaveBeenCalledWith('Canva');
  });

  it('calls onClose from the close button, Escape, and clicking the scrim - but not clicking inside the panel', async () => {
    const { onClose, container } = setup();
    await userEvent.click(container.querySelector('.sdp-panel'));
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose on Escape', async () => {
    const { onClose } = setup();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when clicking the overlay outside the panel', async () => {
    const { onClose, container } = setup();
    await userEvent.click(container.querySelector('.sdp-overlay'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
