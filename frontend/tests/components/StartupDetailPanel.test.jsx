import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
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

describe('StartupDetailPanel, while the full record is still arriving', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows what the map or list already knew, says the rest is loading, and does not claim the address is missing', () => {
    setup({ startup: { partial: true, address: undefined, founders: undefined, investors: undefined, blurb: undefined } });
    expect(screen.getByText('Canva')).toBeInTheDocument();
    expect(screen.getByText('SaaS / Design Tech')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading details…');
    expect(screen.queryByText('◐ City-level only')).not.toBeInTheDocument();
    expect(screen.queryByText('✓ Address on file')).not.toBeInTheDocument();
  });

  it('shows the address note and no loading line once the full record is there', () => {
    setup({ startup: { address: '110 Kippax Street, Surry Hills NSW 2010' } });
    expect(screen.queryByText('Loading details…')).not.toBeInTheDocument();
    expect(screen.getByText('✓ Address on file')).toBeInTheDocument();
  });
});

describe('StartupDetailPanel, how well the place is known', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  const where = (precision, place, quality) => ({ startup: { location: { precision, place, quality } } });

  it('shows an office a source has checked as such, with its address', () => {
    setup(where('EXACT', '110 Kippax Street, Surry Hills, Sydney', 'Verified office'));
    expect(screen.getByText('110 Kippax Street, Surry Hills, Sydney')).toBeInTheDocument();
    expect(screen.getByText('✓ Verified office')).toBeInTheDocument();
  });

  it('says an address that is only on file is only on file', () => {
    setup(where('EXACT', '1 George Street, Sydney', 'Office address on file'));
    expect(screen.getByText('✓ Office address on file')).toBeInTheDocument();
    expect(screen.queryByText(/Verified office/)).not.toBeInTheDocument();
  });

  it('calls a suburb approximate: the pin is at the suburb, not the office', () => {
    setup(where('SUBURB', 'Surry Hills, Sydney', 'Location: suburb-level'));
    expect(screen.getByText('◐ Location: suburb-level')).toBeInTheDocument();
    expect(screen.getByText('Approximate: the pin is at the suburb, not the office.')).toBeInTheDocument();
  });

  it('says a company known only to its city has no pin, and where it is shown instead', () => {
    setup(where('CITY', 'Sydney, NSW', 'Location: city-level'));
    expect(screen.getByText('Sydney, NSW')).toBeInTheDocument();
    expect(screen.getByText('◐ Location: city-level')).toBeInTheDocument();
    expect(screen.getByText('No pin: shown as a group in Sydney on the map.')).toBeInTheDocument();
  });

  it('says a state-level company has no pin either, and an unknown place is not shown at all', () => {
    const { unmount } = setup(where('STATE', 'VIC', 'Location: state-level'));
    expect(screen.getByText('No pin: shown as a group in its state on the map.')).toBeInTheDocument();
    unmount();
    setup(where('UNKNOWN', null, 'Location unknown'));
    expect(screen.getByText('○ Location unknown')).toBeInTheDocument();
    expect(screen.getByText('Not shown on the map.')).toBeInTheDocument();
  });

  it('says it at once for a company opened from a pin, while the rest of the record is still loading', () => {
    setup({ startup: { partial: true, location: { precision: 'EXACT', place: '15 William Street, Melbourne', quality: 'Verified office' } } });
    expect(screen.getByRole('status')).toHaveTextContent('Loading details…');
    expect(screen.getByText('15 William Street, Melbourne')).toBeInTheDocument();
    expect(screen.getByText('✓ Verified office')).toBeInTheDocument();
  });

  it('describes a record that does not say how well its place is known as it always did', () => {
    setup({ startup: { address: '123 Test St', location: undefined } });
    expect(screen.getByText('✓ Address on file')).toBeInTheDocument();
  });
});

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

describe('StartupDetailPanel, the company logo', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  const logo = (container) => container.querySelector('.pc-avatar-logo');
  // The panel also asks for the news when it opens; let that answer land inside act().
  const settle = () => act(async () => {});

  it('tries Clearbit, then Google\'s favicon, then gives up and leaves the initial', async () => {
    const { container } = setup();
    await settle();
    expect(logo(container).getAttribute('src')).toBe('https://logo.clearbit.com/canva.com?size=96');

    fireEvent.error(logo(container));
    expect(logo(container).getAttribute('src')).toBe('https://www.google.com/s2/favicons?domain=canva.com&sz=96');

    fireEvent.error(logo(container));
    expect(logo(container)).toBeNull();
    expect(container.querySelector('.pc-avatar-fallback')).toHaveTextContent('C');
  });

  // The panel used to answer every failure by pointing the image at the favicon again. For a visitor whose
  // browser blocks both addresses that failed again at once, thousands of times a second, while the panel was open.
  it('stops after the second address, however many more failures are reported', async () => {
    const { container } = setup();
    await settle();
    for (let i = 0; i < 5; i += 1) { const current = logo(container); if (current) fireEvent.error(current); }
    expect(logo(container)).toBeNull();
  });

  it('starts again from Clearbit for the next company', async () => {
    fetchNews.mockResolvedValue({ source: 'live', deals: [] });
    const props = { sectorColor: '#abcdef', isTracked: () => false, onToggleTracked: vi.fn(), onSuggestEdit: vi.fn(), onSelectPerson: vi.fn(), onClose: vi.fn() };
    const { container, rerender } = render(<StartupDetailPanel startup={startup()} {...props} />);
    await settle();
    fireEvent.error(logo(container));
    fireEvent.error(logo(container));
    expect(logo(container)).toBeNull();

    rerender(<StartupDetailPanel startup={startup({ name: 'Atlassian', website: 'https://www.atlassian.com' })} {...props} />);
    expect(logo(container).getAttribute('src')).toBe('https://logo.clearbit.com/atlassian.com?size=96');
  });

  it('shows no logo, and no broken image, for a company with no website', async () => {
    const { container } = setup({ startup: { website: '' } });
    await settle();
    expect(logo(container)).toBeNull();
    expect(container.querySelector('.pc-avatar-fallback')).toHaveTextContent('C');
  });
});
