import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Segmented, VcBadge, Badge, BookmarkButton, EmptyState, CompanyRow } from '../../src/components/brand/parts.jsx';

describe('Segmented', () => {
  const OPTIONS = [{ id: 'all', label: 'All' }, { id: 'startups', label: 'Startups' }, { id: 'vcs', label: 'VCs', badge: <VcBadge /> }];

  it('is a labelled group of buttons, the one that is on pressed, and hands a press to the page', async () => {
    const onChange = vi.fn();
    render(<Segmented label="What the map shows" options={OPTIONS} value="startups" onChange={onChange} />);
    const group = screen.getByRole('group', { name: 'What the map shows' });
    expect(within(group).getByRole('button', { name: 'Startups' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(within(group).getByRole('button', { name: /^VCs/ }));
    expect(onChange).toHaveBeenCalledWith('vcs');
  });

  it('can carry an icon and a badge in a button, and takes a class of its own', () => {
    const { container } = render(<Segmented className="inv-views" label="View" options={[{ id: 'a', label: 'A', icon: <svg data-testid="icon" /> }]} value="a" onChange={() => {}} />);
    expect(container.querySelector('.seg.inv-views')).toBeInTheDocument();
    expect(screen.getByTestId('icon')).toBeInTheDocument();
  });

  it('is worked from the keyboard: Tab to a button, Enter presses it', async () => {
    const onChange = vi.fn();
    render(<Segmented label="View" options={OPTIONS} value="all" onChange={onChange} />);
    await userEvent.tab();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Startups' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('startups');
  });
});

describe('the badges', () => {
  it('says VC on the butter yellow, and takes a tone for the rest', () => {
    const { container } = render(<><VcBadge /><Badge tone="green">Hiring</Badge><Badge>Plain</Badge></>);
    expect(container.querySelector('.badge-vc')).toHaveTextContent('VC');
    expect(container.querySelector('.badge-green')).toHaveTextContent('Hiring');
    expect(container.querySelector('.badge-quiet')).toHaveTextContent('Plain');
  });
});

describe('BookmarkButton', () => {
  it('says what it will do and whether it is on, to a screen reader as well as the eye', async () => {
    const onToggle = vi.fn();
    const { rerender } = render(<BookmarkButton name="Acme" saved={false} onToggle={onToggle} />);
    const save = screen.getByRole('button', { name: 'Save Acme' });
    expect(save).toHaveAttribute('aria-pressed', 'false');
    expect(save).toHaveAttribute('title', 'Save (kept in this browser)');
    await userEvent.click(save);
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(<BookmarkButton name="Acme" saved onToggle={onToggle} />);
    expect(screen.getByRole('button', { name: 'Remove Acme from saved' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('EmptyState', () => {
  it('says what is missing and why, and offers the one thing to do', async () => {
    const onClick = vi.fn();
    render(<EmptyState title="Nothing matches." action={<button type="button" onClick={onClick}>Clear filters</button>}>Change a filter.</EmptyState>);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Nothing matches.' })).toBeInTheDocument();
    expect(screen.getByText('Change a filter.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('CompanyRow', () => {
  const row = (props = {}) => render(<ul><CompanyRow name="Acme" website="https://acme.ai" sub="AI · Sydney" onSelect={() => {}} {...props} /></ul>);

  it('is the logo, the name and what it is in one button, and the bookmark beside it (not inside it)', async () => {
    const onSelect = vi.fn();
    const onToggleSaved = vi.fn();
    const { container } = row({ onSelect, onToggleSaved, saved: true });
    const main = screen.getByRole('button', { name: /^Acme/ });
    expect(main).toHaveTextContent('AI · Sydney');
    expect(main.querySelector('img')).toHaveAttribute('src', expect.stringContaining('acme.ai'));
    expect(main.querySelector('button')).toBeNull();
    await userEvent.click(main);
    expect(onSelect).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Remove Acme from saved' }));
    expect(onToggleSaved).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledTimes(1); // saving does not open it
    expect(container.querySelector('li.crow')).not.toHaveAttribute('aria-current');
  });

  it('marks the one that is open with aria-current, and says VC, Hiring or anything else beside the name', () => {
    const { container } = row({ selected: true, vc: true, hiring: true, extra: <span className="badge-unverified">Unverified</span> });
    expect(container.querySelector('li.crow')).toHaveAttribute('aria-current', 'true');
    const name = container.querySelector('.crow-name');
    expect(within(name).getByText('VC')).toBeInTheDocument();
    expect(within(name).getByText('Hiring')).toBeInTheDocument();
    expect(within(name).getByText('Unverified')).toBeInTheDocument();
  });

  it('has no bookmark when the page gives it no way to save, and no line for what it is when there is none', () => {
    row({ sub: '' });
    expect(screen.queryByRole('button', { name: /^Save|^Remove/ })).not.toBeInTheDocument();
    expect(document.querySelector('.crow-sub')).toBeNull();
  });

  it('draws an investor from its domain, and writes the name as text', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const { container } = render(<ul><CompanyRow name={evil} domain="fund.vc" vc onSelect={() => {}} /></ul>);
    expect(container.querySelector('.crow-name > span')).toHaveTextContent(evil);
    expect(container.querySelectorAll('img[src*="fund.vc"]')).toHaveLength(1);
    expect(container.querySelector('.crow-name img')).toBeNull();
  });
});
