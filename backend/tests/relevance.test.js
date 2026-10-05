import { describe, it, expect } from 'vitest';
import { assessAustralian, assessStartup } from '../src/discovery/relevance.js';
import { scoreCandidate } from '../src/discovery/score.js';

const codes = (a) => a.signals.map((s) => s.code);

describe('is it Australian', () => {
  it('says yes on a .au domain, an Australian address and a Pty Ltd', () => {
    const a = assessAustralian({ name: 'Acme Robotics Pty Ltd', domain: 'acme.com.au', address: '1 George Street, Sydney NSW 2000' });
    expect(a.verdict).toBe('yes');
    expect(codes(a)).toEqual(expect.arrayContaining(['au_domain', 'au_address', 'pty_ltd']));
  });

  it('counts a valid ABN or ACN, but not an invalid one', () => {
    expect(codes(assessAustralian({ name: 'x', external_ids: { abn: '53004085616' } }))).toContain('registry_number');
    expect(codes(assessAustralian({ name: 'x', external_ids: { acn: '690900497' } }))).toContain('registry_number');
    expect(codes(assessAustralian({ name: 'x', external_ids: { abn: '12345678901', acn: '123456789' } }))).not.toContain('registry_number');
  });

  it('says likely from an Australian source and an Australian mention, which is what a funding story gives', () => {
    const a = assessAustralian({ name: 'Trendspek', regions: ['AU'], text: 'Trendspek grabs $6M ... Aussie startups' });
    expect(a.verdict).toBe('likely');
    expect(codes(a)).toEqual(['au_source', 'au_mention']);
  });

  it('reads "Sydney-based" as an Australian mention', () => {
    expect(codes(assessAustralian({ name: 'x', text: 'Sydney-based Foodly raises $4m' }))).toContain('au_mention');
  });

  it('is unknown when there is little to go on, and never "no" for lack of evidence', () => {
    const a = assessAustralian({ name: 'Zorbly', text: 'Payments for pets.' });
    expect(a.verdict).toBe('unknown');
    expect(a.signals).toEqual([]);
  });

  it('says no on explicit evidence of being elsewhere: a US address, a foreign domain, a foreign HQ', () => {
    expect(assessAustralian({ name: 'Foo Inc', domain: 'foo.com', address: '500 Market Street, San Francisco CA 94105' }).verdict).toBe('no');
    expect(assessAustralian({ name: 'Foo', domain: 'foo.co.uk', text: 'London-based Foo raises $5m' }).verdict).toBe('no');
    expect(codes(assessAustralian({ name: 'Foo', address: '10 Downing Street, London SW1A 2AA' }))).toContain('foreign_address');
    expect(codes(assessAustralian({ name: 'Foo', address: '1 Queen Street, Auckland, New Zealand' }))).toContain('foreign_address');
  });

  it('does not say no when Australian signals outweigh a foreign one, as for a company with a US HQ and a Sydney office', () => {
    const a = assessAustralian({ name: 'Forward Flow Pty Ltd', domain: 'useforward.co', state: 'NSW', city: 'Sydney', regions: ['AU'], text: 'San Francisco-based Forward, with an office in Sydney' });
    expect(a.verdict).not.toBe('no');
    expect(codes(a)).toEqual(expect.arrayContaining(['foreign_hq', 'au_location', 'pty_ltd']));
  });

  it('stays within -1 and 1 and records every signal with its weight', () => {
    const a = assessAustralian({ name: 'Acme Pty Ltd', domain: 'acme.com.au', address: '1 George St, Sydney NSW 2000', phones: 2, regions: ['AU'], external_ids: { abn: '53004085616' }, text: 'Australian' });
    expect(a.score).toBeLessThanOrEqual(1);
    expect(a.signals.every((s) => typeof s.weight === 'number' && s.code && s.detail)).toBe(true);
  });
});

describe('is it a startup', () => {
  const trendspek = { name: 'Trendspek', text: 'Asset analysis platform Trendspek banks $6 million to keep critical infrastructure upright. Trendspek grabs $6M to turn drones into things.' };

  it('says yes or likely for a funding story about a company', () => {
    const a = assessStartup(trendspek);
    expect(['yes', 'likely']).toContain(a.verdict);
    expect(codes(a)).toEqual(expect.arrayContaining(['funding_language', 'startup_words']));
  });

  it('counts an investor it already knows', () => {
    const a = assessStartup({ name: 'Foodly', text: 'Foodly raises $4m seed round led by Blackbird.' }, { knownInvestors: ['Blackbird', 'AirTree'] });
    expect(codes(a)).toContain('known_investor');
    expect(a.signals.find((s) => s.code === 'known_investor').detail).toBe('Blackbird');
    expect(a.verdict).toBe('yes');
  });

  it('counts a recent founding year', () => {
    expect(codes(assessStartup({ name: 'x', text: '', foundedYear: 2022 }, { asOfYear: 2026 }))).toContain('recent_founding');
    expect(codes(assessStartup({ name: 'x', text: '', foundedYear: 1999 }, { asOfYear: 2026 }))).not.toContain('recent_founding');
  });

  it('says no to a venture fund, which the real feed throws up', () => {
    const a = assessStartup({ name: 'Eastend Ventures', text: 'Eastend Ventures nails $30 million debut fund to back SA, WA and Queensland startups' });
    expect(a.verdict).toBe('no');
    expect(codes(a)).toContain('fund_or_investor');
  });

  it('says no to an ordinary business, an old established company and a public body', () => {
    expect(assessStartup({ name: "Joe's Plumbing Pty Ltd", text: "Joe's Plumbing, a family plumbing business in Sydney" }).verdict).toBe('no');
    expect(assessStartup({ name: 'Old Co', text: 'ASX-listed Old Co, founded in 1923, raises $50m' }).signals.map((s) => s.code)).toContain('established_company');
    expect(codes(assessStartup({ name: 'Shire Council', text: '' }))).toContain('public_body');
  });

  it('is unknown, not no, when it simply says nothing', () => {
    const a = assessStartup({ name: 'Zorbly', text: 'Payments for pets.' });
    expect(a.verdict).toBe('unknown');
  });
});

describe('the confidence score', () => {
  const base = () => ({
    website: 'https://zorbly.com.au', resolution: 'NEW_COMPANY',
    australian: { score: 0.8 }, startup: { score: 0.6 },
    evidence: [{ field: 'website', confidence: 'high' }, { field: 'city', confidence: 'medium' }],
    discoveries: [{ source_id: 'a' }],
  });

  it('combines the three parts with the stated weights and explains itself', () => {
    const s = scoreCandidate(base());
    // 0.4 x 0.8 + 0.35 x 0.6 + 0.25 x ((1 + 0.6) / 2)
    expect(s.score).toBeCloseTo(0.4 * 0.8 + 0.35 * 0.6 + 0.25 * 0.8, 2);
    expect(s.label).toBe('medium');
    expect(s.breakdown).toMatchObject({ australian: 0.8, startup: 0.6, evidence: 0.8, corroboration: 0, caps: [] });
  });

  it('is helped a little when independent sources found it, up to a limit', () => {
    const two = scoreCandidate({ ...base(), discoveries: [{ source_id: 'a' }, { source_id: 'b' }] });
    const four = scoreCandidate({ ...base(), discoveries: ['a', 'b', 'c', 'd'].map((source_id) => ({ source_id })) });
    expect(two.breakdown.corroboration).toBe(0.1);
    expect(four.breakdown.corroboration).toBe(0.2);
    expect(two.score).toBeGreaterThan(scoreCandidate(base()).score);
    const sameSourceTwice = scoreCandidate({ ...base(), discoveries: [{ source_id: 'a' }, { source_id: 'a' }] });
    expect(sameSourceTwice.breakdown.corroboration).toBe(0);
  });

  it('caps a candidate with an unresolved possible duplicate at 0.5, and one with no website at 0.6', () => {
    const strong = { ...base(), australian: { score: 1 }, startup: { score: 1 }, evidence: [{ field: 'website', confidence: 'high' }] };
    expect(scoreCandidate(strong).score).toBeGreaterThan(0.9);
    const dup = scoreCandidate({ ...strong, resolution: 'LIKELY_MATCH' });
    expect(dup.score).toBe(0.5);
    expect(dup.breakdown.caps).toEqual(['possible duplicate unresolved']);
    const noSite = scoreCandidate({ ...strong, website: null });
    expect(noSite.score).toBe(0.6);
    expect(noSite.breakdown.caps).toEqual(['no website to check against']);
  });

  it('labels high, medium and low', () => {
    expect(scoreCandidate({ ...base(), australian: { score: 1 }, startup: { score: 1 }, evidence: [{ field: 'website', confidence: 'high' }] }).label).toBe('high');
    expect(scoreCandidate({ website: null, australian: { score: 0.35 }, startup: { score: 0.35 }, evidence: [], discoveries: [] }).label).toBe('low');
  });

  it('copes with a candidate nothing has been assessed for', () => {
    const s = scoreCandidate({ website: null, evidence: [], discoveries: [] });
    expect(s.score).toBeCloseTo(0.025, 2);
    expect(s.label).toBe('low');
  });
});
