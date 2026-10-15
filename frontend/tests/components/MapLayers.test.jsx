import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MapLayers from '../../src/components/MapLayers.jsx';

const props = (over = {}) => ({
  institutionCount: 0, showInstitutions: true, onToggleInstitutions: vi.fn(), basemap: 'dark', onBasemap: vi.fn(), ...over,
});

describe('the map\'s layers and basemap', () => {
  it('is a labelled group with the two basemaps, and no Companies switch (the toolbar\'s All / Startups / VCs says what is drawn)', () => {
    render(<MapLayers {...props()} />);
    const group = screen.getByRole('group', { name: 'Map layers' });
    expect(within(group).queryByRole('button', { name: 'Companies' })).not.toBeInTheDocument();
    const basemap = within(group).getByRole('group', { name: 'Basemap' });
    expect(within(basemap).getAllByRole('button').map((b) => b.textContent)).toEqual(['Dark map', 'Light map']);
  });

  it('has an Institutions switch, with how many offices, only when there are some to draw', () => {
    const { rerender } = render(<MapLayers {...props()} />);
    expect(screen.queryByRole('button', { name: /Institutions/ })).not.toBeInTheDocument();
    rerender(<MapLayers {...props({ institutionCount: 24 })} />);
    const firms = screen.getByRole('button', { name: /Institutions/ });
    expect(firms).toHaveTextContent('24');
    expect(firms).toHaveAttribute('aria-pressed', 'true');
  });

  it('says which layers and which basemap are on, to a screen reader as well as the eye', () => {
    render(<MapLayers {...props({ institutionCount: 3, showInstitutions: false, basemap: 'light' })} />);
    expect(screen.getByRole('button', { name: /Institutions/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Dark map' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Light map' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('hands each press to the page', async () => {
    const p = props({ institutionCount: 3 });
    render(<MapLayers {...p} />);
    await userEvent.click(screen.getByRole('button', { name: /Institutions/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Light map' }));
    expect(p.onToggleInstitutions).toHaveBeenCalledTimes(1);
    expect(p.onBasemap).toHaveBeenCalledWith('light');
  });

  it('can be reached and worked from the keyboard', async () => {
    const p = props();
    render(<MapLayers {...p} />);
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Dark map' })).toHaveFocus();
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    expect(p.onBasemap).toHaveBeenCalledWith('light');
  });
});
