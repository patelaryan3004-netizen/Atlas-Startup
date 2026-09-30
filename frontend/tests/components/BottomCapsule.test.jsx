import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BottomCapsule from '../../src/components/BottomCapsule.jsx';

describe('BottomCapsule', () => {
  it('shows the pinned count and label', () => {
    render(<BottomCapsule pinnedCount={42} hiringCount={0} onShowList={() => {}} />);
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('pinned', { exact: false })).toBeInTheDocument();
  });

  it('shows the hiring count when there is at least one hiring company', () => {
    render(<BottomCapsule pinnedCount={42} hiringCount={7} onShowList={() => {}} />);
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('hiring', { exact: false })).toBeInTheDocument();
  });

  it('omits the hiring segment entirely when nothing is hiring', () => {
    render(<BottomCapsule pinnedCount={42} hiringCount={0} onShowList={() => {}} />);
    expect(screen.queryByText('hiring', { exact: false })).not.toBeInTheDocument();
  });

  it('calls onShowList when the button is clicked', async () => {
    const onShowList = vi.fn();
    render(<BottomCapsule pinnedCount={0} hiringCount={0} onShowList={onShowList} />);
    await userEvent.click(screen.getByText('Show list ↑'));
    expect(onShowList).toHaveBeenCalledTimes(1);
  });
});
