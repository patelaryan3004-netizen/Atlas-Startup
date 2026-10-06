// What changes a company's location, other than a person at the Command Center. Each function works on a working
// copy of the dataset (the caller runs it inside a transaction, which migrates, validates and writes it with an
// audit row per company) and returns what it did, company by company, as [{ company_id, name, action, ... changes }].
//
//   geocodeTargets   which companies are worth asking a geocoder about
//   applyGeocodes    puts the geocoder's point on a company when the answer is good and agrees with the record
//   verifyFromEvidence  attaches the page that states an address, to a location that has no source yet
//   promotionCandidates / applyPromotions  gives a city-level company the street address its own website states
//   clearAreaCoordinates  takes the coordinates off a city- or state-level company: a city centre is not where it is
//
// None of them invents a value: a point comes from the geocoder's answer for the company's own address, and a source
// from an evidence row that cites it. A disagreement is reported, never settled here.
import { confirmLocation } from '../enrichment/fill.js';
import { sameAddress } from '../models/identity.js';
import { hasPoint, isPointPrecision, isOfficialSource, deriveBlock, confidenceFor, locationSourceFor, parseAddress, SOURCE_RANK, locationEvidenceIndex } from '../models/location.js';
import { questionFor, cachedVerdict } from './geocode.js';

const isStr = (v) => typeof v === 'string' && v.trim() !== '';

// Companies a geocoder can usefully be asked about: those that are located and have a street address (to get a
// point, or to check the one on file) or are suburb-level (to put the point at the suburb's centre). With
// `candidates`, also the address a city-level company's own website states (see promotionCandidates), marked
// `candidate: true`: it is asked about, but never applied by applyGeocodes.
export function geocodeTargets(ds, { company = null, candidates = false } = {}) {
  const out = [];
  for (const c of ds.companies) {
    if (company && c.id !== company) continue;
    if (c.verified !== true || c.location_precision === 'UNKNOWN') continue;
    const question = questionFor(c);
    if (!question || question.kind === 'city') continue;
    if (question.kind === 'suburb' && c.location_precision !== 'SUBURB') continue;
    out.push({ company: c, question });
  }
  if (candidates) for (const p of promotionCandidates(ds, { company })) out.push({ company: p.asked, question: p.question, candidate: true });
  return out;
}

// A company known only to its city, with no address of its own on file, whose website or published document states a
// street address in Australia. { company: the record, asked: the record as if it carried that address (so the geocoder
// can be asked about it, and its answer judged, by the same code as any other address), question, evidence, address,
// disagree }. `disagree` is true when the official sources it cites do not all state the same address.
export function promotionCandidates(ds, { company = null } = {}) {
  const index = locationEvidenceIndex(ds);
  const rank = (row) => SOURCE_RANK[locationSourceFor(row.source.kind)];
  const out = [];
  for (const c of ds.companies) {
    if (company && c.id !== company) continue;
    if (c.verified !== true || c.location_precision !== 'CITY' || isStr(c.address)) continue;
    const rows = (index.get(c.id) ?? []).filter((r) => r.field === 'address' && isOfficialSource(locationSourceFor(r.source.kind)) && parseAddress(String(r.value)).streetLevel)
      .sort((a, b) => rank(a) - rank(b) || String(b.verified_at ?? '').localeCompare(String(a.verified_at ?? '')));
    if (!rows.length) continue;
    const [best] = rows;
    const address = String(best.value).trim();
    // The question is the address as the company states it, in the state it states: if the record says elsewhere, that is a
    // disagreement to report, not something to ask the geocoder to settle.
    const asked = { ...c, address, state: parseAddress(address).state ?? c.state };
    out.push({ company: c, asked, question: questionFor(asked), evidence: best, address, disagree: rows.some((r) => !sameAddress(address, String(r.value))) });
  }
  return out;
}

const changed = (a, b) => JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);

// For each target with an answer in the cache: place, confirm (replace the point with the geocoder's), agrees (nothing
// to move), or leave alone. Only `place` and `confirm` move a point and `agrees` can raise the confidence; `conflict`
// and `skip` are reported and change nothing.
export function applyGeocodes(work, { at, company = null } = {}) {
  const results = [];
  for (const { company: c, question } of geocodeTargets(work, { company })) {
    const verdict = cachedVerdict(c, work.geocode_cache);
    if (!verdict) { results.push({ company_id: c.id, name: c.name, kind: question.kind, action: 'unasked', changes: [] }); continue; }
    const { decision } = verdict;
    const base = { company_id: c.id, name: c.name, kind: question.kind, action: decision.action, away: decision.away ?? null, reason: decision.reason ?? null, changes: [] };
    if (['place', 'confirm', 'agrees'].includes(decision.action)) {
      const { found } = decision;
      const precision = question.kind === 'address' ? 'EXACT' : 'SUBURB';
      // Where the geocoder and the record already agree the point stays exactly as it is; only what the agreement says
      // about how sure we are (the confidence) can change.
      const point = decision.action === 'agrees' ? { lat: c.lat, lng: c.lng } : { lat: found.lat, lng: found.lng };
      const changes = confirmLocation(c, {
        city: c.city, address: c.address, suburb: c.suburb, state: c.state, postcode: c.postcode, ...point, precision,
        source: c.location_source ?? 'directory_record', sourceUrl: c.location_source_url ?? null, verifiedAt: c.location_verified_at ?? null, geocodeAgrees: true,
      }, { at });
      if (changes.length) c.updated_at = at;
      base.changes = changes;
      base.action = changes.length ? decision.action : 'agrees';
    }
    results.push(base);
  }
  return results;
}

// A location with no source behind it (a record nobody can trace) gets the page that states its address, when an
// active evidence row cites one: the best source wins, and the time the page was read is when it was checked.
export function verifyFromEvidence(work, { at }) {
  const index = locationEvidenceIndex(work);
  const results = [];
  for (const c of work.companies) {
    if (c.verified !== true || !['EXACT', 'SUBURB', 'CITY'].includes(c.location_precision)) continue;
    const derived = deriveBlock({ ...c, verified: true }, { evidence: index.get(c.id) ?? [] });
    if (derived.location_source === 'directory_record' || derived.location_source == null) continue; // nothing backs it
    // Only ever upward: a better source than the one on record, or the same kind read more recently.
    const newRank = SOURCE_RANK[derived.location_source] ?? 9;
    const currentRank = SOURCE_RANK[c.location_source] ?? 9;
    const newer = derived.location_verified_at != null && (c.location_verified_at == null || Date.parse(derived.location_verified_at) > Date.parse(c.location_verified_at));
    if (!(newRank < currentRank || (newRank === currentRank && newer))) continue;
    const verdict = isPointPrecision(c.location_precision) ? cachedVerdict(c, work.geocode_cache) : null;
    const agrees = verdict != null && ['agrees', 'confirm', 'place'].includes(verdict.decision.action) && (verdict.decision.away ?? 0) <= 50;
    const next = {
      location_source: derived.location_source, location_source_url: derived.location_source_url, location_verified_at: derived.location_verified_at,
      location_confidence: confidenceFor({ source: derived.location_source, verified: derived.location_verified_at != null, geocodeAgrees: agrees }),
    };
    const changes = Object.keys(next).filter((k) => changed(c[k], next[k])).map((field) => ({ field, from: c[field] ?? null, to: next[field] }));
    if (!changes.length) continue;
    Object.assign(c, next);
    c.updated_at = at;
    results.push({ company_id: c.id, name: c.name, action: 'verified', source: next.location_source, changes });
  }
  return results;
}

// Gives each promotable city-level company the street address its own website states, at the point the geocoder puts
// that address: EXACT, sourced to the page, checked against it (so high confidence), and recorded as a change a person
// can read. Only when everything agrees: the sources state one address, in the state the record names, and the
// geocoder found the house in the right suburb and near the city. Anything else is reported, not applied.
//   promoted  the company is now at the address its own page states
//   conflict  something disagrees (the pages, the state, the geocoder): a person should look
//   skip      the geocoder could not settle it (only the street, nothing found)
//   unasked   the geocoder has not been asked yet
export function applyPromotions(work, { at, company = null } = {}) {
  const results = [];
  for (const p of promotionCandidates(work, { company })) {
    const c = work.companies.find((x) => x.id === p.company.id);
    const kind = locationSourceFor(p.evidence.source.kind);
    const parsed = parseAddress(p.address);
    const base = { company_id: c.id, name: c.name, address: p.address, source: kind, changes: [] };
    if (p.disagree) { results.push({ ...base, action: 'conflict', reason: "the company's own pages do not all state the same address" }); continue; }
    if (parsed.state && c.state && parsed.state !== c.state) { results.push({ ...base, action: 'conflict', reason: `its own page puts it in ${parsed.state}, the record in ${c.state}` }); continue; }
    const verdict = cachedVerdict(p.asked, work.geocode_cache);
    if (!verdict) { results.push({ ...base, action: 'unasked' }); continue; }
    const { decision } = verdict;
    if (decision.action !== 'place') { results.push({ ...base, action: decision.action === 'conflict' ? 'conflict' : 'skip', reason: decision.reason }); continue; }
    base.changes = confirmLocation(c, {
      city: c.city, address: p.address, state: c.state ?? parsed.state, postcode: parsed.postcode, lat: decision.found.lat, lng: decision.found.lng, precision: 'EXACT',
      source: kind, sourceUrl: p.evidence.source.url, verifiedAt: p.evidence.verified_at ?? null, geocodeAgrees: true,
    }, { at });
    c.updated_at = at;
    results.push({ ...base, action: 'promoted' });
  }
  return results;
}

// A company known only to its city or state is not at a point. Any coordinates it carries are a city centre (or a
// guess), and every reader would take them for the company's own: they come off.
export function clearAreaCoordinates(work, { at }) {
  const results = [];
  for (const c of work.companies) {
    if (!['CITY', 'STATE'].includes(c.location_precision) || !hasPoint(c)) continue;
    const changes = [{ field: 'lat', from: c.lat, to: null }, { field: 'lng', from: c.lng, to: null }];
    c.lat = null;
    c.lng = null;
    c.updated_at = at;
    results.push({ company_id: c.id, name: c.name, action: 'cleared', changes });
  }
  return results;
}
