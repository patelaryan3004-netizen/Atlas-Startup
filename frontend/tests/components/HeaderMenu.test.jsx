import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HeaderMenu from '../../src/components/HeaderMenu.jsx';

function setup(overrides = {}) {
  const props = {
    onShowLists: vi.fn(),
    onShowPeople: vi.fn(),
    newsVisible: true,
    onToggleNews: vi.fn(),
    onShowWaitlist: vi.fn(),
    onShowUnverified: vi.fn(),
    unverifiedCount: 3,
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

  it('opens to show what the header has no room for, with live counts, and not the three places (they are in the header and, on a phone, along the bottom)', async () => {
    setup();
    await userEvent.click(screen.getByLabelText('Menu'));

    for (const item of ['Collections', 'News', 'Hide news ticker', 'Join waitlist', 'Unconfirmed (3)']) expect(screen.getByText(item)).toBeInTheDocument();
    for (const place of ['Home', 'Discover', 'Opportunities', 'Explore', 'Jobs', 'Saved']) expect(screen.queryByText(place)).not.toBeInTheDocument();
  });

  it('holds the about, privacy and feedback dialogs, the pages about the project, and the list that needs no scripts', async () => {
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

  it('opens the collections, and closes itself, when Collections is clicked', async () => {
    const { onShowLists } = setup();
    await userEvent.click(screen.getByLabelText('Menu'));
    await userEvent.click(screen.getByText('Collections'));

    expect(onShowLists).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Collections')).not.toBeInTheDocument();
  });

  it('opens the people page, and closes itself, when People is clicked', async () => {
    const { onShowPeople } = setup();
    await userEvent.click(screen.getByLabelText('Menu'));
    await userEvent.click(screen.getByText('People'));

    expect(onShowPeople).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('People')).not.toBeInTheDocument();
  });

  it('is only links on a page that is not the app (no handlers): the places are their addresses, and what needs a dialog is left out', async () => {
    render(<HeaderMenu />);
    await userEvent.click(screen.getByLabelText('Menu'));
    expect(screen.getByRole('link', { name: 'Collections' })).toHaveAttribute('href', '/lists');
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
