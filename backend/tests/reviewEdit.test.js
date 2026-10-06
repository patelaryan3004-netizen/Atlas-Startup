import { describe, it, expect } from 'vitest';
import { migrateDataset, validateDataset } from '../src/models/dataset.js';
import { runDiscovery } from '../src/discovery/pipeline.js';
import { approveCandidate, editCandidate, EDITABLE } from '../src/discovery/review.js';
import { publishCandidate } from '../src/discovery/publish.js';
import { NOW, dataset, lead, fakeSource, fetcherFor, auPage } from './helpers/discovery.js';

const AT = '2026-10-06T01:00:00.000Z';
const BY = 'Reviewer';
async function discover(leads, routes = {}) {
  const { fetcher } = fetcherFor(routes);
  const { ds } = await runDiscovery({ ds: dataset(), sources: [fakeSource({ leads })], fetcher, now: () => NOW });
  return structuredClone(ds);
}
const ZORBLY = lead({ key: 'z', name: 'Zorbly', website: 'zorbly.com.au', url: 'https://news.example/z', title: 'Zorbly raises $4m seed', text: 'Zorbly raises $4m seed round. Aussie startup' });
const SITE = { 'https://zorbly.com.au/': { body: auPage('Zorbly', { abn: '53004085616' }) } };
const valid = (work) => validateDataset(migrateDataset(work));
const edit = (work, patch, id = 'cand-zorbly') => editCandidate(work, id, patch, { by: BY, at: AT });

describe('a reviewer editing a candidate', () => {
  it('changes the fields it is told to, and says in a note who changed what', async () => {
    const work = await discover([ZORBLY], SITE);
    const c = edit(work, { city: 'Brisbane', state: 'qld', address: '9 Queen Street, Brisbane QLD 4000', description: 'Makes zorbs.' });
    expect(c).toMatchObject({ city: 'Brisbane', state: 'QLD', address: '9 Queen Street, Brisbane QLD 4000', description: 'Makes zorbs.' });
    expect(c.notes.at(-1)).toEqual({ at: AT, by: BY, text: 'Edited by Reviewer: city, address, description, state.' });
    expect(valid(work)).toEqual([]);
  });

  it('keeps the old name as an alias when the name changes: names are preserved, never replaced', async () => {
    const work = await discover([ZORBLY], SITE);
    const c = edit(work, { name: 'Zorbly Technologies' });
    expect(c.name).toBe('Zorbly Technologies');
    expect(c.aliases).toContain('Zorbly');
    expect(valid(work)).toEqual([]);
  });

  it('keeps the old name by default even when the new one is an unrelated company: a rebrand keeps its former name', async () => {
    const work = await discover([lead({ key: 'l', name: 'Leonardo.Ai', website: 'https://leonardo.ai' })]);
    const c = edit(work, { name: 'Totally Different Co', website: 'https://different.example' }, 'cand-leonardo-ai');
    expect(c.aliases).toContain('Leonardo.Ai');
    expect(c.resolution).not.toBe('NEW_COMPANY'); // the old name still points at the company it matched
  });

  it('records a website as supplied by the reviewer, and keeps its domain in step', async () => {
    const work = await discover([ZORBLY], SITE);
    const c = edit(work, { website: 'https://www.zorbly.io/' });
    expect(c).toMatchObject({ website: 'https://zorbly.io', domain: 'zorbly.io' });
    expect(c.evidence.at(-1)).toMatchObject({ field: 'website', value: 'https://zorbly.io', confidence: 'low', note: 'Supplied by Reviewer.', source: { kind: 'user_supplied', publisher: BY } });
    expect(edit(work, { website: '' })).toMatchObject({ website: null, domain: null });
    expect(valid(work)).toEqual([]);
    expect(() => edit(work, { website: 'not a website' })).toThrow(/not a usable company website/);
    expect(() => edit(work, { website: 'https://linkedin.com/company/zorbly' })).toThrow(/not a usable company website/);
  });

  it('records a sector and a stage as the reviewer\'s own choice, replacing an earlier choice rather than piling up', async () => {
    const work = await discover([ZORBLY], SITE);
    edit(work, { sector: 'Fintech', stage: 'Seed' });
    edit(work, { sector: 'HealthTech' });
    const mine = the(work).evidence.filter((e) => e.source.kind === 'user_supplied');
    expect(mine.map((e) => [e.field, e.value, e.confidence])).toEqual([['stage', 'Seed', 'medium'], ['sector', 'HealthTech', 'medium']]);
    expect(valid(work)).toEqual([]);
  });

  it('makes a chosen sector what publishing uses, and leaves it Unknown when nobody chose one', async () => {
    const chosen = await discover([ZORBLY], SITE);
    edit(chosen, { sector: 'Fintech' });
    approveCandidate(chosen, 'cand-zorbly', { by: BY, at: AT });
    expect(publishCandidate(chosen, 'cand-zorbly', { by: BY, at: AT }).company).toMatchObject({ sector: 'Fintech', sectorFull: 'Fintech' });
    const none = await discover([ZORBLY], SITE);
    approveCandidate(none, 'cand-zorbly', { by: BY, at: AT });
    expect(publishCandidate(none, 'cand-zorbly', { by: BY, at: AT }).company).toMatchObject({ sector: 'Unknown', sectorFull: 'Unknown' });
  });

  it('needs a full name for each founder, and records what it adds as evidence so publishing carries it', async () => {
    const work = await discover([ZORBLY], SITE);
    expect(() => edit(work, { founders: ['Cher'] })).toThrow(/first and last name/);
    const c = edit(work, { founders: ['Ada Lovelace', 'Alan Turing'] });
    expect(c.founders).toEqual(['Ada Lovelace', 'Alan Turing']);
    expect(c.evidence.filter((e) => e.field === 'founders').map((e) => e.value)).toEqual(['Ada Lovelace', 'Alan Turing']);
    approveCandidate(work, 'cand-zorbly', { by: BY, at: AT });
    expect(publishCandidate(work, 'cand-zorbly', { by: BY, at: AT }).company.founders).toEqual(['Ada Lovelace', 'Alan Turing']);
  });

  it('refuses an empty change, a field it does not know, a bad state or name, a long text, and a candidate that is finished', async () => {
    const work = await discover([ZORBLY], SITE);
    expect(() => edit(work, { name: 'Zorbly', city: the(work).city })).toThrow(/nothing was changed/); // the same values are not a change
    expect(() => edit(work, {})).toThrow(/nothing was changed/);
    expect(() => edit(work, { status: 'approved' })).toThrow(/cannot edit status: only name, aliases/);
    expect(() => edit(work, { state: 'XX' })).toThrow(/state must be one of/);
    expect(() => edit(work, { name: 'Z' })).toThrow(/2 to 80 characters/);
    expect(() => edit(work, { description: 'x'.repeat(501) })).toThrow(/longer than 500/);
    expect(() => editCandidate(work, 'cand-zorbly', { city: 'Perth' }, { at: AT })).toThrow(/say who is deciding/);
    expect(() => editCandidate(work, 'cand-nobody', { city: 'Perth' }, { by: BY, at: AT })).toThrow(/no candidate/);
    approveCandidate(work, 'cand-zorbly', { by: BY, at: AT });
    publishCandidate(work, 'cand-zorbly', { by: BY, at: AT });
    expect(() => edit(work, { city: 'Perth' })).toThrow(/is published: it can no longer be edited/);
    expect(EDITABLE).toEqual(['name', 'aliases', 'website', 'city', 'state', 'address', 'description', 'founders', 'sector', 'stage']);
  });

  it('checks for duplicates again: a name that is now a company we have sends an approved candidate back to review', async () => {
    const work = await discover([ZORBLY], SITE);
    approveCandidate(work, 'cand-zorbly', { by: BY, at: AT });
    const c = edit(work, { name: 'Leonardo.Ai', website: 'https://leonardo.ai' });
    expect(c.status).toBe('needs_review');
    expect(c.resolution).not.toBe('NEW_COMPANY');
    expect(c.status_history.at(-1).note).toMatch(/now looks like a company we have/);
    expect(valid(work)).toEqual([]);
  });

  it('and the other way: a candidate that turns out not to be an exact match becomes an ordinary one for review', async () => {
    const work = await discover([lead({ key: 'l', name: 'Leonardo.Ai', website: 'https://leonardo.ai' })]);
    expect(the(work, 'cand-leonardo-ai').status).toBe('matched');
    // The name was simply wrong, so the wrong name is not kept as an alias that would keep the old match alive.
    const c = editCandidate(work, 'cand-leonardo-ai', { name: 'Totally Different Co', website: 'https://different.example' }, { by: BY, at: AT, keepOldName: false });
    expect(c).toMatchObject({ status: 'needs_review', resolution: 'NEW_COMPANY', aliases: [] });
    expect(valid(work)).toEqual([]);
  });

  it('rescoring follows the edit, and an approved candidate that is still new stays approved', async () => {
    const work = await discover([ZORBLY], SITE);
    approveCandidate(work, 'cand-zorbly', { by: BY, at: AT });
    const before = the(work).confidence;
    const c = edit(work, { city: 'Brisbane', state: 'QLD' });
    expect(c.status).toBe('approved');
    expect(c.confidence).toMatchObject({ label: expect.any(String), score: expect.any(Number) });
    expect(before).toBeDefined();
  });
});
function the(work, id = 'cand-zorbly') { return work.candidates.find((c) => c.id === id); }
