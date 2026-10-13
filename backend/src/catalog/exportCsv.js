// The directory as a spreadsheet: exactly the companies a set of filters picks, in the order asked for, every column the directory has
// and the page each optional fact comes from. It is a download of one whole result, not a page of one, so it is the one list that is not
// cut into pages of 20.
import { pageOf } from './catalog.js';

// What the first column says is each company's; the rest follow in the order a reader works down them. A fact comes with the address of the
// page behind it and when that page was checked, and a company with none of a fact leaves its cells empty: nothing is written for "unknown".
// The older records write "Unknown" for what is not known; the directory does not show it, and neither does a spreadsheet of it.
const known = (v) => (typeof v === 'string' && v.trim().toLowerCase() === 'unknown' ? '' : v);

export const CSV_COLUMNS = [
  ['name', (r) => r.name],
  ['slug', (r) => r.slug ?? r.id ?? ''],
  ['sector', (r) => known(r.sectorFull) || known(r.sector)],
  ['stage', (r) => known(r.stage)],
  ['city', (r) => known(r.city)],
  ['state', (r) => r.state],
  ['website', (r) => r.website],
  ['website_status', (r) => r.website_status],
  ['hiring', (r) => hiringText(r)],
  ['hiring_source_url', (r) => r.hiring_source_url],
  ['verified', (r) => (r.verified === true ? 'yes' : r.verified === false ? 'no' : '')],
  ['last_verified_at', (r) => r.last_verified_at],
  ['team_size', (r) => r.team_size],
  ['team_size_source_url', (r) => r.facts?.team_size?.source_url],
  ['team_size_verified_at', (r) => r.facts?.team_size?.verified_at],
  ['remote_policy', (r) => r.remote_policy],
  ['remote_policy_source_url', (r) => r.facts?.remote_policy?.source_url],
  ['remote_policy_verified_at', (r) => r.facts?.remote_policy?.verified_at],
  ['tech_stack', (r) => (Array.isArray(r.tech_stack) ? r.tech_stack.join('; ') : '')],
  ['tech_stack_source_url', (r) => r.facts?.tech_stack?.source_url],
  ['tech_stack_verified_at', (r) => r.facts?.tech_stack?.verified_at],
  ['last_funding_date', (r) => r.last_funding_date],
  ['last_funding_date_source_url', (r) => r.facts?.last_funding_date?.source_url],
  ['last_funding_date_verified_at', (r) => r.facts?.last_funding_date?.verified_at],
  ['last_role_seen_at', (r) => r.last_role_seen_at],
  ['last_role_seen_at_source_url', (r) => r.facts?.last_role_seen_at?.source_url],
  ['last_role_seen_at_verified_at', (r) => r.facts?.last_role_seen_at?.verified_at],
];

const day = (iso) => (typeof iso === 'string' && iso.length >= 10 ? iso.slice(0, 10) : null);

// What the site says about hiring, in the same four ways (see hiringStateOf): never a bare "no".
function hiringText(r) {
  if (r.hiringState === 'hiring' || (r.hiringState == null && r.hiring === true)) return 'Hiring now';
  if (r.hiringState === 'checked') return day(r.hiring_checked_at) ? `Hiring (checked ${day(r.hiring_checked_at)})` : 'Hiring (checked earlier)';
  if (r.hiringState === 'none') return day(r.hiring_checked_at) ? `No open roles listed (${day(r.hiring_checked_at)})` : 'No open roles listed';
  return 'Roles unverified';
}

// One cell, as RFC 4180 has it: quoted when it holds a comma, a quote or a line break, a quote doubled. A cell that begins with =, +, - or @
// (or a tab or return) is read by a spreadsheet as a formula, and a company's name or a tech name is a stranger's text, so it is written with
// an apostrophe before it: it is shown as it was typed and never run.
export function csvCell(value) {
  if (value == null || value === '') return '';
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function exportCsv(snap, matched, { sort = 'name' } = {}) {
  const rows = pageOf(snap, matched, { sort, offset: 0, limit: matched.length });
  const lines = [CSV_COLUMNS.map(([name]) => name).join(',')];
  for (const i of rows) {
    const record = snap.records[i];
    lines.push(CSV_COLUMNS.map(([, read]) => csvCell(read(record))).join(','));
  }
  return `﻿${lines.join('\r\n')}\r\n`; // the byte-order mark makes a spreadsheet read the file as UTF-8
}
