// Who can be an employer of a role on the hiring desk: a company in the directory, or a venture firm in the investor directory. A firm's own vacancies are roles like any other, with the
// firm as the employer; its id is the investor's id with `vc-` in front (VC_PREFIX, models/jobSync.js), so it can never be a company's id and a role's `company_id` keeps one meaning:
// "the employer in the directory". Nothing else about a role changes.
import { VC_PREFIX } from '../models/jobSync.js';

export { VC_PREFIX };
export const vcEmployerId = (investorId) => `${VC_PREFIX}${investorId}`;
export const isVcEmployer = (id) => String(id ?? '').startsWith(VC_PREFIX);

// An investor record whose name was saved in lower case (investible) shows the cased form it also carries as an alias (Investible).
export const firmName = (i) => (i.name === String(i.name).toLowerCase() ? (i.aliases ?? []).find((a) => a.toLowerCase() === i.name && a !== i.name) : null) ?? i.name;

// id -> { id, name, slug, website, kind, city, sector, stage, logo, investors } for every employer, from a dataset (companies, investors).
export function employerMap(ds) {
  const out = new Map();
  for (const c of ds.companies ?? []) {
    out.set(c.id, { id: c.id, name: c.name, slug: c.slug, website: c.website ?? '', kind: 'company', city: c.city ?? '', sector: c.sector ?? '', stage: c.stage ?? '', logo: c.logo ?? null, investors: Array.isArray(c.investors) ? c.investors : [] });
  }
  for (const i of ds.investors ?? []) {
    out.set(vcEmployerId(i.id), { id: vcEmployerId(i.id), name: firmName(i), slug: ['published', 'inactive'].includes(i.verification_status) ? i.slug : null, published: ['published', 'inactive'].includes(i.verification_status), website: i.website ?? '', kind: 'investor', city: i.headquarters_city ?? '', sector: 'Venture capital', stage: '', logo: i.logo ?? null, investors: [] });
  }
  return out;
}
