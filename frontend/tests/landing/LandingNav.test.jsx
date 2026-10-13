import { describe, it, expect } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LandingNav from '../../src/components/landing/LandingNav.jsx';

// jsdom cannot navigate; a click on a link is stopped before it tries.
const press = async (element) => {
  element.addEventListener('click', (event) => event.preventDefault());
  await userEvent.click(element);
};

describe('LandingNav', () => {
  it('has the name and the links, each going somewhere real in the app', () => {
    render(<LandingNav />);
    expect(screen.getByText('AU Startup Map').closest('a')).toHaveAttribute('href', '/welcome');
    // the name goes home, and says so
    expect(screen.getByRole('link', { name: 'Go to home' })).toHaveAttribute('href', '/welcome');
    const main = screen.getByRole('navigation', { name: 'Main' });
    // the three places a visitor goes: the map, the people worth following, the lists
    expect(within(main).getByRole('link', { name: 'Map' })).toHaveAttribute('href', '/');
    expect(within(main).getByRole('link', { name: 'People' })).toHaveAttribute('href', '/people');
    expect(within(main).getByRole('link', { name: 'Lists' })).toHaveAttribute('href', '/lists');
    expect(within(main).getAllByRole('link')).toHaveLength(3);
    expect(screen.getByRole('link', { name: 'Join waitlist' })).toHaveAttribute('href', '/?view=waitlist');
  });

  it('is one slim bar that stays at the top: the content sits inside it, on the page width', () => {
    const { container } = render(<LandingNav />);
    const bar = container.querySelector('header.landing-nav');
    expect(bar).toBeInTheDocument();
    expect(bar.querySelector(':scope > .landing-nav-inner')).toBeInTheDocument();
  });

  it('offers no sign-in, because the product has no accounts', () => {
    render(<LandingNav />);
    expect(screen.queryByText(/sign in/i)).not.toBeInTheDocument();
  });

  it('opens and closes the links panel on a phone', async () => {
    render(<LandingNav />);
    const nav = screen.getByRole('navigation', { name: 'Main' });
    const button = screen.getByRole('button', { name: 'Open menu' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveAttribute('aria-controls', 'landing-menu');
    expect(nav).toHaveAttribute('data-open', 'false');

    await userEvent.click(button);
    expect(screen.getByRole('button', { name: 'Close menu' })).toHaveAttribute('aria-expanded', 'true');
    expect(nav).toHaveAttribute('data-open', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'Close menu' }));
    expect(nav).toHaveAttribute('data-open', 'false');
  });

  it('closes on Escape and puts focus back on the button', async () => {
    render(<LandingNav />);
    const button = screen.getByRole('button', { name: 'Open menu' });
    await userEvent.click(button);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('navigation', { name: 'Main' })).toHaveAttribute('data-open', 'false');
    expect(screen.getByRole('button', { name: 'Open menu' })).toHaveFocus();
  });

  it('closes when a link is chosen or when anything outside the bar is pressed, but not for a press inside it', async () => {
    render(<LandingNav />);
    const nav = screen.getByRole('navigation', { name: 'Main' });
    const open = () => userEvent.click(screen.getByRole('button', { name: 'Open menu' }));

    await open();
    await press(within(nav).getByRole('link', { name: 'Lists' }));
    expect(nav).toHaveAttribute('data-open', 'false');

    await open();
    fireEvent.pointerDown(screen.getByText('AU Startup Map'));
    expect(nav).toHaveAttribute('data-open', 'true');
    fireEvent.pointerDown(document.body);
    expect(nav).toHaveAttribute('data-open', 'false');
  });
});
