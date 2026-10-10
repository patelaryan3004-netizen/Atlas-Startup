import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../src/api.js', () => ({
  fetchInvestors: vi.fn(), fetchInvestorMeta: vi.fn(), fetchInvestor: vi.fn(), fetchInvestorPerson: vi.fn(), submitInvestorCorrection: vi.fn(),
}));

import * as api from '../../src/api.js';
import InvestorsView from '../../src/components/investors/InvestorsView.jsx';
import { card, company, page, person, profile, row, serve } from './helpers.js';

const open = (slug, props = {}) => render(<InvestorsView initialRoute={{ kind: 'investor', slug }} onClose={() => {}} onOpenCompany={() => {}} {...props} />);
const heading = (name) => screen.queryByRole('heading', { level: 2, name });

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { window.history.pushState({}, '', '/'); });

describe('an investor profile with only what every public record has', () => {
  it('shows who it is, that it was verified and when, and the pages behind it, and no section that has nothing to say', async () => {
    serve(api, { profiles: { blackbird: profile() } });
    open('blackbird');
    expect(await screen.findByRole('heading', { level: 1, name: 'Blackbird' })).toBeInTheDocument();
    const article = within(screen.getByRole('article'));
    expect(article.getByText('Venture Capital · Sydney, NSW')).toBeInTheDocument();
    expect(article.getAllByText('Verified 8 Oct 2026').length).toBeGreaterThan(0);
    expect(heading('Sources')).toBeInTheDocument();
    for (const empty of ['About', 'Investment thesis', 'Recent verified investments', 'Portfolio jobs', 'Team', 'Funds', 'Invests alongside']) expect(heading(empty)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: /^Portfolio/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Typical cheque')).not.toBeInTheDocument();
  });

  it('shows no Visit website or How to apply button when the investor has neither', async () => {
    serve(api, { profiles: { blackbird: profile({ website: null, application_url: null }) } });
    open('blackbird');
    await screen.findByRole('heading', { level: 1, name: 'Blackbird' });
    expect(screen.queryByRole('link', { name: /Visit website/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /How to apply/ })).not.toBeInTheDocument();
  });
});

describe('an investor profile with everything a page backs', () => {
  const full = () => profile({
    description: 'Backs software founders.', investment_thesis: 'We back founders early.', geographies: ['Australia', 'New Zealand'], other_offices: ['Melbourne'],
    cheque: { min: 250000, max: 1000000, currency: 'AUD' }, lead_or_follow: 'lead', application_url: 'https://blackbird.example/pitch', jobs_url: 'https://blackbird.example/jobs',
    portfolio: [
      row({ company: company({ slug: 'acme', name: 'Acme', hiring: true }), round: 'Series A', investment_date: '2026-03', amount: 3500000, currency: 'AUD', lead_status: 'lead' }),
      row({ company: company({ slug: 'beta', name: 'Beta', sector: 'Health', city: 'Melbourne' }), round: 'Seed', investment_date: '2024-02-14' }),
      row({ company: company({ slug: 'cee', name: 'Cee' }), round: null, investment_date: null }),
    ],
    recent: [row({ company: company({ slug: 'acme', name: 'Acme' }), round: 'Series A', investment_date: '2026-03' })],
    jobs: { url: 'https://blackbird.example/jobs', hiring: [company({ slug: 'acme', name: 'Acme', hiring: true })] },
    team: [
      { person: { slug: 'sam', name: 'Sam Rivera' }, role: 'Partner', is_current: true, started_on: null, ended_on: null, source: page({ url: 'https://blackbird.example/team' }) },
      { person: { slug: 'old', name: 'Olive Former' }, role: 'Analyst', is_current: false, started_on: null, ended_on: null, source: page({ url: 'https://blackbird.example/team' }) },
    ],
    funds: [{ slug: 'f2', name: 'Fund II', vintage_year: 2022, size: { amount: 80000000, currency: 'AUD' }, stage_focus: ['Seed'], sector_focus: [], active_status: 'active', portfolio_count: 2 }],
    related: [{ slug: 'skip', name: 'Skip Capital', shared: 4, companies: ['Acme', 'Beta', 'Cee'] }],
    sources: [page({ id: 's1', title: 'Blackbird about', backs: ['stages', 'sectors', 'typical_cheque', 'description', 'investment_thesis', 'lead_or_follow'] }), page({ id: 's2', title: 'Team page', url: 'https://blackbird.example/team', backs: ['team'] })],
  });

  it('has every section in the order a visitor wants them: about, thesis, portfolio, jobs, team, funds, alongside, sources', async () => {
    serve(api, { profiles: { blackbird: full() } });
    open('blackbird');
    await screen.findByRole('heading', { level: 1, name: 'Blackbird' });
    const titles = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(titles).toEqual(['About', 'Investment thesis', 'Recent verified investments', 'Portfolio (3)', 'Portfolio jobs', 'Team', 'Funds', 'Invests alongside', 'Sources', 'Something wrong or missing?']);
    expect(screen.getByText('Backs software founders.')).toBeInTheDocument();
    expect(screen.getByText('We back founders early.')).toBeInTheDocument();
  });

  it('shows the facts: type, place, stages, sectors, where it invests, the cheque a page states, whether it leads, and that it is investing', async () => {
    serve(api, { profiles: { blackbird: full() } });
    open('blackbird');
    const facts = within(await screen.findByRole('complementary', { name: 'Facts' }));
    expect(facts.getByText('Venture Capital')).toBeInTheDocument();
    expect(facts.getByText('Sydney, NSW')).toBeInTheDocument();
    expect(facts.getByText('Melbourne')).toBeInTheDocument();
    expect(facts.getByText('Series A')).toBeInTheDocument();
    expect(facts.getByText('Software')).toBeInTheDocument();
    expect(facts.getByText('New Zealand')).toBeInTheDocument();
    expect(facts.getByText('$250,000 to $1,000,000')).toBeInTheDocument();
    expect(facts.getByText('As a public page states it')).toBeInTheDocument();
    expect(facts.getByText('Leads rounds')).toBeInTheDocument();
    expect(facts.getByText('Investing now')).toBeInTheDocument();
  });

  it('lists the portfolio with the round, the date as far as a page gives it, an amount only if stated, who led, and a link to the page that says so', async () => {
    serve(api, { profiles: { blackbird: full() } });
    open('blackbird');
    const portfolio = (await screen.findByRole('heading', { level: 2, name: 'Portfolio (3)' })).closest('section');
    const acme = within(portfolio).getByRole('button', { name: 'Acme' }).closest('li');
    expect(within(acme).getByText('Series A · Mar 2026')).toBeInTheDocument();
    expect(within(acme).getByText('Led the round · $3,500,000')).toBeInTheDocument();
    expect(within(acme).getByRole('link', { name: /Source/ })).toHaveAttribute('href', 'https://blackbird.example/portfolio');
    expect(within(within(portfolio).getByRole('button', { name: 'Beta' }).closest('li')).getByText('Seed · 14 Feb 2024')).toBeInTheDocument();
    expect(within(within(portfolio).getByRole('button', { name: 'Cee' }).closest('li')).getByText('Date not stated')).toBeInTheDocument();
  });

  it('does not repeat the portfolio as "recent" unless there is more portfolio than recent', async () => {
    const p = full();
    serve(api, { profiles: { blackbird: { ...p, recent: p.portfolio.slice(0, 2) } } });
    open('blackbird');
    await screen.findByRole('heading', { level: 1, name: 'Blackbird' });
    expect(heading('Recent verified investments')).toBeInTheDocument();
  });

  it('names the portfolio companies that are hiring, and links the investor\'s own jobs page', async () => {
    serve(api, { profiles: { blackbird: full() } });
    open('blackbird');
    const jobs = (await screen.findByRole('heading', { level: 2, name: 'Portfolio jobs' })).closest('section');
    expect(within(jobs).getByText('Hiring now')).toBeInTheDocument();
    expect(within(jobs).getByRole('link', { name: /Browse jobs across Blackbird’s portfolio/ })).toHaveAttribute('href', 'https://blackbird.example/jobs');
  });

  it('marks a former team member as former, and makes each person a link to their own page', async () => {
    serve(api, { profiles: { blackbird: full() } });
    open('blackbird');
    const team = (await screen.findByRole('heading', { level: 2, name: 'Team' })).closest('section');
    expect(within(team).getByRole('link', { name: 'Sam Rivera' })).toHaveAttribute('href', '/investors/people/sam');
    expect(within(team).getByText('Analyst · former')).toBeInTheDocument();
    expect(within(team).getByText('Partner')).toBeInTheDocument();
  });

  it('shows a fund with its vintage, its disclosed size and its stage focus', async () => {
    serve(api, { profiles: { blackbird: full() } });
    open('blackbird');
    const funds = (await screen.findByRole('heading', { level: 2, name: 'Funds' })).closest('section');
    expect(within(funds).getByText('Fund II')).toBeInTheDocument();
    expect(within(funds).getByText('2022 · $80,000,000 · Seed')).toBeInTheDocument();
    expect(within(funds).getByText('2 companies')).toBeInTheDocument();
  });

  it('lists the investors it backs alongside, with the companies they share', async () => {
    serve(api, { profiles: { blackbird: full() } });
    open('blackbird');
    const related = (await screen.findByRole('heading', { level: 2, name: 'Invests alongside' })).closest('section');
    expect(within(related).getByRole('link', { name: 'Skip Capital' })).toHaveAttribute('href', '/investors/skip');
    expect(within(related).getByText('Acme, Beta, Cee and 1 more')).toBeInTheDocument();
    expect(within(related).getByText('4 companies in common')).toBeInTheDocument();
  });

  it('lists the sources as links that open in a new tab, with what each backs in plain words, a long list counted, and when it was read', async () => {
    serve(api, { profiles: { blackbird: full() } });
    open('blackbird');
    const sources = (await screen.findByRole('heading', { level: 2, name: 'Sources' })).closest('section');
    const link = within(sources).getByRole('link', { name: /Blackbird about/ });
    expect(link).toHaveAttribute('href', 'https://blackbird.example/about');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(within(sources).getByText(/backs its stages, its sectors, its cheque size, its description and 2 more/)).toBeInTheDocument();
    expect(within(sources).getByText(/backs its team/)).toBeInTheDocument();
    expect(within(sources).getAllByText('Read 8 Oct 2026').length).toBeGreaterThan(0);
  });

  it('opens a company in the app, and never follows an address that is not http(s)', async () => {
    const p = full();
    p.portfolio[0].source = page({ url: 'javascript:alert(1)' });
    p.website = 'javascript:alert(1)';
    serve(api, { profiles: { blackbird: p } });
    const onOpenCompany = vi.fn();
    open('blackbird', { onOpenCompany });
    await screen.findByRole('heading', { level: 1, name: 'Blackbird' });
    expect(screen.queryByRole('link', { name: /Visit website/ })).not.toBeInTheDocument();
    for (const a of document.querySelectorAll('a[href]')) expect(a.getAttribute('href')).not.toMatch(/^javascript:/i);
    await userEvent.click(within((await screen.findByRole('heading', { level: 2, name: 'Portfolio (3)' })).closest('section')).getByRole('button', { name: 'Acme' }));
    expect(onOpenCompany).toHaveBeenCalledWith(expect.objectContaining({ slug: 'acme', name: 'Acme' }));
  });

  it('makes Visit website and How to apply real links that open in a new tab', async () => {
    serve(api, { profiles: { blackbird: full() } });
    open('blackbird');
    const site = await screen.findByRole('link', { name: /Visit website/ });
    expect(site).toHaveAttribute('href', 'https://blackbird.example/');
    expect(site).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('link', { name: /How to apply/ })).toHaveAttribute('href', 'https://blackbird.example/pitch');
  });

  it('says an investor has stopped investing wherever it says it is investing', async () => {
    serve(api, { profiles: { blackbird: { ...full(), status: 'inactive', active_status: 'inactive' } } });
    open('blackbird');
    await screen.findByRole('heading', { level: 1, name: 'Blackbird' });
    expect(screen.getAllByText('No longer investing').length).toBeGreaterThan(0);
    expect(screen.queryByText('Investing now')).not.toBeInTheDocument();
  });

  it('shows a cheque in another currency in that currency, never converted', async () => {
    serve(api, { profiles: { blackbird: { ...full(), cheque: { min: 5000000, max: 10000000, currency: 'NZD' } } } });
    open('blackbird');
    const facts = within(await screen.findByRole('complementary', { name: 'Facts' }));
    expect(facts.getByText(/NZD\s5,000,000 to NZD\s10,000,000/)).toBeInTheDocument();
    expect(facts.queryByText(/AUD|\$5,000,000/)).not.toBeInTheDocument();
  });
});

describe('suggesting a correction, and claiming a profile', () => {
  const openProfile = async () => {
    serve(api, { profiles: { blackbird: profile() } });
    open('blackbird');
    await screen.findByRole('heading', { level: 1, name: 'Blackbird' });
  };

  it('needs a message, and says so', async () => {
    await openProfile();
    await userEvent.click(screen.getByRole('button', { name: 'Suggest a correction' }));
    await userEvent.click(screen.getByRole('button', { name: 'Send suggestion' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Say what is wrong or missing.');
    expect(api.submitInvestorCorrection).not.toHaveBeenCalled();
  });

  it('refuses a page that is not an address, before sending anything', async () => {
    await openProfile();
    await userEvent.click(screen.getByRole('button', { name: 'Suggest a correction' }));
    await userEvent.type(screen.getByLabelText(/What is wrong or missing/), 'It has closed.');
    await userEvent.type(screen.getByLabelText(/A page that shows it/), 'blackbird dot vc');
    await userEvent.click(screen.getByRole('button', { name: 'Send suggestion' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/http:\/\/ or https:\/\//);
    expect(api.submitInvestorCorrection).not.toHaveBeenCalled();
  });

  it('sends the suggestion for that investor, with the page and the email if given, and says a person checks it against a page', async () => {
    api.submitInvestorCorrection.mockResolvedValue({ id: '1', status: 'pending' });
    await openProfile();
    await userEvent.click(screen.getByRole('button', { name: 'Suggest a correction' }));
    await userEvent.type(screen.getByLabelText(/What is wrong or missing/), '  It no longer invests at Series B.  ');
    await userEvent.type(screen.getByLabelText(/A page that shows it/), 'https://blackbird.example/news');
    await userEvent.type(screen.getByLabelText(/Your email/), 'me@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send suggestion' }));
    expect(api.submitInvestorCorrection).toHaveBeenCalledWith('blackbird', { message: 'It no longer invests at Series B.', source_url: 'https://blackbird.example/news', email: 'me@example.com' });
    expect(await screen.findByText(/A person checks every suggestion against a page before anything on this profile changes/)).toBeInTheDocument();
  });

  it('shows the server\'s reason when the suggestion is refused', async () => {
    api.submitInvestorCorrection.mockRejectedValue(new Error('message is longer than 2000 characters'));
    await openProfile();
    await userEvent.click(screen.getByRole('button', { name: 'Suggest a correction' }));
    await userEvent.type(screen.getByLabelText(/What is wrong or missing/), 'Something.');
    await userEvent.click(screen.getByRole('button', { name: 'Send suggestion' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('message is longer than 2000 characters');
  });

  it('closes on Escape without sending', async () => {
    await openProfile();
    await userEvent.click(screen.getByRole('button', { name: 'Suggest a correction' }));
    expect(screen.getByRole('dialog', { name: 'Suggest a correction' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.submitInvestorCorrection).not.toHaveBeenCalled();
  });

  it('explains that claiming a profile is not open and why, offers the correction route instead, and claims nothing', async () => {
    await openProfile();
    await userEvent.click(screen.getByRole('button', { name: 'Claim this profile' }));
    const dialog = screen.getByRole('dialog', { name: 'Claiming a profile is not open yet' });
    expect(within(dialog).getByText(/no accounts yet/)).toBeInTheDocument();
    expect(within(dialog).getByText(/an email address or a name is not proof/)).toBeInTheDocument();
    expect(api.submitInvestorCorrection).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Suggest a correction' }));
    expect(screen.getByRole('dialog', { name: 'Suggest a correction' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Claiming a profile is not open yet' })).not.toBeInTheDocument();
  });
});

describe('a person who invests', () => {
  const full = () => person({
    biography: 'Invests in software.', sector_focus: ['Software'], stage_focus: ['Seed'], previous_companies: ['An Old Startup'], previous_investor_organisations: ['An Old Fund'],
    linkedin_url: 'https://www.linkedin.com/in/sam-rivera', personal_website: 'https://sam.example/',
    roles: [{ organisation: { slug: 'blackbird', name: 'Blackbird' }, role: 'Partner', is_current: true, started_on: '2021', ended_on: null, source: page({ url: 'https://blackbird.example/team' }) },
      { organisation: { slug: 'oldfund', name: 'Old Fund' }, role: 'Analyst', is_current: false, started_on: '2017', ended_on: '2020', source: page({ url: 'https://oldfund.example/team' }) }],
    investments: [row({ round: 'Seed', investment_date: '2024-05', amount: 2000000, currency: 'AUD' })],
    companies: [company({ hiring: true })],
  });

  const openPerson = (p = full()) => {
    serve(api, { profiles: { blackbird: profile() }, people: { sam: p } });
    return render(<InvestorsView initialRoute={{ kind: 'person', slug: 'sam' }} onClose={() => {}} onOpenCompany={() => {}} />);
  };

  it('shows their role at the firm (a link to it), their focus, their background, their roles, what a page attributes to them, and where it comes from', async () => {
    openPerson();
    expect(await screen.findByRole('heading', { level: 1, name: 'Sam Rivera' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Blackbird' })[0]).toHaveAttribute('href', '/investors/blackbird');
    const titles = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(titles).toEqual(['About', 'Focus', 'Background', 'Roles', 'Verified public investments (1)', 'Connected companies (1)', 'Public links', 'Sources']);
    expect(screen.getByText('Analyst · former · 2017 to 2020')).toBeInTheDocument();
    expect(screen.getByText('An Old Startup')).toBeInTheDocument();
    expect(screen.getByText('Seed · May 2024')).toBeInTheDocument();
  });

  it('links only to pages they publish themselves, and holds no email address or phone number', async () => {
    openPerson();
    await screen.findByRole('heading', { level: 1, name: 'Sam Rivera' });
    const links = within((await screen.findByRole('heading', { level: 2, name: 'Public links' })).closest('section'));
    expect(links.getByRole('link', { name: /LinkedIn/ })).toHaveAttribute('href', 'https://www.linkedin.com/in/sam-rivera');
    expect(links.getByRole('link', { name: /Personal website/ })).toHaveAttribute('href', 'https://sam.example/');
    expect(document.body.textContent).not.toMatch(/@|\+61|phone|mailto/i);
    expect(document.querySelector('a[href^="mailto:"], a[href^="tel:"]')).toBeNull();
  });

  it('leaves out the sections with nothing in them', async () => {
    openPerson(person());
    await screen.findByRole('heading', { level: 1, name: 'Sam Rivera' });
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Sources']);
  });

  it('says a person is not in the directory when they have not been published', async () => {
    serve(api, { people: {} });
    render(<InvestorsView initialRoute={{ kind: 'person', slug: 'nobody' }} onClose={() => {}} onOpenCompany={() => {}} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'This person is not in the directory.' })).toBeInTheDocument();
  });
});
