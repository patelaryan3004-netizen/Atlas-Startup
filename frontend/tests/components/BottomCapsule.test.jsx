import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BottomCapsule from '../../src/components/BottomCapsule.jsx';

describe('BottomCapsule', () => {
  it('shows the count folded into a single list-toggle control', () => {
    render(<BottomCapsule pinnedCount={42} onShowList={() => {}} />);
    expect(screen.getByText('42', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Show list', { exact: false })).toBeInTheDocument();
  });

  it('calls onShowList when clicked', async () => {
    const onShowList = vi.fn();
    render(<BottomCapsule pinnedCount={0} onShowList={onShowList} />);
    await userEvent.click(screen.getByText('Show list', { exact: false }));
    expect(onShowList).toHaveBeenCalledTimes(1);
  });
});
