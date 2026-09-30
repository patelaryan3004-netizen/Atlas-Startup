import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ListView from '../../src/components/ListView.jsx';

function startup(overrides = {}) {
  return {
    name: 'Canva',
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

describe('ListView', () => {
  it('shows the startup count', () => {
    render(<ListView startups={[startup(), startup({ name: 'Airwallex' })]} sectorColors={{}} onSelectStartup={() => {}} />);
    expect(screen.getByText('2 startups')).toBeInTheDocument();
  });

  it('shows an honest empty state when nothing matches', () => {
    render(<ListView startups={[]} sectorColors={{}} onSelectStartup={() => {}} />);
    expect(screen.getByText('No startups match your filters.')).toBeInTheDocument();
    expect(screen.getByText('0 startups')).toBeInTheDocument();
  });

  it('shows the core card fields: name, industry, location, stage, description', () => {
    render(<ListView startups={[startup()]} sectorColors={{}} onSelectStartup={() => {}} />);
    expect(screen.getByText('Canva')).toBeInTheDocument();
    expect(screen.getByText('SaaS / Design Tech · Sydney · Series D+')).toBeInTheDocument();
    expect(screen.getByText('Online graphic design platform for everyone')).toBeInTheDocument();
  });

  it('shows a hiring badge when hiring, a not-hiring badge otherwise', () => {
    const { rerender } = render(<ListView startups={[startup({ hiring: true })]} sectorColors={{}} onSelectStartup={() => {}} />);
    expect(screen.getByText('● Hiring now')).toBeInTheDocument();

    rerender(<ListView startups={[startup({ hiring: false })]} sectorColors={{}} onSelectStartup={() => {}} />);
    expect(screen.getByText('Not hiring')).toBeInTheDocument();
  });

  it('shows a task-gate tag only when the task gate is enabled', () => {
    const { rerender } = render(<ListView startups={[startup({ taskGate: { enabled: true } })]} sectorColors={{}} onSelectStartup={() => {}} />);
    expect(screen.getByText('TASK-GATE')).toBeInTheDocument();

    rerender(<ListView startups={[startup({ taskGate: { enabled: false } })]} sectorColors={{}} onSelectStartup={() => {}} />);
    expect(screen.queryByText('TASK-GATE')).not.toBeInTheDocument();
  });

  it('shows an unverified tag only for unverified startups', () => {
    render(<ListView startups={[startup({ verified: false })]} sectorColors={{}} onSelectStartup={() => {}} />);
    expect(screen.getByText('Unverified')).toBeInTheDocument();
  });

  it('shows a tracked star only for tracked startups', () => {
    const { rerender } = render(
      <ListView startups={[startup()]} sectorColors={{}} onSelectStartup={() => {}} trackedNames={new Set(['Canva'])} />
    );
    expect(screen.getByTitle('Tracked')).toBeInTheDocument();

    rerender(<ListView startups={[startup()]} sectorColors={{}} onSelectStartup={() => {}} trackedNames={new Set()} />);
    expect(screen.queryByTitle('Tracked')).not.toBeInTheDocument();
  });

  it('calls onSelectStartup with the full startup object when a card is clicked', async () => {
    const onSelectStartup = vi.fn();
    const c = startup();
    render(<ListView startups={[c]} sectorColors={{}} onSelectStartup={onSelectStartup} />);
    await userEvent.click(screen.getByText('Canva'));
    expect(onSelectStartup).toHaveBeenCalledWith(c);
  });

  it('sorts by name (A-Z) by default', () => {
    render(
      <ListView
        startups={[startup({ name: 'Zeller' }), startup({ name: 'Airwallex' })]}
        sectorColors={{}}
        onSelectStartup={() => {}}
      />
    );
    const names = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(names).toEqual(['Airwallex', 'Zeller']);
  });

  it('re-sorts when a different sort option is chosen, without inventing a "recently added/funded" option that has no backing data', async () => {
    render(
      <ListView
        startups={[
          startup({ name: 'Zeller', city: 'Adelaide', hiring: false }),
          startup({ name: 'Airwallex', city: 'Melbourne', hiring: true }),
        ]}
        sectorColors={{}}
        onSelectStartup={() => {}}
      />
    );

    const select = screen.getByLabelText('Sort by');
    const optionLabels = [...select.querySelectorAll('option')].map((o) => o.textContent);
    expect(optionLabels).toEqual(['Name (A–Z)', 'Hiring now', 'Location (A–Z)', 'Industry (A–Z)']);

    await userEvent.selectOptions(select, 'hiring');
    let names = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(names).toEqual(['Airwallex', 'Zeller']);

    await userEvent.selectOptions(select, 'location');
    names = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(names).toEqual(['Zeller', 'Airwallex']);
  });
});
