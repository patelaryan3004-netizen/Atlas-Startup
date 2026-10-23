import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrateDataset, validateDataset, serializeDataset, writeFiles, loadRaw, parseRaw } from '../src/models/dataset.js';
import { createApp } from '../src/app.js';
import { createCatalog } from '../src/catalog/catalog.js';
import { createInvestorCatalog } from '../src/catalog/investors.js';
import { readTable, parseCsv, cleanRow, planImport, applyPlan, undoRun, reportText } from '../src/investors/peopleImport.js';
import { tempDir, removeTempDirs } from './helpers/catalog.js';
import { co, world, backed, source, person, role } from './helpers/investors.js';

afterEach(removeTempDirs);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.join(HERE, '..');
const AT = '2026-10-23T02:00:00.000Z';
const SOURCE = { url: 'https://directory.example/network?tab=investors', retrievedAt: '2026-10-22', retrievedBy: 'the owner', name: 'Example Directory' };

// A dataset with one published firm (Harbour Capital, harbour.example) and one person already on record at it. Every name is invented.
function existing() {
  const orgs = [backed('harbour', { verification_status: 'published', name: 'Harbour Capital' })];
  return world({
    companies: [co('Acme')],
    orgs,
    extra: {
      sources: [source('team')],
      investor_people: [person('ada-example', { name: 'Ada Example', current_organisation_id: 'harbour', current_title: 'Partner', linkedin_url: 'https://www.linkedin.com/in/ada-example', verification_status: 'candidate', created_at: AT, updated_at: AT })],
      investor_people_organisations: [role('ada-example', 'harbour', 'team', { verification_status: 'unverified', verified_at: null })],
    },
  });
}

const row = (over = {}) => ({ name: 'Zed Newcomer', role: 'Partner', firm: 'Brand New Capital', location: 'Sydney', profile_url: 'https://www.linkedin.com/in/zed-newcomer', firm_website: 'https://brandnew.example', ...over });
const table = (rows) => ({ rows, ignored: [] });
const plan = (rows, ds = existing()) => planImport(ds, table(rows), SOURCE);

describe('reading the file', () => {
  it('reads CSV with quoted commas, doubled quotes, a byte-order mark and Windows line ends', () => {
    expect(parseCsv('﻿name,role\r\n"Smith, Jo","Said ""hi"""\r\nAnn,Partner\r\n')).toEqual([['name', 'role'], ['Smith, Jo', 'Said "hi"'], ['Ann', 'Partner']]);
  });

  it('understands other names for the columns, and lists the ones it does not use', () => {
    const { rows, ignored } = readTable('Full Name,Title,Company,Area,LinkedIn,Website,Notes\nJo Citizen,Partner,Acme Capital,Sydney,https://www.linkedin.com/in/jo,https://acme.example,hello\n');
    expect(rows).toEqual([{ name: 'Jo Citizen', role: 'Partner', firm: 'Acme Capital', location: 'Sydney', profile_url: 'https://www.linkedin.com/in/jo', firm_website: 'https://acme.example' }]);
    expect(ignored).toEqual(['notes']);
  });

  it('reads JSON as a list, or as an object holding one', () => {
    const one = { name: 'Jo', role: 'Partner', firm: 'Acme' };
    expect(readTable(JSON.stringify([one])).rows[0]).toMatchObject(one);
    expect(readTable(JSON.stringify({ investors: [one] })).rows[0]).toMatchObject(one);
    expect(() => readTable('{"nope": 1}')).toThrow(/list of rows/);
  });
});

describe('reading a row', () => {
  it('takes a row that has a name, a role and a firm, and writes the place out for the few short forms that cannot mean two things', () => {
    const r = cleanRow(row({ location: 'SF' }));
    expect(r.ok).toBe(true);
    expect(r.row).toMatchObject({ name: 'Zed Newcomer', role: 'Partner', firm: 'Brand New Capital', location: 'San Francisco', listed_location: 'SF', linkedin_url: 'https://www.linkedin.com/in/zed-newcomer', firm_site: { url: 'https://brandnew.example/', domain: 'brandnew.example' } });
  });

  it('does not take a row with no role: a firm alone does not make someone an investor', () => {
    expect(cleanRow(row({ role: null }))).toEqual({ ok: false, reason: expect.stringMatching(/no role stated/) });
  });

  it('does not take a row with no name or no firm', () => {
    expect(cleanRow(row({ name: '' })).ok).toBe(false);
    expect(cleanRow(row({ firm: null })).ok).toBe(false);
    expect(cleanRow(row({ name: 'someone@example.com' })).ok).toBe(false);
  });

  it('keeps a person\'s own site, and leaves out an address that is not a person\'s professional profile, saying so', () => {
    expect(cleanRow(row({ profile_url: 'https://zed.example/about' })).row).toMatchObject({ linkedin_url: null, personal_website: 'https://zed.example/about' });
    const company = cleanRow(row({ profile_url: 'https://www.linkedin.com/company/brandnew' }));
    expect(company.ok).toBe(true);
    expect(company.row.linkedin_url).toBeNull();
    expect(company.notes.join(' ')).toMatch(/not a person's profile/);
    expect(cleanRow(row({ profile_url: 'https://twitter.com/zed' })).notes.join(' ')).toMatch(/social or directory page/);
    expect(cleanRow(row({ profile_url: 'mailto:zed@example.com' })).notes.join(' ')).toMatch(/not a web address/);
  });

  it('does not use a social or press page as a firm\'s website', () => {
    const r = cleanRow(row({ firm_website: 'https://www.linkedin.com/company/brandnew' }));
    expect(r.row.firm_site).toBeNull();
    expect(r.notes.join(' ')).toMatch(/cannot identify a firm/);
  });
});

describe('a dry run', () => {
  it('says what each row would do and changes nothing', () => {
    const ds = existing();
    const before = structuredClone(ds);
    const p = plan([row(), row({ name: 'Yan Other', profile_url: 'https://www.linkedin.com/in/yan-other', firm: 'Harbour Capital', firm_website: 'https://www.harbour.example/' })], ds);
    expect(p.report).toMatchObject({ collected: 2, new_people: 2, new_firms: 1, existing_firms_matched: 1, conflicts: 0, skipped: 0 });
    expect(ds).toEqual(before);
  });

  it('matches a firm by the domain of its website, however the address is written, and makes one firm for two people at it', () => {
    const p = plan([
      row({ firm: 'Harbour', firm_website: 'http://HARBOUR.example/about' }),
      row({ name: 'A One', profile_url: null, firm: 'Fresh Fund', firm_website: 'https://fresh.example' }),
      row({ name: 'B Two', profile_url: null, firm: 'Fresh Fund Pty', firm_website: 'https://www.fresh.example/team' }),
    ]);
    expect(p.rows[0].firm).toMatchObject({ kind: 'existing', by: 'domain' });
    expect(p.rows[1].firm.id).toBe(p.rows[2].firm.id);
    expect(p.report.new_firms).toBe(1);
  });

  it('matches a firm by name only when the listing gives no website, and says so', () => {
    const p = plan([row({ firm: 'harbour capital', firm_website: null })]);
    expect(p.rows[0].firm).toMatchObject({ kind: 'existing', by: 'name' });
    expect(p.rows[0].notes.join(' ')).toMatch(/matched by name only/);
  });

  it('keeps a firm that is on record under another website for a person to decide', () => {
    const p = plan([row({ firm: 'Harbour Capital', firm_website: 'https://harbour-capital.other.example' })]);
    expect(p.rows[0].status).toBe('conflict');
    expect(p.rows[0].reason).toMatch(/different website/);
  });

  it('matches a person by their profile address, however it is written, and proposes only to fill what is empty', () => {
    const p = plan([row({ name: 'Ada Example', firm: 'Harbour Capital', firm_website: 'https://harbour.example', profile_url: 'https://au.linkedin.com/in/Ada-Example/?x=1', location: 'Melbourne' })]);
    expect(p.rows[0].status).toBe('matched');
    expect(p.rows[0].fills).toEqual([{ field: 'location', to: 'Melbourne' }]);
    expect(p.report).toMatchObject({ existing_people_matched: 1, proposed_updates: 1, new_people: 0 });
  });

  it('keeps a difference from what is on record as a conflict, and proposes nothing for that row', () => {
    const named = plan([row({ name: 'Ada Renamed', firm: 'Harbour Capital', firm_website: 'https://harbour.example', profile_url: 'https://www.linkedin.com/in/ada-example' })]).rows[0];
    expect(named.status).toBe('conflict');
    expect(named.reason).toMatch(/the record says "Ada Example"/);
    expect(named.fills).toEqual([]);
    const retitled = plan([row({ name: 'Ada Example', role: 'Analyst', firm: 'Harbour Capital', firm_website: 'https://harbour.example', profile_url: 'https://www.linkedin.com/in/ada-example' })]).rows[0];
    expect(retitled.status).toBe('conflict');
    expect(retitled.reason).toMatch(/the listing says "Analyst"; the record says "Partner"/);
    const moved = plan([row({ name: 'Ada Example', profile_url: 'https://www.linkedin.com/in/ada-example' })]).rows[0];
    expect(moved.status).toBe('conflict');
    expect(moved.reason).toMatch(/another organisation/);
  });

  it('flags the same name at the same firm with no shared profile address for a person to settle, and makes no second person', () => {
    const p = plan([row({ name: 'Ada Example', firm: 'Harbour Capital', firm_website: 'https://harbour.example', profile_url: null })]);
    expect(p.rows[0].status).toBe('conflict');
    expect(p.rows[0].reason).toMatch(/already on record/);
    expect(p.report.new_people).toBe(0);
    const other = plan([row({ name: 'Ada Example', firm: 'Harbour Capital', firm_website: 'https://harbour.example', profile_url: 'https://www.linkedin.com/in/another-ada' })]);
    expect(other.rows[0].status).toBe('conflict');
  });

  it('takes a person with the same name at another firm as a different person', () => {
    const p = plan([row({ name: 'Ada Example', profile_url: 'https://www.linkedin.com/in/ada-example-two' })]);
    expect(p.rows[0].status).toBe('new');
    expect(p.rows[0].person.id).toBe('ada-example-brand-new-capital');
  });

  it('skips a second row for the same profile address, or for the same name and firm with no address, as a duplicate in the source', () => {
    const p = plan([row(), row({ role: 'Principal' }), row({ name: 'No Link', profile_url: null }), row({ name: 'no  link', profile_url: null })]);
    expect(p.rows.map((r) => r.status)).toEqual(['new', 'duplicate', 'new', 'duplicate']);
    expect(p.report.duplicates_in_source).toBe(2);
  });

  it('counts Australian and international people, and never calls a place nobody listed Australian', () => {
    const p = plan([
      row({ location: 'Melbourne, VIC' }), row({ name: 'B', profile_url: null, location: 'NYC' }), row({ name: 'C', profile_url: null, location: 'Other' }), row({ name: 'D', profile_url: null, location: null }),
    ]);
    expect(p.report).toMatchObject({ australian: 1, international_or_unplaced: 2, no_location: 1 });
  });

  it('counts the roles, and skips a row with no role, saying why', () => {
    const p = plan([row(), row({ name: 'S', profile_url: null, role: 'Scout' }), row({ name: 'T', profile_url: null, role: 'Talent Partner' }), row({ name: 'U', profile_url: null, role: null })]);
    expect(p.report.roles).toEqual({ investment: 1, scout: 1, talent: 1 });
    expect(p.report).toMatchObject({ skipped: 1, new_people: 3 });
    expect(p.rows[3].reason).toMatch(/no role stated/);
  });

  it('refuses to run without the page the list was read from and the day it was read', () => {
    expect(() => planImport(existing(), table([row()]), { url: 'nope', retrievedAt: '2026-10-22' })).toThrow(/address of the page/);
    expect(() => planImport(existing(), table([row()]), { url: 'https://x.example/', retrievedAt: '' })).toThrow(/never claims to have read a page itself/);
  });

  it('writes the report as words', () => {
    const text = reportText(plan([row(), row({ role: null, name: 'Skipped One' })]));
    expect(text).toMatch(/Dry run of the import: Example Directory/);
    expect(text).toMatch(/Source records collected:\s+2/);
    expect(text).toMatch(/New people:\s+1/);
    expect(text).toMatch(/Skipped \(1\)/);
    expect(text).toMatch(/Skipped One: no role stated/);
  });
});

describe('doing it', () => {
  const run = (rows, ds = existing()) => {
    const work = structuredClone(ds);
    const p = planImport(work, table(rows), SOURCE);
    const made = applyPlan(work, p, { at: AT });
    return { work, p, made };
  };

  it('makes candidates: the person, their firm and the team record, with the listing as the source and nothing verified', () => {
    const { work, made } = run([row()]);
    expect(made.investor_people).toEqual(['zed-newcomer']);
    expect(made.investors).toEqual(['brand-new-capital']);
    const zed = work.investor_people.find((p) => p.id === 'zed-newcomer');
    expect(zed).toMatchObject({ name: 'Zed Newcomer', current_title: 'Partner', current_organisation_id: 'brand-new-capital', location: 'Sydney', linkedin_url: 'https://www.linkedin.com/in/zed-newcomer', verification_status: 'candidate', last_verified_at: null });
    expect(work.investors.find((o) => o.id === 'brand-new-capital')).toMatchObject({ name: 'Brand New Capital', website: 'https://brandnew.example/', verification_status: 'candidate', inclusion_basis: null });
    expect(work.investor_people_organisations.find((m) => m.person_id === 'zed-newcomer')).toMatchObject({ organisation_id: 'brand-new-capital', role: 'Partner', is_current: true, verification_status: 'unverified', verified_at: null, note: expect.stringContaining('Example Directory lists Zed Newcomer') });
    const src = work.sources.find((s) => s.id === 'example-directory-2026-10-22');
    expect(src).toMatchObject({ kind: 'directory_listing', url: SOURCE.url, retrieved_at: '2026-10-22T00:00:00.000Z' });
    for (const r of work.verification_records.filter((x) => x.source_id === src.id)) expect(r).toMatchObject({ verified_at: null, status: 'active', confidence: 'medium', note: expect.stringMatching(/^Listed by Example Directory/) });
  });

  it('leaves a dataset that passes every check the store makes', () => {
    const { work } = run([row(), row({ name: 'Scout Person', profile_url: null, role: 'Scout', location: 'London' })]);
    expect(validateDataset(migrateDataset(work)).join('\n')).toBe('');
  });

  it('makes nothing public: a candidate is in no list and has no page', async () => {
    const { work } = run([row()]);
    const dir = await tempDir();
    await mkdir(dir, { recursive: true });
    await writeFiles(dir, serializeDataset(migrateDataset(work)));
    const catalog = createCatalog({ file: path.join(dir, 'startups.json'), reloadMs: 0 });
    const investorCatalog = createInvestorCatalog({ dir, reloadMs: 0 });
    await investorCatalog.refresh();
    const app = createApp({ catalog, investorCatalog, correctionsFile: path.join(dir, 'c.json') });
    const all = (await request(app).get('/api/investors?kind=all')).body;
    expect(all.results.map((r) => r.name)).toEqual(['Harbour Capital']);
    expect((await request(app).get('/api/investor-people/zed-newcomer')).status).toBe(404);
  });

  it('adds nothing when it is run again on what it made', () => {
    const first = run([row(), row({ name: 'Ada Example', firm: 'Harbour Capital', firm_website: 'https://harbour.example', profile_url: 'https://www.linkedin.com/in/ada-example', location: 'Melbourne' })]);
    const again = planImport(first.work, table([row(), row({ name: 'Ada Example', firm: 'Harbour Capital', firm_website: 'https://harbour.example', profile_url: 'https://www.linkedin.com/in/ada-example', location: 'Melbourne' })]), SOURCE);
    expect(again.report).toMatchObject({ new_people: 0, new_firms: 0, proposed_updates: 0, conflicts: 0, existing_people_matched: 2 });
    const snapshot = structuredClone(first.work);
    const made = applyPlan(first.work, again, { at: '2027-01-01T00:00:00.000Z' });
    expect(made.investor_people).toEqual([]);
    expect(made.investors).toEqual([]);
    expect(first.work).toEqual(snapshot);
  });

  it('fills only an empty field of a person already on record, with the listing behind it, and never overwrites', () => {
    const { work, made } = run([row({ name: 'Ada Example', firm: 'Harbour Capital', firm_website: 'https://harbour.example', profile_url: 'https://www.linkedin.com/in/ada-example', location: 'Melbourne' })]);
    expect(made.filled).toEqual([expect.objectContaining({ person: 'ada-example', field: 'location', to: 'Melbourne' })]);
    const ada = work.investor_people.find((p) => p.id === 'ada-example');
    expect(ada).toMatchObject({ location: 'Melbourne', current_title: 'Partner' });
    expect(work.verification_records.some((r) => r.subject_id === 'ada-example' && r.field === 'location')).toBe(true);
    const again = planImport(work, table([row({ name: 'Ada Example', firm: 'Harbour Capital', firm_website: 'https://harbour.example', profile_url: 'https://www.linkedin.com/in/ada-example', location: 'Sydney' })]), SOURCE);
    expect(again.rows[0].status).toBe('conflict'); // the record says Melbourne now, the listing says Sydney
    expect(again.rows[0].fills).toEqual([]);
  });

  it('applies the unambiguous rows and leaves the conflicts and skips alone', () => {
    const { work, made } = run([row(), row({ name: 'Ada Renamed', firm: 'Harbour Capital', firm_website: 'https://harbour.example', profile_url: 'https://www.linkedin.com/in/ada-example' }), row({ name: 'No Role', profile_url: null, role: null })]);
    expect(made.investor_people).toEqual(['zed-newcomer']);
    expect(work.investor_people.find((p) => p.id === 'ada-example').name).toBe('Ada Example');
    expect(work.investor_people.some((p) => p.name === 'No Role')).toBe(false);
  });

  it('tells two people of one name at different firms apart by their firm', () => {
    const { work } = run([row({ name: 'Sam Same', profile_url: null }), row({ name: 'Sam Same', profile_url: null, firm: 'Other Capital', firm_website: 'https://other.example' })]);
    expect(work.investor_people.filter((p) => p.name === 'Sam Same').map((p) => p.id).sort()).toEqual(['sam-same', 'sam-same-other-capital']);
  });
});

describe('undoing a run', () => {
  it('takes out exactly what it made, while nobody has worked on it', () => {
    const before = existing();
    const work = structuredClone(before);
    const p = planImport(work, table([row(), row({ name: 'Ada Example', firm: 'Harbour Capital', firm_website: 'https://harbour.example', profile_url: 'https://www.linkedin.com/in/ada-example', location: 'Melbourne' })]), SOURCE);
    const made = applyPlan(work, p, { at: AT });
    const done = undoRun(work, made);
    expect(done).toEqual({ people: 1, firms: 1, filled: 1 });
    expect(work).toEqual(before);
  });

  it('does nothing, and says why, once a person has worked on what it made', () => {
    const work = structuredClone(existing());
    const made = applyPlan(work, planImport(work, table([row()]), SOURCE), { at: AT });
    work.investor_people.find((p) => p.id === 'zed-newcomer').verification_status = 'needs_review';
    work.investor_people.find((p) => p.id === 'zed-newcomer').updated_at = '2026-11-01T00:00:00.000Z';
    expect(() => undoRun(work, made)).toThrow(/worked on what it made.*edited after the import/);
    expect(work.investor_people.some((p) => p.id === 'zed-newcomer')).toBe(true);
  });
});

describe('the command', () => {
  async function setup() {
    const dir = await tempDir();
    await mkdir(dir, { recursive: true });
    await writeFiles(dir, serializeDataset(existing()));
    const file = path.join(dir, 'list.csv');
    await writeFile(file, ['name,role,firm,location,profile_url,firm_website', 'Zed Newcomer,Partner,Brand New Capital,Sydney,https://www.linkedin.com/in/zed-newcomer,https://brandnew.example', 'Quiet Person,,Brand New Capital,Sydney,,https://brandnew.example', ''].join('\n'));
    const runs = path.join(dir, 'runs');
    const base = ['scripts/investors/people_import.mjs', '--from', file, '--source-url', SOURCE.url, '--retrieved-at', '2026-10-22', '--retrieved-by', 'the owner', '--source-name', 'Example Directory', '--data', dir, '--runs', runs];
    const cli = (...more) => execFileSync('node', [...base, ...more], { cwd: BACKEND, encoding: 'utf8' });
    return { dir, runs, cli, files: async () => Object.fromEntries(Object.entries(await loadRaw(dir))) };
  }

  it('does a dry run by default, which writes nothing, then applies with a backup and a manifest, then does nothing the second time, then undoes it', async () => {
    const t = await setup();
    const was = await t.files();
    const dry = t.cli();
    expect(dry).toMatch(/Dry run of the import/);
    expect(dry).toMatch(/New people:\s+1/);
    expect(dry).toMatch(/Nothing was written/);
    expect(await t.files()).toEqual(was);

    const out = t.cli('--apply', '--by', 'tester');
    expect(out).toMatch(/Imported:?|Imported the|^Imported/m);
    const after = parseRaw(await loadRaw(t.dir));
    expect(after.investor_people.map((p) => p.id).sort()).toEqual(['ada-example', 'zed-newcomer']);
    expect(after.audit_trail.at(-1)).toMatchObject({ action: 'investor.import', actor: 'tester' });
    const [runId] = await readdir(t.runs);
    expect(JSON.parse(await readFile(path.join(t.runs, runId, 'manifest.json'), 'utf8')).made.investor_people).toEqual(['zed-newcomer']);
    expect(await readFile(path.join(t.runs, runId, 'before', 'investor_people.json'), 'utf8')).toBe(was['investor_people.json']);

    const second = t.cli('--apply', '--by', 'tester');
    expect(second).toMatch(/New people:\s+0/);
    expect(parseRaw(await loadRaw(t.dir)).investor_people).toHaveLength(2);

    const undone = execFileSync('node', ['scripts/investors/people_import.mjs', '--undo', runId, '--by', 'tester', '--data', t.dir, '--runs', t.runs], { cwd: BACKEND, encoding: 'utf8' });
    expect(undone).toMatch(/undone: 1 people, 1 firms/);
    expect(parseRaw(await loadRaw(t.dir)).investor_people.map((p) => p.id)).toEqual(['ada-example']);
  }, 60000);

  it('needs the page the list came from and the day it was read, and a name to apply', async () => {
    const t = await setup();
    expect(() => execFileSync('node', ['scripts/investors/people_import.mjs', '--from', path.join(t.dir, 'list.csv'), '--data', t.dir], { cwd: BACKEND, encoding: 'utf8', stdio: 'pipe' })).toThrow(/--source-url is required/);
    expect(() => t.cli('--apply')).toThrow();
  }, 30000);
});
