import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../src/api.js', () => ({
  fetchStartupPage: vi.fn(),
  // a stand-in with the real one's shape: the filters and the sort in the query
  exportUrl: vi.fn((filters = {}, sort = 'name') => `/api/startups/export.csv?${new URLSearchParams(Object.entries({ ...filters, sort }).filter(([, v]) => v)).toString()}`),
}));

import { fetchStartupPage } from '../../src/api.js';
import ListView from '../../src/components/ListView.jsx';
import { rememberGallery, recallGallery, forgetGallery } from '../../src/gallery.js';

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

  it('asks the server for the first page of the current filters, the companies with a picture first, and shows how many there are', async () => {
    fetchStartupPage.mockResolvedValue(page([startup(), startup({ name: 'Airwallex', slug: 'airwallex' })], { count: 2 }));
    mount();
    expect(await screen.findByText('2 startups')).toBeInTheDocument();
    expect(fetchStartupPage).toHaveBeenCalledWith(FILTERS, expect.objectContaining({ limit: 48, offset: 0, sort: 'pictures' }));
  });

  it('draws each company as one link to its own address, in a list of the companies (the grid is the stylesheet\'s)', async () => {
    fetchStartupPage.mockResolvedValue(page([startup(), startup({ name: 'Airwallex', slug: 'airwallex' })], { count: 2 }));
    mount();
    const list = await screen.findByRole('list', { name: 'Startups' });
    expect(list).toHaveClass('gl-grid');
    const links = within(list).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/startup/canva', '/startup/airwallex']);
    expect(within(links[1]).getByRole('heading', { level: 3, name: 'Airwallex' })).toBeInTheDocument();
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
    expect(await screen.findByText('1,234 startups')).toBeInTheDocument();
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

  it('shows the core card fields: name, one line about it, and Sector · City · Stage', async () => {
    const { container } = mount();
    expect(await screen.findByRole('heading', { name: 'Canva' })).toBeInTheDocument();
    expect(container.querySelector('.gc-meta')).toHaveTextContent('SaaS / Design Tech · Sydney · Series D+');
    expect(screen.getByText('Online graphic design platform for everyone')).toHaveClass('gc-blurb');
  });

  it('leads each card with the company\'s own cover picture, at the size it was made, lazily loaded; with none (or one that fails) its logo on a neutral tile, and it is still listed', async () => {
    fetchStartupPage.mockResolvedValue(page([
      startup({ cover: '/img/covers/canva.webp' }),
      startup({ name: 'Airwallex', slug: 'airwallex', cover: null }),
    ], { count: 2 }));
    const { container } = mount();
    await screen.findByRole('heading', { name: 'Airwallex' });
    const picture = container.querySelector('.gc-img');
    expect(picture).toHaveAttribute('src', '/img/covers/canva.webp');
    expect(picture).toHaveAttribute('loading', 'lazy');
    expect(picture).toHaveAttribute('width', '720');
    expect(picture).toHaveAttribute('height', '405');
    expect(picture).toHaveAttribute('alt', '');
    // the one without a cover: its logo tile, drawn from its letter until the logo arrives
    const tiles = container.querySelectorAll('.gc-fallback');
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toHaveTextContent('A');
    // a cover that cannot be loaded falls back the same way, and the company stays
    fireEvent.error(picture);
    await waitFor(() => expect(container.querySelectorAll('.gc-fallback')).toHaveLength(2));
    expect(screen.getByRole('heading', { name: 'Canva' })).toBeInTheDocument();
  });

  it('opens the company over the gallery on a plain press, and leaves a press meant for a new tab to the browser', async () => {
    const onSelectStartup = vi.fn();
    mount({ onSelectStartup });
    const link = await screen.findByRole('link', { name: /Canva/ });
    await userEvent.click(link);
    expect(onSelectStartup).toHaveBeenCalledTimes(1);
    onSelectStartup.mockClear();
    link.addEventListener('click', (event) => event.preventDefault()); // (jsdom cannot navigate: what matters is that the app did not take the press)
    fireEvent.click(link, { ctrlKey: true });
    fireEvent.click(link, { metaKey: true });
    expect(onSelectStartup).not.toHaveBeenCalled();
  });

  it('marks the open company on the card, for the screen reader as well', async () => {
    mount({ selectedName: 'Canva' });
    expect(await screen.findByRole('link', { name: /Canva/ })).toHaveAttribute('aria-current', 'true');
  });

  it('shows "Hiring now" only for a company a page confirmed lately, and never says "Not hiring" about one nobody has read', async () => {
    const { unmount } = mount();
    expect(await screen.findByText('Hiring now')).toHaveClass('gc-tag');
    unmount();

    fetchStartupPage.mockResolvedValue(page([startup({ hiring: false })]));
    mount();
    await screen.findByRole('heading', { name: 'Canva' });
    expect(screen.queryByText('Hiring now')).not.toBeInTheDocument();
    expect(screen.queryByText('Not hiring')).not.toBeInTheDocument();
  });

  it('says nothing about hiring for roles read earlier or a job board that listed none (those are in the table and the company\'s page), and never "Hiring now"', async () => {
    fetchStartupPage.mockResolvedValue(page([
      startup({ name: 'Superstat', slug: 'superstat', hiring: false, hiringState: 'checked', hiring_checked_at: '2026-10-05T03:59:04.292Z' }),
      startup({ name: 'Shippit', slug: 'shippit', hiring: false, hiringState: 'none', hiring_checked_at: '2026-10-13T04:29:43.000Z' }),
    ]));
    mount();
    await screen.findByRole('heading', { name: 'Superstat' });
    expect(screen.queryByText(/Hiring now|Hiring \(checked/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No open roles/)).not.toBeInTheDocument();
  });

  it('never says "Hiring now" or "Not hiring" for a company flagged as hiring that no page backs', async () => {
    fetchStartupPage.mockResolvedValue(page([startup({ hiring: false, rolesUnverified: true })]));
    mount();
    await screen.findByRole('heading', { name: 'Canva' });
    expect(screen.queryByText('Hiring now')).not.toBeInTheDocument();
    expect(screen.queryByText('Not hiring')).not.toBeInTheDocument();
  });

  it('shows no task-gate tag, even for a company flagged as task-gated', async () => {
    fetchStartupPage.mockResolvedValue(page([startup({ taskGate: { enabled: true, type: 'Coding task' } })]));
    mount();
    await screen.findByText('Canva');
    expect(screen.queryByText(/TASK-GATE/i)).not.toBeInTheDocument();
  });

  it('shows an unverified tag only for unverified startups', async () => {
    fetchStartupPage.mockResolvedValue(page([startup({ verified: false })]));
    mount();
    expect(await screen.findByText('Unverified')).toBeInTheDocument();
  });

  it('shows a tracked star only for tracked startups', async () => {
    const { unmount } = mount({ trackedNames: new Set(['Canva']) });
    expect(await screen.findByTitle('Saved')).toBeInTheDocument();
    unmount();

    mount({ trackedNames: new Set() });
    await screen.findByText('Canva');
    expect(screen.queryByTitle('Saved')).not.toBeInTheDocument();
  });

  it('calls onSelectStartup with the company when its card is pressed', async () => {
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
    expect([...select.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['Pictures first', 'Name', 'Stage (earliest first)', 'Recently verified', 'Hiring first', 'Location (A–Z)', 'Industry (A–Z)']);

    fetchStartupPage.mockResolvedValue(page([startup({ name: 'Zeller', slug: 'zeller' }), startup({ name: 'Airwallex', slug: 'airwallex' })], { count: 2 }));
    await userEvent.selectOptions(select, 'hiring');
    await waitFor(() => expect(fetchStartupPage).toHaveBeenLastCalledWith(FILTERS, expect.objectContaining({ sort: 'hiring', offset: 0 })));
    await waitFor(() => expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Zeller', 'Airwallex']));
  });

  it('asks the server for the stage order and for the most recently verified, which it sorts', async () => {
    mount();
    await screen.findByText('Canva');
    const select = screen.getByLabelText('Sort by');
    for (const sort of ['stage', 'verified']) {
      await userEvent.selectOptions(select, sort);
      await waitFor(() => expect(fetchStartupPage).toHaveBeenLastCalledWith(FILTERS, expect.objectContaining({ sort, offset: 0 })));
    }
  });

  it('shows the chips it is given in a row of their own above the toolbar, and no row when there are none', async () => {
    const view = mount();
    await screen.findByText('Canva');
    expect(document.querySelector('.startup-list-chips')).toBeNull();
    view.rerender(<ListView filters={FILTERS} sectorColors={{}} onSelectStartup={noop} chips={<span>chips here</span>} />);
    expect(document.querySelector('.startup-list-chips')).toHaveTextContent('chips here');
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

  describe('leaving the gallery for the map and coming back', () => {
    const many = (n) => Array.from({ length: n }, (_, i) => startup({ name: `Co ${i}`, slug: `co-${i}` }));
    beforeEach(() => { forgetGallery(); });
    afterEach(() => { forgetGallery(); });

    it('keeps how many were drawn and how far down the page was, for these filters, when it goes', async () => {
      fetchStartupPage.mockResolvedValue(page(many(5), { count: 5 }));
      const { unmount } = mount();
      await screen.findByRole('heading', { name: 'Co 4' });
      unmount();
      expect(recallGallery(FILTERS, 'pictures')).toEqual({ count: 5, scrollY: 0 });
      expect(recallGallery({ ...FILTERS, city: 'Perth' }, 'pictures')).toBeNull();
    });

    it('asks, once, for as many as were drawn, and puts the page back where it was', async () => {
      const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
      rememberGallery(FILTERS, 'pictures', { count: 120, scrollY: 700 });
      fetchStartupPage.mockResolvedValue(page(many(120), { count: 300, hasMore: true, limit: 120 }));
      mount();
      await screen.findByRole('heading', { name: 'Co 119' });
      expect(fetchStartupPage).toHaveBeenCalledWith(FILTERS, expect.objectContaining({ limit: 120, offset: 0, sort: 'pictures' }));
      expect(scrollTo).toHaveBeenCalledWith(0, 700);
      scrollTo.mockRestore();
    });

    it('starts at the top, with one page, for filters it was not left with', async () => {
      const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
      rememberGallery({ ...FILTERS, city: 'Perth' }, 'pictures', { count: 120, scrollY: 700 });
      mount();
      await screen.findByRole('heading', { name: 'Canva' });
      expect(fetchStartupPage).toHaveBeenCalledWith(FILTERS, expect.objectContaining({ limit: 48 }));
      expect(scrollTo).not.toHaveBeenCalled();
      scrollTo.mockRestore();
    });
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
      expect(fetchStartupPage).toHaveBeenLastCalledWith(FILTERS, expect.objectContaining({ offset: 48, limit: 48, sort: 'pictures' }));
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

  describe('the directory bar and what a card says about freshness', () => {
    const ago = (days) => new Date(Date.now() - days * 86400000).toISOString();
    const soon = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

    it('leaves out a field that is empty or "Unknown", and never writes N/A or null', async () => {
      fetchStartupPage.mockResolvedValue(page([startup({ sector: '', sectorFull: '', stage: 'Unknown', city: 'Perth' })]));
      const { container } = mount();
      await screen.findByRole('heading', { name: 'Canva' });
      expect(container.querySelector('.gc-meta')).toHaveTextContent(/^Perth$/);
      expect(container.textContent).not.toMatch(/N\/A|null|undefined|Unknown/);
    });

    it('draws no line for a company with nothing known (no sector, city or stage) and no description, and keeps it in the gallery', async () => {
      fetchStartupPage.mockResolvedValue(page([startup({ sector: '', sectorFull: '', stage: '', city: '', blurb: '' })]));
      const { container } = mount();
      await screen.findByRole('heading', { name: 'Canva' });
      expect(container.querySelector('.gc-meta')).toBeNull();
      expect(container.querySelector('.gc-blurb')).toBeNull();
    });

    it('has a "Seed to Series A" chip: it sets the stage filter to those stages, and switches off again', async () => {
      const onFiltersChange = vi.fn();
      const meta = { sectors: [], cities: [], stages: ['Seed', 'Series A'] };
      const { rerender } = mount({ meta, onFiltersChange });
      await screen.findByText('Canva');
      const chip = screen.getByRole('button', { name: 'Seed to Series A' });
      expect(chip).toHaveAttribute('aria-pressed', 'false');
      await userEvent.click(chip);
      expect(onFiltersChange).toHaveBeenLastCalledWith({ ...FILTERS, stage: 'Seed,Early,Series A' });
      rerender(<ListView filters={{ ...FILTERS, stage: 'Seed,Early,Series A' }} sectorColors={{}} onSelectStartup={noop} meta={meta} onFiltersChange={onFiltersChange} />);
      expect(screen.getByRole('button', { name: 'Seed to Series A' })).toHaveAttribute('aria-pressed', 'true');
      await userEvent.click(screen.getByRole('button', { name: 'Seed to Series A' }));
      expect(onFiltersChange).toHaveBeenLastCalledWith({ ...FILTERS, stage: '' });
    });

    it('has quick chips that set the same filters the drawer does, and none for the city, the sector or the stage: the gallery\'s own bar has those', async () => {
      const onFiltersChange = vi.fn();
      const meta = { sectors: ['AI', 'SaaS'], cities: ['Sydney'], stages: ['Seed', 'Unknown'] };
      mount({ meta, onFiltersChange });
      await screen.findByText('Canva');
      await userEvent.click(screen.getByRole('button', { name: 'Hiring' }));
      expect(onFiltersChange).toHaveBeenLastCalledWith({ ...FILTERS, hiring: 'yes' });
      await userEvent.click(screen.getByRole('button', { name: 'Events this week' }));
      expect(onFiltersChange).toHaveBeenLastCalledWith({ ...FILTERS, events: 'week' });
      expect(screen.queryByLabelText('Sector')).toBeNull();
      expect(screen.queryByLabelText('Stage')).toBeNull();
      expect(screen.queryByLabelText('City')).toBeNull();
    });
  });

  describe('the table, the spreadsheet and the strip of what is new', () => {
    const screenIs = (wide) => vi.stubGlobal('matchMedia', vi.fn((query) => ({ matches: query === '(min-width: 900px)' ? wide : false })));
    const ago = (days) => new Date(Date.now() - days * 86400000).toISOString();
    beforeEach(() => { try { localStorage.removeItem('auStartupListLayout'); } catch (e) { /* ignore */ } });
    afterEach(() => { try { localStorage.removeItem('auStartupListLayout'); } catch (e) { /* ignore */ } });

    it('opens the gallery with the pictures first and the table in name order, unless the visitor chose a sort, which stays', async () => {
    screenIs(true);
    mount();
    await screen.findByRole('heading', { name: 'Canva' });
    expect(screen.getByLabelText('Sort by')).toHaveValue('pictures');
    await userEvent.click(screen.getByRole('button', { name: 'Table' }));
    await waitFor(() => expect(screen.getByLabelText('Sort by')).toHaveValue('name'));
    await userEvent.selectOptions(screen.getByLabelText('Sort by'), 'stage');
    await userEvent.click(screen.getByRole('button', { name: 'Grid' }));
    expect(screen.getByLabelText('Sort by')).toHaveValue('stage');
    vi.unstubAllGlobals();
  });

  it('is the gallery on every screen, wide or narrow, until the visitor asks for the table, and the choice is kept', async () => {
      screenIs(true);
      const first = mount();
      await screen.findByRole('heading', { name: 'Canva' });
      expect(screen.queryByRole('table')).toBeNull();
      expect(screen.getByRole('button', { name: 'Grid' })).toHaveAttribute('aria-pressed', 'true');
      await userEvent.click(screen.getByRole('button', { name: 'Table' }));
      expect(screen.getByRole('table')).toBeInTheDocument();
      expect(document.querySelector('.gl-grid')).toBeNull();
      expect(localStorage.getItem('auStartupListLayout')).toBe('table');
      first.unmount();
      mount(); // the next visit: the choice is kept
      await screen.findByRole('table');
      await userEvent.click(screen.getByRole('button', { name: 'Grid' }));
      expect(screen.queryByRole('table')).toBeNull();
      expect(localStorage.getItem('auStartupListLayout')).toBe('gallery');
      vi.unstubAllGlobals();
    });

    it('takes an older choice of "cards" as the gallery, which is the grid of cards now', async () => {
      screenIs(true);
      localStorage.setItem('auStartupListLayout', 'cards');
      mount();
      await screen.findByRole('heading', { name: 'Canva' });
      expect(screen.queryByRole('table')).toBeNull();
      expect(screen.getByRole('button', { name: 'Grid' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('lists the same companies in either layout, and opens one from either', async () => {
      screenIs(true);
      localStorage.setItem('auStartupListLayout', 'table');
      fetchStartupPage.mockResolvedValue(page([startup(), startup({ name: 'Airwallex', slug: 'airwallex' })], { count: 2 }));
      const onSelectStartup = vi.fn();
      mount({ onSelectStartup });
      await screen.findByRole('table');
      expect(screen.getAllByRole('rowheader').map((h) => h.querySelector('.st-name-text').textContent)).toEqual(['Canva', 'Airwallex']);
      await userEvent.click(screen.getByRole('button', { name: 'Airwallex' }));
      expect(onSelectStartup).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Airwallex' }));
      await userEvent.click(screen.getByRole('button', { name: 'Grid' }));
      expect([...document.querySelectorAll('.gl-grid .gc-name')].map((n) => n.textContent)).toEqual(['Canva', 'Airwallex']);
    });

    it('sorts from a column header as from the Sort by box: they are one sort', async () => {
      screenIs(true);
      localStorage.setItem('auStartupListLayout', 'table');
      mount();
      await screen.findByRole('table');
      await userEvent.click(screen.getByRole('button', { name: 'Hiring' }));
      await waitFor(() => expect(fetchStartupPage).toHaveBeenLastCalledWith(FILTERS, expect.objectContaining({ sort: 'hiring', offset: 0 })));
      expect(screen.getByLabelText('Sort by')).toHaveValue('hiring');
      await userEvent.selectOptions(screen.getByLabelText('Sort by'), 'verified');
      await waitFor(() => expect(fetchStartupPage).toHaveBeenLastCalledWith(FILTERS, expect.objectContaining({ sort: 'verified', offset: 0 })));
      expect(screen.getByRole('columnheader', { name: /Last verified/ })).toHaveAttribute('aria-sort', 'descending');
    });

    it('offers to sort by team size and remote policy only once some company has one', async () => {
      const options = () => [...screen.getByLabelText('Sort by').querySelectorAll('option')].map((o) => o.value);
      const first = mount({ meta: { sectors: [], cities: [], stages: [] } });
      await screen.findByText('Canva');
      expect(options()).toEqual(['pictures', 'name', 'stage', 'verified', 'hiring', 'location', 'industry']);
      first.unmount();
      mount({ meta: { sectors: [], cities: [], stages: [], teamSizes: [{ code: 'lt10', label: 'Under 10' }], remotePolicies: ['remote-au'] } });
      await screen.findByText('Canva');
      expect(options()).toEqual(['pictures', 'name', 'stage', 'verified', 'hiring', 'location', 'industry', 'team', 'remote']);
    });

    it('exports exactly the list: a link with the same filters and sort, saved as a file, and none when nothing is listed', async () => {
      const filters = { ...FILTERS, sector: 'AI', tech: 'Go' };
      fetchStartupPage.mockResolvedValue(page([startup()], { count: 1 }));
      const { rerender, unmount } = mount({ filters });
      const link = await screen.findByRole('link', { name: 'Export CSV' });
      expect(link.getAttribute('href')).toBe('/api/startups/export.csv?sector=AI&tech=Go&sort=name'); // the spreadsheet is in name order unless another was chosen: "pictures first" is the gallery's
      expect(link).toHaveAttribute('download', 'au-startup-map.csv');
      expect(link).toHaveAttribute('title', expect.stringContaining('1 startup'));
      await userEvent.selectOptions(screen.getByLabelText('Sort by'), 'verified');
      await waitFor(() => expect(screen.getByRole('link', { name: 'Export CSV' }).getAttribute('href')).toBe('/api/startups/export.csv?sector=AI&tech=Go&sort=verified'));
      rerender(<ListView filters={{ ...FILTERS, hiring: 'yes' }} sectorColors={{}} onSelectStartup={noop} />);
      await waitFor(() => expect(screen.getByRole('link', { name: 'Export CSV' }).getAttribute('href')).toBe('/api/startups/export.csv?hiring=yes&sort=verified'));
      unmount();
      fetchStartupPage.mockResolvedValue(page([], { count: 0 }));
      mount();
      await screen.findByText('No startups match your filters.');
      expect(screen.queryByRole('link', { name: 'Export CSV' })).toBeNull();
    });

    it('shows the strip of what is new this week only when the directory says some company is, and not otherwise', async () => {
      const raised = startup({ name: 'Fresh Co', slug: 'fresh', last_funding_date: ago(3).slice(0, 10) });
      fetchStartupPage.mockImplementation(async (filters, { limit } = {}) => (filters.fresh === 'week' ? page([raised], { count: 1, limit }) : page([startup(), raised], { count: 2 })));
      const first = mount({ meta: { sectors: [], cities: [], stages: [], hasFresh: false } });
      await screen.findByText('2 startups');
      expect(screen.queryByRole('heading', { name: 'New this week' })).toBeNull();
      expect(fetchStartupPage.mock.calls.every(([f]) => f.fresh !== 'week')).toBe(true); // not even asked
      first.unmount();
      mount({ meta: { sectors: [], cities: [], stages: [], hasFresh: true }, onFiltersChange: vi.fn() });
      expect(await screen.findByRole('heading', { name: 'New this week' })).toBeInTheDocument();
      const strip = screen.getByRole('region', { name: 'New this week' });
      expect(within(strip).getByRole('button', { name: /Fresh Co/ })).toHaveTextContent(/Raised \d{1,2} \w{3}/);
    });
  });
});
