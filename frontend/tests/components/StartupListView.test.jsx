import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StartupListView from '../../src/components/StartupListView.jsx';

function s(name, overrides = {}) {
  return { name, sector: 'AI', city: 'Sydney', stage: 'Seed', verified: true, ...overrides };
}
const investor = (slug, name, overrides = {}) => ({ slug, name, domain: `${slug}.vc`, type_label: 'Venture Capital', location: { label: 'Sydney, NSW' }, ...overrides });

describe('StartupListView (what the visitor saved)', () => {
  it('lists every passed-in startup as the one row: its name, its sector, its city and its stage', () => {
    const startups = [s('A'), s('B', { city: 'Melbourne', stage: 'Series A', sector: 'Fintech' })];
    render(<StartupListView startups={startups} onClose={() => {}} />);

    expect(screen.getByRole('heading', { name: 'Startups in view (2)' })).toBeInTheDocument();
    expect(screen.getByText('AI · Sydney · Seed')).toBeInTheDocument();
    expect(screen.getByText('Fintech · Melbourne · Series A')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^A/ })).toBeInTheDocument();
  });

  it('flags a company nobody has verified with an Unverified badge, as every card does', () => {
    render(<StartupListView startups={[s('Pinned', { verified: true }), s('Unpinned', { verified: false })]} onClose={() => {}} />);
    expect(screen.getAllByText('Unverified')).toHaveLength(1);
    expect(within(screen.getByRole('button', { name: /^Unpinned/ })).getByText('Unverified')).toBeInTheDocument();
  });

  it('is a dialog named by its title, over the page', () => {
    render(<StartupListView startups={[s('A')]} onClose={() => {}} title="Saved (1)" />);
    expect(screen.getByRole('dialog', { name: 'Saved (1)' })).toBeInTheDocument();
  });

  it('calls onClose when the close button is clicked, and on Escape', async () => {
    const onClose = vi.fn();
    render(<StartupListView startups={[]} onClose={onClose} />);
    await userEvent.click(screen.getByLabelText('Close'));
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('accepts a custom title and subtitle', () => {
    render(<StartupListView startups={[s('A')]} onClose={() => {}} title="Saved (1)" subtitle="The companies you saved." />);
    expect(screen.getByRole('heading', { name: 'Saved (1)' })).toBeInTheDocument();
    expect(screen.getByText('The companies you saved.')).toBeInTheDocument();
  });

  it('says how to save something when nothing is saved, and never an empty list', () => {
    render(<StartupListView startups={[]} investors={[]} onClose={() => {}} title="Saved (0)" />);
    expect(screen.getByRole('heading', { name: 'Nothing saved yet.' })).toBeInTheDocument();
    expect(screen.getByText(/Press the bookmark on a company or an investor/)).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('has no bookmark when onToggleTracked is not passed', () => {
    render(<StartupListView startups={[s('A')]} onClose={() => {}} />);
    expect(screen.queryByRole('button', { name: /Save A|Remove A/ })).not.toBeInTheDocument();
  });

  it('has a bookmark per company, filled for what is saved, and calls onToggleTracked with its name', async () => {
    const onToggleTracked = vi.fn();
    const isTracked = (name) => name === 'A';
    render(<StartupListView startups={[s('A'), s('B')]} onClose={() => {}} isTracked={isTracked} onToggleTracked={onToggleTracked} />);

    expect(screen.getByRole('button', { name: 'Remove A from saved' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Save B' })).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(screen.getByRole('button', { name: 'Save B' }));
    expect(onToggleTracked).toHaveBeenCalledWith('B');
  });

  it('opens a company from its row', async () => {
    const onOpenStartup = vi.fn();
    const a = s('A');
    render(<StartupListView startups={[a]} onClose={() => {}} onOpenStartup={onOpenStartup} />);
    await userEvent.click(screen.getByRole('button', { name: /^A/ }));
    expect(onOpenStartup).toHaveBeenCalledWith(a);
  });

  it('lists the saved investors under their own heading, each with the VC badge, and opens one from its row', async () => {
    const onOpenInvestor = vi.fn();
    const onToggleInvestor = vi.fn();
    render(
      <StartupListView
        startups={[s('A')]}
        investors={[investor('blackbird', 'Blackbird')]}
        onClose={() => {}}
        isSavedInvestor={() => true}
        onToggleInvestor={onToggleInvestor}
        onOpenInvestor={onOpenInvestor}
      />,
    );
    const companies = screen.getByRole('region', { name: 'Companies' });
    const investors = screen.getByRole('region', { name: 'Investors' });
    expect(within(companies).getByText('AI · Sydney · Seed')).toBeInTheDocument();
    const row = within(investors).getByRole('button', { name: /^Blackbird/ });
    expect(within(investors).getByText('VC')).toBeInTheDocument();
    expect(within(investors).getByText('Venture Capital · Sydney, NSW')).toBeInTheDocument();
    await userEvent.click(row);
    expect(onOpenInvestor).toHaveBeenCalledWith('blackbird');
    await userEvent.click(within(investors).getByRole('button', { name: 'Remove Blackbird from saved' }));
    expect(onToggleInvestor).toHaveBeenCalledWith('blackbird');
  });

  it('does not call a firm a VC unless its type says so', () => {
    render(<StartupListView startups={[]} investors={[investor('corp', 'Corp Fund', { type_label: 'Corporate fund' })]} onClose={() => {}} />);
    expect(screen.queryByText('VC')).toBeNull();
    expect(screen.getByText('Corporate fund · Sydney, NSW')).toBeInTheDocument();
  });
});
