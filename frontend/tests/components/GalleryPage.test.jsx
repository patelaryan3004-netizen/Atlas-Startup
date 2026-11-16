import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../src/api.js', () => ({ fetchSuggestions: vi.fn(async () => ({ companies: [], people: [], investors: [], industries: [], locations: [], cohorts: [] })) }));

import GalleryPage from '../../src/components/gallery/GalleryPage.jsx';
import Cover, { CoverFallback } from '../../src/components/gallery/Cover.jsx';
import GalleryCard from '../../src/components/gallery/GalleryCard.jsx';
import { rememberGallery, recallGallery, forgetGallery } from '../../src/gallery.js';

const EMPTY = { search: '', sector: '', city: '', investor: '', stage: '', hiring: '', taskGate: '', events: '', precision: '', state: '' };
const CITIES = [{ city: 'Melbourne', count: 392 }, { city: 'Sydney', count: 301 }, { city: 'Perth', count: 59 }];
const props = (overrides = {}) => ({
  onView: vi.fn(),
  filters: EMPTY,
  onFilterChange: vi.fn(),
  cities: CITIES,
  sectors: ['AI', 'Fintech', 'Unknown'],
  stages: ['Seed', 'Series A', 'Unknown'],
  entity: 'all',
  onEntityChange: vi.fn(),
  filtersOpen: false,
  onToggleFilters: vi.fn(),
  filtersRef: { current: null },
  onClear: vi.fn(),
  ...overrides,
});
const mount = (p = props(), children = <p>the gallery</p>) => { render(<GalleryPage {...p}>{children}</GalleryPage>); return p; };

describe('the gallery page: its heading, its switch to the map and its bar', () => {
  it('says what it is, and puts the gallery in the page\'s own main region', () => {
    mount();
    expect(screen.getByRole('heading', { level: 1, name: 'Startup gallery.' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toContainElement(screen.getByText('the gallery'));
  });

  it('has a Map | Gallery switch that says where the visitor is, and asks for the map when it is pressed', async () => {
    const p = mount();
    const group = screen.getByRole('group', { name: 'How the startups are shown' });
    expect(within(group).getByRole('button', { name: 'Gallery' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByRole('button', { name: 'Map' })).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(within(group).getByRole('button', { name: 'Map' }));
    expect(p.onView).toHaveBeenCalledWith('map');
  });

  it('searches by name or keyword as the visitor types, through the one filter the map has too', async () => {
    const p = mount();
    await userEvent.type(screen.getByRole('textbox', { name: /Search startups/ }), 'p');
    expect(p.onFilterChange).toHaveBeenLastCalledWith({ search: 'p' });
  });

  it('offers the cities (the busiest first as given), the industries and the stages on record, and not "Unknown", and sets the same filters the map does', async () => {
    const p = mount();
    await userEvent.click(screen.getByRole('button', { name: 'All cities' }));
    const cities = within(screen.getByRole('group', { name: 'City' }));
    expect(cities.getAllByRole('checkbox').map((c) => c.parentElement.textContent)).toEqual(['Melbourne392', 'Sydney301', 'Perth59']);
    await userEvent.click(cities.getByRole('checkbox', { name: /Perth/ }));
    expect(p.onFilterChange).toHaveBeenLastCalledWith({ city: 'Perth' });

    await userEvent.click(screen.getByRole('button', { name: 'All industries' }));
    const industries = within(screen.getByRole('group', { name: 'Industry' }));
    expect(industries.getAllByRole('checkbox').map((c) => c.parentElement.textContent)).toEqual(['AI', 'Fintech']);
    await userEvent.click(industries.getByRole('checkbox', { name: 'Fintech' }));
    expect(p.onFilterChange).toHaveBeenLastCalledWith({ sector: 'Fintech' });

    await userEvent.click(screen.getByRole('button', { name: 'All stages' }));
    const stages = within(screen.getByRole('group', { name: 'Stage' }));
    expect(stages.getAllByRole('checkbox').map((c) => c.parentElement.textContent)).toEqual(['Seed', 'Series A']);
    await userEvent.click(stages.getByRole('checkbox', { name: 'Seed' }));
    expect(p.onFilterChange).toHaveBeenLastCalledWith({ stage: 'Seed' });
  });

  it('says what is picked on each menu, and picks the kind of organisation like the map page does', async () => {
    const p = mount(props({ filters: { ...EMPTY, city: 'Melbourne', sector: 'Fintech' } }));
    expect(screen.getByRole('button', { name: 'Melbourne' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fintech' })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('What kind of organisation'), 'spaces');
    expect(p.onEntityChange).toHaveBeenCalledWith('spaces');
  });

  it('shows "Clear filters" only while something is filtered, and clears everything with it', async () => {
    const { unmount } = render(<GalleryPage {...props()}><p>x</p></GalleryPage>);
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
    unmount();
    const p = props({ filters: { ...EMPTY, sector: 'AI' } });
    render(<GalleryPage {...p}><p>x</p></GalleryPage>);
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(p.onClear).toHaveBeenCalledTimes(1);
  });

  it('counts only the filters its bar does not show on the Filters button (a wide screen), and opens the filter panel with it', async () => {
    const p = mount(props({ filters: { ...EMPTY, sector: 'AI', hiring: 'yes', remote: 'remote-au' } }));
    const button = screen.getByRole('button', { name: /^Filters/ });
    expect(button).toHaveTextContent('2'); // hiring and remote; the sector is on the bar
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(button);
    expect(p.onToggleFilters).toHaveBeenCalledTimes(1);
  });

  it('is one search region, and has no second heading to compete with the page\'s', () => {
    mount();
    expect(screen.getByRole('search', { name: 'Find startups' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});

describe('a card\'s picture', () => {
  it('is the company\'s own cover when it has one, at the size it was made', () => {
    const { container } = render(<Cover name="Canva" website="https://canva.com" cover="/img/covers/canva.webp" />);
    const picture = container.querySelector('img.gc-img');
    expect(picture).toHaveAttribute('src', '/img/covers/canva.webp');
    expect(picture).toHaveAttribute('width', '720');
    expect(picture).toHaveAttribute('height', '405');
    expect(container.querySelector('.gc-fallback')).toBeNull();
  });

  it('is the company\'s logo on a neutral tile (its letter first) when it has none, and never anyone else\'s picture', () => {
    const { container } = render(<CoverFallback name="Zeller" website="https://www.myzeller.com" />);
    expect(container.querySelector('.gc-fallback')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('.entity-initial')).toHaveTextContent('Z');
    expect(container.querySelector('img.gc-img')).toBeNull();
    const logo = container.querySelector('.gc-logo img');
    expect(logo.getAttribute('src')).toContain('myzeller.com');
  });

  it('has no logo to ask for when the company has no website: its letter alone', () => {
    const { container } = render(<CoverFallback name="Zeller" />);
    expect(container.querySelector('.entity-initial')).toHaveTextContent('Z');
    expect(container.querySelector('img')).toBeNull();
  });
});

describe('a card as a link', () => {
  it('has no address (and is no link to nowhere) for a company with no slug, and is still listed', () => {
    render(<ul><GalleryCard startup={{ name: 'Nameless Pty', blurb: 'x' }} onOpen={() => {}} /></ul>);
    expect(screen.getByRole('heading', { name: 'Nameless Pty' })).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});

describe('where the gallery was left', () => {
  beforeEach(() => { forgetGallery(); vi.useRealTimers(); });

  it('is remembered for the same filters and sort, and for no others', () => {
    rememberGallery({ ...EMPTY, sector: 'AI' }, 'pictures', { count: 96, scrollY: 1200 });
    expect(recallGallery({ ...EMPTY, sector: 'Fintech' }, 'pictures')).toBeNull();
    expect(recallGallery({ ...EMPTY, sector: 'AI' }, 'name')).toBeNull();
    expect(recallGallery({ ...EMPTY, sector: 'AI', city: '' }, 'pictures')).toEqual({ count: 96, scrollY: 1200 }); // (an empty filter is no filter)
  });

  it('is forgotten when the gallery is up again, and after a quarter of an hour', () => {
    rememberGallery(EMPTY, 'pictures', { count: 48, scrollY: 300 });
    forgetGallery();
    expect(recallGallery(EMPTY, 'pictures')).toBeNull();

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-17T09:00:00Z'));
    rememberGallery(EMPTY, 'pictures', { count: 48, scrollY: 300 });
    vi.setSystemTime(new Date('2026-11-17T09:16:00Z'));
    expect(recallGallery(EMPTY, 'pictures')).toBeNull();
    vi.useRealTimers();
  });

  it('never throws when the browser will not keep anything', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    expect(() => rememberGallery(EMPTY, 'pictures', { count: 1, scrollY: 1 })).not.toThrow();
    spy.mockRestore();
  });
});
