import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../src/api.js', () => ({ fetchStartupPage: vi.fn(), fetchSuggestions: vi.fn() }));

import { fetchStartupPage, fetchSuggestions } from '../../src/api.js';
import ExploreHero from '../../src/components/explore/ExploreHero.jsx';
import ResultsColumn from '../../src/components/explore/ResultsColumn.jsx';
import PreviewCard from '../../src/components/explore/PreviewCard.jsx';

const FILTERS = { search: '', sector: '', city: '', investor: '', stage: '', hiring: '', taskGate: '', events: '', precision: '', state: '', remote: '', tech: '', team: '', cohort: '', fresh: '' };

describe('the heading and the main search', () => {
  beforeEach(() => { fetchSuggestions.mockResolvedValue({ companies: [], people: [], investors: [], industries: [], locations: [] }); });
  afterEach(() => { vi.unstubAllGlobals(); });
  const setup = (over = {}) => {
    const props = { filters: FILTERS, onApplyFilters: vi.fn(), entity: 'all', ...over };
    return { props, ...render(<ExploreHero {...props} />) };
  };

  it('is the one heading of the page, "Find your people.", with the one italic word in the green, and says what the site is', () => {
    const { container } = setup();
    const h1 = screen.getByRole('heading', { level: 1, name: 'Find your people.' });
    expect(h1).toHaveClass('display');
    expect(h1.querySelector('em')).toHaveTextContent('people.');
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(screen.getByText('Discover the startups, investors and teams shaping Australia.')).toBeInTheDocument();
    expect(screen.getByText(/Australia.s startup community/)).toBeInTheDocument();
  });

  it('has the main search beside it, asking for what is being looked at', () => {
    const { rerender, props } = setup();
    expect(screen.getByLabelText(/Search startups/)).toHaveAttribute('placeholder', 'Search companies, investors or industries');
    rerender(<ExploreHero {...props} entity="startups" />);
    expect(screen.getByLabelText(/Search startups/)).toHaveAttribute('placeholder', 'Search companies or industries');
    rerender(<ExploreHero {...props} entity="vcs" />);
    expect(screen.getByLabelText(/Search startups/)).toHaveAttribute('placeholder', 'Search investors');
  });

  it('has a short search box on a phone', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })));
    setup();
    expect(screen.getByLabelText(/Search startups/)).toHaveAttribute('placeholder', 'Search startups or investors');
  });

  it('hands what is typed to the page, and offers real searches under it', async () => {
    const { props } = setup();
    await userEvent.type(screen.getByLabelText(/Search startups/), 'a');
    expect(props.onApplyFilters).toHaveBeenCalledWith({ search: 'a' });
    expect(screen.getByText(/Try/)).toHaveTextContent('Try fintech, climate or cybersecurity.');
    await userEvent.click(screen.getByRole('button', { name: 'climate' }));
    expect(props.onApplyFilters).toHaveBeenLastCalledWith({ search: 'climate' });
  });

  it('says the shortcut, and Ctrl+K moves to the box from anywhere on the page', async () => {
    setup();
    expect(document.querySelector('.kbd')).toBeInTheDocument();
    expect(screen.getByLabelText(/Search startups/)).not.toHaveFocus();
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    expect(screen.getByLabelText(/Search startups/)).toHaveFocus();
  });

  it('can be cleared with its own button, which gives the box its focus back', async () => {
    const { props } = setup({ filters: { ...FILTERS, search: 'fin' } });
    expect(document.querySelector('.kbd')).toBeNull(); // with text in it the shortcut is not said
    await userEvent.click(screen.getByRole('button', { name: 'Clear the search' }));
    expect(props.onApplyFilters).toHaveBeenCalledWith({ search: '' });
    expect(screen.getByLabelText(/Search startups/)).toHaveFocus();
  });
});

describe('the results beside the map', () => {
  const page = (names, over = {}) => ({ results: names.map((name) => ({ slug: name.toLowerCase().replace(/\W/g, '-'), name, city: 'Melbourne', sector: 'AI', website: `https://${name.toLowerCase()}.ai`, hiringState: name === 'Acme' ? 'hiring' : 'unverified' })), count: names.length, hasMore: false, ...over });
  const FIRMS = [
    { slug: 'oif', name: 'OIF Ventures', domain: 'oif.vc', places: ['Melbourne'], stages: [], sectors: [], pin: { id: 'oif@Melbourne', slug: 'oif', name: 'OIF Ventures', lat: -37.8, lng: 144.9, city: 'Melbourne' } },
    { slug: 'zed', name: 'Zed Capital', domain: 'zed.vc', places: ['Melbourne', 'Sydney'], stages: [], sectors: [], pin: { id: 'zed@Melbourne', slug: 'zed', name: 'Zed Capital', lat: -37.8, lng: 144.9, city: 'Melbourne' } },
  ];
  const props = (over = {}) => ({
    where: 'Melbourne', entity: 'all', filters: FILTERS, selected: null, onPick: vi.fn(), onPickVc: vi.fn(), vcFirms: FIRMS, isTracked: () => false, onToggleTracked: vi.fn(),
    isSavedVc: () => false, onToggleVc: vi.fn(), onViewAll: vi.fn(), onShowCollections: vi.fn(), onClearFilters: vi.fn(), ...over,
  });
  beforeEach(() => { fetchStartupPage.mockReset(); fetchStartupPage.mockResolvedValue(page(['Acme', 'Beta', 'Cora', 'Dune', 'Echo'])); });

  it('has the place in the serif and what it lists under it, and a row for each company with its sector and city', async () => {
    render(<ResultsColumn {...props()} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Explore Melbourne' })).toHaveClass('serif-h2');
    expect(screen.getByText('Companies and investors.')).toBeInTheDocument();
    const acme = await screen.findByRole('button', { name: /^Acme/ });
    expect(acme).toHaveTextContent('AI · Melbourne');
    expect(within(acme).getByText('Hiring')).toBeInTheDocument(); // only where the record says it
    expect(within(screen.getByRole('button', { name: /^Beta/ })).queryByText('Hiring')).toBeNull();
  });

  it('puts an investor after every third startup, so the investors are seen, each with the yellow VC', async () => {
    render(<ResultsColumn {...props()} />);
    await screen.findByRole('button', { name: /^Acme/ });
    const names = [...document.querySelectorAll('.xc-list .crow-name > span:first-child')].map((n) => n.textContent);
    expect(names).toEqual(['Acme', 'Beta', 'Cora', 'OIF Ventures', 'Dune', 'Echo', 'Zed Capital']);
    const oif = screen.getByRole('button', { name: /^OIF Ventures/ });
    expect(oif).toHaveTextContent('Venture capital · Melbourne');
    expect(within(oif).getByText('VC')).toBeInTheDocument();
  });

  it('lists only the startups for Startups, and only the investors for VCs (and asks for no startup then)', async () => {
    const { unmount } = render(<ResultsColumn {...props({ entity: 'startups' })} />);
    expect(screen.getByText('Startups.')).toBeInTheDocument();
    await screen.findByRole('button', { name: /^Acme/ });
    expect(screen.queryByRole('button', { name: /^OIF/ })).toBeNull();
    unmount();
    fetchStartupPage.mockClear();
    render(<ResultsColumn {...props({ entity: 'vcs' })} />);
    expect(screen.getByText('Venture capital firms.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^OIF Ventures/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Acme/ })).toBeNull();
    expect(fetchStartupPage).not.toHaveBeenCalled();
  });

  it('lights the row of the open mark, and nothing else', async () => {
    render(<ResultsColumn {...props({ selected: { name: 'Beta', slug: 'beta', city: 'Melbourne' } })} />);
    await screen.findByRole('button', { name: /^Acme/ });
    const lit = [...document.querySelectorAll('li[aria-current="true"]')];
    expect(lit).toHaveLength(1);
    expect(lit[0]).toHaveTextContent('Beta');
  });

  it('puts the open mark on top when its company is not among the rows (the map found it first), and says nothing twice', async () => {
    render(<ResultsColumn {...props({ selected: { name: 'Outlier', slug: 'outlier', city: 'Perth', sector: 'Fintech', website: 'https://outlier.com' } })} />);
    await screen.findByRole('button', { name: /^Acme/ });
    const first = document.querySelector('.xc-list li');
    expect(first).toHaveAttribute('aria-current', 'true');
    expect(first).toHaveTextContent('Outlier');
    expect(first).toHaveTextContent('Fintech · Perth');
    expect(screen.getAllByText('Outlier')).toHaveLength(1);
  });

  it('hands the page the company or the investor that is picked, and saving does not pick it', async () => {
    const p = props();
    render(<ResultsColumn {...p} />);
    await userEvent.click(await screen.findByRole('button', { name: /^Beta/ }));
    expect(p.onPick).toHaveBeenCalledWith(expect.objectContaining({ slug: 'beta', name: 'Beta' }));
    await userEvent.click(screen.getByRole('button', { name: /^OIF Ventures/ }));
    expect(p.onPickVc).toHaveBeenCalledWith(FIRMS[0].pin);
    await userEvent.click(screen.getByRole('button', { name: 'Save Cora' }));
    expect(p.onToggleTracked).toHaveBeenCalledWith('Cora');
    await userEvent.click(screen.getByRole('button', { name: 'Save Zed Capital' }));
    expect(p.onToggleVc).toHaveBeenCalledWith('zed');
    expect(p.onPick).toHaveBeenCalledTimes(1);
    expect(p.onPickVc).toHaveBeenCalledTimes(1);
  });

  it('shows what is saved as saved', async () => {
    render(<ResultsColumn {...props({ isTracked: (name) => name === 'Acme', isSavedVc: (slug) => slug === 'oif' })} />);
    expect(await screen.findByRole('button', { name: 'Remove Acme from saved' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Remove OIF Ventures from saved' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Save Beta' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('counts the rest in "View all results", which opens the list, and has the Collections card, a real link to /lists', async () => {
    const p = props();
    render(<ResultsColumn {...p} />);
    const all = await screen.findByRole('button', { name: 'View all 7 results' }); // 5 startups and 2 investors
    await userEvent.click(all);
    expect(p.onViewAll).toHaveBeenCalledTimes(1);
    const card = screen.getByRole('link', { name: /Collections/ });
    expect(card).toHaveAttribute('href', '/lists');
    expect(card).toHaveTextContent('Good company starts here.');
    expect(fireEvent.click(card)).toBe(false); // a plain click goes inside the app
    expect(p.onShowCollections).toHaveBeenCalledTimes(1);
    fireEvent.click(card, { ctrlKey: true });
    expect(p.onShowCollections).toHaveBeenCalledTimes(1); // a new tab is left to the browser
  });

  it('shows no more than a screenful of rows (the rest are one press away), and says so while it loads and when it cannot', async () => {
    fetchStartupPage.mockResolvedValue(page(Array.from({ length: 40 }, (_, i) => `Co ${String(i).padStart(2, '0')}`), { count: 40 }));
    const { unmount } = render(<ResultsColumn {...props({ entity: 'startups' })} />);
    await screen.findByRole('button', { name: /^Co 00/ });
    expect(document.querySelectorAll('.xc-list .crow')).toHaveLength(24);
    expect(screen.getByRole('button', { name: 'View all 40 results' })).toBeInTheDocument();
    unmount();
    fetchStartupPage.mockImplementation(() => new Promise(() => {}));
    const second = render(<ResultsColumn {...props({ entity: 'startups', vcFirms: [] })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    second.unmount();
    fetchStartupPage.mockRejectedValue(new Error('down'));
    render(<ResultsColumn {...props({ entity: 'startups', vcFirms: [] })} />);
    expect(await screen.findByText('Could not load the startups right now.')).toBeInTheDocument();
  });

  it('says nothing matches, and offers to clear the filters, when there is nothing to list', async () => {
    fetchStartupPage.mockResolvedValue(page([]));
    const p = props({ vcFirms: [] });
    render(<ResultsColumn {...p} />);
    expect(await screen.findByRole('heading', { name: 'Nothing matches.' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(p.onClearFilters).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /View all/ })).toBeNull();
  });

  it('shows the filters that are on under the heading', async () => {
    render(<ResultsColumn {...props({ chips: <ul aria-label="Filters on"><li>AI</li></ul> })} />);
    await screen.findByRole('button', { name: /^Acme/ });
    expect(within(screen.getByRole('region', { name: 'Results in Melbourne' })).getByRole('list', { name: 'Filters on' })).toBeInTheDocument();
  });
});

describe('the preview beside the open mark', () => {
  const COMPANY = { slug: 'acme', name: 'Acme AI', city: 'Melbourne', sector: 'AI', hiring: true, website: 'https://acme.ai', location: { precision: 'SUBURB', place: 'Richmond, VIC', quality: 'Location: suburb-level' } };
  const FIRM = { kind: 'vc', slug: 'blackbird', id: 'blackbird@Melbourne', name: 'Blackbird', city: 'Melbourne', website: 'https://www.blackbird.vc', location: { precision: 'EXACT', place: '15 Dover St, Cremorne VIC 3121', quality: 'Office address from its own website' } };
  const setup = (pin, over = {}) => {
    const props = { pin, saved: false, onToggleSaved: vi.fn(), onOpen: vi.fn(), onClose: vi.fn(), ...over };
    return { props, ...render(<PreviewCard {...props} />) };
  };

  it('is the logo, the name, what it is, whether it is hiring, where it is and how well that is known, in a region named for the company', () => {
    setup(COMPANY);
    const card = screen.getByRole('region', { name: 'Acme AI' });
    expect(within(card).getByText('Acme AI')).toBeInTheDocument();
    expect(within(card).getByText('AI')).toBeInTheDocument();
    expect(within(card).getByText('Hiring')).toBeInTheDocument();
    expect(within(card).getByText('Richmond, VIC')).toBeInTheDocument();
    expect(within(card).getByText('Location: suburb-level')).toBeInTheDocument();
    expect(card.querySelector('img')).toHaveAttribute('src', expect.stringContaining('acme.ai'));
  });

  it('opens the company from "Explore company", saves it, and closes from its button and with Escape', async () => {
    const { props } = setup(COMPANY);
    await userEvent.click(screen.getByRole('button', { name: /Explore company/ }));
    expect(props.onOpen).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Save Acme AI' }));
    expect(props.onToggleSaved).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Close the preview' }));
    await userEvent.keyboard('{Escape}');
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });

  it('is an investor card for an investor: the yellow VC, "Venture capital", the address its own page gives, and a way to its profile', async () => {
    const { props } = setup(FIRM);
    const card = screen.getByRole('region', { name: 'Blackbird' });
    expect(within(card).getByText('VC')).toBeInTheDocument();
    expect(within(card).getByText('Venture capital')).toBeInTheDocument();
    expect(within(card).queryByText('Hiring')).toBeNull(); // an investor is never said to be hiring
    expect(within(card).getByText('15 Dover St, Cremorne VIC 3121')).toBeInTheDocument();
    expect(within(card).getByText('Office address from its own website')).toBeInTheDocument();
    expect(card.querySelector('img')).toHaveAttribute('src', expect.stringContaining('blackbird.vc'));
    await userEvent.click(within(card).getByRole('button', { name: /View investor profile/ }));
    expect(props.onOpen).toHaveBeenCalledTimes(1);
  });

  it('says a city is only a city: the investor placed at a city says it has no address on file', () => {
    setup({ ...FIRM, location: { precision: 'CITY', place: 'Melbourne, VIC', quality: 'City-level: its headquarters city, no address on file' } });
    expect(screen.getByText('City-level: its headquarters city, no address on file')).toBeInTheDocument();
  });

  it('shows it as saved, and writes the name as text', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const { container } = setup({ ...COMPANY, name: evil }, { saved: true });
    expect(screen.getByRole('button', { name: `Remove ${evil} from saved` })).toHaveAttribute('aria-pressed', 'true');
    expect(container.querySelector('.pv-name img')).toBeNull();
    expect(screen.getByRole('region', { name: evil })).toBeInTheDocument();
  });
});
