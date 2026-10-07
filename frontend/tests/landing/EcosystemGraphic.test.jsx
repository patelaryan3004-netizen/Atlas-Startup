import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import EcosystemGraphic from '../../src/components/landing/EcosystemGraphic.jsx';

const pin = (name, lat, lng) => [name.toLowerCase(), name, lat, lng, 'SaaS', 'Sydney', 1, ''];
const pins = [pin('Canva', -33.88, 151.21), pin('SafetyCulture', -33.884, 151.21), pin('Airwallex', -37.82, 144.96)];
const companies = [
  { name: 'Canva', city: 'Sydney', hiring: true },
  { name: 'Airwallex', city: 'Melbourne', hiring: true },
];

describe('EcosystemGraphic', () => {
  it('is only the country in dots, and hidden from assistive technology, until there is something to say', () => {
    const { container } = render(<EcosystemGraphic />);
    expect(container.querySelector('.eco-grid').getAttribute('d')).toMatch(/^M/);
    expect(container.querySelector('figure')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelectorAll('.eco-dot')).toHaveLength(0);
    expect(container.querySelectorAll('.eco-city, .eco-chip')).toHaveLength(0);
    expect(screen.queryByText(/Each dot/)).not.toBeInTheDocument();
  });

  it('makes up no company: companies with nowhere on the drawing to hang are not named', () => {
    render(<EcosystemGraphic companies={companies} />);
    expect(screen.queryByText('Canva')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('lights a dot for each place the pins fall in, not for each pin', () => {
    const { container } = render(<EcosystemGraphic pins={pins} />);
    expect(container.querySelectorAll('.eco-dot')).toHaveLength(2); // two in Sydney share a dot
    expect(container.querySelector('figure')).not.toHaveAttribute('aria-hidden');
  });

  it('names the capitals that have startups, with how many, and no others', () => {
    const { container } = render(<EcosystemGraphic pins={pins} />);
    const labels = [...container.querySelectorAll('.eco-city')].map((li) => li.textContent.replace(/\s+/g, ' ').trim());
    expect(labels).toEqual(['Sydney 2 startups', 'Melbourne 1 startup']); // the word is there for screen readers
  });

  it('names real companies as links into the app, with where they are and that they are hiring', () => {
    render(<EcosystemGraphic pins={pins} companies={companies} />);
    expect(screen.getByRole('link', { name: 'Canva, Sydney, hiring now' })).toHaveAttribute('href', '/?view=list&search=Canva');
    expect(screen.getByRole('link', { name: 'Airwallex, Melbourne, hiring now' })).toHaveAttribute('href', '/?view=list&search=Airwallex');
  });

  it('encodes a company\'s name in the link', () => {
    render(<EcosystemGraphic pins={pins} companies={[{ name: 'Q&A Co', city: 'Sydney', hiring: true }]} />);
    expect(screen.getByRole('link', { name: /Q&A Co/ })).toHaveAttribute('href', '/?view=list&search=Q%26A%20Co');
  });

  it('says what a dot is, and mentions amber only when a named company is hiring', () => {
    const { rerender } = render(<EcosystemGraphic pins={pins} companies={companies} />);
    expect(screen.getByText(/Each dot is about 90/)).toHaveTextContent('larger means more startups with a known location');
    expect(screen.getByText(/Each dot is about 90/)).toHaveTextContent('Amber marks a company that is hiring now');

    rerender(<EcosystemGraphic pins={pins} companies={[{ name: 'Canva', city: 'Sydney', hiring: false }]} />);
    expect(screen.getByText(/Each dot is about 90/)).not.toHaveTextContent('Amber');
    expect(screen.getByRole('link', { name: 'Canva, Sydney' })).toBeInTheDocument();
  });

  it('rings a capital known only to its city-level group, and never draws it as a dot', () => {
    const { container } = render(<EcosystemGraphic areas={[{ lat: -42.88, lng: 147.33, count: 2 }]} />);
    expect(container.querySelectorAll('.eco-ring')).toHaveLength(1);
    expect(container.querySelectorAll('.eco-dot')).toHaveLength(0);
    expect(container.querySelector('.eco-city')).toHaveTextContent('Hobart 2');
    expect(container.querySelector('figure')).not.toHaveAttribute('aria-hidden');
  });

  it('joins the capitals it labels with routes, and draws a line from each named company to its capital', () => {
    const { container } = render(<EcosystemGraphic pins={pins} companies={companies} />);
    expect(container.querySelectorAll('.eco-route')).toHaveLength(1); // Sydney to Melbourne
    expect(container.querySelectorAll('.eco-leader')).toHaveLength(2);
  });
});
