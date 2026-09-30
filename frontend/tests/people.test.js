import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/curatedLists.js', () => ({
  curatedLists: [
    {
      id: 'people-to-follow',
      type: 'people',
      people: [
        { name: 'Niki Scevak', role: 'Co-founder & Partner', company: 'Blackbird Ventures', why: 'Backed Canva and Airwallex early.', link: 'https://www.blackbird.vc/team/niki-scevak' },
        { name: 'Scott Farquhar', role: 'Co-founder', company: 'Atlassian', why: 'Co-founded Atlassian in 2002.' },
        { name: 'No Link Person', role: 'Operator', company: 'Some Co', why: '' },
      ],
    },
  ],
}));

import { getPersonProfile, PERSON_ROLES } from '../src/people.js';
import { RELATIONSHIP_TYPES } from '../src/relationships.js';

const startups = [
  { name: 'Canva', website: 'https://www.canva.com', founders: ['Melanie Perkins', 'Cliff Obrecht'] },
  { name: 'Airwallex', website: 'https://www.airwallex.com', founders: ['Jack Zhang'] },
  { name: 'Second Co', website: null, founders: ['Melanie Perkins'] },
];

describe('getPersonProfile', () => {
  it('lists Founder/Investor/Operator/Advisor/Ecosystem as the known role vocabulary', () => {
    expect(PERSON_ROLES).toEqual(['Founder', 'Investor', 'Operator', 'Advisor', 'Ecosystem']);
  });

  it('builds a founder-only profile from startups.json alone when there is no curated entry', () => {
    const p = getPersonProfile('Jack Zhang', startups);
    expect(p.roles).toEqual(['Founder']);
    expect(p.role).toBe('Founder');
    expect(p.currentCompany).toBe('Airwallex');
    expect(p.foundedAt).toEqual([{ company: 'Airwallex', website: 'https://www.airwallex.com' }]);
    expect(p.notableWork).toBeNull();
    expect(p.link).toBeNull();
  });

  it('lists every company a name appears in founders[] for, not just the first', () => {
    const p = getPersonProfile('Melanie Perkins', startups);
    expect(p.foundedAt).toEqual([
      { company: 'Canva', website: 'https://www.canva.com' },
      { company: 'Second Co', website: null },
    ]);
    expect(p.currentCompany).toBe('Canva');
  });

  it('merges a curated entry with startups.json founder data by exact name match', () => {
    const p = getPersonProfile('Niki Scevak', startups);
    expect(p.role).toBe('Co-founder & Partner');
    expect(p.currentCompany).toBe('Blackbird Ventures');
    expect(p.notableWork).toBe('Backed Canva and Airwallex early.');
    expect(p.link).toBe('https://www.blackbird.vc/team/niki-scevak');
  });

  it('derives the Founder role from verified role text even when the company is not in startups.json', () => {
    const p = getPersonProfile('Scott Farquhar', startups);
    expect(p.roles).toEqual(['Founder']);
    expect(p.foundedAt).toEqual([]);
    expect(p.currentCompany).toBe('Atlassian');
  });

  it('derives both Founder and Investor roles when the verified role text says so', () => {
    const p = getPersonProfile('Niki Scevak', startups);
    expect(p.roles).toEqual(['Founder', 'Investor']);
  });

  it('never fabricates industry, location, previous companies or relationships - always empty until a real source exists', () => {
    const p = getPersonProfile('Niki Scevak', startups);
    expect(p.industry).toBeNull();
    expect(p.location).toBeNull();
    expect(p.previousCompanies).toEqual([]);
    expect(p.relationships).toEqual([]);
  });

  it('returns an all-empty profile for a name matching nothing, rather than guessing', () => {
    const p = getPersonProfile('Nobody Real', startups);
    expect(p.roles).toEqual([]);
    expect(p.role).toBeNull();
    expect(p.currentCompany).toBeNull();
    expect(p.foundedAt).toEqual([]);
    expect(p.notableWork).toBeNull();
    expect(p.link).toBeNull();
  });

  it('handles a curated entry with no link or why without crashing, normalizing blank text to null', () => {
    const p = getPersonProfile('No Link Person', startups);
    expect(p.role).toBe('Operator');
    expect(p.notableWork).toBeNull();
    expect(p.link).toBeNull();
  });

  it('populates relationships from real typed edges (COFOUNDED, since Canva has two founders on file)', () => {
    const p = getPersonProfile('Melanie Perkins', startups);
    expect(p.relationships).toEqual([
      { type: 'COFOUNDED', from: { type: 'Person', id: 'Melanie Perkins' }, to: { type: 'Company', id: 'Canva' } },
      { type: 'FOUNDED', from: { type: 'Person', id: 'Melanie Perkins' }, to: { type: 'Company', id: 'Second Co' } },
    ]);
  });

  it('uses the same relationship-type vocabulary as relationships.js, not a separate ad-hoc list', () => {
    expect(RELATIONSHIP_TYPES).toContain('FOUNDED');
    expect(RELATIONSHIP_TYPES).toContain('COFOUNDED');
  });
});
