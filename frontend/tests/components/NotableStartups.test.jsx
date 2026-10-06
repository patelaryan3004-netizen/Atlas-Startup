import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import NotableStartups from '../../src/components/NotableStartups.jsx';

describe('NotableStartups', () => {
  it('lists the oldest companies the server found, oldest first, with their founding year', () => {
    render(<NotableStartups notable={{ total: 2, items: [{ name: 'Oldest Co', foundedYear: 2004 }, { name: 'Newer Co', foundedYear: 2020 }] }} />);

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Oldest Co');
    expect(items[0]).toHaveTextContent('2004');
    expect(items[1]).toHaveTextContent('Newer Co');
    expect(screen.queryByText(/oldest of/)).not.toBeInTheDocument();
  });

  it('says how many there are in all when it shows only the oldest of them', () => {
    render(<NotableStartups notable={{ total: 612, items: [{ name: 'Oldest Co', foundedYear: 2004 }] }} />);
    expect(screen.getByText('The 1 oldest of 612.')).toBeInTheDocument();
  });

  it('renders nothing when no company has a founding year, or nothing was given', () => {
    const { container, rerender } = render(<NotableStartups notable={{ total: 0, items: [] }} />);
    expect(container.firstChild).toBeNull();
    rerender(<NotableStartups />);
    expect(container.firstChild).toBeNull();
  });
});
