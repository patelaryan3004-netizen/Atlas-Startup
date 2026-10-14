import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../src/api.js', () => ({
  fetchInvestors: vi.fn(), fetchInvestorMeta: vi.fn(), fetchInvestor: vi.fn(), fetchInvestorPerson: vi.fn(), submitInvestorCorrection: vi.fn(), submitFeedback: vi.fn(),
}));

import * as api from '../../src/api.js';
import InvestorsView from '../../src/components/investors/InvestorsView.jsx';
import { card, company, page, person, profile, row, serve } from './helpers.js';

const renderView = (props = {}) => render(<InvestorsView onClose={() => {}} onOpenCompany={() => {}} {...props} />);
const panel = (name = 'Blackbird') => screen.findByRole('complementary', { name });
const phone = () => vi.stubGlobal('matchMedia', vi.fn((query) => ({ matches: !query.includes('min-width'), addEventListener: () => {}, removeEventListener: () => {} })));

const world = () => serve(api, {
  cards: [card({ portfolio_count: 2 }), card({ slug: 'skip', name: 'Skip Capital', type: 'angel_network', type_label: 'Angel Network', stages: [], sectors: [], portfolio_count: 0, location: { city: null, state: null, country: null, label: null } })],
  profiles: {
    blackbird: profile({
      description: 'Backs software founders.', investment_thesis: 'We back founders early.', other_offices: ['Melbourne'], cheque: { min: 250000, max: 1000000, currency: 'AUD' }, lead_or_follow: 'lead',
      application_url: 'https://blackbird.example/pitch', jobs_url: 'https://blackbird.example/jobs',
      portfolio: [row({ company: company({ slug: 'acme', name: 'Acme', sector: 'Unknown', hiring: true }) }), row({ company: company({ slug: 'beta', name: 'Beta', sector: 'Health', city: 'Melbourne' }), round: 'Seed' })],
      recent: [row()],
      jobs: { url: 'https://blackbird.example/jobs', hiring: [company({ slug: 'acme', name: 'Acme', hiring: true })] },
      team: [{ person: { slug: 'sam', name: 'Sam Rivera' }, role: 'Partner', is_current: true, started_on: null, ended_on: null, source: page({ url: 'https://blackbird.example/team' }) }],
      funds: [{ slug: 'f2', name: 'Fund II', vintage_year: 2022, size: { amount: 80000000, currency: 'AUD' }, stage_focus: ['Seed'], sector_focus: [], active_status: 'active', portfolio_count: 2 }],
      related: [{ slug: 'skip', name: 'Skip Capital', shared: 2, companies: ['Acme', 'Beta'] }],
      sources: [page({ id: 's1', title: 'Blackbird about', backs: ['stages', 'sectors'] })],
    }),
    skip: profile({ slug: 'skip', name: 'Skip Capital', type: 'angel_network', type_label: 'Angel Network', stages: [], sectors: [], portfolio_count: 0, location: { city: null, state: null, country: null, label: null } }),
  },
  people: { sam: person() },
});

beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); document.title = 'AU Startup Map'; });
afterEach(() => { window.history.pushState({}, '', '/'); vi.unstubAllGlobals(); });

describe('an investor opened beside the results', () => {
  it('opens from a card, at its own address, with the results still there and the card lit', async () => {
    world();
    renderView();
    await userEvent.click(await screen.findByRole('link', { name: 'Blackbird' }));
    const side = within(await panel());
    expect(window.location.pathname).toBe('/investors/blackbird');
    expect(side.getByRole('heading', { level: 2, name: 'Blackbird' })).toHaveFocus(); // a screen reader is told who is open
    expect(side.getByText('Software · Sydney, NSW')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Skip Capital' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Blackbird' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('link', { name: 'Blackbird' }).closest('li')).toHaveClass('inv-card-on');
    expect(screen.getByRole('link', { name: 'Skip Capital' })).not.toHaveAttribute('aria-current');
  });

  it('is drawn at once from the card, with the record to follow: the name, the three facts and the tabs do not wait', async () => {
    world();
    let release;
    api.fetchInvestor.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    renderView();
    await userEvent.click(await screen.findByRole('link', { name: 'Blackbird' }));
    const side = within(await panel());
    expect(side.getByRole('heading', { level: 2, name: 'Blackbird' })).toBeInTheDocument();
    expect(side.getByText('Focus').nextSibling).toHaveTextContent('Software');
    expect(side.getByText('Stage').nextSibling).toHaveTextContent('Seed → Series A');
    expect(side.getByText('Location').nextSibling).toHaveTextContent('Sydney, NSW');
    expect(side.getByRole('tab', { name: 'Portfolio 2' })).toBeInTheDocument(); // the card knows how many companies
    expect(side.getByRole('status')).toHaveTextContent('Loading');
    expect(side.queryByText('About')).not.toBeInTheDocument();
    release(profile({ description: 'Backs software founders.' }));
    expect(await side.findByText('Backs software founders.')).toBeInTheDocument();
    expect(side.queryByRole('status')).not.toBeInTheDocument();
  });

  it('says its focus, stage and place side by side, with a dash for what nobody states', async () => {
    world();
    renderView();
    await userEvent.click(await screen.findByRole('link', { name: 'Skip Capital' }));
    const side = within(await panel('Skip Capital'));
    const facts = [...document.querySelectorAll('.inv-panel-facts > div')].map((d) => [d.querySelector('dt').textContent, d.querySelector('dd').textContent]);
    expect(facts).toEqual([['Focus', '–Not stated'], ['Stage', '–Not stated'], ['Location', '–Not stated']]);
    expect(side.getAllByText('Angel Network').length).toBeGreaterThan(0); // under its name, and among its details
  });

  it('has an overview of what a page backs: about, thesis, details, funds, recent investments and the pages behind it, and nothing without a page', async () => {
    world();
    renderView();
    await userEvent.click(await screen.findByRole('link', { name: 'Blackbird' }));
    const side = within(await panel());
    expect(await side.findByText('Backs software founders.')).toBeInTheDocument();
    for (const heading of ['About', 'Investment thesis', 'Details', 'Funds', 'Recent verified investments', 'Sources']) expect(side.getByRole('heading', { level: 3, name: heading })).toBeInTheDocument();
    expect(side.getByText('We back founders early.')).toBeInTheDocument();
    expect(side.getByText('$250,000 to $1,000,000')).toBeInTheDocument();
    expect(side.getByText('As a public page states it')).toBeInTheDocument();
    expect(side.getByText('Leads rounds')).toBeInTheDocument();
    expect(side.getByText('Fund II')).toBeInTheDocument();
    expect(side.getByRole('link', { name: /Blackbird about/ })).toHaveAttribute('href', 'https://blackbird.example/about');
    expect(side.getByRole('button', { name: 'Suggest a correction' })).toBeInTheDocument();
    expect(side.getByRole('button', { name: 'Claim this profile' })).toBeInTheDocument();
  });

  it('leaves out every heading an investor has nothing for', async () => {
    world();
    renderView();
    await userEvent.click(await screen.findByRole('link', { name: 'Skip Capital' }));
    const side = within(await panel('Skip Capital'));
    await side.findByRole('heading', { level: 3, name: 'Sources' });
    for (const heading of ['About', 'Investment thesis', 'Funds', 'Recent verified investments']) expect(side.queryByRole('heading', { level: 3, name: heading })).not.toBeInTheDocument();
  });

  it('lists the portfolio in its tab, each company a way to open it, and hides a sector that is not known', async () => {
    world();
    const onOpenCompany = vi.fn();
    window.history.pushState({}, '', '/investors/blackbird?city=Sydney');
    renderView({ onOpenCompany, fromLink: true, initialRoute: { kind: 'investor', slug: 'blackbird' } });
    const side = within(await panel());
    await userEvent.click(await side.findByRole('tab', { name: 'Portfolio 2' }));
    expect(side.getByRole('heading', { level: 3, name: 'Portfolio (2)' })).toBeInTheDocument();
    expect(side.getByText('Health · Melbourne')).toBeInTheDocument();
    expect(side.queryByText(/Unknown/)).not.toBeInTheDocument(); // "Unknown" is not a sector
    expect(side.getByText('Sydney', { selector: '.inv-row-sub' })).toBeInTheDocument();
    expect(side.getByRole('heading', { level: 3, name: 'Portfolio jobs' })).toBeInTheDocument();
    expect(side.getByRole('link', { name: /Browse jobs across Blackbird/ })).toHaveAttribute('href', 'https://blackbird.example/jobs');
    await userEvent.click(side.getAllByRole('button', { name: 'Acme' })[0]);
    expect(onOpenCompany).toHaveBeenCalledWith(company({ slug: 'acme', name: 'Acme', sector: 'Unknown', hiring: true }));
    expect(window.location.pathname).toBe('/'); // a company opens over the map: the address is left clean
    expect(window.location.search).toBe('?city=Sydney');
  });

  it('opens another investor from "Invests alongside", in the same panel and without a step of its own', async () => {
    world();
    renderView();
    await userEvent.click(await screen.findByRole('link', { name: 'Blackbird' }));
    const first = within(await panel());
    await userEvent.click(await first.findByRole('tab', { name: 'Portfolio 2' }));
    const before = window.history.length;
    await userEvent.click(first.getByRole('link', { name: 'Skip Capital' }));
    expect(await panel('Skip Capital')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/investors/skip');
    expect(window.history.length).toBe(before); // a replace: Back is still the directory
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true'); // another investor starts at its overview
  });

  it('says in its Portfolio and People tabs when a page has linked no company, or named no one, rather than leaving them blank', async () => {
    world();
    renderView();
    await userEvent.click(await screen.findByRole('link', { name: 'Skip Capital' }));
    const side = within(await panel('Skip Capital'));
    await side.findByRole('heading', { level: 3, name: 'Sources' });
    await userEvent.click(side.getByRole('tab', { name: 'Portfolio' }));
    expect(side.getByText(/No company has been linked to Skip Capital by a page yet/)).toBeInTheDocument();
    await userEvent.click(side.getByRole('tab', { name: 'People' }));
    expect(side.getByText(/No one from Skip Capital has been published yet/)).toBeInTheDocument();
  });

  it('lists the people a page names in its People tab, each a way to open their page, which is a step of its own', async () => {
    world();
    renderView();
    await userEvent.click(await screen.findByRole('link', { name: 'Blackbird' }));
    const side = within(await panel());
    await userEvent.click(await side.findByRole('tab', { name: 'People 1' }));
    expect(side.getByText('Partner')).toBeInTheDocument();
    await userEvent.click(side.getByRole('link', { name: 'Sam Rivera' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Sam Rivera' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/investors/people/sam');
    window.history.back();
    expect(await panel()).toBeInTheDocument(); // Back is the panel it came from
  });

  it('moves between its tabs with the arrow keys, and each tab names the panel it controls', async () => {
    world();
    renderView();
    await userEvent.click(await screen.findByRole('link', { name: 'Blackbird' }));
    const side = within(await panel());
    const overview = await side.findByRole('tab', { name: 'Overview' });
    expect(overview).toHaveAttribute('aria-selected', 'true');
    overview.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(side.getByRole('tab', { name: /^Portfolio/ })).toHaveFocus();
    expect(side.getByRole('tab', { name: /^Portfolio/ })).toHaveAttribute('aria-selected', 'true');
    const tabpanel = side.getByRole('tabpanel');
    expect(side.getByRole('tab', { name: /^Portfolio/ })).toHaveAttribute('aria-controls', tabpanel.id);
    expect(tabpanel).toHaveAttribute('aria-labelledby', side.getByRole('tab', { name: /^Portfolio/ }).id);
    await userEvent.keyboard('{End}');
    expect(side.getByRole('tab', { name: /^People/ })).toHaveFocus();
  });

  it('saves the investor from its panel and from its card, which are one thing', async () => {
    world();
    renderView();
    await userEvent.click(await screen.findByRole('link', { name: 'Blackbird' }));
    const side = within(await panel());
    await userEvent.click(side.getByRole('button', { name: 'Save Blackbird' }));
    expect(side.getByRole('button', { name: 'Remove Blackbird from saved' })).toHaveTextContent('Saved');
    expect(screen.getAllByRole('button', { name: 'Remove Blackbird from saved' })).toHaveLength(2); // the card's and the panel's
    expect(JSON.parse(localStorage.getItem('auStartupSavedInvestors'))).toEqual(['blackbird']);
    await userEvent.click(screen.getAllByRole('button', { name: 'Remove Blackbird from saved' })[0]);
    expect(side.getByRole('button', { name: 'Save Blackbird' })).toHaveTextContent('Save');
  });

  it('has the investor\'s website and how to apply, each in a new tab, and neither when there is none', async () => {
    world();
    const first = renderView();
    await userEvent.click(await screen.findByRole('link', { name: 'Blackbird' }));
    const side = within(await panel());
    const visit = await side.findByRole('link', { name: /Visit website/ });
    expect(visit).toHaveAttribute('href', 'https://blackbird.example/');
    expect(visit).toHaveAttribute('target', '_blank');
    expect(visit).toHaveAttribute('rel', 'noopener noreferrer');
    expect(side.getByRole('link', { name: /How to apply/ })).toHaveAttribute('href', 'https://blackbird.example/pitch');
    first.unmount();
    window.history.pushState({}, '', '/');
    serve(api, { cards: [card({ website: null, domain: null })], profiles: { blackbird: profile({ website: null, application_url: null }) } });
    renderView();
    await userEvent.click(await screen.findByRole('link', { name: 'Blackbird' }));
    const bare = within(await panel());
    await bare.findByRole('heading', { level: 3, name: 'Sources' });
    expect(bare.queryByRole('link', { name: /Visit website/ })).not.toBeInTheDocument();
    expect(bare.queryByRole('link', { name: /How to apply/ })).not.toBeInTheDocument();
  });

  it('names the tab by the investor that is open, and gives the directory\'s name back when it is shut', async () => {
    world();
    renderView();
    await screen.findByRole('link', { name: 'Blackbird' });
    expect(document.title).toBe('Australian Startup Investors · AU Startup Map');
    await userEvent.click(screen.getByRole('link', { name: 'Blackbird' }));
    await panel();
    await waitFor(() => expect(document.title).toBe('Blackbird · Australian Startup Investors · AU Startup Map'));
    await userEvent.click(screen.getByRole('button', { name: /Close/ }));
    await waitFor(() => expect(document.title).toBe('Australian Startup Investors · AU Startup Map'));
  });

  it('says an investor is not in the directory (a mistyped link), and says it could not load one when the server fails: not the same thing', async () => {
    world();
    const first = renderView({ fromLink: true, initialRoute: { kind: 'investor', slug: 'nobody' } });
    const missing = await screen.findByRole('complementary', { name: 'Investor details' });
    expect(await within(missing).findByRole('heading', { level: 2, name: 'This investor is not in the directory.' })).toBeInTheDocument();
    expect(within(missing).getByText(/It may not have been published yet/)).toBeInTheDocument();
    first.unmount();
    api.fetchInvestor.mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 500 }));
    renderView({ fromLink: true, initialRoute: { kind: 'investor', slug: 'unreachable' } });
    expect(await screen.findByRole('heading', { level: 2, name: 'Could not load this investor right now.' })).toBeInTheDocument();
  });

  it('opens from a link to /investors/<slug>: the directory behind it, the investor beside it, and no step added to the history', async () => {
    world();
    window.history.pushState({}, '', '/investors/blackbird');
    const before = window.history.length;
    renderView({ fromLink: true, initialRoute: { kind: 'investor', slug: 'blackbird' } });
    expect(await panel()).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Skip Capital' })).toBeInTheDocument();
    expect(window.history.length).toBe(before);
    expect(window.location.pathname).toBe('/investors/blackbird');
  });

  it('writes an old ?view=investors&investor= link in the new form', async () => {
    world();
    window.history.pushState({}, '', '/?city=Sydney&view=investors&investor=blackbird');
    renderView({ fromLink: true, initialRoute: { kind: 'investor', slug: 'blackbird' } });
    await panel();
    expect(window.location.pathname).toBe('/investors/blackbird');
    expect(window.location.search).toBe('?city=Sydney');
  });

  describe('closing it', () => {
    it('goes Back over the step that opened it, so the next Back leaves the directory', async () => {
      world();
      const onClose = vi.fn();
      renderView({ onClose });
      await userEvent.click(await screen.findByRole('link', { name: 'Blackbird' }));
      await panel();
      expect(window.history.state).toEqual({ investors: 'panel' });
      await userEvent.click(screen.getByRole('button', { name: /Close/ }));
      await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Blackbird' })).not.toBeInTheDocument());
      expect(window.location.pathname).toBe('/investors');
      expect(screen.getByRole('link', { name: 'Blackbird' })).not.toHaveAttribute('aria-current');
      expect(onClose).not.toHaveBeenCalled();
    });

    it('goes Back to the directory when the browser\'s Back button is used, and forward opens it again', async () => {
      world();
      renderView();
      await userEvent.click(await screen.findByRole('link', { name: 'Blackbird' }));
      await panel();
      window.history.back();
      await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Blackbird' })).not.toBeInTheDocument());
      window.history.forward();
      expect(await panel()).toBeInTheDocument();
    });

    it('puts the directory in its place, with no step to go Back over, when it was opened from a link', async () => {
      world();
      window.history.pushState({}, '', '/investors/blackbird');
      renderView({ fromLink: true, initialRoute: { kind: 'investor', slug: 'blackbird' } });
      await panel();
      const before = window.history.length;
      await userEvent.click(screen.getByRole('button', { name: /Close/ }));
      await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Blackbird' })).not.toBeInTheDocument());
      expect(window.location.pathname).toBe('/investors');
      expect(window.history.length).toBe(before);
    });

    it('closes with Escape from inside the panel, and leaves Escape alone in the search box', async () => {
      world();
      renderView();
      await userEvent.click(await screen.findByRole('link', { name: 'Blackbird' }));
      await panel();
      await userEvent.click(screen.getByRole('searchbox'));
      await userEvent.keyboard('{Escape}');
      expect(screen.getByRole('complementary', { name: 'Blackbird' })).toBeInTheDocument();
      within(screen.getByRole('complementary', { name: 'Blackbird' })).getByRole('heading', { level: 2 }).focus();
      await userEvent.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Blackbird' })).not.toBeInTheDocument());
    });

    it('does not move the results: opening, switching and closing an investor never touch the page\'s scroll', async () => {
      world();
      renderView();
      await screen.findByRole('link', { name: 'Blackbird' });
      const scroller = document.getElementById('investorsView');
      const writes = [];
      let top = 240;
      Object.defineProperty(scroller, 'scrollTop', { configurable: true, get: () => top, set: (v) => { writes.push(v); top = v; } });
      await userEvent.click(screen.getByRole('link', { name: 'Blackbird' }));
      await panel();
      await userEvent.click(screen.getByRole('link', { name: 'Skip Capital', hidden: false }));
      await panel('Skip Capital');
      await userEvent.click(screen.getByRole('button', { name: /Close/ }));
      await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Skip Capital' })).not.toBeInTheDocument());
      expect(writes).toEqual([]);
      expect(top).toBe(240);
    });
  });

  describe('the full profile', () => {
    it('opens from "Open full profile" at its own address, with the directory kept behind it, and "All investors" comes back to the panel', async () => {
      world();
      renderView();
      await userEvent.click(await screen.findByRole('link', { name: 'Blackbird' }));
      await userEvent.click(within(await panel()).getByRole('button', { name: /Open full profile/ }));
      expect(await screen.findByRole('article')).toBeInTheDocument();
      expect(window.location.pathname).toBe('/investors/blackbird/profile');
      expect(screen.getByRole('heading', { level: 1, name: 'Blackbird' })).toBeInTheDocument();
      expect(screen.queryByRole('complementary', { name: 'Blackbird' })).not.toBeInTheDocument();
      expect(document.querySelector('[hidden] .inv-hero')).not.toBeNull(); // the directory is mounted, only hidden

      const asked = api.fetchInvestors.mock.calls.length;
      await userEvent.click(screen.getByRole('button', { name: '← All investors' }));
      expect(await panel()).toBeInTheDocument();
      expect(window.location.pathname).toBe('/investors/blackbird');
      expect(api.fetchInvestors.mock.calls.length).toBe(asked); // the directory was never rebuilt
    });

    it('returns to the same place in the results, with the same filters, after a full profile or a person', async () => {
      world();
      renderView();
      await screen.findByRole('link', { name: 'Blackbird' });
      const scroller = document.getElementById('investorsView');
      let top = 0;
      Object.defineProperty(scroller, 'scrollTop', { configurable: true, get: () => top, set: (v) => { top = v; } });
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'name_desc');
      await waitFor(() => expect(screen.getAllByRole('heading', { level: 2 })[0]).toHaveTextContent('Skip Capital'));
      top = 310;
      await userEvent.click(screen.getByRole('link', { name: 'Blackbird' }));
      await userEvent.click(within(await panel()).getByRole('button', { name: /Open full profile/ }));
      await screen.findByRole('article');
      expect(top).toBe(0); // a full page starts at its top
      await userEvent.click(screen.getByRole('button', { name: '← All investors' }));
      await panel();
      expect(top).toBe(310);
      expect(screen.getByRole('combobox', { name: 'Sort by' })).toHaveValue('name_desc');
    });

    it('still opens at /investors/<slug>/profile from a link, and from there "All investors" opens the panel', async () => {
      world();
      window.history.pushState({}, '', '/investors/blackbird/profile');
      renderView({ fromLink: true, initialRoute: { kind: 'profile', slug: 'blackbird' } });
      expect(await screen.findByRole('heading', { level: 1, name: 'Blackbird' })).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: '← All investors' }));
      expect(await panel()).toBeInTheDocument();
    });
  });

  describe('a correction suggested from the panel', () => {
    it('opens a dialog over it, which Escape closes without closing the panel', async () => {
      world();
      renderView();
      await userEvent.click(await screen.findByRole('link', { name: 'Blackbird' }));
      const side = within(await panel());
      await userEvent.click(await side.findByRole('button', { name: 'Suggest a correction' }));
      expect(await screen.findByRole('dialog', { name: 'Suggest a correction' })).toBeInTheDocument();
      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByRole('complementary', { name: 'Blackbird' })).toBeInTheDocument();
    });

    it('says claiming is not open yet, and offers the correction instead', async () => {
      world();
      renderView();
      await userEvent.click(await screen.findByRole('link', { name: 'Blackbird' }));
      await userEvent.click(await within(await panel()).findByRole('button', { name: 'Claim this profile' }));
      const claim = await screen.findByRole('dialog', { name: 'Claiming a profile is not open yet' });
      await userEvent.click(within(claim).getByRole('button', { name: 'Suggest a correction' }));
      expect(await screen.findByRole('dialog', { name: 'Suggest a correction' })).toBeInTheDocument();
    });
  });
});

describe('an investor on a phone', () => {
  it('opens in a full-screen drawer: a dialog with a clear Back button, and the page behind it does not scroll', async () => {
    phone();
    world();
    renderView();
    await userEvent.click(await screen.findByRole('link', { name: 'Blackbird' }));
    const drawer = await screen.findByRole('dialog', { name: 'Blackbird' });
    expect(drawer).toHaveAttribute('aria-modal', 'true');
    expect(drawer).toHaveClass('inv-panel-drawer');
    expect(document.getElementById('investorsView')).toHaveClass('inv-locked');
    expect(within(drawer).getByRole('button', { name: '← Back to investors' })).toBeInTheDocument();
    expect(within(drawer).getByRole('heading', { level: 2, name: 'Blackbird' })).toHaveFocus();
    expect(window.location.pathname).toBe('/investors/blackbird');
  });

  it('goes Back to the results from its Back button, and from Escape wherever focus is, and the page scrolls again', async () => {
    phone();
    world();
    renderView();
    await userEvent.click(await screen.findByRole('link', { name: 'Blackbird' }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Blackbird' })).getByRole('button', { name: '← Back to investors' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.getElementById('investorsView')).not.toHaveClass('inv-locked');
    expect(window.location.pathname).toBe('/investors');

    await userEvent.click(screen.getByRole('link', { name: 'Skip Capital' }));
    await screen.findByRole('dialog', { name: 'Skip Capital' });
    await userEvent.click(screen.getByRole('searchbox', { hidden: true }));
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('has the same tabs, the same save and the same way to the full profile', async () => {
    phone();
    world();
    renderView();
    await userEvent.click(await screen.findByRole('link', { name: 'Blackbird' }));
    const drawer = within(await screen.findByRole('dialog', { name: 'Blackbird' }));
    expect(drawer.getAllByRole('tab').map((t) => t.textContent.replace(/\s+/g, ' '))).toEqual(['Overview', 'Portfolio 2', 'People 1']);
    await userEvent.click(drawer.getByRole('button', { name: 'Save Blackbird' }));
    expect(JSON.parse(localStorage.getItem('auStartupSavedInvestors'))).toEqual(['blackbird']);
    await userEvent.click(drawer.getByRole('button', { name: /Open full profile/ }));
    expect(await screen.findByRole('article')).toBeInTheDocument();
    expect(document.getElementById('investorsView')).not.toHaveClass('inv-locked');
  });

  it('has a table that is cards, and offers no choice of view, because a table does not fit', async () => {
    // the view switch is hidden by the stylesheet under 900px (the table stacks into blocks): it is still the same control and the same data
    phone();
    world();
    renderView();
    await screen.findByRole('link', { name: 'Blackbird' });
    expect(screen.getByRole('group', { name: 'View' })).toHaveClass('inv-views');
  });
});

describe('the shared header and the theme', () => {
  it('leaves for the map from Explore, with the investor pages taken out of the address', async () => {
    world();
    const onClose = vi.fn();
    window.history.pushState({}, '', '/investors?city=Sydney');
    renderView({ onClose });
    await userEvent.click(await screen.findByRole('button', { name: 'Explore' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe('/');
    expect(window.location.search).toBe('?city=Sydney');
  });

  it('goes to the jobs page from Jobs, and says how many are hiring', async () => {
    world();
    const onShowJobs = vi.fn();
    renderView({ chrome: { hiringCount: 25, onShowJobs, menu: {} } });
    const jobs = await screen.findByRole('button', { name: 'Jobs' });
    expect(jobs).toHaveAttribute('title', '25 hiring now');
    await userEvent.click(jobs);
    expect(onShowJobs).toHaveBeenCalledTimes(1);
  });

  it('is the directory again from Investors: the panel shut, the tab All, and the page at its top', async () => {
    world();
    renderView();
    await userEvent.click(await screen.findByRole('tab', { name: 'Saved' }));
    await userEvent.click(screen.getByRole('tab', { name: 'All investors' }));
    await userEvent.click(screen.getByRole('link', { name: 'Blackbird' }));
    await panel();
    await userEvent.click(screen.getByRole('tab', { name: 'Saved' }));
    await userEvent.click(screen.getByRole('button', { name: 'Investors' }));
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Blackbird' })).not.toBeInTheDocument());
    expect(screen.getByRole('tab', { name: 'All investors' })).toHaveAttribute('aria-selected', 'true');
  });

  it('puts the app\'s menu in the header, with Explore, Investors and Saved meaning what they mean on this page', async () => {
    world();
    localStorage.setItem('auStartupSavedInvestors', JSON.stringify(['blackbird']));
    const onClose = vi.fn();
    const onShowAbout = vi.fn();
    renderView({ onClose, chrome: { hiringCount: 0, menu: { onShowAbout, directoryUrl: '/directory/', trackedCount: 9 } } });
    await userEvent.click(await screen.findByRole('button', { name: 'Menu' }));
    const menu = within(document.querySelector('.hdr-menu-panel'));
    expect(menu.getByText('Saved (1)')).toBeInTheDocument(); // the investors saved, not the companies
    await userEvent.click(menu.getByText('Saved (1)'));
    expect(screen.getByRole('tab', { name: 'Saved 1' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Menu' }));
    await userEvent.click(within(document.querySelector('.hdr-menu-panel')).getByText('About & sources'));
    expect(onShowAbout).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Menu' }));
    await userEvent.click(within(document.querySelector('.hdr-menu-panel')).getByRole('button', { name: 'Explore' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe('Add investor', () => {
    it('opens a dialog that says a suggestion is not a listing, and gives focus back to its button when it closes', async () => {
      world();
      renderView();
      const add = await screen.findByRole('button', { name: 'Add investor' });
      await userEvent.click(add);
      const dialog = await screen.findByRole('dialog', { name: 'Suggest an investor' });
      expect(within(dialog).getByText(/never listed straight away/)).toBeInTheDocument();
      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(add).toHaveFocus();
    });

    it('asks for a name, and for a website and an email that are what they say, and sends nothing until they are', async () => {
      world();
      renderView();
      await userEvent.click(await screen.findByRole('button', { name: 'Add investor' }));
      await userEvent.click(screen.getByRole('button', { name: 'Send suggestion' }));
      expect(await screen.findByText('Say who the investor is.')).toBeInTheDocument();
      await userEvent.type(screen.getByLabelText('Investor *'), 'Example Ventures');
      await userEvent.type(screen.getByLabelText('Its website, optional'), 'example.com');
      await userEvent.click(screen.getByRole('button', { name: 'Send suggestion' }));
      expect(screen.getByRole('alert')).toHaveTextContent('must be an address that starts with http');
      await userEvent.clear(screen.getByLabelText('Its website, optional'));
      await userEvent.type(screen.getByLabelText('Your email, optional'), 'not-an-email');
      await userEvent.click(screen.getByRole('button', { name: 'Send suggestion' }));
      expect(screen.getByRole('alert')).toHaveTextContent('does not look like an email address');
      expect(api.submitFeedback).not.toHaveBeenCalled();
    });

    it('sends the suggestion to the queue as an investor suggestion, and thanks the visitor without promising a listing', async () => {
      world();
      api.submitFeedback.mockResolvedValue({ id: '1' });
      renderView();
      await userEvent.click(await screen.findByRole('button', { name: 'Add investor' }));
      await userEvent.type(screen.getByLabelText('Investor *'), 'Example Ventures');
      await userEvent.type(screen.getByLabelText('Its website, optional'), 'https://example.com');
      await userEvent.type(screen.getByLabelText('Anything else, optional'), 'Backs seed-stage climate startups.');
      await userEvent.type(screen.getByLabelText('Your email, optional'), 'me@example.com');
      await userEvent.click(screen.getByRole('button', { name: 'Send suggestion' }));
      expect(await screen.findByRole('heading', { name: 'Thank you.' })).toBeInTheDocument();
      expect(api.submitFeedback).toHaveBeenCalledWith({
        type: 'investor', message: 'Investor to add: Example Ventures\nWebsite: https://example.com\nBacks seed-stage climate startups.', email: 'me@example.com',
      });
      expect(screen.getByText(/Nothing is listed on a suggestion alone/)).toBeInTheDocument();
    });

    it('says so when it could not be sent, and keeps what was typed', async () => {
      world();
      api.submitFeedback.mockRejectedValue(new Error('Failed to submit feedback'));
      renderView();
      await userEvent.click(await screen.findByRole('button', { name: 'Add investor' }));
      await userEvent.type(screen.getByLabelText('Investor *'), 'Example Ventures');
      await userEvent.click(screen.getByRole('button', { name: 'Send suggestion' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Failed to submit feedback');
      expect(screen.getByLabelText('Investor *')).toHaveValue('Example Ventures');
    });
  });

  describe('the theme', () => {
    it('opens light, and switches to dark and back from the button in the header', async () => {
      world();
      renderView();
      const view = await screen.findByRole('link', { name: 'Blackbird' }).then(() => document.getElementById('investorsView'));
      expect(view).toHaveAttribute('data-theme', 'light');
      const toggle = screen.getByRole('button', { name: 'Dark theme' });
      expect(toggle).toHaveAttribute('aria-pressed', 'false');
      await userEvent.click(toggle);
      expect(view).toHaveAttribute('data-theme', 'dark');
      expect(toggle).toHaveAttribute('aria-pressed', 'true');
      expect(toggle).toHaveAttribute('title', 'Switch to the light theme');
      await userEvent.click(toggle);
      expect(view).toHaveAttribute('data-theme', 'light');
    });

    it('is kept in this browser, so the page opens as it was left', async () => {
      world();
      const first = renderView();
      await userEvent.click(await screen.findByRole('button', { name: 'Dark theme' }));
      expect(localStorage.getItem('auStartupInvestorTheme')).toBe('dark');
      first.unmount();
      renderView();
      await screen.findByRole('link', { name: 'Blackbird' });
      expect(document.getElementById('investorsView')).toHaveAttribute('data-theme', 'dark');
    });

    it('is not changed by switching the view, opening an investor, a full profile, or the saved tab', async () => {
      world();
      renderView();
      await userEvent.click(await screen.findByRole('button', { name: 'Dark theme' }));
      const view = document.getElementById('investorsView');
      await userEvent.click(screen.getByRole('button', { name: 'Table' }));
      expect(view).toHaveAttribute('data-theme', 'dark');
      await userEvent.click(screen.getByRole('link', { name: 'Blackbird' }));
      await panel();
      expect(view).toHaveAttribute('data-theme', 'dark');
      await userEvent.click(screen.getByRole('button', { name: 'Cards' }));
      await userEvent.click(screen.getByRole('tab', { name: 'Saved' }));
      expect(view).toHaveAttribute('data-theme', 'dark');
      await userEvent.click(screen.getByRole('tab', { name: 'All investors' }));
      await userEvent.click(within(await panel()).getByRole('button', { name: /Open full profile/ }));
      await screen.findByRole('article');
      expect(view).toHaveAttribute('data-theme', 'dark');
    });

    it('falls back to light when the browser will not say what was kept', async () => {
      world();
      const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
      try {
        renderView();
        await screen.findByRole('link', { name: 'Blackbird' });
        expect(document.getElementById('investorsView')).toHaveAttribute('data-theme', 'light');
      } finally {
        get.mockRestore();
      }
    });
  });
});

describe('moving between the directory, an investor and a person', () => {
  it('opened from the map is a step of its own, and Back is the map', async () => {
    world();
    const onClose = vi.fn();
    const before = window.history.length;
    renderView({ onClose });
    await screen.findByRole('heading', { level: 1, name: 'Find your next backer.' });
    expect(window.location.pathname).toBe('/investors');
    expect(window.history.length).toBe(before + 1);
    window.history.back();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('opened from a link adds no step to the history', async () => {
    world();
    window.history.pushState({}, '', '/investors');
    const before = window.history.length;
    renderView({ fromLink: true });
    await screen.findByRole('heading', { level: 1, name: 'Find your next backer.' });
    expect(window.history.length).toBe(before);
  });

  it('opens a person from a link, and goes back to the directory from their page', async () => {
    world();
    window.history.pushState({}, '', '/investors/people/sam');
    renderView({ fromLink: true, initialRoute: { kind: 'person', slug: 'sam' } });
    expect(await screen.findByRole('heading', { level: 1, name: 'Sam Rivera' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '← All investors' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Find your next backer.' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/investors');
  });

  it('opens an investor from a person\'s page as that investor\'s full profile', async () => {
    world();
    renderView({ initialRoute: { kind: 'person', slug: 'sam' } });
    await userEvent.click(await screen.findByRole('link', { name: /Blackbird/ }));
    expect(await screen.findByRole('article')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/investors/blackbird/profile');
  });
});
