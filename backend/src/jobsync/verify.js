// The final check of the hiring desk's data, as a command (`npm run jobsync -- verify`): duplicates, expired vacancies, Australian eligibility, application links and timestamps. It reads
// the stored data and, with `--links`, asks each open role's own application address (through the compliant fetcher: robots.txt, pacing, no login) whether it still answers. It changes
// nothing. A finding is a violation (the data breaks a rule the sync keeps) or a note (worth knowing, not wrong).
import { buildBoard } from '../network/board.js';
import { employerMap } from './employers.js';
import { workPlaces } from './locations.js';
import { allowedHosts, PROVIDERS } from './adapters.js';
import { duplicateKey } from './dedupe.js';
import { canonicalUrl } from './canonical.js';
import { FetchPolicyError } from '../discovery/http.js';

const hostOf = (url) => { try { return new URL(url).hostname.toLowerCase(); } catch (e) { return ''; } };
const ms = (iso) => (iso ? Date.parse(iso) : NaN);
const SLACK = 90000; // a read stamps the board and its roles a moment apart

// Everything that can be checked without the network. `now` in ms.
export function verifyData(ds, { now = Date.now() } = {}) {
  const violations = [];
  const notes = [];
  const bad = (kind, id, msg) => violations.push({ kind, id, msg });
  const employers = employerMap(ds);
  const cards = new Map([...employers].map(([id, e]) => [id, { name: e.name, slug: e.slug, city: e.city, sector: e.sector, stage: e.stage, website: e.website, kind: e.kind, logo: e.logo, investors: e.investors }]));
  const state = new Map((ds.job_sync_state ?? []).map((r) => [r.source_id, r]));
  const sources = new Map((ds.job_sources ?? []).map((s) => [s.id, s]));
  const board = buildBoard({ jobs: ds.jobs, cardOf: (id) => cards.get(id) ?? null, sync: { sources: ds.job_sources ?? [], state: ds.job_sync_state ?? [] }, names: new Map([...employers].map(([id, e]) => [id, { name: e.name, slug: e.slug }])), now });
  const onBoard = new Set(board.roles.map((r) => r.id));
  const open = ds.jobs.filter((j) => j.status === 'open');
  const shown = ds.jobs.filter((j) => onBoard.has(j.id));

  // ---- duplicates
  const ids = new Map();
  for (const j of ds.jobs) ids.set(j.id, (ids.get(j.id) ?? 0) + 1);
  for (const [id, n] of ids) if (n > 1) bad('duplicate', id, `the id is used by ${n} stored roles`);
  const byUrl = new Map();
  for (const j of shown) { const u = j.canonical_url ?? canonicalUrl(j.apply_url); byUrl.set(u, [...(byUrl.get(u) ?? []), j.id]); }
  for (const [u, list] of byUrl) if (list.length > 1) bad('duplicate', list[0], `${list.length} roles on the desk share one application address (${u})`);
  const byKey = new Map();
  for (const j of shown) { const k = duplicateKey(j); byKey.set(k, [...(byKey.get(k) ?? []), j]); }
  let sameBoardRepeats = 0;
  for (const list of byKey.values()) {
    if (list.length < 2) continue;
    const sourcesIn = new Set(list.map((j) => j.source_id));
    if (sourcesIn.size > 1) bad('duplicate', list[0].id, `the same role (${list[0].title}) is shown from ${sourcesIn.size} different boards`);
    else sameBoardRepeats += 1;
  }
  if (sameBoardRepeats) notes.push(`${sameBoardRepeats} title(s) are listed more than once by the same employer board at the same place: the employer's own repeats, not merged`);
  const hiddenDuplicates = ds.jobs.filter((j) => j.duplicate_of && j.status === 'hidden').length;

  // ---- expired: a role is open only while its board's last whole read listed it
  let preserved = 0;
  for (const j of open) {
    if (!j.source_id || !j.provider) continue; // a role the slower reader held: dated by its own clock
    const s = state.get(j.source_id);
    const src = sources.get(j.source_id);
    if (!src) { bad('expired', j.id, `its board "${j.source_id}" is not in the catalogue`); continue; }
    if (src.status === 'paused') continue;
    if (!s?.last_success_at) { bad('expired', j.id, 'open, but its board has never been read whole'); continue; }
    if (ms(j.last_confirmed_at) + SLACK < ms(s.last_success_at)) bad('expired', j.id, `open, but its board's last whole read (${s.last_success_at}) did not list it (last confirmed ${j.last_confirmed_at}): it should be hidden`);
    if ((s.consecutive_failures ?? 0) > 0) preserved += 1;
  }
  if (preserved) notes.push(`${preserved} open role(s) are kept while their board is failing to answer (a failed read never closes a role)`);
  const stale = ds.jobs.filter((j) => j.status === 'open' && ms(j.last_confirmed_at ?? j.retrieved_at) < now - 14 * 86400000);
  if (stale.length) notes.push(`${stale.length} open role(s) were last confirmed more than 14 days ago: they are off the default board (stale)`);

  // ---- Australian eligibility
  for (const r of board.roles) {
    if (r.region !== 'au') bad('eligibility', r.id, 'on the desk but not in Australia');
    const j = ds.jobs.find((x) => x.id === r.id);
    const w = workPlaces(Array.isArray(j.locations) && j.locations.length ? j.locations : [j.location].filter(Boolean), { workplaceType: j.workplace_type });
    if (!w.au && !w.remoteAu) bad('eligibility', r.id, `no Australian place and not remote from Australia (${j.location ?? 'no place'})`);
    if (w.remoteAu && !w.evidence) bad('eligibility', r.id, 'remote from Australia without the employer\'s words to show');
  }
  const heldElsewhere = open.filter((j) => !onBoard.has(j.id) && j.provider).length;
  if (heldElsewhere) notes.push(`${heldElsewhere} open stored role(s) are not on the desk: not in Australia, or not confirmed for two weeks`);

  // ---- application links (static rules)
  for (const j of shown) {
    const u = j.apply_url ?? '';
    if (!/^https:\/\/\S+$/.test(u)) { bad('link', j.id, `the application address is not https (${u || 'none'})`); continue; }
    if (j.provider && PROVIDERS[j.provider]) {
      const site = employers.get(j.company_id)?.website ?? '';
      const host = hostOf(u);
      if (!allowedHosts(j.provider, site).some((h) => host === h || host.endsWith(`.${h}`))) bad('link', j.id, `the application address (${host}) is neither ${j.provider}'s nor the company's own`);
    }
  }

  // ---- timestamps
  for (const j of shown) {
    const t = { first: ms(j.first_seen_at), conf: ms(j.last_confirmed_at), posted: ms(j.posted_at), ret: ms(j.retrieved_at) };
    if (j.provider) {
      if (!(t.first <= t.conf + SLACK)) bad('timestamp', j.id, `first seen (${j.first_seen_at}) is after last confirmed (${j.last_confirmed_at})`);
      if (!Number.isFinite(t.conf)) bad('timestamp', j.id, 'no last-confirmed time');
      if (Number.isFinite(t.ret) && Math.abs(t.ret - t.conf) > SLACK) bad('timestamp', j.id, 'retrieved_at and last_confirmed_at disagree');
      const s = state.get(j.source_id);
      if (s?.last_success_at && t.conf > ms(s.last_success_at) + SLACK) bad('timestamp', j.id, 'confirmed after its board was last read');
    }
    if (Number.isFinite(t.conf) && t.conf > now + SLACK) bad('timestamp', j.id, 'last confirmed in the future');
    if (Number.isFinite(t.posted) && t.posted > now + 86400000) bad('timestamp', j.id, 'posted in the future');
    if (Number.isFinite(t.posted) && Number.isFinite(t.conf) && t.posted > t.conf + 86400000) bad('timestamp', j.id, 'posted after it was last confirmed');
  }
  for (const s of ds.job_sync_state ?? []) {
    if (ms(s.last_success_at) > now + SLACK) bad('timestamp', s.source_id, 'a board was "last read" in the future');
    if (ms(s.last_success_at) > ms(s.last_attempt_at) + SLACK) bad('timestamp', s.source_id, 'last success is after the last attempt');
  }
  const health = ds.job_health ?? [];
  for (let i = 1; i < health.length; i += 1) if (ms(health[i].at) < ms(health[i - 1].at)) bad('timestamp', health[i].id, 'health rows are out of order');
  const withoutPosted = shown.filter((j) => !j.posted_at).length;
  if (withoutPosted) notes.push(`${withoutPosted} role(s) on the desk have no posted date because the employer's feed states none: none is invented`);

  return {
    counts: { stored: ds.jobs.length, open: open.length, on_the_desk: board.roles.length, companies: board.totals.companies, hidden_duplicates: hiddenDuplicates, boards_approved: (ds.job_sources ?? []).filter((s) => s.status === 'approved').length },
    violations, notes, board,
  };
}

// Asks each open role's application address whether it still answers. A role whose page says it is gone (404, 410) is a violation; a page that refuses robots or login is "not checked" (we
// do not push past it); a network error is "unreachable" (not proof of anything).
export async function verifyLinks(roles, { fetcher, concurrency = 6, onProgress = () => {} }) {
  const out = { ok: 0, gone: [], not_checked: [], unreachable: [] };
  let next = 0;
  const worker = async () => {
    while (next < roles.length) {
      const j = roles[next]; next += 1;
      try {
        await fetcher.get(j.apply_url);
        out.ok += 1;
      } catch (err) {
        if (!(err instanceof FetchPolicyError)) { out.unreachable.push({ id: j.id, url: j.apply_url, why: String(err.message).slice(0, 80) }); continue; }
        if (err.code === 'too_large' || err.code === 'unsupported_content') out.ok += 1; // it answered; what it answered is not a page we read
        else if (err.code === 'http_error' && /HTTP (404|410)/.test(err.message)) out.gone.push({ id: j.id, url: j.apply_url, why: err.message });
        else if (['robots_disallow', 'robots_unavailable', 'access_controlled', 'rate_limited', 'blocked_host'].includes(err.code)) out.not_checked.push({ id: j.id, url: j.apply_url, why: err.code });
        else out.unreachable.push({ id: j.id, url: j.apply_url, why: err.code });
      }
      onProgress(next, roles.length);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return out;
}
