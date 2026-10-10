import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MapKey from '../../src/components/MapKey.jsx';
import { clusterSize, CLUSTER_MEDIUM, CLUSTER_LARGE } from '../../src/mapPins.js';

const COLOURS = { Fintech: '#5fb894', AI: '#e08a5a', Health: '#d4a24e' };
const colourOf = (hex) => { const probe = document.createElement('div'); probe.style.background = hex; return probe.style.background; };
const open = async (colours = COLOURS) => {
  const view = render(<MapKey sectorColors={colours} />);
  await userEvent.click(screen.getByRole('button', { name: 'Key' }));
  return view;
};

describe('MapKey', () => {
  it('is a button, and the key is out of the way until it is asked for', () => {
    render(<MapKey sectorColors={COLOURS} />);
    const button = screen.getByRole('button', { name: 'Key' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: 'Map key' })).toBeNull();
  });

  it('opens on a click and closes on the next, telling assistive technology which', async () => {
    render(<MapKey sectorColors={COLOURS} />);
    const button = screen.getByRole('button', { name: 'Key' });
    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveAttribute('aria-controls', 'mapKey');
    expect(screen.getByRole('region', { name: 'Map key' })).toHaveAttribute('id', 'mapKey');
    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: 'Map key' })).toBeNull();
  });

  it('closes with its own button and with Escape, and Escape does nothing while it is shut', async () => {
    render(<MapKey sectorColors={COLOURS} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Map key' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Key' }));
    await userEvent.click(screen.getByRole('button', { name: 'Close the map key' }));
    expect(screen.queryByRole('region', { name: 'Map key' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Key' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Map key' })).toBeNull();
  });

  it('says what every mark on the map means', async () => {
    await open();
    const key = screen.getByRole('region', { name: 'Map key' });
    for (const words of [/The edge of its pin takes the colour of its sector/, /dashed edge/i, /green dot: hiring now/i, /gold star: a company you track/i, /numbered circle/i, /dashed ring/i, /Names appear under the pins/]) {
      expect(within(key).getByText(words)).toBeInTheDocument();
    }
  });

  it('draws the marks with the map\'s own classes, so the key cannot drift from the map', async () => {
    await open();
    const key = screen.getByRole('region', { name: 'Map key' });
    expect(key.querySelectorAll('.custom-pin-badge').length).toBe(4);
    expect(key.querySelector('.custom-pin-badge.pin-approx')).not.toBeNull();
    expect(key.querySelector('.pin-hiring-dot')).not.toBeNull();
    expect(key.querySelector('.pin-tracked-star')).not.toBeNull();
    expect(key.querySelector('.marker-cluster-inner')).not.toBeNull();
    for (const size of ['small', 'medium', 'large']) expect(key.querySelector(`.mk-dot.cluster-${size}`)).not.toBeNull();
  });

  it('gives the cluster sizes the thresholds the map uses', async () => {
    await open();
    const key = screen.getByRole('region', { name: 'Map key' });
    expect(within(key).getByText(`under ${CLUSTER_MEDIUM}`)).toBeInTheDocument();
    expect(within(key).getByText(`${CLUSTER_MEDIUM} to ${CLUSTER_LARGE - 1}`)).toBeInTheDocument();
    expect(within(key).getByText(`${CLUSTER_LARGE} or more`)).toBeInTheDocument();
    // and those are the thresholds the map colours by
    expect([clusterSize(CLUSTER_MEDIUM - 1), clusterSize(CLUSTER_MEDIUM), clusterSize(CLUSTER_LARGE - 1), clusterSize(CLUSTER_LARGE)]).toEqual(['small', 'medium', 'medium', 'large']);
  });

  it('lists the colour of each sector in order, behind a section that starts shut', async () => {
    await open();
    const key = screen.getByRole('region', { name: 'Map key' });
    const section = key.querySelector('details.mk-colours');
    expect(section).not.toBeNull();
    expect(section.open).toBe(false);
    expect(within(section).getByText('Colour of each sector')).toBeInTheDocument();
    const items = [...section.querySelectorAll('.mk-sectors li')];
    expect(items.map((li) => li.textContent)).toEqual(['AI', 'Fintech', 'Health']);
    expect(items.map((li) => li.querySelector('.mk-sector-dot').style.background)).toEqual([colourOf('#e08a5a'), colourOf('#5fb894'), colourOf('#d4a24e')]);
    expect(within(section).queryByText(/more sectors than colours/)).toBeNull(); // each has a colour of its own
  });

  it('puts the sectors that share a colour on one line, and says that colours are shared', async () => {
    // the map has far fewer colours than the directory has sectors, so a colour can mean any of several
    await open({ AI: '#111111', Biotech: '#222222', Cloud: '#111111', Data: '#222222', Energy: '#333333' });
    const section = screen.getByRole('region', { name: 'Map key' }).querySelector('.mk-colours');
    const items = [...section.querySelectorAll('.mk-sectors li')];
    expect(items.map((li) => li.textContent)).toEqual(['AI, Cloud', 'Biotech, Data', 'Energy']);
    expect(items.map((li) => li.querySelector('.mk-sector-dot').style.background)).toEqual([colourOf('#111111'), colourOf('#222222'), colourOf('#333333')]);
    expect(within(section).getByText('There are more sectors than colours, so some share one.')).toBeInTheDocument();
  });

  it('leaves out the colours when there are no sectors, and still explains the marks', async () => {
    await open({});
    const key = screen.getByRole('region', { name: 'Map key' });
    expect(key.querySelector('.mk-colours')).toBeNull();
    expect(key.querySelector('.mk-sectors')).toBeNull();
    expect(within(key).getByText(/numbered circle/i)).toBeInTheDocument();
  });

  it('writes a sector name as text, never as markup', async () => {
    await open({ '<img src=x onerror=alert(1)>': '#fff' });
    const key = screen.getByRole('region', { name: 'Map key' });
    expect(key.querySelector('.mk-sectors li').textContent).toBe('<img src=x onerror=alert(1)>');
    expect(key.querySelector('.mk-sectors img')).toBeNull();
  });

  it('hides the sample marks from screen readers: the words beside each say it all', async () => {
    await open();
    const key = screen.getByRole('region', { name: 'Map key' });
    for (const mark of key.querySelectorAll('.mk-mark')) expect(mark).toHaveAttribute('aria-hidden', 'true');
    for (const dot of key.querySelectorAll('.mk-sector-dot, .mk-dot')) expect(dot).toHaveAttribute('aria-hidden', 'true');
  });
});
