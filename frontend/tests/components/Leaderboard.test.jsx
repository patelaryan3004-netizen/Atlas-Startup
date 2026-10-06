import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Leaderboard from '../../src/components/Leaderboard.jsx';

describe('Leaderboard', () => {
  it('lists the cities the server counted, in the order it gave', () => {
    render(<Leaderboard cities={[{ city: 'Sydney', count: 3 }, { city: 'Melbourne', count: 2 }]} />);

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Sydney');
    expect(items[0]).toHaveTextContent('3');
    expect(items[1]).toHaveTextContent('Melbourne');
    expect(items[1]).toHaveTextContent('2');
  });

  it('renders an empty list when there are no cities, or none given', () => {
    const { rerender } = render(<Leaderboard cities={[]} />);
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    rerender(<Leaderboard />);
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });
});
