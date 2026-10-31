import { shortDate } from '../../freshness.js';

const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };

// The public pages behind a company's facts, as short lines: who published the page, and the day it was read. The company's own site comes first, then the
// pages that list it (an investor's or an accelerator's portfolio), as the record gives them (provenance.js serves only pages anyone can open). Nothing is
// made up: a record with no sources gives none.
export function sourceLines(record, limit = 3) {
  const rows = (record?.sources ?? []).filter((s) => s?.url);
  const rank = (s) => (s.kind === 'company_website' ? 0 : s.kind === 'accelerator_profile' || s.kind === 'investor_website' ? 1 : 2);
  return [...rows].sort((a, b) => rank(a) - rank(b)).slice(0, limit).map((s) => ({
    url: s.url, label: s.kind === 'company_website' ? `its own site (${hostOf(s.url)})` : s.publisher || hostOf(s.url), read: shortDate(s.checked_at),
  }));
}

// "Source: its own site (example.com), read 21 Oct 2026; Blackbird, read 31 Oct 2026". With `compact` it is one line for the card beside a mark.
export default function SourceNote({ record, limit = 3, className = 'xp-sources' }) {
  const lines = sourceLines(record, limit);
  if (!lines.length) return null;
  return (
    <p className={className}>
      <span className="xp-sources-lead">{lines.length === 1 ? 'Source' : 'Sources'}: </span>
      {lines.map((l, i) => (
        <span key={l.url}>
          {i > 0 && '; '}
          <a href={l.url} target="_blank" rel="noopener noreferrer">{l.label}</a>{l.read ? `, read ${l.read}` : ''}
        </span>
      ))}
    </p>
  );
}
