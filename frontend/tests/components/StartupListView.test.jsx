import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StartupListView from '../../src/components/StartupListView.jsx';

function s(name, overrides = {}) {
  return { name, sector: 'AI', city: 'Sydney', stage: 'Seed', verified: true, ...overrides };
}

describe('StartupListView', () => {
  it('lists every passed-in startup with city and stage', () => {
    const startups = [s('A'), s('B', { city: 'Melbourne', stage: 'Series A' })];
    render(<StartupListView startups={startups} sectorColors={{ AI: '#abcdef' }} onClose={() => {}} />);

    expect(screen.getByText('Startups in view (2)')).toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('Sydney · Seed')).toBeInTheDocument();
    expect(screen.getByText('Melbourne · Series A')).toBeInTheDocument();
  });

  it('flags unverified (unpinned) startups with an Unverified badge', () => {
    const startups = [s('Pinned', { verified: true }), s('Unpinned', { verified: false })];
    render(<StartupListView startups={startups} sectorColors={{}} onClose={() => {}} />);

    expect(screen.getByText('Unverified')).toBeInTheDocument();
  });

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn();
    render(<StartupListView startups={[]} sectorColors={{}} onClose={onClose} />);
    await userEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('accepts a custom title and subtitle, for reuse as a tracked-companies view', () => {
    render(
      <StartupListView
        startups={[s('A')]}
        sectorColors={{}}
        onClose={() => {}}
        title="Tracked startups (1)"
        subtitle="Companies you have starred."
      />
    );
    expect(screen.getByText('Tracked startups (1)')).toBeInTheDocument();
    expect(screen.getByText('Companies you have starred.')).toBeInTheDocument();
  });

  it('shows no track star when onToggleTracked is not passed', () => {
    render(<StartupListView startups={[s('A')]} sectorColors={{}} onClose={() => {}} />);
    expect(screen.queryByLabelText(/Track A/)).not.toBeInTheDocument();
  });

  it('shows a track star per company and calls onToggleTracked with its name', async () => {
    const onToggleTracked = vi.fn();
    const isTracked = (name) => name === 'A';
    render(
      <StartupListView
        startups={[s('A'), s('B')]}
        sectorColors={{}}
        onClose={() => {}}
        isTracked={isTracked}
        onToggleTracked={onToggleTracked}
      />
    );

    expect(screen.getByLabelText('Untrack A')).toHaveTextContent('★');
    expect(screen.getByLabelText('Track B')).toHaveTextContent('☆');

    await userEvent.click(screen.getByLabelText('Track B'));
    expect(onToggleTracked).toHaveBeenCalledWith('B');
  });
});
