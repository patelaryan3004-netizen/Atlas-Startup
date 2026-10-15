import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MapLayers from '../../src/components/MapLayers.jsx';

const props = (over = {}) => ({ institutionCount: 0, showInstitutions: true, onToggleInstitutions: vi.fn(), ...over });

describe('the map\'s layers', () => {
  it('has nothing to say when there are no firms\' offices to draw: the toolbar\'s All / Startups / VCs says what is drawn, and the map is the one light map', () => {
    const { container } = render(<MapLayers {...props()} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('group', { name: 'Basemap' })).not.toBeInTheDocument();
  });

  it('has an Institutions switch, with how many offices, only when there are some to draw', () => {
    render(<MapLayers {...props({ institutionCount: 24 })} />);
    const group = screen.getByRole('group', { name: 'Map layers' });
    expect(within(group).queryByRole('button', { name: 'Companies' })).not.toBeInTheDocument();
    const firms = within(group).getByRole('button', { name: /Institutions/ });
    expect(firms).toHaveTextContent('24');
    expect(firms).toHaveAttribute('aria-pressed', 'true');
  });

  it('says whether the layer is on, to a screen reader as well as the eye', () => {
    render(<MapLayers {...props({ institutionCount: 3, showInstitutions: false })} />);
    expect(screen.getByRole('button', { name: /Institutions/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('hands the press to the page', async () => {
    const p = props({ institutionCount: 3 });
    render(<MapLayers {...p} />);
    await userEvent.click(screen.getByRole('button', { name: /Institutions/ }));
    expect(p.onToggleInstitutions).toHaveBeenCalledTimes(1);
  });

  it('can be reached and worked from the keyboard', async () => {
    const p = props({ institutionCount: 3 });
    render(<MapLayers {...p} />);
    await userEvent.tab();
    expect(screen.getByRole('button', { name: /Institutions/ })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(p.onToggleInstitutions).toHaveBeenCalledTimes(1);
  });
});
