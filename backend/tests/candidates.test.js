import { describe, it, expect } from 'vitest';
import { migrateDataset, validateDataset } from '../src/models/dataset.js';
import { makeIdentifierRow, normalizeIdentifierValue, IDENTIFIER_SCHEMES } from '../src/models/identifiers.js';
import { CANDIDATE_STATUSES, CANDIDATE_TRANSITIONS, createCandidate, moveTo, candidateId } from '../src/models/candidate.js';
import { runDiscovery } from '../src/discovery/pipeline.js';
import { approveCandidate, rejectCandidate } from '../src/discovery/review.js';
import { publishCandidate } from '../src/discovery/publish.js';
import { NOW, dataset, lead, fakeSource, fetcherFor, auPage } from './helpers/discovery.js';

const errs = (ds) => validateDataset(migrateDataset(ds));
const has = (errors, text) => expect(errors).toEqual(expect.arrayContaining([expect.stringContaining(text)]));

// A dataset with a waiting candidate (Zorbly) and a matched one (Leonardo.Ai).
async function base() {
  const { fetcher } = fetcherFor({ 'https://zorbly.com.au/': { body: auPage('Zorbly') } });
  const leads = [lead({ key: 'z', name: 'Zorbly', website: 'zorbly.com.au', text: 'Zorbly raises $4m. Aussie startup' }), lead({ key: 'l', name: 'Leonardo.Ai', website: 'leonardo.ai' })];
  const { ds } = await runDiscovery({ ds: dataset(), sources: [fakeSource({ leads })], fetcher, now: () => NOW });
  return ds;
}
const cand = (ds, id) => ds.candidates.find((c) => c.id === id);
const tweak = async (fn) => { const ds = structuredClone(await base()); fn(ds, (id) => cand(ds, id)); return errs(ds); };

describe('candidate lifecycle', () => {
  it('lists the statuses and only the moves between them that are allowed', () => {
    expect(CANDIDATE_STATUSES).toEqual(['candidate', 'needs_review', 'matched', 'approved', 'rejected', 'merged', 'published']);
    expect(CANDIDATE_TRANSITIONS.candidate).toEqual(['needs_review', 'matched', 'rejected']);
    expect(CANDIDATE_TRANSITIONS.published).toEqual([]);
    expect(CANDIDATE_TRANSITIONS.merged).toEqual([]);
    for (const [from, targets] of Object.entries(CANDIDATE_TRANSITIONS)) for (const t of targets) expect(CANDIDATE_STATUSES, `${from} -> ${t}`).toContain(t);
    // Nothing can reach approved, merged or published without passing through review or matching.
    const reaching = (target) => Object.entries(CANDIDATE_TRANSITIONS).filter(([, t]) => t.includes(target)).map(([f]) => f);
    expect(reaching('approved')).toEqual(['needs_review']);
    expect(reaching('published')).toEqual(['approved']);
    expect(reaching('merged').sort()).toEqual(['matched', 'needs_review']);
  });

  it('is created as "candidate", always', () => {
    const c = createCandidate({ id: 'cand-x', name: 'X', website: 'https://x.example' }, { at: '2026-10-05T00:00:00.000Z' });
    expect(c.status).toBe('candidate');
    expect(c.status_history).toEqual([{ status: 'candidate', at: '2026-10-05T00:00:00.000Z', by: 'engine', note: 'discovered' }]);
    expect(c).toMatchObject({ domain: 'x.example', resolution: 'NEW_COMPANY', matches: [], review: null, published_company_id: null });
  });

  it('refuses a move that is not allowed, and does not mutate the original', () => {
    const c = createCandidate({ id: 'cand-x', name: 'X' }, { at: '2026-10-05T00:00:00.000Z' });
    expect(() => moveTo(c, 'approved', { at: 'x' })).toThrow(/cannot go from candidate to approved/);
    expect(() => moveTo(c, 'published', { at: 'x' })).toThrow(/cannot go from candidate to published/);
    const next = moveTo(c, 'needs_review', { at: '2026-10-05T00:01:00.000Z', note: 'ok' });
    expect(next.status_history).toHaveLength(2);
    expect(c.status_history).toHaveLength(1);
  });

  it('gives each candidate a readable unique id', () => {
    expect(candidateId('Zorbly Pty Ltd', new Set())).toBe('cand-zorbly-pty-ltd');
    expect(candidateId('Zorbly', new Set(['cand-zorbly']))).toBe('cand-zorbly-2');
    expect(candidateId('!!!', new Set())).toBe('cand-unnamed');
  });
});

describe('validating candidates', () => {
  it('accepts what the pipeline produces, and a lifecycle taken all the way to published', async () => {
    const ds = structuredClone(await base());
    expect(errs(ds)).toEqual([]);
    approveCandidate(ds, 'cand-zorbly', { by: 'R', at: '2026-10-06T00:00:00.000Z' });
    publishCandidate(ds, 'cand-zorbly', { by: 'R', at: '2026-10-06T00:00:00.000Z' });
    expect(errs(ds)).toEqual([]);
  });

  it('cannot be published twice: the first publish takes the candidate out of "approved"', async () => {
    const ds = structuredClone(await base());
    approveCandidate(ds, 'cand-zorbly', { by: 'R', at: '2026-10-06T00:00:00.000Z' });
    publishCandidate(ds, 'cand-zorbly', { by: 'R', at: '2026-10-06T00:00:00.000Z' });
    expect(() => publishCandidate(ds, 'cand-zorbly', { by: 'R', at: '2026-10-06T00:00:00.000Z' })).toThrow(/is published: only an approved candidate/);
    expect(ds.companies.filter((c) => c.name === 'Zorbly')).toHaveLength(1);
  });

  it('insists on a valid id and a name, and rejects a duplicate id', async () => {
    has(await tweak((ds, c) => { c('cand-zorbly').id = 'zorbly'; }), 'invalid id');
    has(await tweak((ds, c) => { c('cand-zorbly').name = ' '; }), 'name must be a non-empty string');
    has(await tweak((ds) => { ds.candidates[1].id = ds.candidates[0].id; }), 'duplicate id');
  });

  it('insists the history starts at "candidate", moves legally, and ends where the status says', async () => {
    has(await tweak((ds, c) => { c('cand-zorbly').status_history[0].status = 'needs_review'; }), 'must enter as "candidate"');
    has(await tweak((ds, c) => { c('cand-zorbly').status_history.push({ status: 'published', at: '2026-10-05T04:00:00.000Z', by: 'x', note: null }); c('cand-zorbly').status = 'published'; }), 'which is not allowed');
    has(await tweak((ds, c) => { c('cand-zorbly').status = 'rejected'; }), 'does not match the end of status_history');
    has(await tweak((ds, c) => { c('cand-zorbly').status = 'nonsense'; }), 'invalid status');
    has(await tweak((ds, c) => { c('cand-zorbly').status_history[1].by = ''; }), 'needs an ISO "at" and a "by"');
  });

  it('insists a candidate says where and when it was found', async () => {
    has(await tweak((ds, c) => { c('cand-zorbly').discoveries = []; }), 'needs at least one discovery');
    has(await tweak((ds, c) => { c('cand-zorbly').discoveries[0].source_kind = 'rumour'; }), 'discoveries[0] needs');
    has(await tweak((ds, c) => { c('cand-zorbly').discoveries[0].observed_at = 'yesterday'; }), 'discoveries[0] needs');
    has(await tweak((ds, c) => { c('cand-zorbly').last_seen_at = '2020-01-01T00:00:00.000Z'; }), 'last_seen_at is before first_discovered_at');
  });

  it('checks the website, its domain, the state and registry numbers', async () => {
    has(await tweak((ds, c) => { c('cand-zorbly').website = 'zorbly.com.au'; }), 'website must be an http(s) URL');
    has(await tweak((ds, c) => { c('cand-zorbly').domain = 'other.example'; }), 'domain should be "zorbly.com.au"');
    has(await tweak((ds, c) => { c('cand-zorbly').state = 'Texas'; }), 'invalid state');
    has(await tweak((ds, c) => { c('cand-zorbly').external_ids.abn = '12345678901'; }), 'not a valid ABN');
    has(await tweak((ds, c) => { c('cand-zorbly').external_ids.acn = '123456789'; }), 'not a valid ACN');
  });

  it('holds each piece of evidence to the same rules as company evidence', async () => {
    has(await tweak((ds, c) => { c('cand-zorbly').evidence[0].field = 'favourite_colour'; }), 'unknown field');
    has(await tweak((ds, c) => { const e = c('cand-zorbly').evidence.find((x) => x.field === 'website'); e.value = 'not a url'; }), 'http(s) URL');
    has(await tweak((ds, c) => { c('cand-zorbly').evidence[0].confidence = 'certain'; }), 'invalid confidence');
    has(await tweak((ds, c) => { const e = c('cand-zorbly').evidence.find((x) => x.confidence === 'medium'); e.confidence = 'high'; e.verified_at = null; }), 'high confidence requires verified_at');
    has(await tweak((ds, c) => { const e = c('cand-zorbly').evidence.find((x) => x.confidence === 'medium'); e.verified_at = '2026-10-05T04:00:00.000Z'; e.source.retrieved_at = null; }), 'verified_at is set but the source was never retrieved');
    has(await tweak((ds, c) => { c('cand-zorbly').evidence[0].source.kind = 'gossip'; }), 'needs a source with a valid kind');
  });

  it('checks the assessments and the confidence', async () => {
    has(await tweak((ds, c) => { c('cand-zorbly').australian.verdict = 'maybe'; }), 'australian needs a verdict');
    has(await tweak((ds, c) => { c('cand-zorbly').startup.score = 5; }), 'startup needs a verdict');
    has(await tweak((ds, c) => { c('cand-zorbly').confidence.label = 'great'; }), 'confidence needs a score from 0 to 1 and a label');
    has(await tweak((ds, c) => { c('cand-zorbly').notes = [{ at: 'x', by: '', text: '' }]; }), 'notes[0] needs');
  });

  it('keeps resolution and matches consistent, and only points at things that exist', async () => {
    has(await tweak((ds, c) => { c('cand-zorbly').matches = [{ kind: 'company', id: 'acme-robotics', name: 'Acme', outcome: 'LIKELY_MATCH', score: 0.7, signals: [], conflicts: [] }]; }), 'resolution is NEW_COMPANY but it has matches');
    has(await tweak((ds, c) => { c('cand-leonardo-ai').resolution = 'POSSIBLE_MATCH'; }), 'resolution does not match its best match');
    has(await tweak((ds, c) => { c('cand-leonardo-ai').matches[0].id = 'no-such-company'; }), 'unknown company "no-such-company"');
    has(await tweak((ds, c) => { c('cand-leonardo-ai').matches[0].kind = 'candidate'; }), 'unknown candidate');
    has(await tweak((ds, c) => { c('cand-leonardo-ai').matches[0].score = 3; }), 'score must be 0..1');
    has(await tweak((ds, c) => { c('cand-zorbly').decisions.not_same_as = ['nobody']; }), 'names unknown "nobody"');
    has(await tweak((ds, c) => { c('cand-zorbly').decisions.same_as = 'nobody'; }), 'names unknown company');
  });

  it('holds each status to what it promises', async () => {
    const lifecycle = (ds, c, ...steps) => { for (const [status, extra] of steps) { c.status_history.push({ status, at: '2026-10-06T00:00:00.000Z', by: 'x', note: null }); c.status = status; Object.assign(c, extra); } };
    has(await tweak((ds, c) => { lifecycle(ds, c('cand-zorbly'), ['approved']); }), 'approved needs a review');
    has(await tweak((ds, c) => { lifecycle(ds, c('cand-zorbly'), ['approved', { review: { by: 'x', at: '2026-10-06T00:00:00.000Z' } }], ['published']); }), 'published needs published_company_id');
    has(await tweak((ds, c) => { lifecycle(ds, c('cand-zorbly'), ['merged']); }), 'merged needs decisions.same_as');
    has(await tweak((ds, c) => { c('cand-zorbly').published_company_id = 'acme-robotics'; }), 'it is not published');
    has(await tweak((ds, c) => { const z = c('cand-zorbly'); z.status_history.push({ status: 'matched', at: '2026-10-06T00:00:00.000Z', by: 'x', note: null }); z.status = 'matched'; }), 'matched needs an exact match to a company');
    has(await tweak((ds, c) => {
      const l = c('cand-leonardo-ai');
      lifecycle(ds, l, ['needs_review'], ['approved', { review: { by: 'x', at: '2026-10-06T00:00:00.000Z' } }]);
    }), 'approved needs every possible duplicate settled');
  });
});

describe('validating identifiers', () => {
  const row = (over = {}) => ({ id: 'acme-robotics.alias.acme-labs', company_id: 'acme-robotics', scheme: 'alias', value: 'Acme Labs', source_id: null, note: 'renamed', ...over });
  const withIds = (...rows) => errs(dataset(undefined, { identifiers: rows }));

  it('accepts well-formed identifiers of every scheme', () => {
    expect(withIds(
      row(), row({ id: 'acme-robotics.former_name.old', scheme: 'former_name', value: 'Old Name' }),
      row({ id: 'acme-robotics.legal_name.acme', scheme: 'legal_name', value: 'Acme Robotics Pty Ltd' }),
      row({ id: 'acme-robotics.domain.acme-io', scheme: 'domain', value: 'acme.io' }),
      row({ id: 'acme-robotics.abn.1', scheme: 'abn', value: '53004085616' }),
      row({ id: 'acme-robotics.acn.1', scheme: 'acn', value: '004085616' }),
    )).toEqual([]);
    expect(IDENTIFIER_SCHEMES).toEqual(['alias', 'former_name', 'legal_name', 'domain', 'abn', 'acn']);
  });

  it('rejects an unknown company or scheme and a bad id', () => {
    has(withIds(row({ company_id: 'nobody' })), 'unknown company_id "nobody"');
    has(withIds(row({ scheme: 'twitter' })), 'invalid scheme');
    has(withIds(row({ id: 'Bad Id!' })), 'invalid id');
    has(withIds(row(), row()), 'duplicate id');
  });

  it('rejects an invalid registry number, a domain that is not a company site, and one not stored in canonical form', () => {
    has(withIds(row({ scheme: 'abn', value: '12345678901' })), 'ABN fails its checksum');
    has(withIds(row({ scheme: 'acn', value: '123456789' })), 'ACN fails its checksum');
    has(withIds(row({ scheme: 'domain', value: 'https://www.linkedin.com/company/acme' })), 'is not a valid domain');
    has(withIds(row({ scheme: 'domain', value: 'WWW.Acme.IO' })), 'must be stored as "acme.io"');
    has(withIds(row({ value: '  ' })), 'is not a valid alias');
  });

  it('insists on a source or a note saying how it is known, and that the source exists', () => {
    has(withIds(row({ note: null })), 'needs a source_id or a note');
    has(withIds(row({ source_id: 'nowhere', note: null })), 'unknown source_id');
  });

  it('rejects repeats, including names that differ only in punctuation, and an alias that is just the company name', () => {
    has(withIds(row(), row({ id: 'acme-robotics.alias.acme-labs-2', value: 'ACME  Labs.' })), 'repeats an identifier this company already has');
    has(withIds(row({ value: 'ACME Robotics Pty Ltd' })), 'is the same as the company name');
  });

  it('will not let two companies claim the same registry number or domain, or a domain that is another company\'s website', () => {
    const abn = (company_id, n) => row({ id: `${company_id}.abn.${n}`, company_id, scheme: 'abn', value: '53004085616' });
    has(withIds(abn('acme-robotics', 1), abn('hex', 2)), 'is also claimed by "acme-robotics"');
    has(withIds(row({ scheme: 'domain', value: 'honeag.com' })), 'is the website of "Hone (HoneAg)"');
    expect(withIds(row({ scheme: 'domain', value: 'acme.io' }))).toEqual([]);
  });

  it('stores values in canonical form when built by makeIdentifierRow', () => {
    expect(makeIdentifierRow({ company_id: 'acme', scheme: 'domain', value: 'https://www.Acme.io/about', note: 'n' })).toEqual({ id: 'acme.domain.acme-io', company_id: 'acme', scheme: 'domain', value: 'acme.io', source_id: null, note: 'n' });
    expect(makeIdentifierRow({ company_id: 'acme', scheme: 'abn', value: '53 004 085 616', note: 'n' }).value).toBe('53004085616');
    expect(normalizeIdentifierValue('domain', 'https://linkedin.com/company/x')).toBeNull();
    const taken = new Set(['acme.alias.x']);
    expect(makeIdentifierRow({ company_id: 'acme', scheme: 'alias', value: 'X', note: 'n' }, taken).id).toBe('acme.alias.x.2');
  });
});

describe('a rejection is kept, so a company is not rediscovered', () => {
  it('leaves the rejected candidate in place with its observations', async () => {
    const ds = structuredClone(await base());
    rejectCandidate(ds, 'cand-zorbly', { by: 'R', reason: 'A hobby project.', at: '2026-10-06T00:00:00.000Z' });
    const { fetcher, w } = fetcherFor();
    const again = await runDiscovery({ ds, sources: [fakeSource({ leads: [lead({ key: 'z', name: 'Zorbly', website: 'zorbly.com.au' })] })], fetcher, now: () => NOW });
    expect(again.ds.candidates.filter((c) => c.name === 'Zorbly')).toHaveLength(1);
    expect(again.ds.candidates.find((c) => c.id === 'cand-zorbly').status).toBe('rejected');
    expect(again.report.already_seen).toBe(1);
    expect(w.calls).toEqual([]);
  });
});
