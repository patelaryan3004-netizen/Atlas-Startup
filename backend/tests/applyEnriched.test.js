import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { analysisFor, applyEnriched } from '../scripts/enrich/apply_enriched.js';
import { createCatalog, recordFor } from '../src/catalog/catalog.js';
import { co, dataset, source, evidenceRow } from './helpers/locations.js';
import { makeDataDir, readDataDir, removeMadeDirs } from './helpers/store.js';

// Putting the readings of scripts/enrich/enrich_companies.py on the dataset, and the owner's decisions about them (2026-10-13).
const RUN = '2026-10-13T04:00:00Z';
const LATER = '2026-10-13T04:20:00Z'; // a follow-up (Pass 1b) reads a little after the run
const field = (value, source_url, confidence, last_verified_at) => ({ value, source_url, confidence, last_verified_at });
const NOTHING = field(null, null, null, null);
const job = (title, extra = {}) => ({ title, location: 'Sydney, NSW', employment_type: 'Full-time', remote: null, posted_at: null, apply_url: `https://boards.greenhouse.io/acme/jobs/${title.length}`, ...extra });
const read = (id, name, result, over = {}) => ({
  id, name, website: `https://www.${id}.example`,
  fields: { hiring: NOTHING, open_jobs: NOTHING, city: NOTHING, suburb: NOTHING, state: NOTHING },
  pass1: { result, refusal: null, careers_url: `https://www.${id}.example/careers`, boards: [], refused: [], role_count: null, ...over },
});

const cleanup = [];
afterEach(async () => { await removeMadeDirs(); await Promise.all(cleanup.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });

describe('what a reading becomes', () => {
  it('turns roles on a job board into a high-confidence claim, the board as its source, and the roles as jobs', () => {
    const r = read('acme', 'Acme', 'roles_found_board', {
      boards: [{ provider: 'greenhouse', token: 'acme', page_url: 'https://boards.greenhouse.io/acme', feed_ok: true, role_count: 2 }], role_count: 2,
    });
    r.fields.hiring = field(true, 'https://boards.greenhouse.io/acme', 0.95, RUN);
    r.fields.open_jobs = field([job('Engineer'), job('Designer')], 'https://boards.greenhouse.io/acme', 0.95, RUN);
    const a = analysisFor(r, RUN);
    expect(a.evidence).toHaveLength(1);
    expect(a.evidence[0]).toMatchObject({ field: 'hiring_status', value: 'hiring', confidence: 'high', verified_at: RUN });
    expect(a.evidence[0].source).toMatchObject({ kind: 'company_website', url: 'https://boards.greenhouse.io/acme', title: 'Greenhouse job board', slug: 'greenhouse-jobs' });
    expect(a.evidence[0].note).toContain('2 open roles on the company\'s Greenhouse job board');
    expect(a.jobs.map((j) => j.title)).toEqual(['Engineer', 'Designer']);
    expect(a.pages).toEqual([{ url: 'https://boards.greenhouse.io/acme', status: 200 }]);
  });

  it('turns a board that listed nothing into a medium-confidence "not hiring" claim, and no jobs', () => {
    const r = read('quiet', 'Quiet', 'board_empty', { boards: [{ provider: 'bamboohr', token: 'quiet', page_url: 'https://quiet.bamboohr.com/careers', feed_ok: true, role_count: 0 }], role_count: 0 });
    r.fields.hiring = field(false, 'https://quiet.bamboohr.com/careers', 0.6, LATER);
    const a = analysisFor(r, RUN);
    expect(a.evidence).toEqual([expect.objectContaining({ field: 'hiring_status', value: 'not_hiring', confidence: 'medium', verified_at: LATER })]);
    expect(a.jobs).toEqual([]);
  });

  it('does not take an older, more confident list of jobs for this reading\'s', () => {
    const r = read('fast', 'Fast', 'roles_found_structured', { role_count: 1 });
    r.fields.hiring = field(true, 'https://www.fast.example/careers', 0.9, LATER);
    r.fields.open_jobs = field([job('Old role')], 'https://old.example', 0.9, '2026-10-05T03:59:04.292Z'); // kept from before: not read this run
    const a = analysisFor(r, RUN);
    expect(a.jobs).toEqual([]);
    expect(a.evidence[0].source.url).toBe('https://www.fast.example/careers');
  });
});

describe('applying the readings and the owner\'s decisions', () => {
  it('adds the evidence and the roles, so a company is hiring now; holds the hand-read ones out; accepts hiring:false for the empty boards; marks no live site as unavailable', async () => {
    const NOW = Date.parse('2026-10-13T06:00:00Z');
    const board = source('hand', 'company_website', 'https://hand.example/careers');
    const dir = await makeDataDir(dataset(
      [co('Acme', { hiring: false }), co('Handread', { hiring: true }), co('Shippit', { hiring: true }), co('Spriggy', { hiring: true }), co('Zoomo', { website: 'https://zoomo.example' })],
      { sources: [board], evidence: [evidenceRow('handread', 'hiring_status', 'hiring', 'hand', { id: 'handread.hiring_status.hand', verified_at: '2026-10-05T03:59:04.292Z', confidence: 'high' })] },
    ));
    const acme = read('acme', 'Acme', 'roles_found_board', { boards: [{ provider: 'greenhouse', token: 'acme', page_url: 'https://boards.greenhouse.io/acme', feed_ok: true, role_count: 1 }], role_count: 1 });
    acme.fields.hiring = field(true, 'https://boards.greenhouse.io/acme', 0.95, RUN);
    acme.fields.open_jobs = field([job('Engineer')], 'https://boards.greenhouse.io/acme', 0.95, RUN);
    const empty = (id, name) => {
      const r = read(id, name, 'board_empty', { boards: [{ provider: 'bamboohr', token: id, page_url: `https://${id}.bamboohr.com/careers`, feed_ok: true, role_count: 0 }], role_count: 0 });
      r.fields.hiring = field(false, `https://${id}.bamboohr.com/careers`, 0.6, LATER);
      return r;
    };
    // a "dead" website whose domain resolves (example.com does): it must NOT be marked, because the script checks again itself
    const live = read('zoomo', 'Zoomo', 'site_unreachable', { refusal: 'dns_failed', careers_url: null });
    live.website = 'https://example.com';
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'enriched-'));
    cleanup.push(tmp);
    const file = path.join(tmp, 'companies_enriched.json');
    await writeFile(file, JSON.stringify({ generated_at: RUN, companies: [acme, empty('shippit', 'Shippit'), empty('spriggy', 'Spriggy'), live], conflicts: [] }));

    // no network: example.com resolves, and nothing else does
    const resolveHost = async (host) => { if (host !== 'example.com') throw new Error('ENOTFOUND'); };
    const report = await applyEnriched({ dir, file, now: () => NOW, resolveHost, retryMs: 0 });
    const ds = await readDataDir(dir);
    const company = (id) => ds.companies.find((c) => c.id === id);

    // the reading: evidence, a source for the board, the role as an open job, and the record says hiring
    expect(report.applied.map((a) => a.id).sort()).toEqual(['acme', 'shippit', 'spriggy']);
    expect(ds.evidence.find((e) => e.company_id === 'acme' && e.field === 'hiring_status')).toMatchObject({ value: 'hiring', confidence: 'high', verified_at: RUN });
    expect(ds.jobs.filter((j) => j.company_id === 'acme' && j.status === 'open').map((j) => j.title)).toEqual(['Engineer']);
    expect(company('acme')).toMatchObject({ hiring: true, hiring_status: 'hiring', hiring_verified_at: RUN });

    // the decision about the empty boards: hiring:false, with the old and the new value in the audit trail
    expect(report.not_hiring_accepted.map((x) => x.id).sort()).toEqual(['shippit', 'spriggy']);
    expect(company('shippit')).toMatchObject({ hiring: false, hiring_status: 'not_hiring' });
    const audit = ds.audit_trail.find((a) => a.action === 'company.hiring_decision' && a.target.id === 'shippit');
    expect(audit.changes).toEqual(expect.arrayContaining([{ field: 'hiring', from: true, to: false }, { field: 'hiring_status', from: 'hiring', to: 'not_hiring' }]));
    expect(audit.reason).toContain('Owner decision 2026-10-13');

    // the hand-read ones are held: still evidence, now medium, so a check and not a confirmation
    // (here the company is not one of the two held by name, so it keeps its confidence)
    expect(report.held).toEqual([]);
    expect(ds.evidence.find((e) => e.id === 'handread.hiring_status.hand').confidence).toBe('high');

    // a domain that still resolves is never marked unavailable, whatever the run saw
    expect(report.websites_unavailable).toEqual([]);
    expect(report.resolves_now).toEqual(['zoomo']);
    expect(company('zoomo').website_status).toBeNull();

    // and through the catalog: confirmed lately is hiring now; the empty boards say so; nothing is called not hiring that was not read
    const snap = await createCatalog({ file: path.join(dir, 'startups.json'), now: () => NOW, hiringWindowDays: 14 }).refresh();
    expect(recordFor(snap, 'acme')).toMatchObject({ hiring: true, hiringState: 'hiring', open_roles: 1 });
    expect(recordFor(snap, 'shippit')).toMatchObject({ hiring: false, hiringState: 'none' });
    expect(recordFor(snap, 'zoomo')).toMatchObject({ hiring: false, hiringState: 'unverified' });
  });

  it('holds Superstat and Forward out of hiring now until they are re-checked by hand, and says when they were read', async () => {
    const NOW = Date.parse('2026-10-13T06:00:00Z');
    const page = source('careers', 'company_website', 'https://superstatsport.com/careers');
    const dir = await makeDataDir(dataset(
      [co('Superstat', { hiring: true })],
      { sources: [page], evidence: [evidenceRow('superstat', 'hiring_status', 'hiring', 'careers', { id: 'superstat.hiring_status.superstat-careers', verified_at: '2026-10-05T03:59:04.292Z', confidence: 'high', note: 'Open roles on retrieval: Founding Engineer.' })] },
    ));
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'enriched-'));
    cleanup.push(tmp);
    const file = path.join(tmp, 'companies_enriched.json');
    await writeFile(file, JSON.stringify({ generated_at: RUN, companies: [], conflicts: [] }));
    const before = await createCatalog({ file: path.join(dir, 'startups.json'), now: () => NOW, hiringWindowDays: 14 }).refresh();
    expect(recordFor(before, 'superstat').hiring).toBe(true); // confirmed 8 days ago, inside the window: counted, until the decision

    const report = await applyEnriched({ dir, file, now: () => NOW, resolveHost: async () => {}, retryMs: 0 });
    expect(report.held).toEqual([{ id: 'superstat', evidence: 'superstat.hiring_status.superstat-careers' }]);
    const ds = await readDataDir(dir);
    const row = ds.evidence.find((e) => e.id === 'superstat.hiring_status.superstat-careers');
    expect(row).toMatchObject({ confidence: 'medium', status: 'active', verified_at: '2026-10-05T03:59:04.292Z' });
    expect(row.note).toContain('a check, not a confirmation');
    expect(ds.audit_trail.find((a) => a.action === 'evidence.hold').changes).toEqual([{ field: 'evidence superstat.hiring_status.superstat-careers confidence', from: 'high', to: 'medium' }]);

    const after = await createCatalog({ file: path.join(dir, 'startups.json'), now: () => NOW, hiringWindowDays: 14 }).refresh();
    expect(recordFor(after, 'superstat')).toMatchObject({ hiring: false, hiringState: 'checked', hiring_checked_at: '2026-10-05T03:59:04.292Z' });
  });
});
