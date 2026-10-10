import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchStartups, fetchMeta, fetchNews, submitStartup, submitEdit, submitFeedback,
  fetchStartupPage, fetchMarkers, fetchSummary, fetchCount, fetchStartup, fetchStartupsByName, fetchSuggestions, fetchPerson,
  fetchInvestors, fetchInvestorMeta, fetchInvestor, fetchInvestorPerson, fetchInvestorsByName, submitInvestorCorrection,
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

// The investor directory's calls.
describe('api.js, the investor directory', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  const urlOf = () => new URL(global.fetch.mock.calls[0][0], 'http://x');

  it('fetchInvestors asks for one page, alphabetical by default, with the filters that are set and none that are not', async () => {
    mockFetchOnce({ total: 5, count: 5, results: [], offset: 0, limit: 24, hasMore: false });
    await fetchInvestors({ type: 'angel_network', stage: '', chequeMin: '100000' });
    expect(urlOf().pathname).toBe('/api/investors');
    expect(Object.fromEntries(urlOf().searchParams)).toEqual({ type: 'angel_network', chequeMin: '100000', limit: '24', offset: '0', sort: 'name' });
  });

  it('fetchInvestors takes a page size, an offset, facets and an abort signal', async () => {
    mockFetchOnce({ results: [] });
    const ctrl = new AbortController();
    await fetchInvestors({}, { limit: 10, offset: 20, facets: 'type,stage', signal: ctrl.signal });
    expect(Object.fromEntries(urlOf().searchParams)).toEqual({ limit: '10', offset: '20', sort: 'name', facets: 'type,stage' });
    expect(global.fetch.mock.calls[0][1]).toEqual({ signal: ctrl.signal });
  });

  it('fetchInvestorsByName repeats name for each, up to 100, and asks for them all', async () => {
    mockFetchOnce({ results: [] });
    await fetchInvestorsByName(['Blackbird Ventures', 'Smith, Jones & Co']);
    expect(urlOf().searchParams.getAll('name')).toEqual(['Blackbird Ventures', 'Smith, Jones & Co']);
    expect(urlOf().searchParams.get('limit')).toBe('100');
    mockFetchOnce({ results: [] });
    await fetchInvestorsByName(Array.from({ length: 150 }, (_, i) => `Fund ${i}`));
    expect(urlOf().searchParams.getAll('name')).toHaveLength(100);
  });

  it('fetchInvestorMeta, fetchInvestor and fetchInvestorPerson ask their own addresses, encode the slug, and say what failed', async () => {
    mockFetchOnce({ total: 2 });
    expect(await fetchInvestorMeta()).toEqual({ total: 2 });
    expect(global.fetch.mock.calls[0][0]).toBe('/api/investors/meta');
    mockFetchOnce({ name: 'Blackbird' });
    await fetchInvestor('a b/c');
    expect(global.fetch.mock.calls[0][0]).toBe('/api/investors/a%20b%2Fc');
    mockFetchOnce({ name: 'Sam' });
    await fetchInvestorPerson('sam');
    expect(global.fetch.mock.calls[0][0]).toBe('/api/investor-people/sam');
    mockFetchOnce({}, false);
    await expect(fetchInvestorMeta()).rejects.toThrow('Failed to fetch the investor filters');
    mockFetchOnce({}, false);
    await expect(fetchInvestor('x')).rejects.toThrow('Failed to fetch the investor');
    mockFetchOnce({}, false);
    await expect(fetchInvestorPerson('x')).rejects.toThrow('Failed to fetch the person');
  });

  it('carries the status of a refused request, so a page that is not there is told from a server that is down', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404, json: () => Promise.resolve({}) });
    await expect(fetchInvestor('nobody')).rejects.toMatchObject({ status: 404 });
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503, json: () => Promise.resolve({}) });
    await expect(fetchInvestor('nobody')).rejects.toMatchObject({ status: 503 });
  });

  it('submitInvestorCorrection POSTs the suggestion to that investor, and shows the server\'s reason when it is refused', async () => {
    mockFetchOnce({ id: '1', status: 'pending' });
    expect(await submitInvestorCorrection('a b', { message: 'Wrong.', source_url: '', email: '' })).toEqual({ id: '1', status: 'pending' });
    expect(global.fetch).toHaveBeenCalledWith('/api/investors/a%20b/corrections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Wrong.', source_url: '', email: '' }),
    });
    mockFetchOnce({ error: 'message is required: say what is wrong' }, false);
    await expect(submitInvestorCorrection('x', {})).rejects.toThrow('message is required: say what is wrong');
    global.fetch = vi.fn().mockResolvedValue({ ok: false, json: () => Promise.reject(new Error('not json')) });
    await expect(submitInvestorCorrection('x', {})).rejects.toThrow('Failed to send the correction');
  });
});
