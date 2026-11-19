import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('../src/api.js', () => ({ fetchSummary: vi.fn() }));
vi.mock('../src/peek.js', () => ({ peek: { summary: vi.fn(() => null) } }));

import { fetchSummary } from '../src/api.js';
import { peek } from '../src/peek.js';
import { useSectorOptions } from '../src/sectorOptions.js';

// The sectors every sector menu (the map's, Discover's, the filter panel's) offers: the display sectors that have a result for the city and the type of organisation chosen.
const ALL = [{ value: 'AI & Data', count: 40 }, { value: 'Fintech', count: 99 }];
const MELBOURNE = [{ value: 'Fintech', count: 12 }];

describe('the sectors a menu offers', () => {
  beforeEach(() => { fetchSummary.mockReset(); peek.summary.mockReset(); peek.summary.mockReturnValue(null); });

  it('is what the page already knows, with no request, while no city and no type of organisation is chosen', () => {
    const { result } = renderHook(() => useSectorOptions({ city: '', orgType: '', onMap: 'yes' }, ALL));
    expect(result.current).toBe(ALL);
    expect(fetchSummary).not.toHaveBeenCalled();
  });

  it('asks the server for the city and the type only (never the sector, the search or the stage, or the menu would shrink to what is chosen) and offers what comes back', async () => {
    fetchSummary.mockResolvedValue({ sectors: MELBOURNE });
    const { result } = renderHook(() => useSectorOptions({ city: 'Melbourne', orgType: 'startup', onMap: 'yes' }, ALL));
    expect(result.current).toBe(ALL); // until the answer is in, what the page has
    await waitFor(() => expect(result.current).toEqual(MELBOURNE));
    expect(fetchSummary).toHaveBeenCalledWith({ city: 'Melbourne', orgType: 'startup', onMap: 'yes' }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(fetchSummary).toHaveBeenCalledTimes(1);
  });

  it('draws from the snapshot at once when it holds the answer, and the server\'s answer replaces it', async () => {
    peek.summary.mockReturnValue({ sectors: MELBOURNE });
    fetchSummary.mockResolvedValue({ sectors: [{ value: 'Fintech', count: 13 }] });
    const { result } = renderHook(() => useSectorOptions({ city: 'Melbourne' }, ALL));
    expect(result.current).toEqual(MELBOURNE);
    await waitFor(() => expect(result.current).toEqual([{ value: 'Fintech', count: 13 }]));
  });

  it('asks again when the city changes, and keeps what it had when the server cannot answer', async () => {
    fetchSummary.mockResolvedValueOnce({ sectors: MELBOURNE }).mockRejectedValueOnce(new Error('down'));
    const { result, rerender } = renderHook(({ city }) => useSectorOptions({ city }, ALL), { initialProps: { city: 'Melbourne' } });
    await waitFor(() => expect(result.current).toEqual(MELBOURNE));
    rerender({ city: 'Perth' });
    await waitFor(() => expect(fetchSummary).toHaveBeenCalledTimes(2));
    expect(fetchSummary).toHaveBeenLastCalledWith({ city: 'Perth' }, expect.anything());
    expect(result.current).toEqual(MELBOURNE); // (no flicker to nothing)
  });

  it('goes back to what the page knows when the city is cleared', async () => {
    fetchSummary.mockResolvedValue({ sectors: MELBOURNE });
    const { result, rerender } = renderHook(({ city }) => useSectorOptions({ city }, ALL), { initialProps: { city: 'Melbourne' } });
    await waitFor(() => expect(result.current).toEqual(MELBOURNE));
    rerender({ city: '' });
    expect(result.current).toBe(ALL);
  });

  it('falls back to what the page knows when an older server does not send the sectors', async () => {
    fetchSummary.mockResolvedValue({ count: 5 });
    const { result } = renderHook(() => useSectorOptions({ city: 'Melbourne' }, ALL));
    await waitFor(() => expect(fetchSummary).toHaveBeenCalled());
    expect(result.current).toBe(ALL);
  });
});
