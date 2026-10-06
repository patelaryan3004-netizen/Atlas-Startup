import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import MostVouched from '../../src/components/MostVouched.jsx';

describe('MostVouched', () => {
  it('lists the most-vouched companies the server found, most first, with their vouch counts', () => {
    render(<MostVouched vouched={{ total: 2, items: [{ name: 'Three Vouch Co', vouches: 3 }, { name: 'One Vouch Co', vouches: 1 }] }} />);

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Three Vouch Co');
    expect(items[0]).toHaveTextContent('3');
    expect(items[1]).toHaveTextContent('One Vouch Co');
    expect(items[1]).toHaveTextContent('1');
    expect(screen.queryByText(/most vouched of/)).not.toBeInTheDocument();
  });

  it('says how many there are in all when it shows only the top of them', () => {
    render(<MostVouched vouched={{ total: 80, items: [{ name: 'A', vouches: 9 }] }} />);
    expect(screen.getByText('The 1 most vouched of 80.')).toBeInTheDocument();
  });

  it('renders nothing when no company has any vouches (the current real-data state), or nothing was given', () => {
    const { container, rerender } = render(<MostVouched vouched={{ total: 0, items: [] }} />);
    expect(container.firstChild).toBeNull();
    rerender(<MostVouched />);
    expect(container.firstChild).toBeNull();
  });
});
