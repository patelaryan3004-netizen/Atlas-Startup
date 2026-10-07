import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../src/api.js', () => ({ fetchStartupPage: vi.fn() }));

import { fetchStartupPage } from '../../src/api.js';
import ListView from '../../src/components/ListView.jsx';

function startup(overrides = {}) {
  return {
    name: 'Canva',
    slug: 'canva',
    sector: 'SaaS',
    sectorFull: 'SaaS / Design Tech',
    city: 'Sydney',
    stage: 'Series D+',
    hiring: true,
    verified: true,
    website: 'https://www.canva.com',
    blurb: 'Online graphic design platform for everyone',
    taskGate: { enabled: false },
    ...overrides,
  };
}
const page = (results, extra = {}) => ({ total: 500, count: results.length, results, offset: 0, limit: 48, hasMore: false, ...extra });
const noop = () => {};
const FILTERS = { search: '', sector: '', city: '', investor: '', stage: '', hiring: '', taskGate: '' };
const mount = (props = {}) => render(<ListView filters={FILTERS} sectorColors={{}} onSelectStartup={noop} {...props} />);

describe('ListView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchStartupPage.mockResolvedValue(page([startup()]));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('asks the server for the first page of the current filters, in name order, and shows how many there are', async () => {
    fetchStartupPage.mockResolvedValue(page([startup(), startup({ name: 'Airwallex', slug: 'airwallex' })], { count: 2 }));
    mount();
    expect(await screen.findByText('2 startups')).toBeInTheDocument();
    expect(fetchStartupPage).toHaveBeenCalledWith(FILTERS, expect.objectContaining({ limit: 48, offset: 0, sort: 'name' }));
  });

  it('says what the list is narrowed to when a group on the map was opened as a list, and widens it again on request', async () => {
    const onClearScope = vi.fn();
    mount({ filters: { ...FILTERS, city: 'Sydney', precision: 'CITY' }, scope: 'City-level locations in Sydney', onClearScope });
    expect(await screen.findByText('City-level locations in Sydney')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Show every location'));
    expect(onClearScope).toHaveBeenCalledTimes(1);
    expect(fetchStartupPage).toHaveBeenCalledWith(expect.objectContaining({ city: 'Sydney', precision: 'CITY' }), expect.anything());
  });

  it('says nothing about scope when the list is not narrowed that way', async () => {
    mount();
    await screen.findByText('1 startup');
    expect(screen.queryByText('Show every location')).not.toBeInTheDocument();
  });

  it('shows the count of everything that matches, not just the page on screen', async () => {
    fetchStartupPage.mockResolvedValue(page([startup()], { count: 1234, hasMore: true }));
    mount();
    expect(await screen.findByText('1234 startups')).toBeInTheDocument();
  });

  it('says it is loading, then shows an honest empty state when nothing matches', async () => {
    fetchStartupPage.mockResolvedValue(page([], { count: 0 }));
    mount();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(await screen.findByText('No startups match your filters.')).toBeInTheDocument();
    expect(screen.getByText('0 startups')).toBeInTheDocument();
  });

  it('says so when the list could not be loaded', async () => {
    fetchStartupPage.mockRejectedValue(new Error('down'));
    mount();
    expect(await screen.findByText('Could not load the list right now.')).toBeInTheDocument();
  });

  it('shows the core card fields: name, industry, location, stage, description', async () => {
    mount();
    expect(await screen.findByText('Canva')).toBeInTheDocument();
    expect(screen.getByText('SaaS / Design Tech · Sydney · Series D+')).toBeInTheDocument();
    expect(screen.getByText('Online graphic design platform for everyone')).toBeInTheDocument();
  });

  it('shows a hiring badge when hiring, a not-hiring badge otherwise', async () => {
    const { unmount } = mount();
    expect(await screen.findByText('● Hiring now')).toBeInTheDocument();
    unmount();

    fetchStartupPage.mockResolvedValue(page([startup({ hiring: false })]));
    mount();
    expect(await screen.findByText('Not hiring')).toBeInTheDocument();
  });

  it('shows a task-gate tag only when the task gate is enabled', async () => {
    fetchStartupPage.mockResolvedValue(page([startup({ taskGate: { enabled: true } })]));
    const { unmount } = mount();
    expect(await screen.findByText('TASK-GATE')).toBeInTheDocument();
    unmount();

    fetchStartupPage.mockResolvedValue(page([startup({ taskGate: { enabled: false } })]));
    mount();
    await screen.findByText('Canva');
    expect(screen.queryByText('TASK-GATE')).not.toBeInTheDocument();
  });

  it('shows an unverified tag only for unverified startups', async () => {
    fetchStartupPage.mockResolvedValue(page([startup({ verified: false })]));
    mount();
    expect(await screen.findByText('Unverified')).toBeInTheDocument();
  });

  it('shows a tracked star only for tracked startups', async () => {
    const { unmount } = mount({ trackedNames: new Set(['Canva']) });
    expect(await screen.findByTitle('Tracked')).toBeInTheDocument();
    unmount();

    mount({ trackedNames: new Set() });
    await screen.findByText('Canva');
    expect(screen.queryByTitle('Tracked')).not.toBeInTheDocument();
  });

  it('calls onSelectStartup with the card when it is clicked', async () => {
    const onSelectStartup = vi.fn();
    const c = startup();
    fetchStartupPage.mockResolvedValue(page([c]));
    mount({ onSelectStartup });
    await userEvent.click(await screen.findByText('Canva'));
    expect(onSelectStartup).toHaveBeenCalledWith(c);
  });

  it('keeps the order the server gave, and asks again, in the new order, when another is chosen, offering only sorts with real data behind them', async () => {
    mount();
    await screen.findByText('Canva');
    const select = screen.getByLabelText('Sort by');
    expect([...select.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['Name (A–Z)', 'Hiring now', 'Location (A–Z)', 'Industry (A–Z)']);

    fetchStartupPage.mockResolvedValue(page([startup({ name: 'Zeller', slug: 'zeller' }), startup({ name: 'Airwallex', slug: 'airwallex' })], { count: 2 }));
    await userEvent.selectOptions(select, 'hiring');
    await waitFor(() => expect(fetchStartupPage).toHaveBeenLastCalledWith(FILTERS, expect.objectContaining({ sort: 'hiring', offset: 0 })));
    await waitFor(() => expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Zeller', 'Airwallex']));
  });

  it('starts again from the first page when the filters change, replacing the list', async () => {
    const { rerender } = mount();
    await screen.findByText('Canva');
    const next = { ...FILTERS, city: 'Perth' };
    fetchStartupPage.mockResolvedValue(page([startup({ name: 'Mindset', slug: 'mindset', city: 'Perth' })], { count: 1 }));
    rerender(<ListView filters={next} sectorColors={{}} onSelectStartup={noop} />);
    expect(await screen.findByText('Mindset')).toBeInTheDocument();
    expect(screen.queryByText('Canva')).not.toBeInTheDocument();
    expect(fetchStartupPage).toHaveBeenLastCalledWith(next, expect.objectContaining({ offset: 0 }));
  });

  it('drops an answer to a question that has since changed', async () => {
    let resolveFirst;
    fetchStartupPage.mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }));
    const { rerender } = mount();
    const next = { ...FILTERS, city: 'Perth' };
    fetchStartupPage.mockResolvedValueOnce(page([startup({ name: 'Mindset', slug: 'mindset' })], { count: 1 }));
    rerender(<ListView filters={next} sectorColors={{}} onSelectStartup={noop} />);
    expect(await screen.findByText('Mindset')).toBeInTheDocument();
    await act(async () => { resolveFirst(page([startup({ name: 'Stale', slug: 'stale' })])); });
    expect(screen.queryByText('Stale')).not.toBeInTheDocument();
    expect(screen.getByText('Mindset')).toBeInTheDocument();
  });

  describe('a long list', () => {
    const many = (from, n) => Array.from({ length: n }, (_, i) => startup({ name: `Co ${from + i}`, slug: `co-${from + i}` }));

    it('shows "Show more" with how many are left, and adds the next page under the first when it is pressed', async () => {
      fetchStartupPage.mockResolvedValueOnce(page(many(0, 48), { count: 120, hasMore: true }));
      mount();
      const more = await screen.findByRole('button', { name: 'Show more (72 left)' });
      expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(48);

      fetchStartupPage.mockResolvedValueOnce(page(many(48, 48), { count: 120, hasMore: true, offset: 48 }));
      await userEvent.click(more);
      await waitFor(() => expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(96));
      expect(fetchStartupPage).toHaveBeenLastCalledWith(FILTERS, expect.objectContaining({ offset: 48, limit: 48, sort: 'name' }));
      expect(screen.getByRole('button', { name: 'Show more (24 left)' })).toBeInTheDocument();

      fetchStartupPage.mockResolvedValueOnce(page(many(96, 24), { count: 120, hasMore: false, offset: 96 }));
      await userEvent.click(screen.getByRole('button', { name: 'Show more (24 left)' }));
      await waitFor(() => expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(120));
      expect(screen.queryByRole('button', { name: /Show more/ })).not.toBeInTheDocument();
    });

    it('says so, and lets the visitor try again, when the next page cannot be loaded', async () => {
      fetchStartupPage.mockResolvedValueOnce(page(many(0, 48), { count: 120, hasMore: true }));
      mount();
      fetchStartupPage.mockRejectedValueOnce(new Error('down'));
      await userEvent.click(await screen.findByRole('button', { name: /Show more/ }));
      const retry = await screen.findByRole('button', { name: 'Could not load more: try again' });
      expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(48);
      fetchStartupPage.mockResolvedValueOnce(page(many(48, 72), { count: 120, hasMore: false, offset: 48 }));
      await userEvent.click(retry);
      await waitFor(() => expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(120));
    });

    it('loads the next page by itself when the end of the list nears the screen', async () => {
      let notify;
      const disconnect = vi.fn();
      vi.stubGlobal('IntersectionObserver', class { constructor(cb) { notify = cb; } observe() {} disconnect() { disconnect(); } });
      fetchStartupPage.mockResolvedValueOnce(page(many(0, 48), { count: 96, hasMore: true }));
      mount();
      await screen.findByRole('button', { name: /Show more/ });
      await waitFor(() => expect(notify).toBeDefined());
      fetchStartupPage.mockResolvedValueOnce(page(many(48, 48), { count: 96, hasMore: false, offset: 48 }));
      await act(async () => { notify([{ isIntersecting: false }]); });
      expect(fetchStartupPage).toHaveBeenCalledTimes(1); // nothing yet: the end is far off
      await act(async () => { notify([{ isIntersecting: true }]); });
      await waitFor(() => expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(96));
      expect(disconnect).toHaveBeenCalled();
    });

    it('does not ask for the same page twice when the end is reported twice at once', async () => {
      let notify;
      vi.stubGlobal('IntersectionObserver', class { constructor(cb) { notify = cb; } observe() {} disconnect() {} });
      fetchStartupPage.mockResolvedValueOnce(page(many(0, 48), { count: 96, hasMore: true }));
      mount();
      await screen.findByRole('button', { name: /Show more/ });
      let release;
      fetchStartupPage.mockImplementationOnce(() => new Promise((r) => { release = r; }));
      await act(async () => { notify([{ isIntersecting: true }]); notify([{ isIntersecting: true }]); });
      expect(fetchStartupPage).toHaveBeenCalledTimes(2); // the first page, and one more
      await act(async () => { release(page(many(48, 48), { count: 96, hasMore: false, offset: 48 })); });
      await waitFor(() => expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(96));
    });
  });
});
