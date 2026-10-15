import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSavedInvestors } from '../../src/hooks/useSavedInvestors.js';

describe('useSavedInvestors', () => {
  beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

  it('starts with none saved when nothing is kept', () => {
    const { result } = renderHook(() => useSavedInvestors());
    expect(result.current.saved).toEqual([]);
    expect(result.current.isSaved('blackbird')).toBe(false);
  });

  it('saves and unsaves an investor by its address, keeping them in this browser in the order saved', () => {
    const { result } = renderHook(() => useSavedInvestors());
    act(() => result.current.toggle('blackbird'));
    act(() => result.current.toggle('airtree'));
    expect(result.current.saved).toEqual(['blackbird', 'airtree']);
    expect(result.current.isSaved('airtree')).toBe(true);
    expect(JSON.parse(localStorage.getItem('auStartupSavedInvestors'))).toEqual(['blackbird', 'airtree']);
    act(() => result.current.toggle('blackbird'));
    expect(result.current.saved).toEqual(['airtree']);
    expect(JSON.parse(localStorage.getItem('auStartupSavedInvestors'))).toEqual(['airtree']);
  });

  it('finds what was saved on an earlier visit, and ignores anything in that place that is not a list of addresses', () => {
    localStorage.setItem('auStartupSavedInvestors', JSON.stringify(['a', 'a', '', 7, null, 'b']));
    expect(renderHook(() => useSavedInvestors()).result.current.saved).toEqual(['a', 'b']);
    localStorage.setItem('auStartupSavedInvestors', '{"not":"a list"}');
    expect(renderHook(() => useSavedInvestors()).result.current.saved).toEqual([]);
    localStorage.setItem('auStartupSavedInvestors', 'not json');
    expect(renderHook(() => useSavedInvestors()).result.current.saved).toEqual([]);
  });

  it('still saves for the visit when the browser will not keep anything', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    const { result } = renderHook(() => useSavedInvestors());
    act(() => result.current.toggle('blackbird'));
    expect(result.current.isSaved('blackbird')).toBe(true);
  });
});
