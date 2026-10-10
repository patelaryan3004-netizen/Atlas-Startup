import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ListBanner from '../../src/components/ListBanner.jsx';
import PageNotFound from '../../src/components/PageNotFound.jsx';

const list = { id: 'au-fintech', name: 'Australian Fintech Startups', description: 'Companies building financial products and infrastructure.' };

afterEach(() => { vi.unstubAllGlobals(); });

describe('ListBanner', () => {
  it('says what the list is, and how many companies are in it', () => {
    render(<ListBanner list={list} count={27} url="https://x.test/lists/au-fintech" onAllLists={() => {}} />);
    expect(screen.getByRole('region', { name: 'List: Australian Fintech Startups' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Australian Fintech Startups' })).toBeInTheDocument();
    expect(screen.getByText('Companies building financial products and infrastructure.')).toBeInTheDocument();
    expect(screen.getByText('27 companies')).toBeInTheDocument();
  });

  it('says one company in the singular, and nothing while the count is not known', () => {
    const view = render(<ListBanner list={list} count={1} url="https://x.test/l" onAllLists={() => {}} />);
    expect(screen.getByText('1 company')).toBeInTheDocument();
    view.rerender(<ListBanner list={list} count={null} url="https://x.test/l" onAllLists={() => {}} />);
    expect(screen.queryByText(/compan/)).not.toBeInTheDocument();
  });

  it('copies the list\'s address when Share this list is pressed, and says it did', async () => {
    const writeText = vi.fn().mockResolvedValue();
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    render(<ListBanner list={list} count={3} url="https://x.test/lists/au-fintech" onAllLists={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Share this list' }));
    expect(writeText).toHaveBeenCalledWith('https://x.test/lists/au-fintech');
    expect(await screen.findByRole('button', { name: 'Link copied' })).toBeInTheDocument();
  });

  it('does not fail where the clipboard is not available', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
    render(<ListBanner list={list} count={3} url="https://x.test/l" onAllLists={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Share this list' }));
    expect(screen.getByRole('button', { name: 'Share this list' })).toBeInTheDocument();
  });

  it('goes to all the lists on request', async () => {
    const onAllLists = vi.fn();
    render(<ListBanner list={list} count={3} url="https://x.test/l" onAllLists={onAllLists} />);
    await userEvent.click(screen.getByRole('button', { name: 'All lists' }));
    expect(onAllLists).toHaveBeenCalledTimes(1);
  });
});

describe('PageNotFound', () => {
  it('says what is missing and offers the way back, and closes on Escape and on the backdrop', async () => {
    const onClose = vi.fn();
    render(<PageNotFound title="This list does not exist." onClose={onClose}>The link may be mistyped.</PageNotFound>);
    expect(screen.getByRole('dialog', { name: 'This list does not exist.' })).toBeInTheDocument();
    expect(screen.getByText('The link may be mistyped.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back to the map' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
