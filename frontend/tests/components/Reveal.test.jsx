import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import Reveal from '../../src/components/Reveal.jsx';

const originals = { io: globalThis.IntersectionObserver, mm: window.matchMedia };
afterEach(() => { globalThis.IntersectionObserver = originals.io; window.matchMedia = originals.mm; });

// A page that can say when an element is on screen: the test says when.
function watching() {
  const seen = [];
  globalThis.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; seen.push(this); this.disconnect = vi.fn(); }
    observe() {}
  };
  return seen;
}
const noPreference = () => { window.matchMedia = vi.fn().mockReturnValue({ matches: false }); };

describe('Reveal', () => {
  it('shows its content at once when the browser cannot say when it is on screen', () => {
    globalThis.IntersectionObserver = undefined;
    render(<Reveal>content</Reveal>);
    expect(screen.getByText('content')).toHaveClass('reveal', 'is-in');
  });

  it('shows its content at once to a visitor who has asked for less motion', () => {
    watching();
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    render(<Reveal>content</Reveal>);
    expect(screen.getByText('content')).toHaveClass('is-in');
  });

  it('waits for the element to be on screen, then lets it rise, once, and stops watching', () => {
    const seen = watching();
    noPreference();
    render(<Reveal>content</Reveal>);
    const element = screen.getByText('content');
    expect(element).toHaveClass('reveal');
    expect(element).not.toHaveClass('is-in');
    act(() => seen[0].callback([{ isIntersecting: false }]));
    expect(element).not.toHaveClass('is-in');
    act(() => seen[0].callback([{ isIntersecting: true }]));
    expect(element).toHaveClass('is-in');
    expect(seen[0].disconnect).toHaveBeenCalled();
  });

  it('staggers a row by its index (70 ms each, no more than eight steps), is any element, and passes on what it is given', () => {
    watching();
    noPreference();
    render(
      <ul>
        <Reveal as="li" index={2} className="mine" data-x="y">two</Reveal>
        <Reveal as="li" index={30}>late</Reveal>
      </ul>,
    );
    const two = screen.getByText('two');
    expect(two.tagName).toBe('LI');
    expect(two).toHaveClass('mine');
    expect(two).toHaveAttribute('data-x', 'y');
    expect(two.style.getPropertyValue('--i')).toBe('2');
    expect(screen.getByText('late').style.getPropertyValue('--i')).toBe('8');
  });
});
