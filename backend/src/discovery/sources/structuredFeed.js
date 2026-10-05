// A structured dataset we may use: a licensed API, an open dataset published for
// reuse, or a portfolio listing whose terms permit it. Nothing is hard-coded about
// any particular provider; a config names where the data is, how its columns map
// onto a lead, and the licence that covers the use. A source without a valid
// licence is refused when it is loaded (see sources/index.js).
//
//   {
//     id: 'open.example', adapter: 'structured-feed',
//     kind: 'open_dataset' | 'licensed_dataset', region: 'AU', publisher: 'Example Org',
//     license: { basis: 'open_data', attestation: 'CC BY 3.0 AU', terms_url: 'https://...' },
//     source: { url: 'https://.../data.json' | file: 'C:/.../data.csv', format: 'json' | 'csv', records_path: 'data.items' },
//     headers_env: { 'x-api-key': 'EXAMPLE_API_KEY' },      // licensed APIs only; read from the environment, never stored
//     field_map: { key: 'id', name: 'company_name', website: 'url', description: 'summary', city: 'city', state: 'state',
//                  address: 'address', founders: { column: 'founders', split: ';' }, abn: 'abn', acn: 'acn', observed_at: 'updated' },
//   }
//
// Fetching goes through the compliance fetcher like everything else. This is not a
// way to copy a proprietary database: that needs a licence, stated in the config.
import { readFile } from 'node:fs/promises';
import { DATA_TYPES } from '../http.js';
import { websiteUrl, normalizeABN, normalizeACN } from '../../models/identity.js';

// RFC 4180: quoted fields, doubled quotes, commas and line breaks inside quotes.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const src = String(text).replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c !== '')) rows.push(row);
  const [header, ...body] = rows;
  return (header ?? []).length ? body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? '']))) : [];
}

const at = (obj, pathExpr) => String(pathExpr).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const clean = (v) => (v == null ? null : String(v).replace(/\s+/g, ' ').trim() || null);

function pick(record, spec) {
  if (spec == null) return null;
  if (typeof spec === 'object') {
    const raw = at(record, spec.column);
    if (Array.isArray(raw)) return raw.map(clean).filter(Boolean);
    return clean(raw) ? clean(raw).split(spec.split ?? ';').map((s) => s.trim()).filter(Boolean) : [];
  }
  return clean(at(record, spec));
}

export function recordToLead(record, config, { retrievedAt }) {
  const m = config.field_map;
  const name = pick(record, m.name);
  if (!name) return null;
  const confidence = 'medium'; // a licensed or open dataset is a retrieved secondary source
  const note = `From ${config.publisher ?? config.id}.`;
  const website = websiteUrl(pick(record, m.website));
  const description = pick(record, m.description);
  const city = pick(record, m.city);
  const state = pick(record, m.state);
  const founders = pick(record, m.founders) ?? [];
  const evidence = [];
  if (website) evidence.push({ field: 'website', value: website, confidence, note });
  if (description) evidence.push({ field: 'description', value: description.slice(0, 500), confidence, note });
  if (city) evidence.push({ field: 'city', value: city, confidence, note });
  for (const founder of founders) evidence.push({ field: 'founders', value: founder, confidence, note });
  const observed = pick(record, m.observed_at);
  const parsed = observed ? new Date(observed) : null;
  return {
    key: pick(record, m.key) ?? name, name, website, description, city, state, founders,
    address: pick(record, m.address),
    external_ids: { abn: normalizeABN(pick(record, m.abn)), acn: normalizeACN(pick(record, m.acn)) },
    url: null, title: name, publisher: config.publisher ?? config.id,
    observed_at: parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : retrievedAt, retrieved_at: retrievedAt,
    evidence, text: description ?? '', extraction: { method: 'structured', agreed: false },
  };
}

export function createStructuredFeedSource(config, env = process.env) {
  const { id, kind, region = 'AU', source, field_map: map } = config;
  if (!['open_dataset', 'licensed_dataset'].includes(kind)) throw new Error(`source "${id}": kind must be open_dataset or licensed_dataset`);
  if (!source || (!source.url && !source.file)) throw new Error(`source "${id}": source.url or source.file is required`);
  if (!['json', 'csv'].includes(source.format)) throw new Error(`source "${id}": source.format must be json or csv`);
  if (!map?.name) throw new Error(`source "${id}": field_map.name is required`);
  if (config.headers_env && config.license?.basis !== 'licensed_api') throw new Error(`source "${id}": headers_env is only for a licensed_api source`);
  return {
    id, kind, region, license: config.license,
    async discover(ctx) {
      let body;
      if (source.file) body = await readFile(source.file, 'utf-8');
      else {
        const headers = {};
        for (const [header, variable] of Object.entries(config.headers_env ?? {})) {
          if (!env[variable]) throw new Error(`set ${variable} in the environment: the ${config.license.basis} credential for ${id}`);
          headers[header] = env[variable];
        }
        body = (await ctx.fetcher.get(source.url, { accept: source.format === 'json' ? 'application/json' : 'text/csv', allow: DATA_TYPES, headers })).text;
      }
      let records = source.format === 'csv' ? parseCsv(body) : JSON.parse(body);
      if (source.format === 'json' && source.records_path) records = at(records, source.records_path);
      if (!Array.isArray(records)) throw new Error(`${id}: expected a list of records${source.records_path ? ` at "${source.records_path}"` : ''}`);
      const retrievedAt = new Date(ctx.now()).toISOString();
      return records.map((r) => recordToLead(r, config, { retrievedAt })).filter(Boolean);
    },
  };
}
