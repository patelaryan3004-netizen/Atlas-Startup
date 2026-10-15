import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HeaderMenu from '../../src/components/HeaderMenu.jsx';

function setup(overrides = {}) {
  const props = {
    go: { explore: vi.fn(), collections: vi.fn(), investors: vi.fn(), jobs: vi.fn(), saved: vi.fn() },
    onShowPeople: vi.fn(),
    newsVisible: true,
    onToggleNews: vi.fn(),
    onShowWaitlist: vi.fn(),
    onShowUnverified: vi.fn(),
    unverifiedCount: 3,
    trackedCount: 2,
    onShowAbout: vi.fn(),
    onShowPrivacy: vi.fn(),
    onShowFeedback: vi.fn(),
    onShowNews: vi.fn(),
    directoryUrl: '/directory/',
    ...overrides,
  };
  const result = render(<HeaderMenu {...props} />);
  return { ...props, container: result.container, unmount: result.unmount };
}

describe('HeaderMenu', () => {
  it('starts closed, with no menu items in the document', () => {
    setup();
    expect(screen.queryByText('Collections')).not.toBeInTheDocument();
    expect(screen.queryByText('News')).not.toBeInTheDocument();
  });

  it('opens to show the five places the header names (for a phone) and the secondary actions with live counts', async () => {
    setup();
    await userEvent.click(screen.getByLabelText('Menu'));

    for (const place of ['Explore', 'Collections', 'Investors', 'Jobs']) expect(screen.getByText(place)).toBeInTheDocument();
    expect(screen.getByText('Saved (2)')).toBeInTheDocument();
    expect(screen.getByText('News')).toBeInTheDocument();
    expect(screen.getByText('Hide news ticker')).toBeInTheDocument();
    expect(screen.getByText('Join waitlist')).toBeInTheDocument();
    expect(screen.getByText('Unconfirmed (3)')).toBeInTheDocument();
  });

  it('holds what the header has no room for: the about, privacy and feedback dialogs, the pages about the project, and the list that needs no scripts', async () => {
    const { onShowAbout, onShowPrivacy, onShowFeedback } = setup();
    await userEvent.click(screen.getByLabelText('Menu'));
    expect(screen.getByRole('link', { name: 'Methodology' })).toHaveAttribute('href', '/methodology');
    expect(screen.getByRole('link', { name: 'About' })).toHaveAttribute('href', '/about');
    expect(screen.getByRole('link', { name: 'Contact' })).toHaveAttribute('href', '/contact');
    expect(screen.getByRole('link', { name: 'Full list (no JS)' })).toHaveAttribute('href', '/directory/');
    expect(screen.getByText(/Built by Aryan/)).toBeInTheDocument();
    await userEvent.click(screen.getByText('About & sources'));
    expect(onShowAbout).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByLabelText('Menu'));
    await userEvent.click(screen.getByText('Privacy'));
    expect(onShowPrivacy).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByLabelText('Menu'));
    await userEvent.click(screen.getByText('Feedback'));
    expect(onShowFeedback).toHaveBeenCalledTimes(1);
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

  it('offers the news ticker as "Show news ticker" when it is hidden, and News as the page either way', async () => {
    setup({ newsVisible: false });
    await userEvent.click(screen.getByLabelText('Menu'));
    expect(screen.getByText('Show news ticker')).toBeInTheDocument();
    expect(screen.getByText('News')).toBeInTheDocument();
  });

  it('opens the News page from its item', async () => {
    const { onShowNews } = setup();
    await userEvent.click(screen.getByLabelText('Menu'));
    await userEvent.click(screen.getByText('News'));
    expect(onShowNews).toHaveBeenCalledTimes(1);
  });

  it('calls the matching handler and closes itself when a place is chosen', async () => {
    const { go } = setup();
    await userEvent.click(screen.getByLabelText('Menu'));
    await userEvent.click(screen.getByText('Collections'));

    expect(go.collections).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Collections')).not.toBeInTheDocument();
  });

  it('opens the investor directory, and closes itself, when Investors is clicked', async () => {
    const { go } = setup();
    await userEvent.click(screen.getByLabelText('Menu'));
    await userEvent.click(screen.getByText('Investors'));

    expect(go.investors).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Investors')).not.toBeInTheDocument();
  });

  it('opens the people page, and closes itself, when People is clicked', async () => {
    const { onShowPeople } = setup();
    await userEvent.click(screen.getByLabelText('Menu'));
    await userEvent.click(screen.getByText('People'));

    expect(onShowPeople).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('People')).not.toBeInTheDocument();
  });

  it('opens the saved companies and closes when the Saved item is clicked', async () => {
    const { go } = setup();
    await userEvent.click(screen.getByLabelText('Menu'));
    await userEvent.click(screen.getByText('Saved (2)'));

    expect(go.saved).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Saved (2)')).not.toBeInTheDocument();
  });

  it('is only links on a page that is not the app (no handlers): the places are their addresses, and what needs a dialog is left out', async () => {
    render(<HeaderMenu />);
    await userEvent.click(screen.getByLabelText('Menu'));
    expect(screen.getByRole('link', { name: 'Explore' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Collections' })).toHaveAttribute('href', '/lists');
    expect(screen.getByRole('link', { name: 'Investors' })).toHaveAttribute('href', '/investors');
    expect(screen.getByRole('link', { name: 'Jobs' })).toHaveAttribute('href', '/jobs');
    expect(screen.getByRole('link', { name: 'Saved' })).toHaveAttribute('href', '/?view=saved');
    expect(screen.getByRole('link', { name: 'News' })).toHaveAttribute('href', '/news');
    expect(screen.queryByText('Join waitlist')).not.toBeInTheDocument();
    expect(screen.queryByText('Feedback')).not.toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    setup();
    await userEvent.click(screen.getByLabelText('Menu'));
    expect(screen.getByText('Collections')).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByText('Collections')).not.toBeInTheDocument();
  });

  it('closes when clicking the scrim outside the panel', async () => {
    const { container } = setup();
    await userEvent.click(screen.getByLabelText('Menu'));
    expect(screen.getByText('Collections')).toBeInTheDocument();

    await userEvent.click(container.querySelector('.hdr-menu-scrim'));
    expect(screen.queryByText('Collections')).not.toBeInTheDocument();
  });
});
