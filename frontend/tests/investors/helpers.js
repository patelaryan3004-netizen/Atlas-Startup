// Shared scaffolding for the investor page tests: cards and profiles as the server serves them, and a stand-in for the server.
import { vi } from 'vitest';

export const AT = '2026-10-08T12:00:00.000Z';

// A firm as the list serves it once people are asked for: with its kind, its key and where it is based.
export const card = (over = {}) => ({
  kind: 'firm', key: over.slug ?? 'blackbird', scope: (over.location?.country ?? 'Australia') === 'Australia' ? 'au' : 'global',
  slug: 'blackbird', name: 'Blackbird', aliases: [], type: 'venture_capital', type_label: 'Venture Capital', website: 'https://blackbird.example', domain: 'blackbird.example',
  stages: ['Seed', 'Series A'], sectors: ['Software'], location: { city: 'Sydney', state: 'NSW', country: 'Australia', label: 'Sydney, NSW' },
  portfolio_count: 3, active_status: 'active', status: 'published', verified_at: AT, ...over,
});

// A person as the list serves them: their role, their firm, where they are and what they invest in.
export const personCard = (over = {}) => ({
  kind: 'person', key: `people/${over.slug ?? 'sam'}`, slug: 'sam', name: 'Sam Rivera', photo: null, title: 'Partner', role_class: 'investment', role_label: 'Investing',
  organisation: { slug: 'blackbird', name: 'Blackbird', domain: 'blackbird.example', logo: null }, domain: 'blackbird.example', type: 'venture_capital', type_label: 'Venture Capital',
  stages: ['Seed'], sectors: ['Software'], focus_from: 'person', location: { city: 'Sydney', state: 'NSW', country: 'Australia', label: 'Sydney, NSW' }, scope: 'au',
  portfolio_count: 0, active_status: null, status: 'published', verified_at: AT, ...over,
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
  slug: 'sam', name: 'Sam Rivera', photo: null, current_title: 'Partner', role_class: 'investment', role_label: 'Investing', scope: 'au',
  organisation: { slug: 'blackbird', name: 'Blackbird', domain: 'blackbird.example', website: 'https://blackbird.example/', type_label: 'Venture Capital', country: 'Australia', inclusion_basis: 'based_in_australia', sectors: ['Software'], stages: ['Seed'], scope: 'au' }, location: 'Sydney, NSW', biography: null,
  previous_companies: [], previous_investor_organisations: [], sector_focus: [], stage_focus: [], linkedin_url: null, personal_website: null, roles: [], investments: [], companies: [],
  last_verified_at: AT, sources: [page({ id: 't1', title: 'Team page', url: 'https://blackbird.example/team', backs: ['role'] })], ...over,
});

const LABELS = { venture_capital: 'Venture Capital', angel_network: 'Angel Network', corporate_vc: 'Corporate VC' };
const countBy = (cards, pick) => {
  const m = new Map();
  for (const c of cards) for (const v of [].concat(pick(c))) if (v) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m].map(([value, count]) => ({ value, count }));
};
export const metaOf = (cards, over = {}, people = []) => ({
  total: cards.length + people.length,
  roles: [], kinds: { firm: cards.length, person: people.length }, scopes: { au: [...cards, ...people].filter((c) => c.scope === 'au').length, global: cards.length + people.length },
  types: countBy(cards, (c) => c.type).map((t) => ({ ...t, label: LABELS[t.value] ?? t.value })),
  stages: countBy(cards, (c) => c.stages), sectors: countBy(cards, (c) => c.sectors), locations: countBy(cards, (c) => c.location.state ?? c.location.country),
  lead: [], active: countBy(cards, (c) => c.active_status), cheque: null, ...over,
});

const list = (v) => (v ? String(v).split(',').filter(Boolean) : null);
const ORDERS = {
  name: (a, b) => a.name.localeCompare(b.name),
  name_desc: (a, b) => b.name.localeCompare(a.name),
  portfolio: (a, b) => b.portfolio_count - a.portfolio_count || a.name.localeCompare(b.name),
  location: (a, b) => (a.location.label ?? '\uffff').localeCompare(b.location.label ?? '\uffff') || a.name.localeCompare(b.name),
};

// A stand-in for the server: filters the cards it has (by search, type, stage, sector and location, each of several, and by address), puts them in the
// order asked for, pages them, and knows the profiles it is given.
export function serve(api, { cards = [card()], peopleCards = [], meta = metaOf(cards, {}, peopleCards), profiles = {}, people = {} } = {}) {
  api.fetchInvestorMeta.mockResolvedValue(meta);
  api.fetchInvestors.mockImplementation(async (filters = {}, { limit = 24, offset = 0, sort = 'name' } = {}) => {
    const [types, stages, sectors, places, slugs, roles] = ['type', 'stage', 'sector', 'location', 'slug', 'role'].map((k) => list(filters[k]));
    const pool = filters.kind === 'person' ? peopleCards : filters.kind === 'all' ? [...cards, ...peopleCards] : cards;
    const matches = pool.filter((c) => (!types || types.includes(c.type)) && (filters.scope !== 'au' || c.scope === 'au') && (!roles || roles.includes(c.role_class)) && (!stages || c.stages.some((s) => stages.includes(s))) && (!sectors || c.sectors.some((s) => sectors.includes(s)))
      && (!places || places.includes(c.location.state ?? c.location.country)) && (!slugs || slugs.includes(c.key ?? c.slug))
      && (!filters.search || JSON.stringify(c).toLowerCase().includes(String(filters.search).toLowerCase()))).sort(ORDERS[sort]);
    return { total: pool.length, count: matches.length, results: matches.slice(offset, offset + limit), offset, limit, hasMore: offset + limit < matches.length };
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
  fetchInvestors: vi.fn(), fetchInvestorMeta: vi.fn(), fetchInvestor: vi.fn(), fetchInvestorPerson: vi.fn(), submitInvestorCorrection: vi.fn(), fetchInvestorsByName: vi.fn(), submitFeedback: vi.fn(),
});
