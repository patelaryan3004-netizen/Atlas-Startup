import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import IndexRow, { cardId } from '../../src/components/IndexRow.jsx';

const items = (...names) => names.map((name) => ({ id: cardId('company', name), name }));

describe('cardId', () => {
  it('makes a safe id from a kind and a name or slug', () => {
    expect(cardId('company', 'Canva')).toBe('company-canva');
    expect(cardId('investor', 'Blackbird Ventures & Co.')).toBe('investor-blackbird-ventures-co');
    expect(cardId('job', ':Different')).toBe('job-different');
  });
});

describe('IndexRow', () => {
  beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); });

  it('lists the names as links, in a navigation the page can find, each named by what it does', () => {
    render(<IndexRow items={items('Canva', 'Atlassian', 'Airwallex')} what="the companies listed" />);
    const nav = screen.getByRole('navigation', { name: 'Index of the companies listed' });
    expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual(['Canva', 'Atlassian', 'Airwallex']);
    expect(within(nav).getByRole('link', { name: 'Jump to Canva' })).toHaveAttribute('href', '#company-canva');
  });

  it('is short: the first ten, and how many more there are', () => {
    const names = Array.from({ length: 14 }, (_, i) => `Co ${i}`);
    render(<IndexRow items={items(...names)} />);
    expect(screen.getAllByRole('link')).toHaveLength(10);
    expect(screen.getByText('+4 more')).toBeInTheDocument();
    expect(screen.queryByText('Co 10')).not.toBeInTheDocument();
  });

  it('can be told how short', () => {
    render(<IndexRow items={items('A1', 'B2', 'C3', 'D4')} max={2} />);
    expect(screen.getAllByRole('link')).toHaveLength(2);
    expect(screen.getByText('+2 more')).toBeInTheDocument();
  });

  it('is nothing for a list with fewer than two names: there is nothing to find', () => {
    const { container, rerender } = render(<IndexRow items={items('Canva')} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<IndexRow items={[]} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<IndexRow items={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('moves to the card and puts the keyboard on it, without changing the address', async () => {
    render(
      <>
        <IndexRow items={items('Canva', 'Atlassian')} />
        <button id="company-atlassian">Atlassian card</button>
      </>,
    );
    const before = window.location.href;
    await userEvent.click(screen.getByRole('link', { name: 'Jump to Atlassian' }));
    expect(document.getElementById('company-atlassian').scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: expect.stringMatching(/smooth|auto/) });
    expect(screen.getByRole('button', { name: 'Atlassian card' })).toHaveFocus();
    expect(window.location.href).toBe(before);
  });

  it('does nothing, and lets the link act as a link, when the card is not on the page', async () => {
    render(<IndexRow items={items('Canva', 'Atlassian')} />);
    await userEvent.click(screen.getByRole('link', { name: 'Jump to Canva' }));
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });
});
