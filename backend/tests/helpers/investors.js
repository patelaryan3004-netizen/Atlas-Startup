// Shared scaffolding for the investor tests: companies, investor organisations that are fully backed by sources (so they can
// be verified and published), and the other rows of the layer. Nothing here touches the network or the real data.
import { migrateDataset } from '../../src/models/dataset.js';
import { co } from './locations.js';

export { co };
export const NOW = Date.parse('2026-10-08T01:00:00.000Z');
export const ISO = '2026-10-08T01:00:00.000Z';
export const LONG_AGO = '2024-01-02T00:00:00.000Z';

export const source = (id, kind = 'investor_website', over = {}) => ({
  id, kind, url: `https://${id}.example/about`, title: `${id} about`, publisher: id, retrieved_at: ISO, note: '', ...over,
});

export const bare = (id, over = {}) => ({ id, name: over.name ?? `${id[0].toUpperCase()}${id.slice(1)}`, slug: id, aliases: [], ...over });

// A verification record, in the form the model stores it.
export const record = (subject_id, field, value, source_id, over = {}) => ({
  id: `${subject_id}.${field}.${typeof value === 'string' ? value.toLowerCase().replace(/[^a-z0-9]+/g, '-') : 'x'}.${source_id}`,
  subject_type: 'investor_organisation', subject_id, field, value, source_id, confidence: 'high', verified_at: ISO, status: 'active',
  note: `The page says: "${typeof value === 'string' ? value : JSON.stringify(value)}".`, ...over,
});

// An organisation with every identity claim backed by one source, ready to be verified. `status` and any field can be overridden;
// pass `claims` to add more claims (and their records) of the same source.
export function backed(id, over = {}, claims = []) {
  const src = source(`${id}-site`);
  const org = {
    ...bare(id), website: `https://${id}.example/`, investor_type: 'venture_capital', inclusion_basis: 'based_in_australia',
    headquarters_city: 'Sydney', state: 'NSW', country: 'Australia', verification_status: 'verified', last_verified_at: ISO, ...over,
  };
  // A record for each identity claim the organisation makes (one it does not make has none).
  const records = [
    ['name', org.name], ['website', org.website], ['investor_type', org.investor_type], ['inclusion_basis', org.inclusion_basis],
    ['headquarters_city', org.headquarters_city], ['state', org.state], ['country', org.country], ...claims,
  ].filter(([, value]) => value != null).map(([field, value]) => record(id, field, value, src.id));
  return { org, source: src, records };
}

// A dataset from companies and the parts that backed() (or a test) gives. Migrated, so it is what the store would hold.
export function world({ companies = [co('Acme')], orgs = [], extra = {} } = {}) {
  const investors = [...orgs.map((o) => o.org ?? o), ...(extra.investors ?? [])];
  const sources = [...orgs.flatMap((o) => (o.source ? [o.source] : [])), ...(extra.sources ?? [])];
  const verification_records = [...orgs.flatMap((o) => o.records ?? []), ...(extra.verification_records ?? [])];
  return migrateDataset({
    companies, people: [], evidence: [], funding_rounds: [], jobs: [], news: [], ...extra, investors, sources, verification_records,
  });
}

export const investment = (investor, company, source_id, over = {}) => ({
  id: `${investor}-${company}`, investor_organisation_id: investor, fund_id: null, investor_person_id: null, company_id: company, round: null,
  investment_date: null, amount: null, currency: null, lead_status: null, source_id, note: 'Listed in the portfolio.', verified_at: ISO,
  verification_status: 'verified', ...over,
});

export const person = (id, over = {}) => ({ id, name: over.name ?? id, slug: id, ...over });
export const role = (person_id, organisation_id, source_id, over = {}) => ({
  id: `${person_id}-${organisation_id}`, person_id, organisation_id, role: 'Partner', is_current: true, started_on: null, ended_on: null,
  source_id, note: 'On the team page.', verified_at: ISO, verification_status: 'verified', ...over,
});
