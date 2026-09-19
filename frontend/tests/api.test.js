import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchStartups, fetchMeta, fetchNews, submitStartup, submitEdit, submitFeedback } from '../src/api.js';

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
