import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BottomCapsule from '../../src/components/BottomCapsule.jsx';

describe('BottomCapsule', () => {
  it('shows the pinned count and label', () => {
    render(<BottomCapsule pinnedCount={42} onShowList={() => {}} />);
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('startups pinned on map')).toBeInTheDocument();
  });

  it('calls onShowList when the button is clicked', async () => {
    const onShowList = vi.fn();
    render(<BottomCapsule pinnedCount={0} onShowList={onShowList} />);
    await userEvent.click(screen.getByText('Show list ↑'));
    expect(onShowList).toHaveBeenCalledTimes(1);
  });
});
