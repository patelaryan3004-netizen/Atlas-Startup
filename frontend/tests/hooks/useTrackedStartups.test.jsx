import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTrackedStartups } from '../../src/hooks/useTrackedStartups.js';

describe('useTrackedStartups', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts empty when nothing is stored', () => {
    const { result } = renderHook(() => useTrackedStartups());
    expect(result.current.tracked.size).toBe(0);
    expect(result.current.isTracked('Canva')).toBe(false);
  });

  it('tracks and untracks a company, persisting to localStorage', () => {
    const { result } = renderHook(() => useTrackedStartups());

    act(() => result.current.toggleTracked('Canva'));
    expect(result.current.isTracked('Canva')).toBe(true);
    expect(JSON.parse(localStorage.getItem('auStartupTracked'))).toEqual(['Canva']);

    act(() => result.current.toggleTracked('Canva'));
    expect(result.current.isTracked('Canva')).toBe(false);
    expect(JSON.parse(localStorage.getItem('auStartupTracked'))).toEqual([]);
  });

  it('tracks multiple companies independently', () => {
    const { result } = renderHook(() => useTrackedStartups());

    act(() => result.current.toggleTracked('Canva'));
    act(() => result.current.toggleTracked('Airwallex'));

    expect(result.current.isTracked('Canva')).toBe(true);
    expect(result.current.isTracked('Airwallex')).toBe(true);
    expect(result.current.tracked.size).toBe(2);
  });

  it('loads previously tracked companies from localStorage on mount', () => {
    localStorage.setItem('auStartupTracked', JSON.stringify(['SafetyCulture']));
    const { result } = renderHook(() => useTrackedStartups());
    expect(result.current.isTracked('SafetyCulture')).toBe(true);
  });

  it('recovers gracefully from corrupted localStorage data', () => {
    localStorage.setItem('auStartupTracked', 'not valid json');
    const { result } = renderHook(() => useTrackedStartups());
    expect(result.current.tracked.size).toBe(0);
  });
});
