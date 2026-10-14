import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import MapKey from '../../src/components/MapKey.jsx';
import { clusterSize, CLUSTER_MEDIUM, CLUSTER_LARGE } from '../../src/mapPins.js';

const key = () => screen.getByRole('region', { name: 'Map key' });

describe('MapKey', () => {
  it('is a labelled section in the page, with no button of its own: it sits in the filter panel\'s Map tab', () => {
    render(<MapKey />);
    expect(key()).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('says what every mark on the map means', () => {
    render(<MapKey />);
    for (const words of [/A small dot: a company/, /white tile with a mint dot: hiring now/i, /tile with a star: a company you saved/i, /dashed edge/i, /numbered ring/i, /dashed ring/i, /Names appear under the pins/]) {
      expect(within(key()).getByText(words)).toBeInTheDocument();
    }
  });

  it('draws the marks with the map\'s own classes, so the key cannot drift from the map', () => {
    render(<MapKey />);
    const k = key();
    expect(k.querySelectorAll('.custom-pin-badge').length).toBe(4);
    expect(k.querySelectorAll('.custom-pin-badge.pin-dot').length).toBe(2);
    expect(k.querySelectorAll('.custom-pin-badge.pin-tile').length).toBe(2);
    expect(k.querySelector('.custom-pin-badge.pin-approx')).not.toBeNull();
    expect(k.querySelector('.pin-hiring-dot')).not.toBeNull();
    expect(k.querySelector('.pin-tracked-star')).not.toBeNull();
    expect(k.querySelector('.marker-cluster-inner')).not.toBeNull();
    for (const size of ['small', 'medium', 'large']) expect(k.querySelector(`.mk-dot.cluster-${size}`)).not.toBeNull();
  });

  it('gives the cluster sizes the thresholds the map uses', () => {
    render(<MapKey />);
    expect(within(key()).getByText(`under ${CLUSTER_MEDIUM}`)).toBeInTheDocument();
    expect(within(key()).getByText(`${CLUSTER_MEDIUM} to ${CLUSTER_LARGE - 1}`)).toBeInTheDocument();
    expect(within(key()).getByText(`${CLUSTER_LARGE} or more`)).toBeInTheDocument();
    // and those are the thresholds the map sizes its rings by
    expect([clusterSize(CLUSTER_MEDIUM - 1), clusterSize(CLUSTER_MEDIUM), clusterSize(CLUSTER_LARGE - 1), clusterSize(CLUSTER_LARGE)]).toEqual(['small', 'medium', 'medium', 'large']);
  });

  it('says nothing of sector colours: a company is the same dot whatever it does', () => {
    render(<MapKey />);
    expect(key().textContent).not.toMatch(/colour of each sector|sector.s colour/i);
    expect(key().querySelector('details')).toBeNull();
  });

  it('hides the sample marks from screen readers: the words beside each say it all', () => {
    render(<MapKey />);
    for (const mark of key().querySelectorAll('.mk-mark')) expect(mark).toHaveAttribute('aria-hidden', 'true');
    for (const dot of key().querySelectorAll('.mk-dot')) expect(dot).toHaveAttribute('aria-hidden', 'true');
  });

  it('says a ring\'s size is how many it holds, and uses no second colour for it', () => {
    render(<MapKey />);
    expect(within(key()).getByText(/The bigger the ring, the more it holds/)).toBeInTheDocument();
    expect(key().textContent).not.toMatch(/amber|orange/i);
  });

  it('explains the firm\'s mark only when the map has firms on it', () => {
    const { unmount } = render(<MapKey />);
    expect(screen.queryByText(/rounded square/i)).not.toBeInTheDocument();
    unmount();
    render(<MapKey showInstitutions />);
    expect(within(key()).getByText(/rounded square: an investor.s office/)).toBeInTheDocument();
    expect(key().querySelector('.inst-pin')).not.toBeNull();
  });
});
