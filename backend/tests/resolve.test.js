import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRaw, parseRaw } from '../src/models/dataset.js';
import {
  OUTCOMES, buildIndex, addToIndex, identityOfLead, identityOfCompany, identityOfCandidate, compareIdentities,
  resolveLead, describeMatch,
} from '../src/discovery/resolve.js';

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const co = (name, over = {}) => ({ id: slug(name), name, website: '', city: 'Sydney', state: 'NSW', founders: [], stage: 'Seed', ...over });
const COMPANIES = [
  co('Acme Robotics', { website: 'https://acme.com.au', founders: ['Jane Doe', 'John Roe'], address: 'Level 2, 1 George St, Sydney NSW 2000' }),
  co('Leonardo AI', { website: 'https://leonardo.ai', stage: 'Acquired' }),
  co('Hone (HoneAg)', { website: 'https://honeag.com', city: 'Newcastle' }),
  co('Brumby (formerly GrazeMate)'),
  co('Hex'),
  co('Fastlane', { website: 'https://usefastlane.ai' }),
  co('Dead Co', { website: 'https://dead.example', stage: 'Defunct (in liquidation)' }),
  co('Widgets', { website: 'https://widgets.netlify.app' }),
];
const IDENTIFIERS = [
  { id: 'fastlane.legal_name.possibility-studios-pty-ltd', company_id: 'fastlane', scheme: 'legal_name', value: 'Possibility Studios Pty Ltd', source_id: null, note: 'privacy policy' },
  { id: 'fastlane.acn.690900497', company_id: 'fastlane', scheme: 'acn', value: '690900497', source_id: null, note: 'privacy policy' },
  { id: 'acme-robotics.domain.acmerobotics.example', company_id: 'acme-robotics', scheme: 'domain', value: 'acmerobotics.example', source_id: null, note: 'redirects to the main site' },
  { id: 'acme-robotics.former_name.acme-labs', company_id: 'acme-robotics', scheme: 'former_name', value: 'Acme Labs', source_id: null, note: 'renamed in 2024' },
];
const idx = (over = {}) => buildIndex({ companies: COMPANIES, identifiers: IDENTIFIERS, candidates: [], ...over });
const resolve = (lead, index = idx(), opts) => resolveLead(identityOfLead(lead), index, opts);
const codes = (r) => r.best.signals.map((s) => s.code);
const deepFreeze = (o) => { Object.freeze(o); for (const v of Object.values(o)) if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v); return o; };

describe('exact matches need a website or registry number AND a compatible name', () => {
  it('resolves "Leonardo.Ai" at leonardo.ai to the existing "Leonardo AI"', () => {
    const r = resolve({ name: 'Leonardo.Ai', website: 'https://leonardo.ai' });
    expect(r.outcome).toBe(OUTCOMES.EXACT);
    expect(r.best.target).toEqual({ kind: 'company', id: 'leonardo-ai', name: 'Leonardo AI' });
    expect(codes(r)).toEqual(expect.arrayContaining(['domain_match', 'name_exact']));
  });

  it('sees the same site however it is written: scheme, www, path, subdomain, case, a .com.au', () => {
    for (const website of ['http://www.Leonardo.ai/careers?x=1', 'leonardo.ai', 'https://app.leonardo.ai']) {
      expect(resolve({ name: 'Leonardo AI', website }).outcome, website).toBe(OUTCOMES.EXACT);
    }
    expect(resolve({ name: 'Acme Robotics', website: 'https://www.acme.com.au/about' }).outcome).toBe(OUTCOMES.EXACT);
  });

  it('is never exact on the name alone, however identical', () => {
    for (const name of ['Leonardo.Ai', 'Leonardo AI', 'LEONARDO AI', 'Leonardo A.I.']) {
      const r = resolve({ name });
      expect(r.outcome, name).toBe(OUTCOMES.LIKELY);
      expect(r.outcome).not.toBe(OUTCOMES.NEW);
    }
  });

  it('does not let a matching website settle it when the names differ: that goes to a person', () => {
    const r = resolve({ name: 'Canva Leonardo', website: 'https://leonardo.ai' });
    expect(r.outcome).toBe(OUTCOMES.LIKELY);
    expect(r.best.reasons.join(' ')).toMatch(/names differ: a rebrand, an acquisition, or the wrong website/);
  });

  it('notes that the matched company is acquired or defunct, which is context for the reviewer', () => {
    expect(resolve({ name: 'Leonardo.Ai', website: 'leonardo.ai' }).best.lifecycle).toBe('acquired');
    expect(resolve({ name: 'Dead Co' }).best.reasons.join(' ')).toMatch(/marked defunct/);
  });
});

describe('a website is a stronger signal than a name', () => {
  it('holds a matching name below exact when the websites differ, and records the conflict', () => {
    const r = resolve({ name: 'Leonardo.Ai', website: 'https://leonardo-labs.example' });
    expect(r.outcome).toBe(OUTCOMES.POSSIBLE);
    expect(r.best.conflicts).toEqual([{ code: 'domain_differs', detail: 'leonardo-labs.example vs leonardo.ai' }]);
  });

  it('lifts a same-name, different-website match to likely when a founder or street address agrees', () => {
    const founder = resolve({ name: 'Acme Robotics', website: 'https://other.example', founders: ['jane doe'] });
    expect(founder.outcome).toBe(OUTCOMES.LIKELY);
    const address = resolve({ name: 'Acme Robotics', website: 'https://other.example', address: '1 George Street, Sydney NSW 2000' });
    expect(address.outcome).toBe(OUTCOMES.LIKELY);
  });

  it('does not match two companies on different tenants of one hosting platform', () => {
    expect(resolve({ name: 'Gadgets', website: 'https://gadgets.netlify.app' }).outcome).toBe(OUTCOMES.NEW);
  });

  it('treats the same shared-platform site and the same name as likely, never exact', () => {
    const r = resolve({ name: 'Widgets', website: 'https://widgets.netlify.app' });
    expect(r.outcome).toBe(OUTCOMES.LIKELY);
    expect(codes(r)).toContain('host_match');
  });

  it('ignores a social profile or press link given as the website', () => {
    const r = resolve({ name: 'Acme Robotics', website: 'https://www.linkedin.com/company/some-other-co' });
    expect(codes(r)).not.toContain('domain_differs');
    expect(r.best.conflicts).toEqual([]);
    expect(r.outcome).toBe(OUTCOMES.LIKELY);
  });
});

describe('aliases, former names, legal names and registry numbers', () => {
  it('finds a company by an alias the legacy data keeps inside its name', () => {
    expect(resolve({ name: 'HoneAg', website: 'https://honeag.com' }).outcome).toBe(OUTCOMES.EXACT);
    const r = resolve({ name: 'HoneAg' });
    expect(r.outcome).toBe(OUTCOMES.LIKELY);
    expect(codes(r)).toContain('name_alias');
  });

  it('finds a rebranded company by its former name, and says so', () => {
    const r = resolve({ name: 'GrazeMate' });
    expect(r.outcome).toBe(OUTCOMES.LIKELY);
    expect(r.best.target.id).toBe('brumby-formerly-grazemate');
    expect(codes(r)).toContain('name_former');
    expect(r.best.reasons.join(' ')).toMatch(/former name of an existing company/);
  });

  it('finds a company by a former name or legal name stored in identifiers.json', () => {
    expect(codes(resolve({ name: 'Acme Labs' }))).toContain('name_former');
    const legal = resolve({ name: 'Possibility Studios Pty Ltd' });
    expect(legal.best.target.id).toBe('fastlane');
    expect(codes(legal)).toContain('name_legal');
  });

  it('finds a company by a second domain it owns', () => {
    const r = resolve({ name: 'Acme Robotics', website: 'https://acmerobotics.example' });
    expect(r.outcome).toBe(OUTCOMES.EXACT);
    expect(codes(r)).toContain('domain_alias_match');
  });

  it('is exact on a matching ACN with a compatible name, even with no website', () => {
    const r = resolve({ name: 'Possibility Studios', external_ids: { acn: '690 900 497' } });
    expect(r.outcome).toBe(OUTCOMES.EXACT);
    expect(r.best.score).toBe(1);
  });

  it('sends a matching ACN with a different name to a person: a trading name, or a wrong number', () => {
    const r = resolve({ name: 'Totally Different Name', external_ids: { acn: '690900497' } });
    expect(r.outcome).toBe(OUTCOMES.LIKELY);
    expect(r.best.reasons.join(' ')).toMatch(/registry number but the names differ/);
  });

  it('holds a match below exact when a registry number conflicts, even on the same website and name', () => {
    const r = resolve({ name: 'Fastlane', website: 'https://usefastlane.ai', external_ids: { acn: '004085616' } });
    expect(r.outcome).toBe(OUTCOMES.LIKELY);
    expect(r.best.conflicts).toEqual([{ code: 'acn_differs', detail: '004085616 vs 690900497' }]);
  });

  it('ignores a registry number that fails its checksum', () => {
    const r = resolve({ name: 'Totally Different Name', external_ids: { acn: '690900498' } });
    expect(r.outcome).toBe(OUTCOMES.NEW);
  });
});

describe('weaker evidence goes to review, and one thing alone is not enough', () => {
  it('flags a short name as only possible unless something else agrees', () => {
    expect(resolve({ name: 'Hex' }).outcome).toBe(OUTCOMES.POSSIBLE);
    expect(resolve({ name: 'Hex', city: 'Sydney' }).outcome).toBe(OUTCOMES.LIKELY);
  });

  it('flags a near-identical name, and a name that differs only by a generic word', () => {
    const typo = resolve({ name: 'Acme Robotix' });
    expect(typo.outcome).toBe(OUTCOMES.POSSIBLE);
    expect(codes(typo)).toContain('name_similar');
    const group = resolve({ name: 'Acme Robotics Group' });
    expect(group.outcome).toBe(OUTCOMES.POSSIBLE);
    expect(codes(group)).toContain('name_loose');
    expect(resolve({ name: 'Acme Robotics Group', city: 'Sydney' }).outcome).toBe(OUTCOMES.LIKELY);
  });

  it('flags "Prosus Ventures" against "Prosus" as the same name apart from a generic word', () => {
    const r = resolve({ name: 'Prosus Ventures' }, idx({ companies: [...COMPANIES, co('Prosus')] }));
    expect(r.outcome).toBe(OUTCOMES.POSSIBLE);
    expect(codes(r)).toContain('name_loose');
  });

  it('flags one name containing another when the extra word is not generic: "Lyrebird Health" and "Lyrebird"', () => {
    const r = resolve({ name: 'Lyrebird Health' }, idx({ companies: [...COMPANIES, co('Lyrebird')] }));
    expect(r.outcome).toBe(OUTCOMES.POSSIBLE);
    expect(codes(r)).toContain('name_contained');
  });

  it('flags a shared founder when nothing else relates the two, and ignores a one-word "founder"', () => {
    const r = resolve({ name: 'Totally New Thing', founders: ['Jane Doe'] });
    expect(r.outcome).toBe(OUTCOMES.POSSIBLE);
    expect(codes(r)).toContain('founder_overlap');
    expect(resolve({ name: 'Totally New Thing', founders: ['Jane'] }).outcome).toBe(OUTCOMES.NEW);
  });

  it('does not match on a street address or a city alone: buildings and towns are shared', () => {
    expect(resolve({ name: 'Unrelated Co', address: '1 George St, Sydney NSW 2000', city: 'Sydney' }).outcome).toBe(OUTCOMES.NEW);
  });

  it('calls a company with nothing in common new', () => {
    expect(resolve({ name: 'Zorbly', website: 'https://zorbly.com.au', city: 'Sydney' }).outcome).toBe(OUTCOMES.NEW);
  });
});

describe('ambiguity and human decisions', () => {
  it('will not call a match exact when two existing companies share the website: that is a duplicate to settle first', () => {
    const index = idx({ companies: [...COMPANIES, co('Acme Robotics Copy', { website: 'https://acme.com.au' })] });
    const r = resolve({ name: 'Acme Robotics', website: 'https://acme.com.au' }, index);
    expect(r.outcome).toBe(OUTCOMES.LIKELY);
    expect(r.matches.length).toBeGreaterThanOrEqual(2);
    expect(r.matches.every((m) => m.outcome !== OUTCOMES.EXACT)).toBe(true);
    expect(r.best.reasons.join(' ')).toMatch(/several existing companies/);
  });

  it('stops matching a company a person has said this is not', () => {
    const r = resolve({ name: 'Leonardo.Ai' }, idx(), { exclude: ['leonardo-ai'] });
    expect(r.outcome).toBe(OUTCOMES.NEW);
  });

  it('matches pending candidates too, so the same company found twice is one candidate', () => {
    const candidate = { id: 'cand-zorbly', status: 'needs_review', name: 'Zorbly', aliases: [], website: 'https://zorbly.com.au', city: 'Sydney', founders: [], external_ids: {} };
    const r = resolve({ name: 'Zorbly Pty Ltd', website: 'https://www.zorbly.com.au/about' }, idx({ candidates: [candidate] }));
    expect(r.outcome).toBe(OUTCOMES.EXACT);
    expect(r.best.target).toEqual({ kind: 'candidate', id: 'cand-zorbly', name: 'Zorbly' });
  });

  it('leaves out candidates that already became companies, which the company represents', () => {
    const published = { id: 'cand-zorbly', status: 'published', name: 'Zorbly', aliases: [], website: 'https://zorbly.com.au', founders: [], external_ids: {} };
    expect(idx({ candidates: [published] }).candidates).toEqual([]);
  });

  it('does not compare a candidate with itself, and sees a newly added candidate', () => {
    const candidate = { id: 'cand-zorbly', status: 'candidate', name: 'Zorbly', aliases: [], website: 'https://zorbly.com.au', founders: [], external_ids: {} };
    const index = idx();
    addToIndex(index, candidate);
    const self = resolveLead({ ...identityOfCandidate(candidate) }, index);
    expect(self.outcome).toBe(OUTCOMES.NEW);
    expect(resolve({ name: 'Zorbly', website: 'zorbly.com.au' }, index).outcome).toBe(OUTCOMES.EXACT);
  });

  it('prefers a company over a candidate on equal footing, and returns at most five matches', () => {
    const many = Array.from({ length: 8 }, (_, i) => co(`Widget Works ${i}`, { website: `https://widgetworks${i}.example` }));
    const r = resolve({ name: 'Widget Works' }, idx({ companies: many }));
    expect(r.matches.length).toBeLessThanOrEqual(5);
    const mixed = resolve({ name: 'Zorbly' }, idx({ candidates: [{ id: 'cand-zorbly', status: 'needs_review', name: 'Zorbly', aliases: [], founders: [], external_ids: {} }], companies: [...COMPANIES, co('Zorbly')] }));
    expect(mixed.matches[0].target.kind).toBe('company');
  });
});

describe('scores', () => {
  it('keeps each outcome in its own band, and a registry-number match at 1', () => {
    const exact = resolve({ name: 'Leonardo AI', website: 'leonardo.ai' }).best.score;
    const likely = resolve({ name: 'Leonardo AI' }).best.score;
    const possible = resolve({ name: 'Hex' }).best.score;
    expect(exact).toBeGreaterThanOrEqual(0.9);
    expect(likely).toBeGreaterThanOrEqual(0.65);
    expect(likely).toBeLessThan(0.9);
    expect(possible).toBeGreaterThanOrEqual(0.3);
    expect(possible).toBeLessThan(0.65);
    expect(exact).toBeGreaterThan(likely);
    expect(likely).toBeGreaterThan(possible);
    expect(resolve({ name: 'Possibility Studios', external_ids: { acn: '690900497' } }).best.score).toBe(1);
  });

  it('explains a match in words', () => {
    const line = describeMatch(resolve({ name: 'Leonardo.Ai', website: 'leonardo.ai' }).best);
    expect(line).toMatch(/^EXACT_MATCH 0\.\d+ company "Leonardo AI" \(leonardo-ai\): same website and a compatible name/);
  });
});

describe('purity', () => {
  it('does not modify the data it is given', () => {
    const frozen = deepFreeze({ companies: structuredClone(COMPANIES), identifiers: structuredClone(IDENTIFIERS), candidates: [] });
    const index = buildIndex(frozen);
    expect(() => resolve({ name: 'Leonardo.Ai', website: 'leonardo.ai' }, index)).not.toThrow();
  });

  it('compares identities directly', () => {
    const a = identityOfLead({ name: 'Leonardo.Ai', website: 'leonardo.ai' });
    const b = identityOfCompany(COMPANIES[1]);
    expect(compareIdentities(a, b).outcome).toBe(OUTCOMES.EXACT);
    expect(compareIdentities(a, identityOfCompany(COMPANIES[0])).outcome).toBe(OUTCOMES.NEW);
  });
});

describe('against the shipped companies', () => {
  let ds;
  let index;
  beforeAll(async () => {
    ds = parseRaw(await loadRaw(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data')));
    index = buildIndex(ds);
  });

  it('resolves every existing company, presented back as a lead, to itself and never to a new company', () => {
    for (const c of ds.companies) {
      const withSite = resolveLead(identityOfLead({ name: c.name, website: c.website, city: c.city, founders: c.founders }), index);
      expect(withSite.best?.target.id, `${c.name} (with website)`).toBe(c.id);
      if (c.website) expect(withSite.outcome, c.name).toBe(OUTCOMES.EXACT);
      const nameOnly = resolveLead(identityOfLead({ name: c.name }), index);
      expect(nameOnly.best?.target.id, `${c.name} (name only)`).toBe(c.id);
      expect(nameOnly.outcome, `${c.name} by name alone`).not.toBe(OUTCOMES.EXACT);
    }
  });

  it('finds no pair of existing companies that are exact matches of each other', () => {
    const identities = ds.companies.map((c) => identityOfCompany(c, ds.identifiers));
    for (let i = 0; i < identities.length; i += 1) {
      for (let j = i + 1; j < identities.length; j += 1) {
        expect(compareIdentities(identities[i], identities[j]).outcome, `${identities[i].name} / ${identities[j].name}`).not.toBe(OUTCOMES.EXACT);
      }
    }
  });

  it('behaves as described on the examples that motivated it', () => {
    const resolveReal = (lead) => resolveLead(identityOfLead(lead), index);
    expect(resolveReal({ name: 'Leonardo.Ai', website: 'https://leonardo.ai' })).toMatchObject({ outcome: OUTCOMES.EXACT, best: { target: { id: 'leonardo-ai' } } });
    expect(resolveReal({ name: 'Leonardo.Ai' })).toMatchObject({ outcome: OUTCOMES.LIKELY, best: { target: { id: 'leonardo-ai' } } });
    expect(resolveReal({ name: 'GrazeMate' }).best.target.id).toBe('brumby');
    expect(resolveReal({ name: 'HoneAg', website: 'https://honeag.com' }).outcome).toBe(OUTCOMES.EXACT);
    expect(resolveReal({ name: 'Sherpa Delivery', website: 'https://www.sherpa.net.au/' }).best.target.id).toBe('sherpa');
    expect(resolveReal({ name: 'Zorbly', website: 'https://zorbly.com.au' }).outcome).toBe(OUTCOMES.NEW);
  });
});
