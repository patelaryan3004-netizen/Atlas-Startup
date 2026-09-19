import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Leaderboard from '../../src/components/Leaderboard.jsx';

function s(city) {
  return { city };
}

describe('Leaderboard', () => {
  it('counts startups per city and sorts descending', () => {
    const startups = [s('Sydney'), s('Melbourne'), s('Sydney'), s('Sydney'), s('Melbourne')];
    render(<Leaderboard startups={startups} />);

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Sydney');
    expect(items[0]).toHaveTextContent('3');
    expect(items[1]).toHaveTextContent('Melbourne');
    expect(items[1]).toHaveTextContent('2');
  });

  it('renders an empty list when there are no startups', () => {
    render(<Leaderboard startups={[]} />);
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('caps the list to the top 8 cities by count, dropping the long tail', () => {
    const cities = ['Sydney', 'Melbourne', 'Brisbane', 'Adelaide', 'Perth', 'Canberra', 'Hobart', 'Darwin', 'Yatala', 'Warana'];
    const startups = cities.flatMap((city, i) => Array(cities.length - i).fill(0).map(() => s(city)));
    render(<Leaderboard startups={startups} />);

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(8);
    expect(screen.queryByText('Yatala')).not.toBeInTheDocument();
    expect(screen.queryByText('Warana')).not.toBeInTheDocument();
    expect(screen.getByText('Sydney')).toBeInTheDocument();
  });
});
