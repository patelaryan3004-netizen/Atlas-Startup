import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEscapeClose } from '../../src/hooks/useEscapeClose.js';

describe('useEscapeClose', () => {
  it('calls onClose when Escape is pressed', async () => {
    const onClose = vi.fn();
    renderHook(() => useEscapeClose(onClose));

    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose for other keys', async () => {
    const onClose = vi.fn();
    renderHook(() => useEscapeClose(onClose));

    await userEvent.keyboard('{Enter}');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('removes its listener on unmount, so a stale instance cannot fire', async () => {
    const onClose = vi.fn();
    const { unmount } = renderHook(() => useEscapeClose(onClose));
    unmount();

    await userEvent.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });
});
