import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PersonCard from '../../src/components/people/PersonCard.jsx';
import InstitutionCard from '../../src/components/people/InstitutionCard.jsx';
import RequestEdit from '../../src/components/people/RequestEdit.jsx';
import TallyDialog from '../../src/components/people/TallyDialog.jsx';
import { NOMINATE_URL, REMOVAL_URL, NOMINATE_FIELDS, isConfigured, embedUrl, removalHref } from '../../src/tally.js';

const person = (over = {}) => ({
  id: 'ada-example', name: 'Ada Example', type: 'person', roleType: 'founder', title: 'Co-founder', orgName: 'Example Co', orgType: 'company', city: 'Sydney',
  whyFollow: 'Built a thing people use.', links: { website: 'https://ada.example', linkedin: 'https://au.linkedin.com/in/ada', x: 'https://x.com/ada' },
  sources: [{ label: 'Example Co team page', url: 'https://example.example/team' }], verifiedAt: '2026-10-01', vouches: [], ...over,
});
const institution = (over = {}) => ({
  id: 'example-capital', name: 'Example Capital', type: 'institution', city: 'Melbourne', stageFocus: 'Seed, Series A', sectors: ['Software', 'Health'], website: 'https://capital.example',
  sources: [{ label: 'Their site', url: 'https://capital.example/about' }], verifiedAt: '2026-10-01', ...over,
});
const inList = (ui) => render(<ul>{ui}</ul>);

describe('PersonCard', () => {
  it('says who they are, where, and why they are worth following, in the app\'s one card', () => {
    const { container } = inList(<PersonCard person={person()} />);
    expect(container.querySelector('li')).toHaveClass('card', 'entity-card', 'person-card');
    expect(screen.getByRole('heading', { level: 2, name: 'Ada Example' })).toBeInTheDocument();
    // the row of who they are, a dot between each: role, organisation, place
    expect([...container.querySelectorAll('.meta-row li')].map((li) => li.textContent)).toEqual(['Co-founder', 'Example Co', 'Sydney']);
    expect(container.querySelector('.entity-initial')).toHaveTextContent('A');
    expect(container.querySelector('.entity-avatar img')).toBeNull(); // a person has no picture
    expect(screen.getByText('Built a thing people use.')).toHaveClass('entity-blurb');
    expect(screen.getByText('Verified 1 Oct 2026')).toBeInTheDocument();
  });

  it('opens every link in a new tab that cannot reach back, and says so to a screen reader', () => {
    inList(<PersonCard person={person()} />);
    const links = screen.getByRole('list', { name: 'Ada Example online' });
    for (const [name, href] of [['Website', 'https://ada.example'], ['LinkedIn', 'https://au.linkedin.com/in/ada'], ['X', 'https://x.com/ada']]) {
      const link = within(links).getByRole('link', { name: `${name} (opens in a new tab)` });
      expect(link).toHaveAttribute('href', href);
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
    const source = screen.getByRole('link', { name: 'Example Co team page (opens in a new tab)' });
    expect(source).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('leaves out a line with nothing behind it: no link list, no sources, no date, no vouch line', () => {
    const { container } = inList(<PersonCard person={person({ title: null, orgName: null, city: null, whyFollow: null, links: {}, sources: [], verifiedAt: null })} />);
    expect(container.querySelector('.person-role, .person-city, .person-why, .person-links, .person-sources, .person-verified, .person-vouches')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Ada Example' })).toBeInTheDocument();
    expect(screen.getByText('Request edit or removal')).toBeInTheDocument(); // every card has it
  });

  it('shows "Vouched by N" only where there are vouches, and each as a quotation with who said it', async () => {
    const { container } = inList(<PersonCard person={person({ vouches: [{ name: 'Sam Lee', role: 'Investor', note: 'Backed their seed round.' }, { name: 'Kim Wu', role: null, note: 'Great to work with.' }] })} />);
    await userEvent.click(screen.getByText('Vouched by 2'));
    const quotes = [...container.querySelectorAll('.person-vouches blockquote')].map((q) => q.textContent);
    expect(quotes).toEqual(['Backed their seed round.', 'Great to work with.']);
    expect(screen.getByText('Sam Lee').closest('figcaption')).toHaveTextContent('Sam Lee, Investor');
  });

  it('shows no vouch line when there are none', () => {
    inList(<PersonCard person={person({ vouches: [] })} />);
    expect(screen.queryByText(/Vouched by/)).not.toBeInTheDocument();
  });

  it('marks a placeholder as not real', () => {
    inList(<PersonCard person={person({ placeholder: true })} />);
    expect(screen.getByText(/not a real person/)).toBeInTheDocument();
  });

  it('opens the page the app already has for them in the app on a plain click, and leaves a new-tab click to the browser', async () => {
    const open = vi.fn();
    inList(<PersonCard person={person({ href: '/investors/people/ada' })} onOpenInternal={open} />);
    const link = screen.getByRole('link', { name: 'Ada Example' });
    expect(link).toHaveAttribute('href', '/investors/people/ada');
    await userEvent.click(link);
    expect(open).toHaveBeenCalledWith('/investors/people/ada');
    open.mockClear();
    fireEvent.click(link, { ctrlKey: true });
    expect(open).not.toHaveBeenCalled();
  });

  it('can be any element and any heading level, so it fits where it sits', () => {
    const { container } = render(<PersonCard as="div" level={3} person={person()} />);
    expect(container.firstChild.tagName).toBe('DIV');
    expect(screen.getByRole('heading', { level: 3, name: 'Ada Example' })).toBeInTheDocument();
  });

  it('shows what it is given as text, never as markup', () => {
    const { container } = inList(<PersonCard person={person({ name: '<img src=x onerror=alert(1)>', whyFollow: '<b>bold</b>' })} />);
    expect(container.querySelector('img, b')).toBeNull();
    expect(screen.getByText('<b>bold</b>')).toBeInTheDocument();
  });
});

describe('InstitutionCard', () => {
  it('says where the firm is and what it backs, with its website and the pages behind it', () => {
    inList(<InstitutionCard institution={institution()} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Example Capital' })).toBeInTheDocument();
    expect(screen.getByText('Melbourne')).toBeInTheDocument();
    expect(screen.getByText('Seed, Series A')).toBeInTheDocument();
    expect(screen.getByText('Software, Health')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Website (opens in a new tab)' })).toHaveAttribute('href', 'https://capital.example');
    expect(screen.getByText('Verified 1 Oct 2026')).toBeInTheDocument();
    expect(screen.getByText('Request edit or removal')).toBeInTheDocument();
  });

  it('opens a published investor\'s own page in the app', async () => {
    const open = vi.fn();
    inList(<InstitutionCard institution={institution({ href: '/investors/example-capital' })} onOpenInternal={open} />);
    await userEvent.click(screen.getByRole('link', { name: 'Example Capital' }));
    expect(open).toHaveBeenCalledWith('/investors/example-capital');
  });

  it('leaves out what it does not know', () => {
    const { container } = inList(<InstitutionCard institution={institution({ city: null, stageFocus: null, sectors: [], website: null, sources: [], verifiedAt: null })} />);
    expect(container.querySelector('.person-city, .person-facts, .person-links, .person-sources, .person-verified')).toBeNull();
  });
});

describe('the forms', () => {
  it('has placeholders for the two forms until the owner makes them, and a real address is only a Tally one', () => {
    expect(NOMINATE_URL).toBe('TALLY_NOMINATE_URL_HERE');
    expect(REMOVAL_URL).toBe('TALLY_REMOVAL_URL_HERE');
    expect(isConfigured(NOMINATE_URL)).toBe(false);
    expect(isConfigured('https://tally.so/r/abc123')).toBe(true);
    expect(isConfigured('http://tally.so/r/abc')).toBe(false);
    expect(isConfigured('https://evil.example/https://tally.so/r/x')).toBe(false);
    expect(isConfigured(undefined)).toBe(false);
  });

  it('turns a share link into the address Tally lets a page frame, and fills in the removal form with the card it is about', () => {
    expect(embedUrl('https://tally.so/r/abc123')).toBe('https://tally.so/embed/abc123?hideTitle=1&alignLeft=1&transparentBackground=1');
    expect(embedUrl('https://tally.so/r/abc123?x=1')).toContain('/embed/abc123?hideTitle=1');
    expect(removalHref('https://tally.so/r/rem1', { name: 'Ada Example', id: 'ada-example', type: 'person' })).toBe('https://tally.so/r/rem1?name=Ada+Example&id=ada-example&type=person');
  });

  it('asks for what the nomination needs: name, link, role type, why, and that they know', () => {
    expect(NOMINATE_FIELDS).toEqual(expect.arrayContaining([
      'Name', 'A link to them', 'Role type: founder, operator or investor', 'Why they are worth following', 'A checkbox: I am nominating myself or have asked them',
    ]));
  });
});

describe('Request edit or removal', () => {
  const entry = { id: 'ada-example', name: 'Ada Example', type: 'person' };

  it('is a link to the removal form, in a new tab, about this card, once the form is set up', () => {
    render(<RequestEdit entry={entry} url="https://tally.so/r/rem1" />);
    const link = screen.getByRole('link', { name: 'Request edit or removal: Ada Example' });
    expect(link).toHaveAttribute('href', 'https://tally.so/r/rem1?name=Ada+Example&id=ada-example&type=person');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('is never a link to the placeholder: until the form is set up it is a button that says so', async () => {
    const { container } = render(<RequestEdit entry={entry} />);
    expect(container.querySelector('a')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Request edit or removal: Ada Example' }));
    const dialog = screen.getByRole('dialog', { name: 'Request an edit or removal' });
    expect(dialog).toHaveTextContent('This form is not set up yet');
    expect(dialog).toHaveTextContent('About Ada Example.');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('TallyDialog', () => {
  it('shows the Tally form in a frame once it is set up', () => {
    render(<TallyDialog title="Nominate someone" url="https://tally.so/r/nom1" onClose={() => {}} />);
    expect(screen.getByTitle('Nominate someone')).toHaveAttribute('src', 'https://tally.so/embed/nom1?hideTitle=1&alignLeft=1&transparentBackground=1');
    expect(screen.queryByText(/not set up yet/)).not.toBeInTheDocument();
  });

  it('says plainly that it is not set up, and what it will ask, rather than showing a broken frame', () => {
    render(<TallyDialog title="Nominate someone" url={NOMINATE_URL} fields={NOMINATE_FIELDS} onClose={() => {}} />);
    expect(screen.queryByTitle('Nominate someone')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('This form is not set up yet');
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(NOMINATE_FIELDS);
  });

  it('closes from its button, the page behind it and Escape, and stays open when its own panel is pressed', async () => {
    const onClose = vi.fn();
    render(<TallyDialog title="Nominate someone" url={NOMINATE_URL} onClose={onClose} />);
    await userEvent.click(screen.getByRole('heading', { name: 'Nominate someone' }));
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
