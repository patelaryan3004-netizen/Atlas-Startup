// Official portfolio pages as a weekly company discovery source (src/jobsync/portfolio.js): read once a week by rotation, only the companies nothing has seen are looked at, each matched against
// the directory and judged from its own website by the directory's engine on a scratch copy, and the survivors become leads. It never stores a role.
import { describe, it, expect, afterEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { jobSyncFetcher } from '../src/jobsync/fetcher.js';
import { createFetcher } from '../src/discovery/http.js';
import { SOURCES, sourceById } from '../src/discovery/portfolioSources.js';
import { normUrl, savedScanKeys, seenUrls, portfolioDue, portfolioRow, portfolioRowId, readPortfolio, applyPortfolio, judgeEntries, toJudge, recheckEntries, applyRecheck, evidenceKindOf, SCAN_DIR, PORTFOLIO_READS_PER_RUN } from '../src/jobsync/portfolio.js';
import { discoverySources } from '../src/jobsync/discoverySources.js';
import { isStartupLeadWaiting, isEligibleLead, validateJobLeads } from '../src/models/jobDiscovery.js';
import { queueable } from '../src/jobsync/network.js';
import { createCandidate } from '../src/models/candidate.js';
import { tick } from '../src/scheduler/scheduler.js';
import { main as jobsync } from '../scripts/jobsync.mjs';
import { makeDataDir, readDataDir, removeMadeDirs } from './helpers/store.js';
import { dataset, co, NOW, ISO, scriptedWeb } from './helpers/scheduler.js';
import { fetcherFor, auPage, page } from './helpers/discovery.js';

afterEach(removeMadeDirs);

const PUBLIC = async () => ['93.184.216.34'];
const html = (body) => ({ status: 200, body, headers: { 'content-type': 'text/html' } });
const BB = sourceById('blackbird-portfolio');
const GL = sourceById('giantleap-portfolio');
const listPage = (slugs) => `<html><body>${slugs.map((s) => `<a href="/portfolio/${s}">${s}</a>`).join('')}</body></html>`;
const profilePage = (name, site, desc = 'Makes things.') => `<html><head><title>${name} | Blackbird</title><meta name="description" content="${desc}"></head><body><a href="${site}">Website</a></body></html>`;
const web = (routes) => scriptedWeb((u) => routes[u]);
const fetcherOf = (w, over = {}) => { const sleeps = []; return { sleeps, fetcher: jobSyncFetcher({ fetchImpl: w.fetchImpl, resolveHost: PUBLIC, sleep: async (ms) => { sleeps.push(ms); }, now: () => NOW, ...over }) }; };
const base = () => dataset([co('Acme Robotics', { website: 'https://acme.com.au', city: 'Sydney' }), co('Affirm Software Group', { website: 'https://affirmsoftware.com.au', city: 'Melbourne' })]);
const entry = (name, website, over = {}) => ({ key: `k-${name}`, name, website, description: 'A company.', profile_url: `https://www.blackbird.vc/portfolio/${name.toLowerCase().replace(/\W+/g, '-')}`, list_url: BB.listUrl, ...over });

// ---------- the sources, and the cadence ----------

describe('the portfolio pages', () => {
  it('are the nine official venture-firm and accelerator pages the importer already reads, shared by the importer and the refresh', () => {
    expect(SOURCES.map((s) => s.id)).toEqual(['blackbird-portfolio', 'airtree-portfolio', 'squarepeg-portfolio', 'oneventures-portfolio', 'investible-portfolio', 'startmate-portfolio', 'folklore-portfolio', 'giantleap-portfolio', 'cicada-residents']);
    expect(SOURCES.every((s) => /^https:\/\//.test(s.listUrl))).toBe(true);
    expect(SOURCES.some((s) => /linkedin|crunchbase|getro/.test(s.listUrl))).toBe(false); // never a LinkedIn or database page
    expect(evidenceKindOf(BB)).toBe('investor_website');
    expect(evidenceKindOf(sourceById('startmate-portfolio'))).toBe('accelerator_profile');
  });

  it('are each read once a week: a page never read is due at once, one read is due a week later, one that was down or has companies left to look at is due at the next refresh; and the queue walks them all, Innovation Bay first', () => {
    expect(portfolioDue(undefined, NOW)).toBe(true);
    const ok = portfolioRow(BB, { status: 'ok', listed: 100, new: 3, read: 3, deferred: 0 }, { at: ISO, now: NOW, leads: 2 });
    expect(ok).toMatchObject({ id: 'portfolio-blackbird-portfolio', platform: 'portfolio_page', access: 'public_list', board_url: BB.listUrl, investor_id: null });
    expect(ok.note).toMatch(/names 100 companies; 3 not seen before, 3 looked at.*2 new leads.*never roles/);
    expect(Date.parse(ok.next_check_at) - NOW).toBe(7 * 24 * 3600000);
    expect(portfolioDue(ok, NOW + 3600000)).toBe(false);
    expect(portfolioDue(ok, NOW + 7 * 24 * 3600000)).toBe(true);
    expect(Date.parse(portfolioRow(BB, { status: 'ok', listed: 100, new: 40, read: 30, deferred: 10 }, { at: ISO, now: NOW }).next_check_at) - NOW).toBe(12 * 3600000);
    const down = portfolioRow(BB, { status: 'unread', error: 'http_error', listed: 0, new: 0, read: 0, deferred: 0 }, { at: ISO, now: NOW });
    expect(down).toMatchObject({ access: 'unread' });
    expect(down.note).toMatch(/not read: http_error/);
    expect(portfolioRow(BB, { status: 'layout_changed', listed: 0, new: 0, read: 0, deferred: 0 }, { at: ISO, now: NOW })).toMatchObject({ access: 'no_public_feed' });
    expect(portfolioRowId(GL)).toBe('portfolio-giantleap-portfolio');
    expect(discoverySources().map((s) => s.id)).toEqual(['innovation-bay', ...SOURCES.map((s) => s.id)]);
  });

  it('compare addresses without tracking, fragments, case or a trailing slash', () => {
    expect(normUrl('https://www.Blackbird.vc/portfolio/Acme/?utm=1#x')).toBe(normUrl('http://blackbird.vc/portfolio/acme'));
  });
});

// ---------- the read ----------

describe('reading one portfolio page', () => {
  it('reads the listing and the profile of each company nothing has seen, and no other: the saved scans, candidates and leads count as seen', async () => {
    const w = web({
      [BB.listUrl]: html(listPage(['old-one', 'new-one', 'seen-lead', 'new-two'])),
      'https://www.blackbird.vc/portfolio/new-one': html(profilePage('New One', 'https://newone.com.au')),
      'https://www.blackbird.vc/portfolio/new-two': html(profilePage('New Two', 'https://newtwo.io')),
    });
    const { fetcher } = fetcherOf(w);
    const known = new Set([normUrl('https://www.blackbird.vc/portfolio/old-one'), normUrl('https://www.blackbird.vc/portfolio/seen-lead')]);
    const r = await readPortfolio(BB, { fetcher, now: () => NOW, known: (k) => known.has(k) });
    expect(r).toMatchObject({ status: 'ok', listed: 4, new: 2, read: 2, errors: 0, stopped: null });
    expect(r.entries.map((e) => [e.name, e.website])).toEqual([['New One', 'https://newone.com.au/'], ['New Two', 'https://newtwo.io/']]);
    expect(w.pages()).toEqual([BB.listUrl, 'https://www.blackbird.vc/portfolio/new-one', 'https://www.blackbird.vc/portfolio/new-two']); // the two seen ones were not asked for
  });

  it('counts what the importer saved as seen: a listing that names exactly what the saved scan holds reads no profile page', async () => {
    const saved = JSON.parse(readFileSync(path.join(SCAN_DIR, 'blackbird-portfolio.json'), 'utf8'));
    const slugs = saved.leads.map((l) => new URL(l.profile_url).pathname.split('/').pop());
    expect(slugs.length).toBeGreaterThan(50);
    const w = web({ [BB.listUrl]: html(listPage(slugs)) });
    const keys = savedScanKeys(BB);
    expect(keys.size).toBe(saved.leads.length);
    const r = await readPortfolio(BB, { fetcher: fetcherOf(w).fetcher, now: () => NOW, known: (k) => keys.has(k) });
    expect(r).toMatchObject({ status: 'ok', listed: slugs.length, new: 0, read: 0 });
    expect(w.pages()).toEqual([BB.listUrl]);
    // and a company the portfolio has added since is the only one read
    const w2 = web({ [BB.listUrl]: html(listPage([...slugs, 'brand-new'])), 'https://www.blackbird.vc/portfolio/brand-new': html(profilePage('Brand New', 'https://brandnew.com.au')) });
    const r2 = await readPortfolio(BB, { fetcher: fetcherOf(w2).fetcher, now: () => NOW, known: (k) => keys.has(k) });
    expect(r2).toMatchObject({ new: 1, read: 1 });
    expect(r2.entries[0].name).toBe('Brand New');
  });

  it('takes a card page\'s companies straight from the listing (no profile page to read)', async () => {
    const card = (n, h) => `<a href="${h}" class="portfolio_item x"><h3>${n}</h3><p>Does ${n}.</p></a>`;
    const w = web({ [GL.listUrl]: html(`<html><body>${card('Zorbly', 'https://zorbly.com.au')}${card('Quark', 'https://quark.com.au')}</body></html>`) });
    const r = await readPortfolio(GL, { fetcher: fetcherOf(w).fetcher, now: () => NOW });
    expect(r.entries.map((e) => [e.name, e.website])).toEqual([['Zorbly', 'https://zorbly.com.au'], ['Quark', 'https://quark.com.au']]);
    expect(w.pages()).toEqual([GL.listUrl]);
  });

  it('changes nothing when the page is down, refuses us, or no longer names anyone (a layout it cannot read is not an empty portfolio)', async () => {
    const down = await readPortfolio(BB, { fetcher: fetcherOf(web({ [BB.listUrl]: { status: 500, body: 'oops', headers: { 'content-type': 'text/html' } } })).fetcher, now: () => NOW });
    expect(down).toMatchObject({ status: 'unread', entries: [] });
    const closed = web({ 'https://www.blackbird.vc/robots.txt': { status: 200, body: 'User-agent: *\nDisallow: /portfolio\n', headers: { 'content-type': 'text/plain' } }, [BB.listUrl]: html(listPage(['a'])) });
    const c = await readPortfolio(BB, { fetcher: fetcherOf(closed).fetcher, now: () => NOW });
    expect(c).toMatchObject({ status: 'unread', error: 'robots_disallow', stopped: 'robots_disallow', entries: [] });
    expect(closed.pages()).toEqual([]);
    const changed = await readPortfolio(BB, { fetcher: fetcherOf(web({ [BB.listUrl]: html('<html><body><p>Our new portfolio is loading...</p></body></html>') })).fetcher, now: () => NOW });
    expect(changed).toMatchObject({ status: 'layout_changed', listed: 0, entries: [] });
  });

  it('reads at most its share of profile pages, stops when a site asks it to slow down, and gives up after three failures in a row', async () => {
    const slugs = Array.from({ length: 6 }, (_, i) => `co-${i}`);
    const profiles = Object.fromEntries(slugs.map((s) => [`https://www.blackbird.vc/portfolio/${s}`, html(profilePage(s, `https://${s}.com.au`))]));
    const capped = await readPortfolio(BB, { fetcher: fetcherOf(web({ [BB.listUrl]: html(listPage(slugs)), ...profiles })).fetcher, now: () => NOW, limit: 2 });
    expect(capped).toMatchObject({ new: 6, read: 2, deferred: 4 });
    expect(PORTFOLIO_READS_PER_RUN).toBeLessThanOrEqual(30);
    const slow = await readPortfolio(BB, { fetcher: fetcherOf(web({ [BB.listUrl]: html(listPage(slugs)), ...profiles, 'https://www.blackbird.vc/portfolio/co-1': { status: 429, body: 'slow', headers: { 'content-type': 'text/html', 'retry-after': '60' } } })).fetcher, now: () => NOW });
    expect(slow).toMatchObject({ read: 1, stopped: 'rate_limited' });
    const broken = await readPortfolio(BB, { fetcher: fetcherOf(web({ [BB.listUrl]: html(listPage(slugs)), ...Object.fromEntries(slugs.map((s) => [`https://www.blackbird.vc/portfolio/${s}`, new Error('reset')])) })).fetcher, now: () => NOW });
    expect(broken).toMatchObject({ errors: 3, read: 0, stopped: 'repeated_errors' });
  });
});

// ---------- matching, and the engine's verdict ----------

describe('what the companies named are to the directory', () => {
  it('a company we hold, a pending candidate, the same name on another site, and a social page are not leads; a new company with a website is', () => {
    const work = base();
    work.candidates = [createCandidate({ id: 'cand-quark', name: 'Quark', website: 'https://quark.com.au', discoveries: [], evidence: [] }, { at: ISO, by: 'test' })];
    const s = applyPortfolio(work, BB, [
      entry('Acme Robotics', 'https://acme.com.au'), entry('Quark', 'https://quark.com.au'), entry('Acme Robotics', 'https://acmerobotics.ai', { key: 'k2' }),
      entry('Social Page', 'https://www.linkedin.com/company/x'), entry('Zorbly Labs', 'https://zorbly.com.au'),
    ], { at: ISO });
    expect(s).toMatchObject({ in_directory: 1, already_queued: 1, same_name: 1, no_site: 1, leads_new: 1 });
    expect(work.job_leads).toHaveLength(1);
    expect(work.job_leads[0]).toMatchObject({ id: 'lead-zorbly-labs', kind: 'unknown_company', status: 'needs_review', name: 'Zorbly Labs' });
    expect(work.job_leads[0].seen_on[0]).toMatchObject({ firm: 'blackbird-portfolio', title: 'Zorbly Labs | Blackbird portfolio' });
    expect(work.job_leads[0].profile).toMatchObject({ website: 'https://zorbly.com.au', domain: 'zorbly.com.au', origin: 'portfolio', locations: [] });
    expect(work.job_leads[0].note).toMatch(/Blackbird's official portfolio page/);
    expect(validateJobLeads(work)).toEqual([]);
  });

  it('the same startup named by two places is one lead with both, keeping the first profile; a lead settles once the directory holds the company', () => {
    const work = base();
    applyPortfolio(work, BB, [entry('Zorbly Labs', 'https://zorbly.com.au', { description: 'First.' })], { at: ISO });
    applyPortfolio(work, sourceById('airtree-portfolio'), [entry('Zorbly Labs', 'https://zorbly.com.au', { description: 'Second.', profile_url: 'https://www.airtree.vc/companies/zorbly' })], { at: '2026-10-12T04:00:00.000Z' });
    expect(work.job_leads).toHaveLength(1);
    expect(work.job_leads[0].seen_on.map((x) => x.firm)).toEqual(['blackbird-portfolio', 'airtree-portfolio']);
    expect(work.job_leads[0].profile.description).toBe('First.');
    work.companies.push({ ...work.companies[0], id: 'zorbly-labs', slug: 'zorbly-labs', name: 'Zorbly Labs', website: 'https://zorbly.com.au' });
    const s = applyPortfolio(work, BB, [entry('Zorbly Labs', 'https://zorbly.com.au')], { at: '2026-10-19T04:00:00.000Z' });
    expect(s).toMatchObject({ in_directory: 1, settled: 1 });
    expect(work.job_leads[0]).toMatchObject({ status: 'in_directory', resolved_to: 'zorbly-labs' });
    expect(validateJobLeads(work)).toEqual([]);
  });

  it('keeps the engine\'s verdict on the lead, drops what the engine rejected, and counts a portfolio lead as an Australian company only once its own site says so', () => {
    const work = base();
    const v = (o) => ({ resolution: 'NEW_COMPANY', australian: 'unknown', startup: 'unknown', match: null, status: 'needs_review', ...o });
    const s = applyPortfolio(work, BB, [entry('Au Co', 'https://auco.com.au'), entry('Maybe Co', 'https://maybe.io'), entry('Us Co', 'https://usco.com'), entry('Ours Really', 'https://oursreally.com')], {
      at: ISO, verdicts: new Map([['k-Au Co', v({ australian: 'yes', startup: 'likely' })], ['k-Maybe Co', v({ australian: 'unknown' })], ['k-Us Co', v({ status: 'rejected', australian: 'no' })], ['k-Ours Really', v({ status: 'matched' })]]),
    });
    expect(s).toMatchObject({ leads_new: 2, rejected_by_check: 1, in_directory: 1 });
    const by = Object.fromEntries(work.job_leads.map((l) => [l.name, l]));
    expect(by['Au Co'].profile).toMatchObject({ australian: 'yes', startup: 'likely' });
    expect(Object.keys(by).sort()).toEqual(['Au Co', 'Maybe Co']);
    expect(work.job_leads.filter(isStartupLeadWaiting).map((l) => l.name)).toEqual(['Au Co']); // "Maybe Co": no word on where it is yet
    // a lead from a network (an Australian place on its profile) counts as before
    expect(isStartupLeadWaiting({ kind: 'unknown_company', status: 'needs_review', profile: { origin: undefined } })).toBe(true);
    expect(isStartupLeadWaiting({ kind: 'unknown_company', status: 'needs_review' })).toBe(true);
  });

  it('judges each new company by reading its OWN website on a scratch copy: the verdict comes back and the real data is not touched', async () => {
    const work = base();
    work.candidates = [];
    const before = JSON.stringify([work.candidates, work.identifiers, work.evidence, work.sources]);
    const entries = [entry('Zorbly Labs', 'https://zorbly.com.au'), entry('Hidden Co', 'https://hidden.example')];
    const { fetcher, w } = fetcherFor({ 'https://zorbly.com.au/': { body: auPage('Zorbly Labs', { abn: '53 004 085 616' }) } });
    const verdicts = await judgeEntries(work, BB, entries, { fetcher, now: () => NOW });
    expect(verdicts.get('k-Zorbly Labs')).toMatchObject({ status: 'needs_review', resolution: 'NEW_COMPANY' });
    expect(['yes', 'likely']).toContain(verdicts.get('k-Zorbly Labs').australian);
    expect(verdicts.get('k-Hidden Co')).toMatchObject({ status: 'needs_review', australian: 'unknown' }); // its site could not be read: no verdict, no rejection
    expect(w.pages().every((u) => /zorbly\.com\.au|hidden\.example/.test(u))).toBe(true); // only the companies' own sites
    expect(JSON.stringify([work.candidates, work.identifiers, work.evidence, work.sources])).toBe(before);
  });

  it('queues a portfolio lead only once the engine judged it Australian; one whose own site says nothing about where it is waits as a lead, and is judged again a month later', async () => {
    const work = base();
    const v = (a) => ({ status: 'needs_review', resolution: 'NEW_COMPANY', australian: a, startup: 'likely', match: null });
    applyPortfolio(work, BB, [entry('Au Co', 'https://auco.com.au'), entry('Maybe Co', 'https://maybe.io'), entry('Likely Co', 'https://likely.io')], { at: ISO, verdicts: new Map([['k-Au Co', v('yes')], ['k-Maybe Co', v('unknown')], ['k-Likely Co', v('likely')]]) });
    expect(queueable(work).map((l) => l.name)).toEqual(['Au Co', 'Likely Co']);
    expect(work.job_leads.map((l) => [l.name, isEligibleLead(l)])).toEqual([['Au Co', true], ['Maybe Co', false], ['Likely Co', true]]);
    // a network lead (an Australian place on its profile, no portfolio origin) is eligible as before
    expect(isEligibleLead({ profile: { website: 'https://x.com.au', locations: ['Sydney'] } })).toBe(true);

    // nothing is looked at again before a month has passed
    expect(recheckEntries(work, { now: Date.parse(ISO) + 27 * 86400000 })).toEqual([]);
    const later = Date.parse(ISO) + 29 * 86400000;
    const again = recheckEntries(work, { now: later });
    expect(again.map((e) => [e.lead_id, e.website])).toEqual([['lead-maybe-co', 'https://maybe.io']]); // only the unknown one
    // the company's own site now says it is Australian
    const { fetcher } = fetcherFor({ 'https://maybe.io/': { body: auPage('Maybe Co', { abn: '53 004 085 616' }) } });
    const verdicts = await judgeEntries(work, BB, again, { fetcher, now: () => later });
    const stats = applyRecheck(work, again, verdicts, { at: new Date(later).toISOString() });
    expect(stats.rechecked).toBe(1);
    expect(['yes', 'likely']).toContain(work.job_leads[1].profile.australian);
    expect(queueable(work).map((l) => l.name)).toEqual(['Au Co', 'Maybe Co', 'Likely Co']);
    expect(work.job_leads[1].profile.read_at).toBe(new Date(later).toISOString());
    // explicit evidence against it, or a company we hold after all, settles the lead
    const w2 = base();
    applyPortfolio(w2, BB, [entry('Odd Co', 'https://odd.io'), entry('Twin Co', 'https://twin.io')], { at: ISO, verdicts: new Map([['k-Odd Co', v('unknown')], ['k-Twin Co', v('unknown')]]) });
    const es = recheckEntries(w2, { now: later });
    const r = applyRecheck(w2, es, new Map([[es[0].key, { status: 'rejected', australian: 'no', startup: 'unknown', match: null }], [es[1].key, { status: 'matched', australian: 'yes', startup: 'yes', match: 'Acme Robotics' }]]), { at: ISO });
    expect(r).toMatchObject({ rechecked: 2, rejected: 1 });
    expect(w2.job_leads.map((l) => [l.name, l.status])).toEqual([['Odd Co', 'rejected'], ['Twin Co', 'in_directory']]);
    expect(w2.job_leads[0].note).toMatch(/Read again on 2026-10-05: .*not Australian/);
    expect(w2.job_leads[1].resolved_to).toBe('acme-robotics');
    expect(validateJobLeads(w2)).toEqual([]);
    // at most a few a refresh
    const many = base();
    applyPortfolio(many, BB, Array.from({ length: 15 }, (_, i) => entry(`Co ${i}`, `https://co${i}.io`)), { at: ISO, verdicts: new Map(Array.from({ length: 15 }, (_, i) => [`k-Co ${i}`, v('unknown')])) });
    expect(recheckEntries(many, { now: later })).toHaveLength(10);
  });

  it('judges only what could become a lead: not a company we hold, not a candidate, not one already judged', () => {
    const work = base();
    work.candidates = [createCandidate({ id: 'cand-quark', name: 'Quark', website: 'https://quark.com.au', discoveries: [], evidence: [] }, { at: ISO, by: 'test' })];
    applyPortfolio(work, BB, [entry('Judged Co', 'https://judged.com.au')], { at: ISO, verdicts: new Map([['k-Judged Co', { status: 'needs_review', australian: 'yes', startup: 'likely', match: null }]]) });
    const todo = toJudge(work, [entry('Acme Robotics', 'https://acme.com.au'), entry('Quark', 'https://quark.com.au'), entry('Judged Co', 'https://judged.com.au'), entry('Fresh Co', 'https://fresh.com.au')]);
    expect(todo.map((e) => e.name)).toEqual(['Fresh Co']);
  });

  it('counts what candidates and leads already saw by address', () => {
    const work = base();
    work.candidates = [{ ...createCandidate({ id: 'cand-x', name: 'X', website: 'https://x.com.au', discoveries: [{ source_id: 'blackbird-portfolio', key: 'x', url: 'https://www.blackbird.vc/portfolio/x/', source_kind: 'investor_website', observed_at: ISO }], evidence: [] }, { at: ISO, by: 'test' }) }];
    work.job_leads = [{ id: 'lead-y', kind: 'unknown_company', name: 'Y', status: 'needs_review', seen_on: [{ firm: 'airtree-portfolio', url: 'https://www.airtree.vc/companies/y', title: 'Y', at: ISO }], first_seen_at: ISO, last_seen_at: ISO }];
    const seen = seenUrls(work);
    expect(seen.has(normUrl('https://www.blackbird.vc/portfolio/x'))).toBe(true);
    expect(seen.has(normUrl('https://www.airtree.vc/companies/y'))).toBe(true);
  });
});

// ---------- the whole refresh, and the queue ----------

describe('a refresh with the portfolio step in it', () => {
  async function setup() {
    const dir = await makeDataDir(base());
    const w = scriptedWeb((u) => ({
      [BB.listUrl]: html(listPage(['zorbly'])),
      'https://www.blackbird.vc/portfolio/zorbly': html(profilePage('Zorbly Labs', 'https://zorbly.com.au', 'Zorbly makes things in Melbourne.')),
      'https://zorbly.com.au/': { status: 200, body: auPage('Zorbly Labs', { abn: '53 004 085 616' }), headers: { 'content-type': 'text/html' } },
    })[u]);
    const clock = { now: NOW };
    const now = () => clock.now;
    const fetcher = () => createFetcher({ fetchImpl: w.fetchImpl, resolveHost: PUBLIC, sleep: async () => {}, now, userAgent: 'AUStartupMapBot/1.0 (+https://stillearly-au.vercel.app/; job board sync)', minDelayMs: 1500 });
    return { dir, w, clock, now, run: (over = {}) => tick({ dir, now, fetcher: fetcher(), sources: [], by: 'tester', jobs: ['jobsync'], trigger: 'ci', limits: { slot: '2026-11-21 AM', steps: ['portfolio'] }, ...over }) };
  }

  it('reads the page in its week, makes a lead from the new company after its own site said Australian, stores no role and writes no candidate', async () => {
    const t = await setup();
    const result = await t.run();
    expect(['ok', 'partial']).toContain(result.status);
    const ds = await readDataDir(t.dir);
    expect(ds.job_leads).toHaveLength(1);
    expect(ds.job_leads[0]).toMatchObject({ name: 'Zorbly Labs', kind: 'unknown_company', status: 'needs_review' });
    expect(ds.job_leads[0].profile).toMatchObject({ origin: 'portfolio', website: 'https://zorbly.com.au/' });
    expect(['yes', 'likely']).toContain(ds.job_leads[0].profile.australian);
    expect(ds.jobs).toEqual([]);
    expect(ds.candidates).toEqual([]); // the queue is only ever fed by the command
    expect(JSON.stringify(ds.jobs)).not.toMatch(/blackbird/);
    expect(result.runs.find((x) => x.job === 'jobsync').summary).toMatch(/1 portfolio page\(s\) read, 1 new company looked at, 1 new lead/); // the other eight pages are not reachable in this scripted web: said, not hidden
    expect(ds.job_vc_boards.find((r) => r.id === 'portfolio-blackbird-portfolio')).toMatchObject({ platform: 'portfolio_page', access: 'public_list', checked_at: new Date(NOW).toISOString() });
    expect(ds.job_vc_boards.filter((r) => r.platform === 'portfolio_page')).toHaveLength(SOURCES.length);
    expect(ds.job_vc_boards.filter((r) => r.platform === 'portfolio_page' && r.access === 'unread')).toHaveLength(SOURCES.length - 1);
    expect(t.w.pages().filter((u) => !SOURCES.some((p) => u === p.listUrl) && !/blackbird\.vc|zorbly\.com\.au/.test(u))).toEqual([]); // only the portfolio pages, one profile, and the company's own site
  });

  it('a second refresh in the same hour asks nothing; a week later it asks for the listing and not for the company again', async () => {
    const t = await setup();
    await t.run();
    const profileReads = () => t.w.pages().filter((u) => /\/portfolio\/zorbly$/.test(u)).length;
    const siteReads = () => t.w.pages().filter((u) => u === 'https://zorbly.com.au/').length;
    expect([profileReads(), siteReads()]).toEqual([1, 1]);
    const asked = t.w.calls.length;
    await t.run({ limits: { slot: '2026-11-21 PM', steps: ['portfolio'] } });
    expect(t.w.calls.length).toBe(asked); // not due: no page of any portfolio is asked again
    t.clock.now = NOW + 7 * 24 * 3600000 + 1000; // a week later: Blackbird's page is due again
    await t.run({ limits: { slot: '2026-11-28 AM', steps: ['portfolio'] } });
    expect(t.w.pages().filter((u) => u === BB.listUrl).length).toBe(2);
    expect([profileReads(), siteReads()]).toEqual([1, 1]); // seen (a lead holds it): its profile and its own site are not read again
  });

  it('hands the lead to the directory\'s review queue as a candidate with the portfolio page as its evidence, and records the engine\'s verdict', async () => {
    const t = await setup();
    await t.run();
    const { fetcher } = fetcherFor({ 'https://zorbly.com.au/': { body: auPage('Zorbly Labs', { abn: '53 004 085 616' }) } });
    const lines = [];
    const code = await jobsync(['leads', '--promote', '--by', 'tester', '--source', 'blackbird-portfolio', '--data', t.dir], { out: (l) => lines.push(l), now: () => NOW, fetcher });
    expect(code).toBe(0);
    expect(lines.join(' | ')).toMatch(/Blackbird: 1 lead\(s\) to hand/);
    const ds = await readDataDir(t.dir);
    expect(ds.candidates).toHaveLength(1);
    expect(ds.candidates[0]).toMatchObject({ name: 'Zorbly Labs', status: 'needs_review' });
    expect(ds.candidates[0].discoveries[0]).toMatchObject({ source_id: 'blackbird-portfolio', source_kind: 'investor_website', url: 'https://www.blackbird.vc/portfolio/zorbly' });
    expect(ds.job_leads[0]).toMatchObject({ status: 'queued', candidate_id: ds.candidates[0].id });
    expect(['yes', 'likely']).toContain(ds.job_leads[0].profile.australian);
    expect(ds.companies.map((c) => c.name).sort()).toEqual(['Acme Robotics', 'Affirm Software Group']); // the directory is untouched
    expect(validateJobLeads(ds)).toEqual([]);
    expect((await readFile(path.join(t.dir, 'audit_trail.json'), 'utf-8'))).toMatch(/tester/);
  });
});
