import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Vouch from '../../src/components/Vouch.jsx';

describe('Vouch', () => {
  it('sets what was said as a quotation, then who said it and in what role', () => {
    const { container } = render(<Vouch name="Sam Lee" role="Investor" note="Backed their seed round." />);
    const quote = container.querySelector('blockquote');
    expect(quote).toHaveTextContent('Backed their seed round.');
    expect(container.querySelector('figure')).toBeInTheDocument();
    expect(screen.getByText('Sam Lee').closest('figcaption')).toHaveTextContent('Sam Lee, Investor');
    // the quotation comes first, the attribution after it
    expect(quote.compareDocumentPosition(container.querySelector('figcaption')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('leaves out the role when there is none, and does not write a stray comma', () => {
    render(<Vouch name="Sam Lee" note="Great team." />);
    expect(screen.getByText('Sam Lee').closest('figcaption').textContent).toBe('Sam Lee');
  });

  it('is only the name when it has no words, and nothing when it has neither', () => {
    const { container, rerender } = render(<Vouch name="Sam Lee" role="Investor" />);
    expect(container.querySelector('blockquote')).toBeNull();
    expect(container.querySelector('figcaption')).toHaveTextContent('Sam Lee, Investor');
    rerender(<Vouch />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows what it was given as text, never as markup', () => {
    const { container } = render(<Vouch name="<b>Eve</b>" note="<img src=x onerror=alert(1)>" />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('figcaption b')).toHaveTextContent('<b>Eve</b>'); // the name's own element holds the text of the name, not a second element
    expect(container.querySelectorAll('b')).toHaveLength(1);
    expect(container.querySelector('blockquote')).toHaveTextContent('<img src=x onerror=alert(1)>');
  });
});
