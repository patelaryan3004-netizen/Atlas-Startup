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
    const main = screen.getByRole('navigation', { name: 'Main' });
    expect(within(main).getByRole('link', { name: 'Discover' })).toHaveAttribute('href', '/');
    expect(within(main).getByRole('link', { name: 'Lists' })).toHaveAttribute('href', '/?view=lists');
    expect(within(main).getByRole('link', { name: 'Jobs' })).toHaveAttribute('href', '/?view=jobs');
    expect(screen.getByRole('link', { name: 'Join waitlist' })).toHaveAttribute('href', '/?view=waitlist');
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
