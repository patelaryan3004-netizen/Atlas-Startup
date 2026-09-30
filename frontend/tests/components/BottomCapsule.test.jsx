import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BottomCapsule from '../../src/components/BottomCapsule.jsx';

describe('BottomCapsule', () => {
  it('shows Map and List tabs, with the count folded into the List tab', () => {
    render(<BottomCapsule pinnedCount={42} viewMode="map" onSetViewMode={() => {}} />);
    expect(screen.getByText('Map')).toBeInTheDocument();
    expect(screen.getByText('List', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('(42)')).toBeInTheDocument();
  });

  it('marks the active view mode', () => {
    render(<BottomCapsule pinnedCount={0} viewMode="list" onSetViewMode={() => {}} />);
    expect(screen.getByText('Map')).not.toHaveClass('bc-tab-active');
    expect(screen.getByText('List', { exact: false })).toHaveClass('bc-tab-active');
  });

  it('calls onSetViewMode with "list" when the List tab is clicked', async () => {
    const onSetViewMode = vi.fn();
    render(<BottomCapsule pinnedCount={0} viewMode="map" onSetViewMode={onSetViewMode} />);
    await userEvent.click(screen.getByText('List', { exact: false }));
    expect(onSetViewMode).toHaveBeenCalledWith('list');
  });

  it('calls onSetViewMode with "map" when the Map tab is clicked', async () => {
    const onSetViewMode = vi.fn();
    render(<BottomCapsule pinnedCount={0} viewMode="list" onSetViewMode={onSetViewMode} />);
    await userEvent.click(screen.getByText('Map'));
    expect(onSetViewMode).toHaveBeenCalledWith('map');
  });
});
