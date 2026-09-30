import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HeaderMenu from '../../src/components/HeaderMenu.jsx';

function setup(overrides = {}) {
  const props = {
    newsVisible: true,
    onToggleNews: vi.fn(),
    onShowCuratedLists: vi.fn(),
    onShowUnverified: vi.fn(),
    unverifiedCount: 3,
    onShowTracked: vi.fn(),
    trackedCount: 2,
    onShowSubmitForm: vi.fn(),
    onShowWaitlist: vi.fn(),
    ...overrides,
  };
  render(<HeaderMenu {...props} />);
  return props;
}

describe('HeaderMenu', () => {
  it('starts closed, with no menu items in the document', () => {
    setup();
    expect(screen.queryByText('Curated lists')).not.toBeInTheDocument();
  });

  it('opens to show all secondary actions with live counts', async () => {
    setup();
    await userEvent.click(screen.getByLabelText('More'));

    expect(screen.getByText('Hide news')).toBeInTheDocument();
    expect(screen.getByText('Curated lists')).toBeInTheDocument();
    expect(screen.getByText('Unconfirmed (3)')).toBeInTheDocument();
    expect(screen.getByText('★ Tracked (2)')).toBeInTheDocument();
    expect(screen.getByText('Submit a startup')).toBeInTheDocument();
    expect(screen.getByText('Join waitlist')).toBeInTheDocument();
  });

  it('shows "Show news" instead of "Hide news" when news is already hidden', async () => {
    setup({ newsVisible: false });
    await userEvent.click(screen.getByLabelText('More'));
    expect(screen.getByText('Show news')).toBeInTheDocument();
  });

  it('calls the matching handler and closes itself when an item is clicked', async () => {
    const { onShowCuratedLists } = setup();
    await userEvent.click(screen.getByLabelText('More'));
    await userEvent.click(screen.getByText('Curated lists'));

    expect(onShowCuratedLists).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Curated lists')).not.toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    setup();
    await userEvent.click(screen.getByLabelText('More'));
    expect(screen.getByText('Curated lists')).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByText('Curated lists')).not.toBeInTheDocument();
  });

  it('closes when clicking the scrim outside the panel', async () => {
    const { container } = render(<HeaderMenu
      newsVisible={true} onToggleNews={() => {}} onShowCuratedLists={() => {}}
      onShowUnverified={() => {}} unverifiedCount={0} onShowTracked={() => {}}
      trackedCount={0} onShowSubmitForm={() => {}} onShowWaitlist={() => {}}
    />);
    await userEvent.click(screen.getByLabelText('More'));
    expect(screen.getByText('Curated lists')).toBeInTheDocument();

    await userEvent.click(container.querySelector('.hdr-menu-scrim'));
    expect(screen.queryByText('Curated lists')).not.toBeInTheDocument();
  });
});
