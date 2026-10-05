// The source registry. A source is anything that can produce leads:
//
//   { id, kind, region, license, async discover(ctx) -> Lead[] }
//
// A lead is what a source found, nothing more: { key, name, website?, description?,
// city?, state?, address?, founders?, external_ids?, url?, title?, observed_at,
// retrieved_at, publisher?, evidence[], text?, extraction }. A source never decides
// anything about a lead - whether it is new, Australian, a startup, or worth
// publishing is the pipeline's job - so adding a source is writing one adapter and
// one config entry.
//
// Every source must state why we may use it. The licence basis is checked when the
// source is loaded, and one that is missing or incomplete is refused, not run.
import { isStr, URL_RE } from '../../models/company.js';
import { createRssSource } from './rss.js';
import { createSubmissionsSource } from './submissions.js';
import { createStructuredFeedSource } from './structuredFeed.js';

// needsAttestation: the config must say which licence or permission covers the use,
// and link to its terms.
export const LICENSE_BASES = {
  public_feed: { needsAttestation: false },     // a publisher's own RSS/Atom feed, offered for syndication
  user_submission: { needsAttestation: false }, // sent to us by the company or founder
  company_website: { needsAttestation: false }, // the company's own public pages
  open_data: { needsAttestation: true },        // published under an open licence
  licensed_api: { needsAttestation: true },     // a data licence we hold
  permitted_page: { needsAttestation: true },   // a page whose terms and robots.txt allow this use
};

export function validateLicense(license) {
  if (!license || !LICENSE_BASES[license.basis]) return [`license.basis must be one of ${Object.keys(LICENSE_BASES).join(', ')}`];
  const errors = [];
  if (LICENSE_BASES[license.basis].needsAttestation) {
    if (!isStr(license.attestation)) errors.push(`license.attestation is required for ${license.basis}: say which licence or permission covers this use`);
    if (!URL_RE.test(license.terms_url ?? '')) errors.push(`license.terms_url must link to the terms for ${license.basis}`);
  } else if (license.terms_url != null && !URL_RE.test(license.terms_url)) errors.push('license.terms_url must be an http(s) link');
  return errors;
}

export const ADAPTERS = {
  rss: createRssSource,
  submissions: createSubmissionsSource,
  'structured-feed': createStructuredFeedSource,
};

// Instantiates the enabled sources. One that is disabled, unknown, or fails its
// licence or config check is reported in skipped with the reason and never run.
export function loadSources(configs, { env = process.env, only = null } = {}) {
  const sources = [];
  const skipped = [];
  for (const config of configs) {
    if (only && !only.includes(config.id)) continue;
    if (config.enabled === false) { skipped.push({ id: config.id, reason: 'disabled' }); continue; }
    const create = ADAPTERS[config.adapter];
    if (!create) { skipped.push({ id: config.id, reason: `unknown adapter "${config.adapter}"` }); continue; }
    const licenseErrors = validateLicense(config.license);
    if (licenseErrors.length) { skipped.push({ id: config.id, reason: `no valid licence: ${licenseErrors.join('; ')}` }); continue; }
    try {
      const source = create(config, env);
      sources.push({ ...source, licenseBasis: config.license.basis });
    } catch (err) {
      skipped.push({ id: config.id, reason: err.message });
    }
  }
  return { sources, skipped };
}
