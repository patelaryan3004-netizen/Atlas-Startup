import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../src/api.js', () => ({
  fetchInvestors: vi.fn(), fetchInvestorMeta: vi.fn(), fetchInvestor: vi.fn(), fetchInvestorPerson: vi.fn(), submitInvestorCorrection: vi.fn(), submitPersonCorrection: vi.fn(), submitFeedback: vi.fn(),
}));

import * as api from '../../src/api.js';
import InvestorsView from '../../src/components/investors/InvestorsView.jsx';
import { card, company, person, personCard, profile, row, serve } from './helpers.js';

const renderView = (props = {}) => render(<InvestorsView onClose={() => {}} onOpenCompany={() => {}} {...props} />);
const panel = (name = 'Sam Rivera') => screen.findByRole('complementary', { name });
const phone = () => vi.stubGlobal('matchMedia', vi.fn((query) => ({ matches: !query.includes('min-width'), addEventListener: () => {}, removeEventListener: () => {} })));

const world = (people = {}, peopleCards = [personCard()]) => serve(api, {
  cards: [card()], peopleCards, profiles: { blackbird: profile() }, people: { sam: person(), ...people },
});
const openSam = async () => {
  await userEvent.click(await screen.findByRole('link', { name: 'Sam Rivera' }));
  return within(await panel());
};

beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); document.title = 'Still Early'; });
afterEach(() => { window.history.pushState({}, '', '/'); vi.unstubAllGlobals(); });

describe('a person opened beside the results', () => {
  it('opens from their row at an address of its own, with the results still there, their row lit and the heading told to a screen reader', async () => {
    world();
    renderView();
    const side = await openSam();
    expect(window.location.pathname).toBe('/investors/people/sam');
    expect(side.getByRole('heading', { level: 2, name: 'Sam Rivera' })).toHaveFocus();
    const row =screen.getAllByRole('link', { name: 'Sam Rivera' })[0].closest('li');
    expect(row).toHaveClass('inv-item-on');
    expect(screen.getByRole('heading', { level: 1, name: 'Find your next backer.' })).toBeInTheDocument();
    expect(document.title).toBe('Sam Rivera · Investors · Still Early');
  });

  it('is drawn at once from the row, with the record to follow: the name, role, firm and place do not wait', async () => {
    world();
    let release;
    api.fetchInvestorPerson.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    renderView();
    const side = await openSam();
    expect(side.getByRole('heading', { level: 2, name: 'Sam Rivera' })).toBeInTheDocument();
    expect(side.getByText('Partner')).toBeInTheDocument();
    expect(side.getAllByRole('link', { name: 'Blackbird' })[0]).toHaveAttribute('href', '/investors/blackbird');
    expect(side.getByText('Sydney, NSW')).toBeInTheDocument();
    expect(side.getByRole('status')).toHaveTextContent('Loading');
    release(person({ biography: 'Invests in software founders.' }));
    expect(await side.findByText('Invests in software founders.')).toBeInTheDocument();
    expect(side.queryByRole('status')).not.toBeInTheDocument();
  });

  it('presents a directory profile, never a member, a partner, an endorser or a way to be introduced', async () => {
    world();
    renderView();
    const side = await openSam();
    expect(await side.findByText(/not a Still Early member, partner or endorsement/)).toBeInTheDocument();
    expect(side.getByText('Directory profile')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/request an introduction|get introduced|intro available|warm intro/i);
    expect(screen.queryByRole('button', { name: /introduc/i })).not.toBeInTheDocument();
  });

  it('says their interests, and when the record states none of their own says that these are the firm\'s', async () => {
    world({ sam: person() });
    renderView();
    const side = await openSam();
    expect(await side.findByText('The record states none for them, so this is the focus of Blackbird.')).toBeInTheDocument();
    const interests = within(side.getByRole('heading', { level: 3, name: 'Investment interests' }).closest('section'));
    expect(interests.getByText('Software')).toBeInTheDocument();
    expect(interests.getByText('Seed')).toBeInTheDocument();
  });

  it('shows their own interests as theirs, with no note about the firm', async () => {
    world({ sam: person({ sector_focus: ['Health'], stage_focus: ['Pre-seed'] }) });
    renderView();
    const side = await openSam();
    const interests = within((await side.findByRole('heading', { level: 3, name: 'Investment interests' })).closest('section'));
    expect(interests.getByText('Health')).toBeInTheDocument();
    expect(interests.getByText('Pre-seed')).toBeInTheDocument();
    expect(interests.queryByText('Software')).not.toBeInTheDocument();
    expect(side.queryByText(/The record states none for them/)).not.toBeInTheDocument();
  });

  it('says so when no page states what they invest in, rather than showing a guess', async () => {
    world({ sam: person({ organisation: { ...person().organisation, sectors: [], stages: [] } }) }, [personCard({ sectors: [], stages: [], focus_from: null })]);
    renderView();
    const side = await openSam();
    expect(await side.findByText('No public page states what they invest in, so none is shown.')).toBeInTheDocument();
  });

  it('has the actions that exist: save, open the full profile, visit the firm\'s website and the public professional profile, each a real link', async () => {
    world({ sam: person({ linkedin_url: 'https://www.linkedin.com/in/sam-rivera', personal_website: 'https://sam.example/' }) });
    renderView();
    const side = await openSam();
    await side.findByRole('link', { name: /Visit Blackbird’s website/ });
    const visit = side.getByRole('link', { name: /Visit Blackbird’s website/ });
    expect(visit).toHaveAttribute('href', 'https://blackbird.example/');
    expect(visit).toHaveAttribute('target', '_blank');
    expect(visit).toHaveAttribute('rel', 'noopener noreferrer');
    const profileLinks = side.getAllByRole('link', { name: /Professional profile/ });
    expect(profileLinks.length).toBeGreaterThan(0);
    for (const a of profileLinks) expect(a).toHaveAttribute('href', 'https://www.linkedin.com/in/sam-rivera');
    expect(side.getByRole('link', { name: /Personal website/ })).toHaveAttribute('href', 'https://sam.example/');
    expect(side.getByRole('button', { name: /Open full profile/ })).toBeInTheDocument();
    expect(side.getByRole('button', { name: 'Save Sam Rivera' })).toHaveAttribute('aria-pressed', 'false');
    expect(document.querySelector('a[href^="mailto:"], a[href^="tel:"]')).toBeNull();
  });

  it('offers no website or profile link that the record does not hold', async () => {
    world({ sam: person({ organisation: { ...person().organisation, website: null } }) });
    renderView();
    const side = await openSam();
    await side.findByText('Directory profile');
    await waitFor(() => expect(side.queryByRole('status')).not.toBeInTheDocument());
    expect(side.queryByRole('link', { name: /website/i })).not.toBeInTheDocument();
    expect(side.queryByRole('link', { name: /Professional profile/ })).not.toBeInTheDocument();
  });

  it('saves them by their own key from the panel, and the row\'s bookmark follows', async () => {
    world();
    renderView();
    const side = await openSam();
    await userEvent.click(side.getByRole('button', { name: 'Save Sam Rivera' }));
    expect(side.getByRole('button', { name: 'Remove Sam Rivera from saved' })).toHaveAttribute('aria-pressed', 'true');
    expect(JSON.parse(localStorage.getItem('auStartupSavedInvestors'))).toEqual(['people/sam']);
    const rowSave = screen.getAllByRole('button', { name: 'Remove Sam Rivera from saved' }).find((b) => b.closest('li'));
    expect(rowSave).toBeDefined();
    expect(screen.getByRole('tab', { name: 'Saved 1' })).toBeInTheDocument();
    await userEvent.click(side.getByRole('button', { name: 'Remove Sam Rivera from saved' }));
    expect(JSON.parse(localStorage.getItem('auStartupSavedInvestors'))).toEqual([]);
  });

  it('lists the investments a page attributes to them by name on its Investments tab, and says none when there are none', async () => {
    world({ sam: person({ investments: [row({ round: 'Seed', investment_date: '2024-05', amount: 2000000, currency: 'AUD' })] }) });
    renderView();
    const side = await openSam();
    await userEvent.click(await side.findByRole('tab', { name: 'Investments 1' }));
    expect(side.getByRole('heading', { level: 3, name: 'Verified public investments (1)' })).toBeInTheDocument();
    expect(side.getByText('Seed · May 2024')).toBeInTheDocument();
  });

  it('says that none is shown, and that this does not mean none was made, when no page attributes an investment', async () => {
    world();
    renderView();
    const side = await openSam();
    await side.findByText('Directory profile');
    expect(side.getByRole('tab', { name: 'Investments' })).toBeInTheDocument();
    await userEvent.click(side.getByRole('tab', { name: 'Investments' }));
    expect(side.getByText(/No page attributes an investment to Sam Rivera by name, so none is shown\. That does not mean they have made none\./)).toBeInTheDocument();
  });

  it('moves between its tabs with the arrow keys', async () => {
    world({ sam: person({ investments: [row()] }) });
    renderView();
    const side = await openSam();
    const overview = await side.findByRole('tab', { name: 'Overview' });
    overview.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(side.getByRole('tab', { name: /^Investments/ })).toHaveFocus();
    expect(side.getByRole('tab', { name: /^Investments/ })).toHaveAttribute('aria-selected', 'true');
    expect(side.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', side.getByRole('tab', { name: /^Investments/ }).id);
  });

  it('opens their firm\'s panel from the firm\'s name, a step that replaces theirs', async () => {
    world();
    renderView();
    const side = await openSam();
    await userEvent.click(side.getAllByRole('link', { name: 'Blackbird' })[0]);
    expect(await panel('Blackbird')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/investors/blackbird');
    expect(screen.queryByRole('complementary', { name: 'Sam Rivera' })).not.toBeInTheDocument();
  });

  it('says a person from a link who is not in the directory is not there, rather than showing anyone', async () => {
    world();
    window.history.pushState({}, '', '/investors/people/nobody');
    renderView({ fromLink: true, initialRoute: { kind: 'person', slug: 'nobody' } });
    const side = within(await screen.findByRole('complementary', { name: 'Investor details' }));
    expect(await side.findByRole('heading', { level: 2, name: 'This person is not in the directory.' })).toBeInTheDocument();
    await userEvent.click(side.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Investor details' })).not.toBeInTheDocument());
    expect(window.location.pathname).toBe('/investors');
  });

  describe('the notes about a person based elsewhere', () => {
    const away = { location: { city: 'San Francisco', state: null, country: 'United States', label: 'San Francisco, United States' }, scope: 'global' };

    it('says a person outside Australia is not said to back Australian startups, and never puts them on an Australian map', async () => {
      window.history.pushState({}, '', '/investors?scope=global');
      world({ sam: person({ location: 'San Francisco, United States', scope: 'global', organisation: { ...person().organisation, inclusion_basis: 'international', country: 'United States' } }) }, [personCard(away)]);
      renderView();
      const side = await openSam();
      expect(await side.findByText('Based outside Australia. This profile does not say it invests in Australian startups.')).toBeInTheDocument();
      expect(side.getByText('San Francisco, United States')).toBeInTheDocument();
    });

    it('leaves that note off for a person whose firm is listed because it backs Australian startups', async () => {
      window.history.pushState({}, '', '/investors?scope=global');
      world({ sam: person({ scope: 'global', organisation: { ...person().organisation, inclusion_basis: 'invests_in_australia' } }) }, [personCard(away)]);
      renderView();
      const side = await openSam();
      await side.findByText(/not a Still Early member/);
      expect(side.queryByText(/does not say it invests in Australian startups/)).not.toBeInTheDocument();
    });
  });

  describe('closing it', () => {
    it('closes with its Close button, takes the address back to the directory and gives focus back to their row', async () => {
      world();
      renderView();
      const side = await openSam();
      await userEvent.click(side.getByRole('button', { name: /Close/ }));
      await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Sam Rivera' })).not.toBeInTheDocument());
      expect(window.location.pathname).toBe('/investors');
      expect(screen.getByRole('link', { name: 'Sam Rivera' })).toHaveFocus();
      expect(document.title).toBe('Australian Startup Investors · Still Early');
    });

    it('closes with Escape from inside it, and focus returns to the row that opened it', async () => {
      world();
      renderView();
      await openSam();
      await userEvent.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Sam Rivera' })).not.toBeInTheDocument());
      expect(screen.getByRole('link', { name: 'Sam Rivera' })).toHaveFocus();
    });

    it('leaves focus where it is when it was in the search box, and Escape there does not close it', async () => {
      world();
      renderView();
      await openSam();
      await userEvent.click(screen.getByRole('searchbox'));
      await userEvent.keyboard('{Escape}');
      expect(screen.getByRole('complementary', { name: 'Sam Rivera' })).toBeInTheDocument();
    });

    it('keeps the filters, the search, the scope and the view it was opened over', async () => {
      window.history.pushState({}, '', '/investors?scope=global');
      world();
      renderView();
      await screen.findByRole('link', { name: 'Sam Rivera' });
      await userEvent.click(screen.getByRole('button', { name: 'Cards' }));
      await userEvent.type(screen.getByRole('searchbox'), 'sam');
      await waitFor(() => expect(api.fetchInvestors).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'sam' }), expect.anything()));
      await userEvent.click(await screen.findByRole('link', { name: 'Sam Rivera' }));
      const side = within(await panel());
      await userEvent.click(side.getByRole('button', { name: /Close/ }));
      await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Sam Rivera' })).not.toBeInTheDocument());
      expect(screen.getByRole('searchbox')).toHaveValue('sam');
      expect(screen.getByRole('button', { name: 'Cards' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: 'Global' })).toHaveAttribute('aria-pressed', 'true');
      expect(window.location.search).toBe('?scope=global');
    });
  });

  describe('the full profile', () => {
    it('opens from "Open full profile" at its own address, and "All investors" comes back to the panel', async () => {
      world();
      renderView();
      const side = await openSam();
      await userEvent.click(side.getByRole('button', { name: /Open full profile/ }));
      expect(await screen.findByRole('heading', { level: 1, name: 'Sam Rivera' })).toBeInTheDocument();
      expect(window.location.pathname).toBe('/investors/people/sam/profile');
      expect(screen.queryByRole('complementary', { name: 'Sam Rivera' })).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: '← All investors' }));
      expect(await panel()).toBeInTheDocument();
      expect(window.location.pathname).toBe('/investors/people/sam');
    });
  });

  describe('on a phone', () => {
    it('is a full-screen dialog with a Back button, which Escape also takes away', async () => {
      phone();
      world();
      renderView();
      await userEvent.click(await screen.findByRole('link', { name: 'Sam Rivera' }));
      const drawer = await screen.findByRole('dialog', { name: 'Sam Rivera' });
      expect(drawer).toHaveAttribute('aria-modal', 'true');
      expect(within(drawer).getByRole('heading', { level: 2, name: 'Sam Rivera' })).toHaveFocus();
      expect(within(drawer).getByRole('button', { name: '← Back to investors' })).toBeInTheDocument();
      fireEvent.keyDown(window, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Sam Rivera' })).not.toBeInTheDocument());
      expect(window.location.pathname).toBe('/investors');
    });
  });

  describe('a correction or a removal asked for', () => {
    const open = async () => {
      world();
      renderView();
      const side = await openSam();
      await userEvent.click(await side.findByRole('button', { name: 'Suggest a correction or removal' }));
      return screen.getByRole('dialog', { name: 'Suggest a correction or removal' });
    };

    it('opens a dialog that says nothing changes by itself, and has no field for anyone\'s contact details but the asker\'s optional email', async () => {
      const dialog = within(await open());
      expect(dialog.getByText(/Nothing is changed automatically/)).toBeInTheDocument();
      expect(dialog.getByLabelText(/Your email, optional/)).toBeInTheDocument();
      expect(dialog.queryByLabelText(/phone/i)).not.toBeInTheDocument();
    });

    it('asks what is wrong before it sends, and sends nothing without it', async () => {
      const dialog = within(await open());
      await userEvent.click(dialog.getByRole('button', { name: 'Send suggestion' }));
      expect(await dialog.findByRole('alert')).toHaveTextContent('Say what is wrong or missing.');
      expect(api.submitPersonCorrection).not.toHaveBeenCalled();
    });

    it('checks the page and the email it is given', async () => {
      const dialog = within(await open());
      await userEvent.type(dialog.getByLabelText(/What is wrong or missing/), 'They left the firm.');
      await userEvent.type(dialog.getByLabelText(/A page that shows it/), 'not-a-page');
      await userEvent.click(dialog.getByRole('button', { name: 'Send suggestion' }));
      expect(await dialog.findByRole('alert')).toHaveTextContent('The page must be an address that starts with http:// or https://.');
      await userEvent.clear(dialog.getByLabelText(/A page that shows it/));
      await userEvent.type(dialog.getByLabelText(/Your email, optional/), 'nope');
      await userEvent.click(dialog.getByRole('button', { name: 'Send suggestion' }));
      expect(await dialog.findByRole('alert')).toHaveTextContent(/does not look like an email address/);
      expect(api.submitPersonCorrection).not.toHaveBeenCalled();
    });

    it('stages the suggestion against the person, and thanks the asker', async () => {
      api.submitPersonCorrection.mockResolvedValue({ id: 'c1', status: 'pending' });
      const dialog = within(await open());
      await userEvent.type(dialog.getByLabelText(/What is wrong or missing/), 'Please remove this profile.');
      await userEvent.click(dialog.getByRole('button', { name: 'Send suggestion' }));
      expect(await dialog.findByRole('heading', { name: 'Thank you.' })).toBeInTheDocument();
      expect(api.submitPersonCorrection).toHaveBeenCalledWith('sam', { message: 'Please remove this profile.', source_url: '', email: '' });
    });

    it('says when it could not be sent, and keeps what was typed', async () => {
      api.submitPersonCorrection.mockRejectedValue(new Error('Failed to send the correction'));
      const dialog = within(await open());
      await userEvent.type(dialog.getByLabelText(/What is wrong or missing/), 'They moved.');
      await userEvent.click(dialog.getByRole('button', { name: 'Send suggestion' }));
      expect(await dialog.findByRole('alert')).toHaveTextContent('Failed to send the correction');
      expect(dialog.getByLabelText(/What is wrong or missing/)).toHaveValue('They moved.');
    });

    it('closes with Escape without closing the panel behind it', async () => {
      await open();
      await userEvent.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Suggest a correction or removal' })).not.toBeInTheDocument());
      expect(screen.getByRole('complementary', { name: 'Sam Rivera' })).toBeInTheDocument();
    });
  });
});
