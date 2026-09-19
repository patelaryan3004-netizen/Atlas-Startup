import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import NotableStartups from '../../src/components/NotableStartups.jsx';

function s(name, foundedYear) {
  return { name, foundedYear };
}

describe('NotableStartups', () => {
  it('lists only startups with a foundedYear, oldest first', () => {
    const startups = [s('Newer Co', 2020), s('No Year Co'), s('Oldest Co', 2004)];
    render(<NotableStartups startups={startups} />);

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Oldest Co');
    expect(items[0]).toHaveTextContent('2004');
    expect(items[1]).toHaveTextContent('Newer Co');
    expect(screen.queryByText('No Year Co')).not.toBeInTheDocument();
  });

  it('renders nothing when no startup has a foundedYear', () => {
    const { container } = render(<NotableStartups startups={[s('A'), s('B')]} />);
    expect(container.firstChild).toBeNull();
  });
});
