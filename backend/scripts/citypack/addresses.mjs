// Applies the city pack's address evidence (address-updates-62.json: 50 Melbourne and 12 Perth companies) to the directory, by what each address IS.
//
//   node scripts/citypack/addresses.mjs plan                       prints what each record would do, writes nothing
//   node scripts/citypack/addresses.mjs apply --by "name"          applies it (safe to run again: nothing is added twice, nothing is overwritten)
//
// An address has a type and a status in the evidence file, and the type decides what it can become:
//   operating   an office, lab or hub the company's own page publishes as where it works: recorded as address EVIDENCE (company_website or company_document, with the day
//               the page was consulted), which `locations geocode` and `promote` may turn into a pin where the geocoder confirms the house.
//   listed      a company profile on a platform (LinkedIn) lists it: recorded as evidence from a source that is not the company's own, which never makes a pin.
//   other       a postal, registered, regulatory, partner-listed, dated, historical, incomplete or conflicting address: recorded as a location of its own (company_locations,
//               kind OTHER, with its label and no coordinates), and a matching address that an earlier read recorded as evidence is marked superseded, so it cannot become a pin.
//   nothing     no street is known: nothing is stored, and nothing is invented.
// The consulted dates are carried forward (Melbourne 2026-11-02, Perth 2026-11-05): importing a row does not make its address "verified today". Hiring and funding are not touched.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../discovery.js';
import { loadRaw, parseRaw } from '../../src/models/dataset.js';
import { transact } from '../../src/models/store.js';
import { nameKey, canonicalDomain } from '../../src/models/identity.js';
import { ensureSource, promoteEvidence } from '../../src/discovery/publish.js';
import { parseAddress } from '../../src/models/location.js';
import { valuesEqual } from '../../src/models/evidence.js';
import { cleanAddress } from '../places/rows.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.join(HERE, '..', '..');
const { positional: [step], flags } = parseArgs(process.argv.slice(2));
const dir = path.resolve(typeof flags.data === 'string' ? flags.data : path.join(BACKEND, 'src', 'data'));
const by = typeof flags.by === 'string' ? flags.by : null;
const records = JSON.parse(readFileSync(path.join(HERE, 'input', 'address-updates-62.json'), 'utf8')).records;

// What a person decided where the evidence file is not enough by itself. Each says why, in the words the audit trail keeps.
//   action          operating | other | listed | nothing (overrides what the type and status would say)
//   address         the address to record when it differs from the evidence file's (the company's own page, read by this project)
//   source          { url, kind, day } when the address comes from a page this project read, not from the evidence file
//   label           the words for an 'other' location
//   supersede       a pattern: an earlier evidence row whose address matches is marked superseded
//   extra           more locations of the same company: { label, address, kind }
const RULES = {
  '1receipt': { why: 'Its contact page names the RMIT Activator hub (Carlton) as where it works; Suite 522, 1 Queens Road is a separate service address.', supersede: /Queens R/i, extra: [{ label: 'Service address', address: 'Suite 522, Level 5, 1 Queens Road, Melbourne VIC 3004' }] },
  'Compass Education': { why: 'The head office is the address on its contact page; the separate address on its privacy policy is not an operating office.', address: '109 Burwood Road, Hawthorn VIC', extra: [{ label: 'Other address (privacy policy)', address: 'Level 2, 36-38 Burwood Road, Hawthorn VIC 3122' }] },
  Smileyscope: { why: 'Its contact page names a head office at 488 Victoria Street, North Melbourne; the postcode it prints (3000) is not North Melbourne\'s, so it is stored without one and the geocoder decides. 1/333 Exhibition Street is its registered business address.', address: '488 Victoria Street, North Melbourne VIC', supersede: /Exhibition/i, extra: [{ label: 'Registered business address', address: '1/333 Exhibition Street, Melbourne VIC 3000' }] },
  Nutromics: { why: 'Its contact page gives 420 Victoria Street, Brunswick; "420 VIC Street" in an earlier read is the same address with the name of the street read as the state.', supersede: /VIC Street/i },
  'Brunswick Aces': { why: 'Its contact page names the distillery and bar at 124 Weston Street, Brunswick East as where it works; 6/166 Victoria Street is an address in its terms of service.', supersede: /166 Victoria/i, extra: [{ label: 'Address in its terms of service', address: '6/166 Victoria Street, Brunswick VIC 3056' }] },
  Vinomofo: { why: 'Its contact page names the HQ at Suite 103, 204 Ingles Street; "220 Ingles St" in an earlier read is a different number on the same street.', supersede: /220 Ingles/i },
  Qsic: { why: 'A US company (San Diego) with an Australian office; the published office is in Fitzroy and the older Abbotsford listing is not reused.', extra: [{ label: 'Australian office', address: '145 Little Smith Street, Fitzroy VIC 3065', kind: 'OFFICE' }] },
  'Capability X': { why: 'Its own corporate page gives "Control Centre and HQ 620 Gnangara Rd, Cullacabardee WA 6067"; the Defence West directory prints 6011, which is not the postcode of that address.', action: 'operating', address: '620 Gnangara Road, Cullacabardee WA 6067', source: { url: 'https://www.capabilityx.com/corporate-team', kind: 'company_website', day: '2026-10-31' } },
  Bobbleware: { why: 'Its own contact page gives 15/16 Yampi Way, Willetton WA 6155 (the earlier directory listing said Perth); a stockist\'s address is not its headquarters.', action: 'operating', address: '15/16 Yampi Way, Willetton WA 6155', source: { url: 'https://www.bobbleware.com.au/pages/contact-us', kind: 'company_website', day: '2026-11-05' } },
  Traild: { why: 'Three addresses conflict (the company profile, its privacy policy, its EULA\'s registered address): no operating office is established, so nothing is pinned.', action: 'other', label: 'Company profile address', supersede: /Malvern|Errol/i, extra: [{ label: 'Address on its privacy policy', address: 'Level 1, 540B Malvern Road, Prahran VIC 3181' }] },
  'Nebula Health': { why: 'Its contact page prints a postcode (3004) that does not belong to Exhibition Street in the CBD, so the address is not pinned until that is resolved.', action: 'other', label: 'Contact page address (postcode inconsistent)', supersede: /Exhibition/i },
  Dayworkbook: { why: 'A LinkedIn profile lists 9 The Esplanade; its own privacy and terms pages give 79 St Georges Terrace. The company\'s own address is kept, the listing is evidence only.', action: 'listed' },
  Misti: { why: 'Its home page footer and its June 2026 terms both give 655 Elizabeth Street; the older directory listing (328 Swanston Street) is not used.', action: 'operating' },
  'Cortical Labs': { why: 'The address is from an older privacy policy and its current contact page does not repeat it: historical until it is checked.', action: 'other', label: 'Historical address (older privacy policy)' },
  'Mark My Words': { why: 'Its site says "700 Connect, University of Melbourne": a hub, with no street, floor or postcode. It is not turned into 700 Swanston Street.', action: 'other', label: 'Hub (incomplete address)' },
  NextAero: { why: 'A LinkedIn profile lists Clayton and an industry directory Clayton South: no operating workshop is established.', action: 'other', label: 'Workshop (conflicting listings)' },
};

const consultedISO = (r) => `${r.source_consulted_on}T00:00:00.000Z`;
const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; } };
const isLinkedIn = (url) => /(^|\.)linkedin\.com$/i.test(hostOf(url) ?? '');
const ownDomain = (company, url) => { const mine = canonicalDomain(company.website)?.domain; const h = hostOf(url); return Boolean(mine && h && (h === mine || h.endsWith(`.${mine}`) || mine.endsWith(`.${h}`))); };

// What a record is, from its type and status, unless a person decided otherwise.
function classify(r) {
  const rule = RULES[r.name] ?? {};
  if (rule.action) return rule.action;
  if (!r.address_candidate) return 'nothing';
  if (['office', 'operating_site', 'hub'].includes(r.address_type) && r.address_status === 'published_operating_location') return 'operating';
  if (['office', 'operating_site'].includes(r.address_type) && r.address_status === 'company_profile_listed') return 'listed';
  return 'other';
}

const LABELS = { postal: 'Postal address', registered: 'Registered office', company_contact: 'Address in a company document', office: 'Office listed by a third party', hub: 'Hub (address incomplete)', unknown: 'Address of unconfirmed status' };
const labelOf = (r) => RULES[r.name]?.label ?? (r.address_status === 'regulatory_listing' ? 'Sponsor address in a clinical-trial registration' : r.address_status === 'partner_listed' ? 'Address in a partner\'s documents' : r.address_status === 'dated_company_listing' ? 'Address in a dated company submission' : r.address_status === 'historical' ? 'Historical address' : r.address_status === 'registry_listed' ? 'Registered address (registry)' : LABELS[r.address_type] ?? 'Address');

function companyFor(work, r) {
  const key = nameKey(r.name);
  return work.companies.find((c) => nameKey(c.name) === key) ?? work.companies.find((c) => nameKey(c.slug ?? '') === key) ?? null;
}

async function run(apply) {
  const report = { matched: 0, unmatched: [], operating: [], listed: [], other: [], nothing: [], superseded: [], locations_added: 0, evidence_added: 0 };
  const go = async (work, { at } = {}) => {
    const audit = [];
    work.company_locations ??= [];
    for (const r of records) {
      const company = companyFor(work, r);
      if (!company) { report.unmatched.push(r.name); continue; }
      report.matched += 1;
      const rule = RULES[r.name] ?? {};
      const action = classify(r);
      const when = consultedISO(r);
      const address = rule.address ?? r.address_candidate ?? null;
      const url = rule.source?.url ?? r.source_url;
      const day = rule.source?.day ?? r.source_consulted_on;
      const changes = [];
      const writeLocation = (label, text, kind = 'OTHER', source = null) => {
        const slug = nameKey(label).replace(/ /g, '-');
        const id = `${company.id}.addr.${slug}`;
        if (work.company_locations.some((l) => l.id === id)) return;
        const p = parseAddress(text);
        work.company_locations.push({
          id, company_id: company.id, kind, label, address: text, suburb: p.suburb ?? null, city: company.city ?? null, state: p.state ?? company.state ?? null, country: 'Australia', postcode: p.postcode ?? null,
          latitude: null, longitude: null, location_precision: 'CITY', location_source: source ?? (ownDomain(company, url) ? 'company_document' : 'ecosystem_source'), location_source_url: isLinkedIn(url) ? null : url, location_verified_at: when, location_confidence: 'low',
          created_at: at, updated_at: at,
        });
        report.locations_added += 1;
        changes.push({ field: 'company_locations', from: null, to: `${label}: ${text}` });
      };
      const supersede = (pattern, why, keep = null) => {
        for (const e of work.evidence.filter((x) => x.company_id === company.id && x.field === 'address' && x.status === 'active')) {
          const hit = (pattern && pattern.test(e.value)) || (!pattern && address && valuesEqual('address', e.value, address));
          if (!hit || (keep && valuesEqual('address', e.value, keep))) continue; // never the address being recorded as where it works
          e.status = 'superseded';
          e.note = `${why} (city pack address evidence, ${r.source_consulted_on})`;
          report.superseded.push(`${company.name}: ${e.value}`);
          changes.push({ field: `evidence.${e.id}`, from: 'active', to: 'superseded' });
        }
      };

      if (action === 'operating' && address) {
        const street = cleanAddress(address) ?? address;
        const official = rule.source ? true : ownDomain(company, url);
        const rows = promoteEvidence(work, company.id, [{
          field: 'address', value: street, confidence: official ? 'high' : 'low', verified_at: when,
          note: `${rule.why ?? 'An operating address its own page publishes.'} Address type: ${r.address_type}; status: ${r.address_status}. ${r.notes ?? ''}`.trim().slice(0, 600),
          source: { kind: official ? (/privacy|terms|policy|\.pdf/i.test(url) ? 'company_document' : 'company_website') : 'directory_listing', url, title: `${company.name}: ${hostOf(url)}`, publisher: hostOf(url), retrieved_at: when, note: `Carried forward from the city pack's address evidence (consulted ${day}); not re-checked at import.` },
        }]);
        if (rows.length) { report.evidence_added += rows.length; changes.push({ field: 'evidence.address', from: null, to: street }); }
        if (rule.supersede) supersede(rule.supersede, 'Not the address its own page gives as where it works', street);
        report.operating.push(company.name);
      } else if (action === 'listed' && address && isLinkedIn(url)) {
        writeLocation(`${r.address_type === 'operating_site' ? 'Site' : 'Office'} listed on a company profile (not read)`, address);
        report.listed.push(company.name);
      } else if (action === 'listed' && address) {
        const street = cleanAddress(address) ?? address;
        const rows = promoteEvidence(work, company.id, [{
          field: 'address', value: street, confidence: 'low', verified_at: when,
          note: `${rule.why ?? 'A company profile on another site lists it.'} Address type: ${r.address_type}; status: ${r.address_status}. Not the company's own page, so never a pin. ${r.notes ?? ''}`.trim().slice(0, 600),
          source: { kind: 'directory_listing', url, title: `${company.name}: ${hostOf(url)}`, publisher: hostOf(url), retrieved_at: when, note: `Carried forward from the city pack's address evidence (consulted ${day}); the page itself is not read by this project.` },
        }]);
        if (rows.length) { report.evidence_added += rows.length; changes.push({ field: 'evidence.address', from: null, to: street }); }
        report.listed.push(company.name);
      } else if (action === 'other' && address) {
        writeLocation(labelOf(r), address);
        supersede(rule.supersede ?? null, `Its own page calls this a ${r.address_type} address (${r.address_status}), not where it works`);
        report.other.push(`${company.name} (${r.address_type}/${r.address_status})`);
      } else {
        report.nothing.push(company.name);
      }
      for (const x of rule.extra ?? []) writeLocation(x.label, x.address, x.kind ?? 'OTHER', 'company_document');
      if (changes.length) {
        company.updated_at = at;
        audit.push({ actor: { name: by, role: 'cli' }, via: 'cli', action: 'enrichment.apply', target: { type: 'company', id: company.id }, summary: `${company.name}: the city pack's address evidence (${r.address_type}, ${r.address_status}) was applied as ${action}${rule.why ? ` - ${rule.why}` : ''}`.slice(0, 480), changes });
      }
    }
    return { audit };
  };
  if (apply) {
    if (!by) throw new Error('--by "name" is required: every change is recorded with a name');
    await transact(dir, go);
  } else {
    const work = parseRaw(await loadRaw(dir));
    await go(work, { at: new Date().toISOString() });
  }
  console.log(JSON.stringify({ records: records.length, matched: report.matched, unmatched: report.unmatched, operating_evidence: report.operating.length, listed_only: report.listed.length, kept_as_other_location: report.other.length, nothing_to_store: report.nothing.length, locations_added: report.locations_added, evidence_rows_added: report.evidence_added, evidence_rows_superseded: report.superseded.length }, null, 1));
  console.log('operating:', report.operating.join(', '));
  console.log('listed only:', report.listed.join(', '));
  console.log('other (postal, registered, conflicting, historical...):', report.other.join('; '));
  console.log('superseded:', report.superseded.join('; '));
  if (!apply) console.log('\n(nothing was written)');
}

if (step === 'plan') await run(false);
else if (step === 'apply') await run(true);
else console.log('steps: plan, apply (see the top of this file)');
