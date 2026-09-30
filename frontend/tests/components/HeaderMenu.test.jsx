import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HeaderMenu from '../../src/components/HeaderMenu.jsx';

function setup(overrides = {}) {
  const props = {
    onExplore: vi.fn(),
    onShowJobs: vi.fn(),
    onShowCuratedLists: vi.fn(),
    newsVisible: true,
    onToggleNews: vi.fn(),
    onShowWaitlist: vi.fn(),
    onShowUnverified: vi.fn(),
    unverifiedCount: 3,
    onShowTracked: vi.fn(),
    trackedCount: 2,
    ...overrides,
  };
  const result = render(<HeaderMenu {...props} />);
  return { ...props, container: result.container, unmount: result.unmount };
}

describe('HeaderMenu', () => {
  it('starts closed, with no menu items in the document', () => {
    setup();
    expect(screen.queryByText('Curated lists')).not.toBeInTheDocument();
    expect(screen.queryByText('Lists')).not.toBeInTheDocument();
  });

  it('opens to show the mobile nav row and the always-visible secondary actions with live counts', async () => {
    setup();
    await userEvent.click(screen.getByLabelText('Menu'));

    expect(screen.getByText('Explore')).toBeInTheDocument();
    expect(screen.getByText('Jobs')).toBeInTheDocument();
    expect(screen.getByText('Lists')).toBeInTheDocument();
    expect(screen.getByText('Hide news')).toBeInTheDocument();
    expect(screen.getByText('Join waitlist')).toBeInTheDocument();
    expect(screen.getByText('Unconfirmed (3)')).toBeInTheDocument();
    expect(screen.getByText('★ Tracked (2)')).toBeInTheDocument();
  });

  it('shows a subtle hiring-count hint on the Jobs item when given one, omitting it otherwise', async () => {
    const { unmount } = setup({ hiringCount: 5 });
    await userEvent.click(screen.getByLabelText('Menu'));
    expect(screen.getByText('Jobs', { exact: false })).toHaveTextContent('Jobs · 5 hiring now');
    unmount();

    setup({ hiringCount: 0 });
    await userEvent.click(screen.getByLabelText('Menu'));
    expect(screen.getByText('Jobs').textContent).toBe('Jobs');
  });

  it('shows "News" instead of "Hide news" when news is already hidden', async () => {
    setup({ newsVisible: false });
    await userEvent.click(screen.getByLabelText('Menu'));
    expect(screen.getByText('News')).toBeInTheDocument();
  });

  it('calls the matching handler and closes itself when an item is clicked', async () => {
    const { onShowCuratedLists } = setup();
    await userEvent.click(screen.getByLabelText('Menu'));
    await userEvent.click(screen.getByText('Lists'));

    expect(onShowCuratedLists).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Lists')).not.toBeInTheDocument();
  });

  it('calls onShowTracked and closes when the Tracked item is clicked', async () => {
    const { onShowTracked } = setup();
    await userEvent.click(screen.getByLabelText('Menu'));
    await userEvent.click(screen.getByText('★ Tracked (2)'));

    expect(onShowTracked).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('★ Tracked (2)')).not.toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    setup();
    await userEvent.click(screen.getByLabelText('Menu'));
    expect(screen.getByText('Lists')).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByText('Lists')).not.toBeInTheDocument();
  });

  it('closes when clicking the scrim outside the panel', async () => {
    const { container } = setup();
    await userEvent.click(screen.getByLabelText('Menu'));
    expect(screen.getByText('Lists')).toBeInTheDocument();

    await userEvent.click(container.querySelector('.hdr-menu-scrim'));
    expect(screen.queryByText('Lists')).not.toBeInTheDocument();
  });
});
