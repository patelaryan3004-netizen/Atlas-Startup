// Shared scaffolding for the investor page tests: cards and profiles as the server serves them, and a stand-in for the server.
import { vi } from 'vitest';

export const AT = '2026-10-08T12:00:00.000Z';

export const card = (over = {}) => ({
  slug: 'blackbird', name: 'Blackbird', aliases: [], type: 'venture_capital', type_label: 'Venture Capital', website: 'https://blackbird.example', domain: 'blackbird.example',
  stages: ['Seed', 'Series A'], sectors: ['Software'], location: { city: 'Sydney', state: 'NSW', country: 'Australia', label: 'Sydney, NSW' },
  portfolio_count: 3, active_status: 'active', status: 'published', verified_at: AT, ...over,
});

export const company = (over = {}) => ({ slug: 'acme', name: 'Acme', sector: 'Software', city: 'Sydney', stage: 'Series A', hiring: false, website: 'https://acme.example', ...over });
export const page = (over = {}) => ({ id: 's1', title: 'Blackbird about', url: 'https://blackbird.example/about', publisher: 'blackbird.example', kind: 'investor_website', retrieved_at: AT, backs: ['stages'], ...over });

// An investor in full with nothing but what every public record has: a name, the pages behind it, and when it was verified.
export const profile = (over = {}) => ({
  ...card(), id: 'blackbird', logo: null, description: null, investment_thesis: null, geographies: [], other_offices: [], cheque: null, lead_or_follow: null,
  application_url: null, jobs_url: null, team: [], funds: [], portfolio: [], recent: [], jobs: { url: null, hiring: [] }, related: [], sources: [page()], ...over,
});

export const row = (over = {}) => ({ company: company(), round: 'Series A', investment_date: '2025-06', amount: null, currency: null, lead_status: null, fund: null, person: null, source: page({ id: 'p1', title: 'Portfolio page', url: 'https://blackbird.example/portfolio' }), verified_at: AT, ...over });

export const person = (over = {}) => ({
  slug: 'sam', name: 'Sam Rivera', photo: null, current_title: 'Partner', organisation: { slug: 'blackbird', name: 'Blackbird' }, location: 'Sydney, NSW', biography: null,
  previous_companies: [], previous_investor_organisations: [], sector_focus: [], stage_focus: [], linkedin_url: null, personal_website: null, roles: [], investments: [], companies: [],
  last_verified_at: AT, sources: [page({ id: 't1', title: 'Team page', url: 'https://blackbird.example/team', backs: ['role'] })], ...over,
});

const LABELS = { venture_capital: 'Venture Capital', angel_network: 'Angel Network', corporate_vc: 'Corporate VC' };
const countBy = (cards, pick) => {
  const m = new Map();
  for (const c of cards) for (const v of [].concat(pick(c))) if (v) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m].map(([value, count]) => ({ value, count }));
};
export const metaOf = (cards, over = {}) => ({
  total: cards.length,
  types: countBy(cards, (c) => c.type).map((t) => ({ ...t, label: LABELS[t.value] ?? t.value })),
  stages: countBy(cards, (c) => c.stages), sectors: countBy(cards, (c) => c.sectors), locations: countBy(cards, (c) => c.location.state ?? c.location.country),
  lead: [], active: countBy(cards, (c) => c.active_status), cheque: null, ...over,
});

// A stand-in for the server: filters the cards it has, pages them in the order given, and knows the profiles it is given.
export function serve(api, { cards = [card()], meta = metaOf(cards), profiles = {}, people = {} } = {}) {
  api.fetchInvestorMeta.mockResolvedValue(meta);
  api.fetchInvestors.mockImplementation(async (filters = {}, { limit = 24, offset = 0 } = {}) => {
    const matches = cards.filter((c) => (!filters.type || c.type === filters.type) && (!filters.stage || c.stages.includes(filters.stage))
      && (!filters.search || JSON.stringify(c).toLowerCase().includes(String(filters.search).toLowerCase())));
    return { total: cards.length, count: matches.length, results: matches.slice(offset, offset + limit), offset, limit, hasMore: offset + limit < matches.length };
  });
  api.fetchInvestor.mockImplementation(async (slug) => {
    if (!profiles[slug]) throw Object.assign(new Error('Failed to fetch the investor'), { status: 404 });
    return profiles[slug];
  });
  api.fetchInvestorPerson.mockImplementation(async (slug) => {
    if (!people[slug]) throw Object.assign(new Error('Failed to fetch the person'), { status: 404 });
    return people[slug];
  });
}

export const mockApi = () => ({
  fetchInvestors: vi.fn(), fetchInvestorMeta: vi.fn(), fetchInvestor: vi.fn(), fetchInvestorPerson: vi.fn(), submitInvestorCorrection: vi.fn(), fetchInvestorsByName: vi.fn(),
});
