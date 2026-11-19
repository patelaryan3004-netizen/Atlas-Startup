// The final check of the hiring desk's data: what it finds, and that it finds nothing in good data.
import { describe, it, expect } from 'vitest';
import { createFetcher } from '../src/discovery/http.js';
import { verifyData, verifyLinks } from '../src/jobsync/verify.js';
import { scriptedWeb } from './helpers/scheduler.js';

const NOW = Date.parse('2026-11-20T01:00:00Z');
const iso = (h) => new Date(NOW - h * 3600000).toISOString();
const company = (id, name, website = `https://${id}.com.au`) => ({ id, name, slug: id, website, city: 'Sydney', sector: 'SaaS', stage: 'Seed', investors: [] });
const role = (id, over = {}) => ({
  id, company_id: 'acme', title: `Role ${id}`, location: 'Sydney, NSW, Australia', locations: ['Sydney, NSW, Australia'], employment_type: 'Full-time', remote: null, posted_at: iso(500), apply_url: `https://jobs.lever.co/acme/${id}`,
  status: 'open', source_id: 'acme-lever-jobs', retrieved_at: iso(1), provider: 'lever', external_id: id, canonical_url: `https://jobs.lever.co/acme/${id}`, first_seen_at: iso(100), last_confirmed_at: iso(1), absent_reads: 0,
  workplace_type: null, team: null, ...over,
});
const dataset = (jobs, over = {}) => ({
  companies: [company('acme', 'Acme')], investors: [], jobs,
  job_sources: [{ id: 'acme-lever-jobs', company_id: 'acme', provider: 'lever', token: 'acme', board_url: 'https://jobs.lever.co/acme', status: 'approved', basis: 'x' }],
  job_sync_state: [{ source_id: 'acme-lever-jobs', last_attempt_at: iso(1), last_success_at: iso(1), consecutive_failures: 0, last_error: null }], job_health: [], ...over,
});
const kinds = (r) => r.violations.map((v) => v.kind);

describe('verifying the hiring desk\'s data', () => {
  it('finds nothing wrong in good data', () => {
    const r = verifyData(dataset([role('a'), role('b')]), { now: NOW });
    expect(r.violations).toEqual([]);
    expect(r.counts).toMatchObject({ open: 2, on_the_desk: 2 });
  });

  it('catches the same role shown from two boards, and two roles at one application address', () => {
    const jobs = [role('a'), role('b', { source_id: 'acme-greenhouse-jobs', provider: 'greenhouse', title: 'Role a', canonical_url: 'https://job-boards.greenhouse.io/acme/jobs/9', apply_url: 'https://job-boards.greenhouse.io/acme/jobs/9' }), role('c', { canonical_url: 'https://jobs.lever.co/acme/a' })];
    const data = dataset(jobs, { job_sources: [...dataset([]).job_sources, { id: 'acme-greenhouse-jobs', company_id: 'acme', provider: 'greenhouse', token: 'acme', board_url: 'https://boards.greenhouse.io/acme', status: 'approved', basis: 'x' }], job_sync_state: [...dataset([]).job_sync_state, { source_id: 'acme-greenhouse-jobs', last_attempt_at: iso(1), last_success_at: iso(1), consecutive_failures: 0 }] });
    const r = verifyData(data, { now: NOW });
    const msgs = r.violations.filter((v) => v.kind === 'duplicate').map((v) => v.msg).join(' | ');
    expect(msgs).toMatch(/share one application address/);
    expect(msgs).toMatch(/shown from 2 different boards/);
    expect(verifyData(dataset([role('a'), role('b', { title: 'Role a' })]), { now: NOW }).violations).toEqual([]); // the same board's own repeat is the employer's word
  });

  it('catches a role that is open although its board\'s last whole read did not list it, and one whose board was never read', () => {
    const r = verifyData(dataset([role('a', { last_confirmed_at: iso(30), retrieved_at: iso(30) })]), { now: NOW });
    expect(kinds(r)).toContain('expired');
    const never = verifyData(dataset([role('a')], { job_sync_state: [] }), { now: NOW });
    expect(never.violations[0]).toMatchObject({ kind: 'expired', msg: expect.stringMatching(/never been read whole/) });
  });

  it('keeps a role while its board is failing, and says so rather than calling it expired', () => {
    const failing = dataset([role('a', { last_confirmed_at: iso(30), retrieved_at: iso(30), first_seen_at: iso(100) })], { job_sync_state: [{ source_id: 'acme-lever-jobs', last_attempt_at: iso(1), last_success_at: iso(30), consecutive_failures: 2, last_error: { code: 'server' } }] });
    const r = verifyData(failing, { now: NOW });
    expect(r.violations).toEqual([]);
    expect(r.notes.join(' ')).toMatch(/kept while their board is failing/);
  });

  it('does not put a role outside Australia on the desk, and says what is held that is not on it', () => {
    const r = verifyData(dataset([role('a'), role('b', { locations: ['Austin, TX, USA'], location: 'Austin, TX, USA' }), role('c', { locations: ['Remote'], location: 'Remote' })]), { now: NOW });
    expect(r.violations).toEqual([]);
    expect(r.counts).toMatchObject({ open: 3, on_the_desk: 1 });
    expect(r.notes.join(' ')).toMatch(/2 open stored role\(s\) are not on the desk/);
  });

  it('catches an application address that is not the provider\'s or the company\'s own; one that is not https never reaches the desk at all', () => {
    const r = verifyData(dataset([role('a', { apply_url: 'http://jobs.lever.co/acme/a' }), role('b', { apply_url: 'https://evil.example/jobs/b' })]), { now: NOW });
    expect(r.violations.filter((v) => v.kind === 'link')).toHaveLength(1);
    expect(r.counts.on_the_desk).toBe(1);
  });

  it('catches times that cannot be: confirmed in the future, first seen after it was confirmed, posted in the future, confirmed after its board was read', () => {
    const r = verifyData(dataset([
      role('a', { last_confirmed_at: new Date(NOW + 3 * 3600000).toISOString(), retrieved_at: new Date(NOW + 3 * 3600000).toISOString() }),
      role('b', { first_seen_at: iso(0), last_confirmed_at: iso(5), retrieved_at: iso(5) }),
      role('c', { posted_at: new Date(NOW + 5 * 86400000).toISOString() }),
    ]), { now: NOW });
    const msgs = r.violations.filter((v) => v.kind === 'timestamp').map((v) => v.msg).join(' | ');
    expect(msgs).toMatch(/in the future/);
    expect(msgs).toMatch(/first seen .* is after last confirmed/);
    expect(msgs).toMatch(/posted in the future/);
    expect(msgs).toMatch(/confirmed after its board was last read/);
  });

  it('says that a role without a posted date has none because the employer states none', () => {
    expect(verifyData(dataset([role('a', { posted_at: null })]), { now: NOW }).notes.join(' ')).toMatch(/none is invented/);
  });
});

describe('verifying the application links', () => {
  const make = (routes) => { const w = scriptedWeb(routes); return { w, fetcher: createFetcher({ fetchImpl: w.fetchImpl, resolveHost: async () => ['93.184.216.34'], sleep: async () => {}, now: () => NOW }) }; };
  const page = { status: 200, body: '<html>role</html>', headers: { 'content-type': 'text/html' } };

  it('counts a link that answers, a role whose page is gone, and a page it was told not to read: and never reads past a refusal', async () => {
    const { w, fetcher } = make({
      'https://jobs.lever.co/acme/a': page,
      'https://jobs.lever.co/acme/b': { status: 404, body: 'gone', headers: { 'content-type': 'text/html' } },
      'https://private.example/jobs/c': page, 'https://private.example/robots.txt': { status: 200, body: 'User-agent: *\nDisallow: /', headers: { 'content-type': 'text/plain' } },
    });
    const r = await verifyLinks([{ id: 'a', apply_url: 'https://jobs.lever.co/acme/a' }, { id: 'b', apply_url: 'https://jobs.lever.co/acme/b' }, { id: 'c', apply_url: 'https://private.example/jobs/c' }], { fetcher, concurrency: 1 });
    expect(r.ok).toBe(1);
    expect(r.gone).toEqual([expect.objectContaining({ id: 'b' })]);
    expect(r.not_checked).toEqual([expect.objectContaining({ id: 'c', why: 'robots_disallow' })]);
    expect(w.calls).not.toContain('https://private.example/jobs/c');
  });
});
