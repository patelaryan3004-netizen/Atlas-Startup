import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { lazyView, Lazy, page } from '../src/lazyLoad.jsx';

const KEY = 'auStartupChunkReload';

beforeEach(() => {
  sessionStorage.clear();
  page.reload = vi.fn();
  vi.spyOn(console, 'error').mockImplementation(() => {}); // React logs the error a boundary catches
});

describe('lazyView', () => {
  it('shows the fallback while a piece loads, then the piece, and clears the reload mark', async () => {
    sessionStorage.setItem(KEY, '1');
    let release;
    const Piece = lazyView(() => new Promise((resolve) => { release = () => resolve({ default: () => <p>the piece</p> }); }));
    render(<Lazy fallback={<p>loading it</p>}><Piece /></Lazy>);
    expect(screen.getByText('loading it')).toBeInTheDocument();
    await act(async () => release());
    expect(await screen.findByText('the piece')).toBeInTheDocument();
    expect(screen.queryByText('loading it')).not.toBeInTheDocument();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('shows nothing, not a notice, while a piece with no fallback loads', () => {
    const Piece = lazyView(() => new Promise(() => {}));
    const { container } = render(<Lazy><Piece /></Lazy>);
    expect(container).toBeEmptyDOMElement();
  });

  it('reloads the page once when a piece cannot be fetched (the page is older than the site), and marks that it did', async () => {
    const Piece = lazyView(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module')));
    render(<Lazy><Piece /></Lazy>);
    await vi.waitFor(() => expect(page.reload).toHaveBeenCalledTimes(1));
    expect(sessionStorage.getItem(KEY)).toBe('1');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument(); // the page is going away: no notice yet
  });

  it('shows a notice with a Reload button instead of reloading again, when the reload did not help', async () => {
    sessionStorage.setItem(KEY, '1');
    const Piece = lazyView(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module')));
    render(<Lazy><Piece /></Lazy>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load this part of the page.');
    expect(page.reload).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(page.reload).toHaveBeenCalledTimes(1);
  });

  it('still loads when the browser will not keep a mark (storage refused): it shows the notice rather than reloading in a loop', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('no storage'); });
    const Piece = lazyView(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module')));
    render(<Lazy><Piece /></Lazy>);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(page.reload).not.toHaveBeenCalled();
  });

  it('keeps one piece that cannot load from taking the others down', async () => {
    sessionStorage.setItem(KEY, '1');
    const Broken = lazyView(() => Promise.reject(new TypeError('gone')));
    const Fine = lazyView(() => Promise.resolve({ default: () => <p>still here</p> }));
    render(<><Lazy><Broken /></Lazy><Lazy><Fine /></Lazy></>);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(await screen.findByText('still here')).toBeInTheDocument();
  });
});
