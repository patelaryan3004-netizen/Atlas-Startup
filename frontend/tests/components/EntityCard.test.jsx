import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import EntityCard, { Avatar, MetaRow } from '../../src/components/EntityCard.jsx';

describe('the one card', () => {
  it('is a picture or initial, the name, a description and a row of what it is, and the same box as every card', () => {
    const { container } = render(
      <EntityCard avatar={<Avatar name="acme" />} name="Acme" blurb="Makes things." meta={['SaaS', 'Seed', 'Sydney']}><p>More</p></EntityCard>,
    );
    const card = container.firstChild;
    expect(card).toHaveClass('card', 'entity-card');
    expect(screen.getByRole('heading', { level: 3, name: 'Acme' })).toHaveClass('entity-name');
    expect(card.querySelector('.entity-initial')).toHaveTextContent('A');
    expect(screen.getByText('Makes things.')).toHaveClass('entity-blurb');
    expect([...card.querySelectorAll('.meta-row li')].map((li) => li.textContent)).toEqual(['SaaS', 'Seed', 'Sydney']);
    expect(screen.getByText('More')).toBeInTheDocument(); // what only some have goes under the row
    // the order the brief gives: name, then the description, then the row
    expect(card.querySelector('.entity-top').nextElementSibling).toHaveClass('entity-blurb');
    expect(card.querySelector('.entity-blurb').nextElementSibling).toHaveClass('meta-row');
  });

  it('can be a link, a button or a plain box, and takes the heading level it is given', () => {
    const { rerender, container } = render(<EntityCard as="a" href="/startup/acme" name="Acme" level={2} />);
    expect(container.firstChild.tagName).toBe('A');
    expect(container.firstChild).toHaveAttribute('href', '/startup/acme');
    expect(screen.getByRole('heading', { level: 2, name: 'Acme' }).tagName).toBe('H2');
    rerender(<ul><EntityCard as="li" name="Acme" /></ul>);
    expect(container.querySelector('li')).toHaveClass('entity-card');
  });

  it('says "heading" with a role, not an h3, when the card is a button (a heading cannot sit inside one)', () => {
    let clicked = 0;
    const { container } = render(<EntityCard as="button" name="Acme" level={3} onClick={() => { clicked += 1; }} />);
    expect(container.firstChild.tagName).toBe('BUTTON');
    expect(container.firstChild).toHaveAttribute('type', 'button');
    expect(container.querySelector('h3')).toBeNull();
    expect(screen.getByRole('heading', { level: 3, name: 'Acme' })).toBeInTheDocument();
    fireEvent.click(container.firstChild);
    expect(clicked).toBe(1);
  });

  it('leaves out what it has not got: no description line, no row, no blank text', () => {
    const { container } = render(<EntityCard name="Acme" blurb="" meta={['', 'Unknown', null, undefined, 'N/A']} />);
    expect(container.querySelector('.entity-blurb')).toBeNull();
    expect(container.querySelector('.meta-row')).toBeNull();
  });

  it('keeps the whole description in the page though it shows two lines of it', () => {
    const long = 'A long description. '.repeat(20).trim();
    render(<EntityCard name="Acme" blurb={long} />);
    expect(screen.getByText(long)).toHaveAttribute('title', long);
  });
});

describe('the meta row', () => {
  it('keeps what is known in the order given, drops what is blank or "Unknown", and is a list a screen reader can name', () => {
    render(<MetaRow items={['Fintech', 'Unknown', 'Series A', '', 'Melbourne']} label="Sector, stage and city" />);
    const list = screen.getByRole('list', { name: 'Sector, stage and city' });
    expect([...list.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['Fintech', 'Series A', 'Melbourne']);
  });

  it('shows two parts that happen to be the same word: the row does not decide that two facts are one', () => {
    const { container } = render(<MetaRow items={['Sydney', 'Sydney']} />);
    expect(container.querySelectorAll('li')).toHaveLength(2);
  });
});

describe('the avatar', () => {
  it('is the first letter of the name, always, so a picture that arrives late moves nothing', () => {
    const { container } = render(<Avatar name="  zeller " website="https://zeller.example" />);
    expect(container.querySelector('.entity-initial')).toHaveTextContent('Z');
    expect(container.querySelector('.entity-avatar')).toHaveAttribute('aria-hidden', 'true');
  });

  it('asks for a logo only when the company has a website, lazily, at its size, and shows it only once it has loaded', () => {
    const { container } = render(<Avatar name="Zeller" website="https://www.zeller.example/about" />);
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).toHaveAttribute('decoding', 'async');
    expect(img).toHaveAttribute('width', '40');
    expect(img.getAttribute('src')).toContain('zeller.example');
    expect(img).not.toHaveClass('is-loaded');
    Object.defineProperty(img, 'naturalWidth', { value: 64, configurable: true });
    fireEvent.load(img);
    expect(img).toHaveClass('is-loaded');
  });

  it('counts the service\'s 16-pixel globe (what it sends for a site it does not know) as no logo, leaving the letter', () => {
    const { container } = render(<Avatar name="Antares" website="https://antares.example" />);
    const img = container.querySelector('img');
    Object.defineProperty(img, 'naturalWidth', { value: 16, configurable: true });
    fireEvent.load(img);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.entity-initial')).toHaveTextContent('A');
  });

  it('takes the logo away again if it cannot be loaded, leaving the letter', () => {
    const { container } = render(<Avatar name="Zeller" website="https://zeller.example" />);
    fireEvent.error(container.querySelector('img'));
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.entity-initial')).toHaveTextContent('Z');
  });

  it('draws no picture for someone with no website, such as a person: only their initial', () => {
    const { container } = render(<Avatar name="Ada Example" />);
    expect(container.querySelector('img')).toBeNull();
  });

  it('takes a domain as well as a website, for a firm whose record has the one and not the other', () => {
    const { container } = render(<Avatar name="Blackbird" domain="blackbird.vc" />);
    expect(container.querySelector('img').getAttribute('src')).toContain('blackbird.vc');
  });
});
