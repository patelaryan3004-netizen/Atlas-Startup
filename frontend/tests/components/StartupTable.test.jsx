import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StartupTable, { columnsFor } from '../../src/components/StartupTable.jsx';

const ago = (days) => new Date(Date.now() - days * 86400000).toISOString();
const soon = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const company = (over = {}) => ({
  name: 'Canva', slug: 'canva', sector: 'SaaS', stage: 'Series D+', city: 'Sydney', hiring: true, hiringState: 'hiring', verified: true,
  website: 'https://www.canva.com', last_verified_at: ago(3), ...over,
});
const mount = (items, props = {}) => render(<StartupTable items={items} count={items.length} sort="name" onSort={() => {}} onSelectStartup={() => {}} {...props} />);
const headers = () => screen.getAllByRole('columnheader').map((h) => h.textContent.replace(/[↑↓]/g, '').trim());

describe('the list as a table', () => {
  it('has Name, Stage, Hiring and Last verified for every company, and no column for a fact no company has', () => {
    mount([company(), company({ name: 'Zeller', slug: 'zeller' })]);
    expect(headers()).toEqual(['Name', 'Stage', 'Hiring', 'Last verified']);
  });

  it('adds Team size, Remote policy and Tech stack, in that place, once some company in the list has one', () => {
    mount([company({ team_size: 40 }), company({ name: 'B', slug: 'b', remote_policy: 'remote-au' }), company({ name: 'C', slug: 'c', tech_stack: ['Go'] })]);
    expect(headers()).toEqual(['Name', 'Stage', 'Team size', 'Remote policy', 'Tech stack', 'Hiring', 'Last verified']);
  });

  it('works out the columns from what the list holds', () => {
    expect(columnsFor([company()]).map((c) => c.key)).toEqual(['name', 'stage', 'hiring', 'verified']);
    expect(columnsFor([company({ team_size: 5 })]).map((c) => c.key)).toContain('team');
    expect(columnsFor([company({ remote_policy: 'hybrid' })]).map((c) => c.key)).toContain('remote');
    expect(columnsFor([company({ remote_policy: 'nomad' })]).map((c) => c.key)).not.toContain('remote'); // a policy the directory does not know is not shown
    expect(columnsFor([company({ tech_stack: [] })]).map((c) => c.key)).not.toContain('tech');
    expect(columnsFor([]).map((c) => c.key)).toEqual(['name', 'stage', 'hiring', 'verified']);
  });

  it('says hybrid and on-site in words too', () => {
    mount([company({ remote_policy: 'hybrid' }), company({ name: 'B', slug: 'b', remote_policy: 'onsite' })]);
    expect(screen.getByText('Hybrid')).toBeInTheDocument();
    expect(screen.getByText('On-site')).toBeInTheDocument();
  });

  it('says each fact in words: the team as a number, the policy as a phrase, the tools as tags with a count of the rest', () => {
    mount([company({ team_size: 1234, remote_policy: 'remote-global', tech_stack: ['Go', 'Rust', 'TypeScript', 'Python', 'Kotlin', 'Swift'] })]);
    const row = screen.getAllByRole('row')[1];
    expect(within(row).getByText('1234')).toHaveClass('st-num');
    expect(within(row).getByText('Remote, worldwide')).toBeInTheDocument();
    const tags = within(row).getByRole('list', { name: 'Tech stack' });
    expect([...tags.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['Go', 'Rust', 'TypeScript', 'Python', '+2']);
    expect(within(tags).getByText('+2')).toHaveAttribute('title', 'Kotlin, Swift');
  });

  it('shows hiring in the same words as everywhere, and when a company was last checked, muted once it needs another check', () => {
    mount([
      company(),
      company({ name: 'Checked Co', slug: 'k', hiring: false, hiringState: 'checked', hiring_checked_at: '2026-10-05T03:59:04.292Z', last_verified_at: ago(90) }),
      company({ name: 'None Co', slug: 'n', hiring: false, hiringState: 'unverified', last_verified_at: undefined }),
    ]);
    expect(screen.getByText('● Hiring now')).toBeInTheDocument();
    expect(screen.getByText('Hiring (checked 5 Oct)')).toBeInTheDocument();
    expect(screen.getByText('Roles unverified')).toBeInTheDocument();
    expect(screen.getByText('Verified 3 days ago')).toBeInTheDocument();
    expect(screen.getByText('Needs re-check')).toHaveClass('verified-note-stale');
    expect(document.querySelectorAll('.startup-table .verified-note')).toHaveLength(2); // none for the company with no date
  });

  it('writes nothing for what it does not know: an empty cell, never "Unknown" or "N/A"', () => {
    const { container } = mount([company({ stage: 'Unknown', sector: '', last_verified_at: null })]);
    const cells = [...container.querySelectorAll('tbody td')].map((td) => td.textContent);
    expect(cells[0]).toBe(''); // the stage
    expect(container.textContent).not.toMatch(/N\/A|null|undefined|Unknown/);
  });

  it('opens the company from its name, and marks the open one, a tracked one, one with an event soon, and one nobody has verified', async () => {
    const onSelectStartup = vi.fn();
    const c = company({ name: 'Open Co', slug: 'o', verified: false, events: [{ title: 'Demo day', date: soon(2), url: null }] });
    const { container } = mount([c, company({ name: 'Other', slug: 'x' })], { onSelectStartup, selectedName: 'Open Co', trackedNames: new Set(['Open Co']) });
    await userEvent.click(screen.getByRole('button', { name: 'Open Co' }));
    expect(onSelectStartup).toHaveBeenCalledWith(c);
    expect(container.querySelector('.st-open-selected')).not.toBeNull();
    const row = screen.getAllByRole('row')[1];
    expect(within(row).getByTitle('Tracked')).toBeInTheDocument();
    expect(within(row).getByTitle('Demo day')).toHaveClass('event-badge');
    expect(within(row).getByText('Unverified')).toHaveClass('badge-unverified');
    expect(within(screen.getAllByRole('row')[2]).queryByText('Unverified')).toBeNull();
  });

  it('is a labelled table: a caption for a screen reader, column headers, and a row header for each name', () => {
    mount([company(), company({ name: 'Zeller', slug: 'zeller' })], { count: 2 });
    expect(screen.getByRole('table')).toHaveAccessibleName('2 startups, sorted by Name');
    expect(screen.getAllByRole('rowheader').map((h) => h.querySelector('.st-name-text').textContent)).toEqual(['Canva', 'Zeller']);  });
});

describe('sorting the table by a column', () => {
  it('has a button in the header of each column that sorts, and none on Tech stack', () => {
    mount([company({ tech_stack: ['Go'], team_size: 3, remote_policy: 'remote-au' })]);
    for (const name of ['Name', 'Stage', 'Team size', 'Remote policy', 'Hiring', 'Last verified']) expect(screen.getByRole('button', { name })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tech stack' })).toBeNull();
  });

  it('asks for the sort of the column pressed, and says which one is on and which way it runs', async () => {
    const onSort = vi.fn();
    const { rerender } = mount([company({ team_size: 3 })], { onSort, sort: 'name' });
    expect(screen.getByRole('columnheader', { name: /Name/ })).toHaveAttribute('aria-sort', 'ascending');
    expect(screen.getByRole('columnheader', { name: /Last verified/ })).not.toHaveAttribute('aria-sort');
    await userEvent.click(screen.getByRole('button', { name: 'Team size' }));
    expect(onSort).toHaveBeenLastCalledWith('team');
    await userEvent.click(screen.getByRole('button', { name: 'Last verified' }));
    expect(onSort).toHaveBeenLastCalledWith('verified');
    rerender(<StartupTable items={[company({ team_size: 3 })]} count={1} sort="team" onSort={onSort} onSelectStartup={() => {}} />);
    expect(screen.getByRole('columnheader', { name: /Team size/ })).toHaveAttribute('aria-sort', 'descending'); // the biggest first
    expect(screen.getByRole('columnheader', { name: /Name/ })).not.toHaveAttribute('aria-sort');
  });
});
