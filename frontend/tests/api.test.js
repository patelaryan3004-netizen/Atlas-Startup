import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchStartups, fetchMeta, fetchNews, submitStartup, submitEdit, submitFeedback,
  fetchStartupPage, fetchMarkers, fetchSummary, fetchCount, fetchStartup, fetchStartupsByName, fetchSuggestions, fetchPerson,
} from '../src/api.js';

function mockFetchOnce(body, ok = true) {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    json: () => Promise.resolve(body),
  });
}

describe('api.js', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetchStartups calls /api/startups with no query string when filters are empty', async () => {
    mockFetchOnce({ total: 0, count: 0, results: [] });
    await fetchStartups({});
    expect(global.fetch).toHaveBeenCalledWith('/api/startups');
  });

  it('fetchStartups omits falsy filter values and includes truthy ones', async () => {
    mockFetchOnce({ total: 0, count: 0, results: [] });
    await fetchStartups({ search: 'canva', sector: '', hiring: 'yes' });
    const url = global.fetch.mock.calls[0][0];
    expect(url).toContain('search=canva');
    expect(url).toContain('hiring=yes');
    expect(url).not.toContain('sector=');
  });

  it('fetchStartups throws when the response is not ok', async () => {
    mockFetchOnce({}, false);
    await expect(fetchStartups({})).rejects.toThrow('Failed to fetch startups');
  });

  it('fetchMeta calls /api/startups/meta and returns the parsed body', async () => {
    mockFetchOnce({ sectors: ['AI'], cities: [], investors: [], stages: [] });
    const meta = await fetchMeta();
    expect(global.fetch).toHaveBeenCalledWith('/api/startups/meta');
    expect(meta.sectors).toEqual(['AI']);
  });

  it('fetchMeta throws when the response is not ok', async () => {
    mockFetchOnce({}, false);
    await expect(fetchMeta()).rejects.toThrow('Failed to fetch filter metadata');
  });

  it('fetchNews calls /api/news and returns the parsed body', async () => {
    mockFetchOnce({ source: 'live', deals: [] });
    const news = await fetchNews();
    expect(global.fetch).toHaveBeenCalledWith('/api/news');
    expect(news.source).toBe('live');
  });

  it('fetchNews throws when the response is not ok', async () => {
    mockFetchOnce({}, false);
    await expect(fetchNews()).rejects.toThrow('Failed to fetch news');
  });

  it('fetchNews(true) requests a forced refresh, bypassing the server cache', async () => {
    mockFetchOnce({ source: 'live', deals: [] });
    await fetchNews(true);
    expect(global.fetch).toHaveBeenCalledWith('/api/news?refresh=1');
  });

  it('submitStartup POSTs JSON to /api/submissions and returns the created record', async () => {
    mockFetchOnce({ id: '1', name: 'Acme', status: 'pending' });
    const result = await submitStartup({ name: 'Acme', description: 'Does things' });

    expect(global.fetch).toHaveBeenCalledWith('/api/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Acme', description: 'Does things' }),
    });
    expect(result).toEqual({ id: '1', name: 'Acme', status: 'pending' });
  });

  it('submitStartup throws the server-provided error message when the response is not ok', async () => {
    mockFetchOnce({ error: 'name and description are required' }, false);
    await expect(submitStartup({})).rejects.toThrow('name and description are required');
  });

  it('submitStartup falls back to a generic error when none is provided', async () => {
    mockFetchOnce({}, false);
    await expect(submitStartup({})).rejects.toThrow('Failed to submit startup');
  });

  it('submitEdit POSTs JSON to /api/edits and returns the created record', async () => {
    mockFetchOnce({ id: '1', company: 'Canva', status: 'pending' });
    const result = await submitEdit({ company: 'Canva', message: 'Wrong logo' });

    expect(global.fetch).toHaveBeenCalledWith('/api/edits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company: 'Canva', message: 'Wrong logo' }),
    });
    expect(result).toEqual({ id: '1', company: 'Canva', status: 'pending' });
  });

  it('submitEdit throws the server-provided error message when the response is not ok', async () => {
    mockFetchOnce({ error: 'company and message are required' }, false);
    await expect(submitEdit({})).rejects.toThrow('company and message are required');
  });

  it('submitFeedback POSTs JSON to /api/feedback and returns the created record', async () => {
    mockFetchOnce({ id: '1', type: 'bug', status: 'pending' });
    const result = await submitFeedback({ type: 'bug', message: 'Map is blank on load' });

    expect(global.fetch).toHaveBeenCalledWith('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'bug', message: 'Map is blank on load' }),
    });
    expect(result).toEqual({ id: '1', type: 'bug', status: 'pending' });
  });

  it('submitFeedback throws the server-provided error message when the response is not ok', async () => {
    mockFetchOnce({ error: 'message is required' }, false);
    await expect(submitFeedback({})).rejects.toThrow('message is required');
  });
});

// The calls that let the page hold what it shows instead of every company.
describe('api.js, asking for only what is needed', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  const urlOf = () => new URL(global.fetch.mock.calls[0][0], 'http://x');

  it('fetchStartupPage asks for one page of cards, in an order, with the filters that are set and none that are not', async () => {
    mockFetchOnce({ total: 9, count: 9, results: [], offset: 48, limit: 48, hasMore: false });
    await fetchStartupPage({ search: 'cob', sector: '', hiring: 'yes' }, { limit: 24, offset: 48, sort: 'hiring', facets: 'sector,city' });
    const q = urlOf().searchParams;
    expect(urlOf().pathname).toBe('/api/startups');
    expect(Object.fromEntries(q)).toEqual({ search: 'cob', hiring: 'yes', limit: '24', offset: '48', sort: 'hiring', view: 'card', facets: 'sector,city' });
  });

  it('fetchStartupPage defaults to the first 48 by name, and hands the abort signal to fetch', async () => {
    mockFetchOnce({ results: [] });
    const ctrl = new AbortController();
    await fetchStartupPage({}, { signal: ctrl.signal });
    expect(Object.fromEntries(urlOf().searchParams)).toEqual({ limit: '48', offset: '0', sort: 'name', view: 'card' });
    expect(global.fetch.mock.calls[0][1]).toEqual({ signal: ctrl.signal });
  });

  it('fetchStartupPage throws when the response is not ok', async () => {
    mockFetchOnce({}, false);
    await expect(fetchStartupPage({})).rejects.toThrow('Failed to fetch startups');
  });

  it('fetchMarkers, fetchSummary and fetchCount send the same filters to their own addresses', async () => {
    for (const [call, path, failure] of [[fetchMarkers, '/api/startups/markers', 'map pins'], [fetchSummary, '/api/startups/summary', 'counts'], [fetchCount, '/api/startups/count', 'a count']]) {
      mockFetchOnce({ ok: true });
      expect(await call({ city: 'Sydney', hiring: '' })).toEqual({ ok: true });
      expect(urlOf().pathname).toBe(path);
      expect(Object.fromEntries(urlOf().searchParams)).toEqual({ city: 'Sydney' });
      mockFetchOnce({}, false);
      await expect(call({})).rejects.toThrow(failure);
    }
  });

  it('fetchStartup asks for one company by slug, encoding it, and says so when it fails', async () => {
    mockFetchOnce({ name: 'Canva' });
    await fetchStartup('a b/c');
    expect(global.fetch.mock.calls[0][0]).toBe('/api/startups/a%20b%2Fc');
    mockFetchOnce({}, false);
    await expect(fetchStartup('x')).rejects.toThrow('Failed to fetch the company');
  });

  it('fetchStartupsByName repeats name for each, up to 200, as cards', async () => {
    mockFetchOnce({ results: [] });
    await fetchStartupsByName(['Canva', 'Hone (HoneAg)']);
    expect(urlOf().searchParams.getAll('name')).toEqual(['Canva', 'Hone (HoneAg)']);
    expect(Object.fromEntries(urlOf().searchParams)).toMatchObject({ limit: '200', view: 'card' });
    mockFetchOnce({ results: [] });
    await fetchStartupsByName(Array.from({ length: 250 }, (_, i) => `Co ${i}`));
    expect(urlOf().searchParams.getAll('name')).toHaveLength(200);
  });

  it('fetchSuggestions and fetchPerson encode what the visitor typed', async () => {
    mockFetchOnce({ companies: [] });
    await fetchSuggestions('a&b c');
    expect(urlOf().pathname).toBe('/api/search');
    expect(urlOf().searchParams.get('q')).toBe('a&b c');
    mockFetchOnce({ name: 'Ava Smith', companies: [] });
    await fetchPerson('Ava O\'Neil/Smith');
    expect(global.fetch.mock.calls[0][0]).toBe(`/api/people/${encodeURIComponent('Ava O\'Neil/Smith')}`);
    mockFetchOnce({}, false);
    await expect(fetchPerson('x')).rejects.toThrow('Failed to fetch the person');
    mockFetchOnce({}, false);
    await expect(fetchSuggestions('x')).rejects.toThrow('Failed to search');
  });
});
