import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import MapKey from '../../src/components/MapKey.jsx';
import { clusterSize, CLUSTER_MEDIUM, CLUSTER_LARGE } from '../../src/mapPins.js';

const key = () => screen.getByRole('region', { name: 'Map key' });

describe('MapKey', () => {
  it('has no numbered rings and no dashed city ring in the key of the map page, which draws neither (places={false})', () => {
    render(<MapKey places={false} />);
    expect(screen.getByText('A startup')).toBeInTheDocument(); // the logo pins are still explained
    expect(screen.queryByText('Places')).not.toBeInTheDocument();
    expect(screen.queryByText(/numbered ring|dashed ring|known only to a city/i)).not.toBeInTheDocument();
    expect(key().querySelector('.marker-cluster-inner, .mk-ring, .mk-sizes')).toBeNull();
  });

  it('explains the small dots and the investors drawn one by one in the key of the map page, and the older map\'s key does not mention dots', () => {
    const { unmount } = render(<MapKey places={false} />);
    expect(screen.getByText(/A small dot: there is no room for its logo/)).toBeInTheDocument();
    expect(screen.getByText(/A small yellow dot: a firm with no room for its logo/)).toBeInTheDocument();
    expect(screen.getByText(/A firm known only to its city has no mark: it is in the list beside the map/)).toBeInTheDocument();
    expect(key().querySelector('.pin-dot-vc')).not.toBeNull();
    expect(screen.queryByText(/dashed edge: only the firm/)).not.toBeInTheDocument(); // the map page draws no city-level firm
    expect(screen.queryByText(/spread a little/)).not.toBeInTheDocument();
    unmount();
    render(<MapKey />);
    expect(screen.queryByText(/A small dot|small yellow dot|known only to its city has no mark/)).not.toBeInTheDocument();
    expect(screen.getByText(/drawn at the city.s centre and is not an office/)).toBeInTheDocument(); // the older map still draws a city's firms at its centre
  });

  it('keeps the investors\' offices in the key of the map page when they are drawn', () => {
    render(<MapKey places={false} showInstitutions />);
    expect(screen.getByText('Places')).toBeInTheDocument();
    expect(screen.getByText(/an investor.s office/i)).toBeInTheDocument();
    expect(screen.queryByText(/numbered ring|dashed ring/i)).not.toBeInTheDocument();
  });

  it('is a labelled section in the page, with no button of its own: it sits in the filter panel\'s Map tab', () => {
    render(<MapKey />);
    expect(key()).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('says what every mark on the map means', () => {
    render(<MapKey />);
    for (const words of [/rounded square with the company.s logo, or its first letter/, /mint dot: hiring now/i, /A star: a company you saved/i, /dashed edge: placed at the suburb/i, /square with VC on it and a solid edge: an office/i, /square with VC on it and a dashed edge: only the firm.s city/i, /gives no street address for it that could be placed/i, /numbered ring/i, /dashed ring/i, /Names appear under the pins/]) {
      expect(within(key()).getByText(words)).toBeInTheDocument();
    }
  });

  it('draws the marks with the map\'s own classes, so the key cannot drift from the map', () => {
    render(<MapKey />);
    const k = key();
    expect(k.querySelectorAll('.custom-pin-badge').length).toBe(6);
    expect(k.querySelectorAll('.custom-pin-badge.pin-tile').length).toBe(6); // every mark is a tile: there is no dot
    expect(k.querySelector('.pin-dot')).toBeNull();
    expect(k.querySelectorAll('.custom-pin-badge.pin-approx').length).toBe(2); // a suburb, and a VC (a city)
    expect(k.querySelectorAll('.custom-pin-badge.pin-vc').length).toBe(2);
    expect(k.querySelectorAll('.custom-pin-badge.pin-vc:not(.pin-approx)').length).toBe(1); // a VC at its office address has a solid edge
    expect(k.querySelector('.custom-pin-badge.pin-vc .pin-vc-badge')).toHaveTextContent('VC');
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

  it('says nothing of sector colours: a company is the same tile whatever it does', () => {
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
    expect(screen.queryByText(/investor.s office/i)).not.toBeInTheDocument();
    unmount();
    render(<MapKey showInstitutions />);
    expect(within(key()).getByText(/rounded square: an investor.s office/)).toBeInTheDocument();
    expect(key().querySelector('.inst-pin')).not.toBeNull();
  });
});
