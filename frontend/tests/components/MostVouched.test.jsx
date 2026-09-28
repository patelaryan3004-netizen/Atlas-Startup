import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import MostVouched from '../../src/components/MostVouched.jsx';

function s(name, vouches) {
  return { name, vouches };
}

describe('MostVouched', () => {
  it('lists only startups with at least one vouch, most-vouched first', () => {
    const startups = [
      s('One Vouch Co', [{ name: 'A', role: '', note: '' }]),
      s('No Vouch Co', []),
      s('Three Vouch Co', [{ name: 'A' }, { name: 'B' }, { name: 'C' }]),
      s('Undefined Vouch Co', undefined),
    ];
    render(<MostVouched startups={startups} />);

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Three Vouch Co');
    expect(items[0]).toHaveTextContent('3');
    expect(items[1]).toHaveTextContent('One Vouch Co');
    expect(items[1]).toHaveTextContent('1');
    expect(screen.queryByText('No Vouch Co')).not.toBeInTheDocument();
    expect(screen.queryByText('Undefined Vouch Co')).not.toBeInTheDocument();
  });

  it('renders nothing when no startup has any vouches (the current real-data state)', () => {
    const { container } = render(<MostVouched startups={[s('A', []), s('B', undefined)]} />);
    expect(container.firstChild).toBeNull();
  });
});
