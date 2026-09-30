import { describe, it, expect } from 'vitest';
import {
  RELATIONSHIP_TYPES,
  NODE_TYPES,
  buildRelationships,
  relationshipsForCompany,
  relationshipsForPerson,
} from '../src/relationships.js';

describe('relationship type vocabulary', () => {
  it('documents all 11 relationship types from the ecosystem-graph brief, even though most have no data yet', () => {
    expect(RELATIONSHIP_TYPES).toEqual([
      'FOUNDED', 'COFOUNDED', 'WORKED_AT', 'INVESTED_IN', 'ADVISED', 'MENTORED',
      'EMPLOYED', 'PARTNERED_WITH', 'ACQUIRED', 'INCUBATED_BY', 'ACCELERATED_BY',
    ]);
  });

  it('documents Person/Company/Firm/Accelerator as node types', () => {
    expect(NODE_TYPES).toEqual(['Person', 'Company', 'Firm', 'Accelerator']);
  });
});

describe('buildRelationships', () => {
  it('creates a FOUNDED edge for a solo founder', () => {
    const edges = buildRelationships([{ name: 'Airwallex', founders: ['Jack Zhang'], investors: [] }]);
    expect(edges).toEqual([
      { type: 'FOUNDED', from: { type: 'Person', id: 'Jack Zhang' }, to: { type: 'Company', id: 'Airwallex' } },
    ]);
  });

  it('creates a COFOUNDED edge for each name when a company has more than one founder', () => {
    const edges = buildRelationships([{ name: 'Canva', founders: ['Melanie Perkins', 'Cliff Obrecht'], investors: [] }]);
    expect(edges).toEqual([
      { type: 'COFOUNDED', from: { type: 'Person', id: 'Melanie Perkins' }, to: { type: 'Company', id: 'Canva' } },
      { type: 'COFOUNDED', from: { type: 'Person', id: 'Cliff Obrecht' }, to: { type: 'Company', id: 'Canva' } },
    ]);
  });

  it('creates an INVESTED_IN edge per investor, typed as Firm (no per-partner data exists)', () => {
    const edges = buildRelationships([{ name: 'Canva', founders: [], investors: ['Blackbird', 'AirTree'] }]);
    expect(edges).toEqual([
      { type: 'INVESTED_IN', from: { type: 'Firm', id: 'Blackbird' }, to: { type: 'Company', id: 'Canva' } },
      { type: 'INVESTED_IN', from: { type: 'Firm', id: 'AirTree' }, to: { type: 'Company', id: 'Canva' } },
    ]);
  });

  it('handles a company with no founders or investors on file without crashing', () => {
    expect(buildRelationships([{ name: 'Mystery Co' }])).toEqual([]);
  });

  it('never invents WORKED_AT, ADVISED, ACQUIRED or any other unbacked relationship type', () => {
    const edges = buildRelationships([
      { name: 'Canva', founders: ['Melanie Perkins'], investors: ['Blackbird'] },
    ]);
    const types = new Set(edges.map((e) => e.type));
    expect(types.has('WORKED_AT')).toBe(false);
    expect(types.has('ADVISED')).toBe(false);
    expect(types.has('ACQUIRED')).toBe(false);
    expect(types.has('MENTORED')).toBe(false);
    expect(types.has('ACCELERATED_BY')).toBe(false);
  });
});

describe('relationshipsForCompany', () => {
  it('returns every edge touching a company, whether the company is the source or the target', () => {
    const edges = buildRelationships([
      { name: 'Canva', founders: ['Melanie Perkins', 'Cliff Obrecht'], investors: ['Blackbird'] },
      { name: 'Airwallex', founders: ['Jack Zhang'], investors: [] },
    ]);
    const result = relationshipsForCompany(edges, 'Canva');
    expect(result).toHaveLength(3);
    expect(result.every((e) => e.to.id === 'Canva')).toBe(true);
  });

  it('returns an empty array for a company with no edges, rather than throwing', () => {
    const edges = buildRelationships([{ name: 'Canva', founders: ['Melanie Perkins'], investors: [] }]);
    expect(relationshipsForCompany(edges, 'Nonexistent Co')).toEqual([]);
  });
});

describe('relationshipsForPerson', () => {
  it('returns only edges where the person is the source (never a Firm matching the same string)', () => {
    const edges = buildRelationships([
      { name: 'Canva', founders: ['Melanie Perkins'], investors: ['Melanie Perkins'] },
    ]);
    const result = relationshipsForPerson(edges, 'Melanie Perkins');
    expect(result).toEqual([
      { type: 'FOUNDED', from: { type: 'Person', id: 'Melanie Perkins' }, to: { type: 'Company', id: 'Canva' } },
    ]);
  });
});
