// Innovation Bay as a job DISCOVERY source (src/jobsync/network.js): what its public pages are read for, the pace it is read at, how what is read is matched against the directory,
// the leads it queues, and the guarantees that matter most: no role is ever copied from it, so none is shown twice, and every application link stays the employer's own.
import { describe, it, expect, afterEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createFetcher } from '../src/discovery/http.js';
import { jobSyncFetcher } from '../src/jobsync/fetcher.js';
import { NETWORKS, NETWORK_READS_PER_RUN, parseCompanySitemap, profileOf, eligibility, isInvestorProfile, isAustralianProfile, readNetwork, applyProfiles, coveredBy, queueable, engineLead, markQueued } from '../src/jobsync/network.js';
import { applySample, VC_FIRMS } from '../src/jobsync/vc.js';
import { rotationBucket, blockOf, ROTATION_BLOCKS, dueForDiscovery } from '../src/jobsync/discover.js';
import { compareLedgers } from '../src/jobsync/changes.js';
import { validateJobLeads, validateJobCoverage } from '../src/models/jobDiscovery.js';
import { tick } from '../src/scheduler/scheduler.js';
import { syncSummary } from '../src/network/board.js';
import { makeDataDir, readDataDir, removeMadeDirs } from './helpers/store.js';
import { dataset, co, NOW, ISO, scriptedWeb } from './helpers/scheduler.js';
import { fetcherFor, auPage } from './helpers/discovery.js';
import { main as jobsync } from '../scripts/jobsync.mjs';

afterEach(removeMadeDirs);

const IB = NETWORKS.find((n) => n.id === 'innovation-bay');
const PUBLIC = async () => ['93.184.216.34'];
const html = (body) => ({ status: 200, body, headers: { 'content-type': 'text/html' } });
const xml = (body) => ({ status: 200, body, headers: { 'content-type': 'application/xml' } });
const text = (body, status = 200) => ({ status, body, headers: { 'content-type': 'text/plain' } });
const json = (body) => ({ status: 200, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

// The robots.txt the site really serves: rules for three named bots, none for anyone else.
const IB_ROBOTS = 'User-agent: ExaSearchBot\nUser-agent: AhrefsBot\nUser-agent: meta-externalagent\nDisallow:\nCrawl-delay: 10\n\nSitemap: https://jobs.innovationbay.com/sitemap.xml\n';

const nextPage = (pageProps) => `<html><head><title>x</title></head><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps } })}</script></body></html>`;
const gJob = (over = {}) => ({ id: 1, title: 'Backend Engineer', url: 'https://apply.workable.com/acme-robotics/j/ABC123/', locations: ['Melbourne, VIC, Australia'], workMode: 'hybrid', organization: { name: 'Acme Robotics' }, ...over });
const boardPage = (jobs, { slug = 'innovation-bay', total = 9170 } = {}) => nextPage({ network: { slug, name: 'Innovation Bay' }, initialState: { jobs: { found: jobs, total } } });
const profile = (over = {}) => ({
  id: 3160022, name: 'Affirm Software Group', slug: 'affirm-software-group', domain: 'affirmsoftware.com.au', websiteUrl: 'http://affirmsoftware.com.au', description: 'Provides document management and automation solutions.',
  founded: '2006', approxEmployees: 12, orgType: 'private', stage: 'other', hasActiveJobs: true, activeJobsCount: 4, industryTags: ['Software', 'Software Development'],
  locations: [{ id: '2458', name: 'Melbourne, VIC, Australia' }], ...over,
});
const companyPage = (c) => nextPage({ company: c, companySlug: c.slug, initialState: {} });
const sitemap = (slugs) => `<?xml version="1.0"?><urlset>${slugs.map((s) => `<url><loc>https://jobs.innovationbay.com/companies/${s}</loc><lastmod>2026-11-19T11:16:28Z</lastmod></url>`).join('')}</urlset>`;

// The slugs that fall in the block `now` is in, so a test can name what a refresh at that moment reads.
const inBlock = (slugs, now) => slugs.filter((s) => rotationBucket(s) === blockOf(now) % ROTATION_BLOCKS);
const SLUGS = Array.from({ length: 120 }, (_, i) => `company-${i + 1}`);

function netWeb({ board = boardPage([gJob()]), robots = IB_ROBOTS, slugs = SLUGS, profiles = {}, extra = {} } = {}) {
  const w = scriptedWeb((u) => {
    if (u === 'https://jobs.innovationbay.com/robots.txt') return text(robots);
    if (u === IB.board) return html(board);
    if (u === IB.sitemap) return xml(sitemap(slugs));
    const m = u.match(/^https:\/\/jobs\.innovationbay\.com\/companies\/([^/]+)$/);
    if (m) { const p = profiles[m[1]] ?? profile({ id: 1, name: `Company ${m[1]}`, slug: m[1], domain: `${m[1]}.com.au`, websiteUrl: `https://${m[1]}.com.au` }); return p instanceof Error ? p : p.status ? p : html(companyPage(p)); }
    return extra[u];
  });
  return w;
}
const netFetcher = (w, over = {}) => {
  const sleeps = [];
  const fetcher = jobSyncFetcher({ fetchImpl: w.fetchImpl, resolveHost: PUBLIC, sleep: async (ms) => { sleeps.push(ms); }, now: () => NOW, minDelayMs: IB.delay_ms, ...over });
  return { fetcher, sleeps };
};

// ---------- what the pages say ----------

describe('reading Innovation Bay\'s pages', () => {
  it('takes the company pages the site\'s sitemap lists, once each, and nothing else', () => {
    const list = parseCompanySitemap(`<urlset>
      <url><loc>https://jobs.innovationbay.com/companies/biarri</loc><lastmod>2026-11-19T11:16:28Z</lastmod></url>
      <url><loc>https://jobs.innovationbay.com/companies/biarri</loc></url>
      <url><loc>https://jobs.innovationbay.com/companies/love-to-dream-2</loc></url>
      <url><loc>https://jobs.innovationbay.com/jobs/123-engineer</loc></url>
      <url><loc>https://elsewhere.example/companies/trap</loc></url>
      <url><loc>https://jobs.innovationbay.com/companies/bad slug</loc></url></urlset>`, IB.origin);
    expect(list.map((e) => e.slug)).toEqual(['biarri', 'love-to-dream-2']);
    expect(list[0]).toMatchObject({ url: 'https://jobs.innovationbay.com/companies/biarri', lastmod: '2026-11-19T11:16:28Z' });
  });

  it('reads a company page into a profile: name, website, places, size, industries, whether it has open jobs; and refuses a page that is not one', () => {
    const p = profileOf(companyPage(profile()), 'https://jobs.innovationbay.com/companies/affirm-software-group');
    expect(p).toMatchObject({ name: 'Affirm Software Group', domain: 'affirmsoftware.com.au', website: 'http://affirmsoftware.com.au', employees: 12, org_type: 'private', hiring: true, active_jobs: 4, locations: ['Melbourne, VIC, Australia'], industries: ['Software', 'Software Development'] });
    expect(isAustralianProfile(p)).toBe(true);
    expect(profileOf('<html><body>no data</body></html>', 'https://x/')).toBeNull();
    expect(profileOf(nextPage({ network: {} }), 'https://x/')).toBeNull();
    expect(profileOf(companyPage(profile({ name: '  ' })), 'https://x/')).toBeNull();
  });

  it('says what is plainly not a startup, and what is a venture firm, and what is Australian (a place or a .au website; not Melbourne, Florida)', () => {
    const at = (over) => profileOf(companyPage(profile(over)), 'https://x/');
    expect(eligibility(at({}))).toEqual({ ok: true, why: [] });
    expect(eligibility(at({ approxEmployees: 5000 })).why[0]).toMatch(/5000 people/);
    expect(eligibility(at({ orgType: 'public' })).ok).toBe(false);
    expect(eligibility(at({ domain: null, websiteUrl: null })).why[0]).toMatch(/no website/);
    expect(isInvestorProfile(at({ industryTags: ['Venture Capital & Private Equity'] }))).toBe(true);
    expect(eligibility(at({ industryTags: ['Venture Capital & Private Equity'] })).ok).toBe(false);
    expect(isAustralianProfile(at({ locations: [{ name: 'Melbourne, FL, USA' }], domain: 'acme.com' }))).toBe(false);
    expect(isAustralianProfile(at({ locations: [{ name: 'Singapore' }], domain: 'acme.com.au' }))).toBe(true);
    expect(isAustralianProfile(at({ locations: [{ name: 'Perth, WA, Australia' }], domain: 'acme.io' }))).toBe(true);
  });
});

// ---------- the read: access, pace, rotation ----------

describe('reading the network within its rules', () => {
  it('serves a sample and a company list; checks the board is Innovation Bay\'s from its own data; and never calls Getro\'s API', async () => {
    const w = netWeb();
    const { fetcher } = netFetcher(w);
    const r = await readNetwork(IB, { fetcher, now: () => NOW, profiles: false });
    expect(r.row).toMatchObject({ id: 'innovation-bay', investor_id: null, platform: 'getro', access: 'public_sample', board_url: IB.board });
    expect(r.row.note).toMatch(/sample and never a source of roles/);
    expect(r.row.note).toMatch(/key that Getro issues to the board's owner/);
    expect(r.sample).toHaveLength(1);
    expect(r.sample[0]).toMatchObject({ firm: 'innovation-bay', org: 'Acme Robotics', title: 'Backend Engineer', url: 'https://apply.workable.com/acme-robotics/j/ABC123/' });
    expect(w.calls.some((u) => /getro\.com/.test(u))).toBe(false); // no API, no Getro host at all
    // A board whose own data names another network is not used.
    const other = netWeb({ board: boardPage([gJob()], { slug: 'someone-else' }) });
    const o = await readNetwork(IB, { fetcher: netFetcher(other).fetcher, now: () => NOW });
    expect(o.row.access).toBe('unread');
    expect(o.row.note).toMatch(/not confirmed as Innovation Bay's board.*someone-else/);
    expect(o.sample).toEqual([]);
    expect(other.pages().filter((u) => /\/companies\//.test(u))).toEqual([]);
  });

  it('reads nothing when the site\'s robots.txt closes it, and says so; the three named bots\' rules are not ours to follow or to claim', async () => {
    const closed = netWeb({ robots: 'User-agent: *\nDisallow: /\n' });
    const r = await readNetwork(IB, { fetcher: netFetcher(closed).fetcher, now: () => NOW });
    expect(r.row).toMatchObject({ access: 'unread' });
    expect(r.row.note).toMatch(/robots_disallow/);
    expect(r.stats.stopped).toBe('robots_disallow');
    expect(closed.pages()).toEqual([]);
    // Its real file: rules only for named bots, so a client it does not name is not refused.
    const open = netWeb();
    expect((await readNetwork(IB, { fetcher: netFetcher(open).fetcher, now: () => NOW, profiles: false })).row.access).toBe('public_sample');
  });

  it('reads this half-day\'s slice of the company list, a company page 10 seconds after the last, and no more than the cap', async () => {
    const w = netWeb();
    const { fetcher, sleeps } = netFetcher(w);
    const mine = inBlock(SLUGS, NOW);
    expect(mine.length).toBeGreaterThan(3);
    const r = await readNetwork(IB, { fetcher, now: () => NOW, limit: 3 });
    expect(r.stats).toMatchObject({ listed: 120, in_slice: mine.length, read: 3, deferred: mine.length - 3 });
    expect(w.pages().filter((u) => /\/companies\//.test(u)).map((u) => u.split('/').pop())).toEqual(mine.slice(0, 3));
    expect(sleeps.filter((ms) => ms >= 10000).length).toBeGreaterThanOrEqual(2); // each page after the first waited the site's pace
    expect(Math.max(...sleeps)).toBe(10000);
    expect(r.profiles).toHaveLength(3);
    expect(r.row.profiles_block).toBe(blockOf(NOW));
    expect(NETWORK_READS_PER_RUN).toBeLessThanOrEqual(45);
    // Over a week every company is in exactly one half-day block.
    const seen = new Set();
    for (let b = 0; b < ROTATION_BLOCKS; b += 1) for (const s of inBlock(SLUGS, (blockOf(NOW) + b) * 12 * 3600000)) seen.add(s);
    expect(seen.size).toBe(SLUGS.length);
  });

  it('leaves a company whose job board is already read alone, and stops when the site asks it to slow down', async () => {
    const mine = inBlock(SLUGS, NOW);
    const w = netWeb({ profiles: { [mine[1]]: { status: 429, body: 'slow down', headers: { 'retry-after': '120' } } } });
    const { fetcher } = netFetcher(w);
    const r = await readNetwork(IB, { fetcher, now: () => NOW, covered: (e) => e.slug === mine[0] });
    expect(r.stats.skipped_covered).toBe(1);
    expect(r.stats.stopped).toBe('rate_limited');
    expect(r.profiles).toHaveLength(0); // the first was skipped, the second was refused
    expect(w.pages().some((u) => u.endsWith(`/${mine[0]}`))).toBe(false);
    expect(r.row.note).toMatch(/Reading stopped early: rate_limited/);
  });

  it('stops after three failures in a row instead of working through a broken site', async () => {
    const mine = inBlock(SLUGS, NOW);
    const profiles = Object.fromEntries(mine.map((s) => [s, new Error('connection reset')]));
    const r = await readNetwork(IB, { fetcher: netFetcher(netWeb({ profiles })).fetcher, now: () => NOW });
    expect(r.stats).toMatchObject({ errors: 3, read: 0, stopped: 'repeated_errors' });
  });
});

// ---------- matching against the directory ----------

const prof = (over) => ({ ...profileOf(companyPage(profile(over)), `https://jobs.innovationbay.com/companies/${over.slug ?? 'affirm-software-group'}`), read_at: ISO });
const base = (extra = {}) => dataset([
  co('Affirm Software Group', { website: 'https://affirmsoftware.com.au', city: 'Melbourne' }),
  co('Acme Robotics', { website: 'https://acme.com.au', city: 'Sydney' }),
], {
  investors: [{ id: 'blackbird', name: 'Blackbird', slug: 'blackbird', website: 'https://www.blackbird.vc/' }, { id: 'newvc', name: 'Newvc Partners', slug: 'newvc', website: 'https://newvc.vc/' }],
  job_coverage: [{ company_id: 'affirm-software-group', checked_at: new Date(NOW - 3 * 86400000).toISOString(), outcome: 'careers_page_only', review: true, careers_url: null, boards: [], source_ids: [], note: 'no board link', next_check_at: null }],
  ...extra,
});
const ids = (work) => Object.fromEntries(work.job_leads.map((l) => [l.id, `${l.kind}/${l.status}`]));

describe('matching what the network names against the directory', () => {
  it('a company we hold that is hiring and has no board read is looked at at the next refresh; one whose board is read is not', () => {
    const work = base();
    const s = applyProfiles(work, IB, [prof({})], { at: ISO, now: () => NOW });
    expect(s).toMatchObject({ in_directory: 1, hiring_without_board: 1, hints: 1, leads_new: 0 });
    expect(work.job_coverage[0].hiring_hint_at).toBe(ISO);
    expect(work.job_leads).toEqual([]); // it is in the directory: nothing to approve
    // and discovery takes it at once, outside its turn in the week, and a look clears it
    const due = dueForDiscovery(work, { now: NOW, limit: 10, isInactive: () => false });
    expect(due.planned.map((c) => c.id)).toContain('affirm-software-group');
    work.job_coverage[0].checked_at = new Date(NOW + 1000).toISOString();
    expect(dueForDiscovery(work, { now: NOW + 2000, limit: 10, isInactive: () => false }).planned.map((c) => c.id)).not.toContain('affirm-software-group');
    // a board read for it: no hint
    const covered = base({ job_sources: [{ id: 'affirm-lever-jobs', company_id: 'affirm-software-group', provider: 'lever', token: 'affirm', board_url: 'https://jobs.lever.co/affirm', status: 'approved', basis: 'x', note: '', added_at: ISO }] });
    const s2 = applyProfiles(covered, IB, [prof({})], { at: ISO, now: () => NOW });
    expect(s2).toMatchObject({ in_directory: 1, hiring_without_board: 0, hints: 0 });
    expect(covered.job_coverage[0].hiring_hint_at).toBeUndefined();
    // looked at in the last day: not again
    const fresh = base();
    fresh.job_coverage[0].checked_at = new Date(NOW - 3600000).toISOString();
    expect(applyProfiles(fresh, IB, [prof({})], { at: ISO, now: () => NOW }).hints).toBe(0);
  });

  it('an Australian startup we do not hold becomes a lead with what its page says; one outside Australia, a large one, and one with no website do not', () => {
    const work = base();
    const s = applyProfiles(work, IB, [
      prof({ name: 'Zorbly Labs', slug: 'zorbly', domain: 'zorbly.com.au', websiteUrl: 'https://zorbly.com.au', approxEmployees: 8 }),
      prof({ name: 'Overseas Co', slug: 'overseas', domain: 'overseas.com', websiteUrl: 'https://overseas.com', locations: [{ name: 'Austin, TX, USA' }] }),
      prof({ name: 'Big Corp', slug: 'big', domain: 'big.com.au', websiteUrl: 'https://big.com.au', approxEmployees: 9000 }),
      prof({ name: 'No Site Pty', slug: 'nosite', domain: null, websiteUrl: null, locations: [{ name: 'Perth, WA, Australia' }] }),
    ], { at: ISO, now: () => NOW });
    expect(s).toMatchObject({ leads_new: 1, outside_australia: 1, ineligible: 2 });
    expect(ids(work)).toEqual({ 'lead-zorbly-labs': 'unknown_company/needs_review' });
    const lead = work.job_leads[0];
    expect(lead).toMatchObject({ name: 'Zorbly Labs', first_seen_at: ISO });
    expect(lead.profile).toMatchObject({ website: 'https://zorbly.com.au', domain: 'zorbly.com.au', employees: 8, active_jobs: 4, locations: ['Melbourne, VIC, Australia'] });
    expect(lead.seen_on[0]).toMatchObject({ firm: 'innovation-bay', url: 'https://jobs.innovationbay.com/companies/zorbly' });
    expect(lead.note).toMatch(/Innovation Bay's job board company list/);
    expect(validateJobLeads(work)).toEqual([]);
    // read again a week later: the same lead, not a second one
    const again = applyProfiles(work, IB, [prof({ name: 'Zorbly Labs', slug: 'zorbly', domain: 'zorbly.com.au', websiteUrl: 'https://zorbly.com.au', approxEmployees: 9 })], { at: '2026-10-12T04:00:00.000Z', now: () => NOW });
    expect(again).toMatchObject({ leads_new: 0, leads_seen: 1 });
    expect(work.job_leads).toHaveLength(1);
    expect(work.job_leads[0]).toMatchObject({ first_seen_at: ISO, last_seen_at: '2026-10-12T04:00:00.000Z' });
    expect(work.job_leads[0].profile.employees).toBe(9);
  });

  it("a company we hold under the same name but another website is not queued as new, and the network's own entry is not a lead", () => {
    const work = base();
    const s = applyProfiles(work, IB, [
      prof({ name: 'Acme Robotics', slug: 'acme', domain: 'acmerobotics.ai', websiteUrl: 'https://acmerobotics.ai' }), // ours, listed under another domain
      prof({ name: 'Innovation Bay', slug: 'innovation-bay', domain: 'innovationbay.com', websiteUrl: 'https://innovationbay.com', industryTags: ['Venture Capital & Private Equity'] }),
    ], { at: ISO, now: () => NOW });
    expect(s).toMatchObject({ same_name: 1, self: 1, leads_new: 0, investor_leads: 0 });
    expect(work.job_leads).toEqual([]);
  });

  it('a company a pending candidate already is, or a lead a person rejected, is not queued again; and a lead settles once the directory holds the company', () => {
    const work = base();
    applyProfiles(work, IB, [prof({ name: 'Zorbly Labs', slug: 'zorbly', domain: 'zorbly.com.au', websiteUrl: 'https://zorbly.com.au' })], { at: ISO, now: () => NOW });
    work.job_leads[0].status = 'rejected';
    applyProfiles(work, IB, [prof({ name: 'Zorbly Labs', slug: 'zorbly', domain: 'zorbly.com.au', websiteUrl: 'https://zorbly.com.au' })], { at: ISO, now: () => NOW });
    expect(work.job_leads[0].status).toBe('rejected');
    expect(queueable(work)).toEqual([]);
    // settled
    const w2 = base();
    applyProfiles(w2, IB, [prof({ name: 'Zorbly Labs', slug: 'zorbly', domain: 'zorbly.com.au', websiteUrl: 'https://zorbly.com.au' })], { at: ISO, now: () => NOW });
    w2.companies.push({ ...w2.companies[0], id: 'zorbly-labs', slug: 'zorbly-labs', name: 'Zorbly Labs', website: 'https://zorbly.com.au' });
    const s = applyProfiles(w2, IB, [prof({ name: 'Zorbly Labs', slug: 'zorbly', domain: 'zorbly.com.au', websiteUrl: 'https://zorbly.com.au' })], { at: ISO, now: () => NOW });
    expect(s).toMatchObject({ in_directory: 1, settled: 1 });
    expect(w2.job_leads[0]).toMatchObject({ status: 'in_directory', resolved_to: 'zorbly-labs' });
    expect(validateJobLeads(w2)).toEqual([]);
  });

  it('venture firms: one we hold that is hiring and is not one of the firms checked is flagged; one we check is not; an unknown Australian one is its own kind of lead', () => {
    const work = base();
    const vc = (o) => prof({ industryTags: ['Venture Capital & Private Equity'], ...o });
    const s = applyProfiles(work, IB, [
      vc({ name: 'Newvc Partners', slug: 'newvc', domain: 'newvc.vc', websiteUrl: 'https://newvc.vc', locations: [{ name: 'Sydney, NSW, Australia' }] }),
      vc({ name: 'Blackbird', slug: 'blackbird', domain: 'blackbird.vc', websiteUrl: 'https://www.blackbird.vc', locations: [{ name: 'Sydney, NSW, Australia' }] }),
      vc({ name: 'Fresh Capital', slug: 'fresh', domain: 'fresh.vc', websiteUrl: 'https://fresh.vc', locations: [{ name: 'Melbourne, VIC, Australia' }] }),
      vc({ name: 'Far Capital', slug: 'far', domain: 'far.vc', websiteUrl: 'https://far.vc', locations: [{ name: 'London, UK' }] }),
    ], { at: ISO, now: () => NOW });
    expect(s).toMatchObject({ investors_known: 2, investor_leads: 2, outside_australia: 1 });
    expect(VC_FIRMS.some((f) => f.investor_id === 'blackbird')).toBe(true);
    expect(ids(work)).toEqual({ 'lead-investor-hiring-newvc': 'investor_hiring/needs_review', 'lead-fresh-capital': 'unknown_investor/needs_review' });
    expect(work.job_leads[0]).toMatchObject({ investor_id: 'newvc' });
    expect(work.job_leads[0].note).toMatch(/VC_FIRMS/);
    expect(validateJobLeads(work)).toEqual([]);
    expect(queueable(work)).toEqual([]); // venture firms go through the investor directory, not the startup queue
  });

  it('a name the venture boards\' samples already made a lead for stays ONE lead, with both places that named it', () => {
    const work = base();
    const sample = [{ firm: 'innovation-bay', org: 'Zorbly Labs', title: 'Engineer', url: 'https://jobs.lever.co/zorbly/1', locations: ['Sydney NSW, Australia'], work_mode: null, at: ISO }];
    applySample(work, { id: 'blackbird', name: 'Blackbird' }, sample, { at: ISO, keptReview: [] });
    applyProfiles(work, IB, [prof({ name: 'Zorbly Labs', slug: 'zorbly', domain: 'zorbly.com.au', websiteUrl: 'https://zorbly.com.au' })], { at: ISO, now: () => NOW });
    expect(work.job_leads).toHaveLength(1);
    expect(work.job_leads[0].seen_on.map((x) => x.firm)).toEqual(['blackbird', 'innovation-bay']);
    expect(work.job_leads[0].profile.website).toBe('https://zorbly.com.au');
  });

  it('the board\'s sample is used like any Getro board: an employer\'s own board becomes a review row for the employer to confirm, a LinkedIn link names nothing', () => {
    const work = base();
    const firm = { id: 'innovation-bay', name: 'Innovation Bay', label: IB.label };
    const sample = [
      { firm: 'innovation-bay', org: 'Acme Robotics', title: 'Backend Engineer', url: 'https://apply.workable.com/acme-robotics/j/ABC123/', locations: ['Melbourne, VIC, Australia'], work_mode: null, at: ISO },
      { firm: 'innovation-bay', org: 'Acme Robotics', title: 'Designer', url: 'https://www.linkedin.com/jobs/view/designer-at-acme-4491481473', locations: ['Sydney NSW, Australia'], work_mode: null, at: ISO },
      { firm: 'innovation-bay', org: 'Elsewhere Inc', title: 'Chef', url: 'https://jobs.lever.co/elsewhere/1', locations: ['Denver, CO, USA'], work_mode: null, at: ISO },
      { firm: 'innovation-bay', org: 'Remote Down Under', title: 'Support', url: 'https://jobs.lever.co/rdu/1', locations: ['Australia (Remote)'], work_mode: 'remote', at: ISO },
    ];
    const { stats, reviews } = applySample(work, firm, sample, { at: ISO, keptReview: [] });
    expect(stats).toMatchObject({ sighted: 4, known: 2, review_boards: 1, leads: 1, ignored: 1 });
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ company_id: 'acme-robotics', provider: 'workable', token: 'acme-robotics' });
    expect(reviews[0].reason).toMatch(/Named by Innovation Bay's job board.*Not yet confirmed.*not read/);
    expect(work.job_leads[0]).toMatchObject({ name: 'Remote Down Under' });
    expect(work.job_leads[0].note).toMatch(/Named by Innovation Bay's job board/);
  });
});

// ---------- the directory's own review queue ----------

describe('handing eligible startups to the directory\'s review queue', () => {
  it('offers the startups only, in the shape the discovery engine takes, and marks each with what the engine did with it', () => {
    const work = base();
    applyProfiles(work, IB, [
      prof({ name: 'Zorbly Labs', slug: 'zorbly', domain: 'zorbly.com.au', websiteUrl: 'https://zorbly.com.au' }),
      prof({ name: 'Quark Pty', slug: 'quark', domain: 'quark.com.au', websiteUrl: 'https://quark.com.au' }),
      prof({ name: 'Dup Co', slug: 'dup', domain: 'dup.com.au', websiteUrl: 'https://dup.com.au' }),
      prof({ name: 'Nope Ltd', slug: 'nope', domain: 'nope.com.au', websiteUrl: 'https://nope.com.au' }),
    ], { at: ISO, now: () => NOW });
    expect(queueable(work, { limit: 2 }).map((l) => l.name)).toEqual(['Zorbly Labs', 'Quark Pty']);
    expect(queueable(work, { firm: 'blackbird' })).toEqual([]);
    const lead = engineLead(work.job_leads[0], IB);
    expect(lead).toMatchObject({ key: 'lead-zorbly-labs', name: 'Zorbly Labs', website: 'https://zorbly.com.au', url: 'https://jobs.innovationbay.com/companies/zorbly', publisher: 'Innovation Bay', observed_at: ISO });
    expect(lead.text).toMatch(/Provides document management/);
    expect(JSON.stringify(lead)).not.toMatch(/@/); // nothing about a person
    // what the engine left: a candidate for review, a company we already hold, one it rejected, one it never reached
    work.candidates = [
      { id: 'zorbly-labs', status: 'needs_review', discoveries: [{ source_id: 'innovation-bay', key: 'lead-zorbly-labs' }], matches: [] },
      { id: 'quark', status: 'matched', discoveries: [{ source_id: 'innovation-bay', key: 'lead-quark-pty' }], matches: [{ kind: 'company', id: 'acme-robotics' }] },
      { id: 'dup-co', status: 'rejected', discoveries: [{ source_id: 'innovation-bay', key: 'lead-dup-co' }], matches: [] },
    ];
    const out = markQueued(work, IB, { at: ISO });
    expect(out).toEqual({ queued: 1, in_directory: 1, rejected: 1, left: 1 });
    const by = Object.fromEntries(work.job_leads.map((l) => [l.name, l]));
    expect(by['Zorbly Labs']).toMatchObject({ status: 'queued', candidate_id: 'zorbly-labs', candidate_status: 'needs_review' });
    expect(by['Quark Pty']).toMatchObject({ status: 'in_directory', resolved_to: 'acme-robotics' });
    expect(by['Dup Co'].status).toBe('rejected');
    expect(by['Nope Ltd'].status).toBe('needs_review');
    expect(validateJobLeads(work)).toEqual([]);
  });

  it('the new lead kinds and statuses are checked: a queued lead names its candidate, an in-directory lead its company, a hiring firm its investor', () => {
    const ds = base();
    const row = (o) => ({ id: 'lead-x', kind: 'unknown_company', name: 'X', status: 'needs_review', seen_on: [], first_seen_at: ISO, last_seen_at: ISO, ...o });
    expect(validateJobLeads({ ...ds, job_leads: [row({ status: 'queued' })] })[0]).toMatch(/queued needs candidate_id/);
    expect(validateJobLeads({ ...ds, job_leads: [row({ status: 'in_directory' })] })[0]).toMatch(/in_directory needs resolved_to/);
    expect(validateJobLeads({ ...ds, job_leads: [row({ kind: 'investor_hiring', investor_id: 'nobody' })] })[0]).toMatch(/investor_hiring needs the investor_id/);
    expect(validateJobLeads({ ...ds, job_leads: [row({ kind: 'mystery' })] })[0]).toMatch(/invalid kind/);
    expect(validateJobLeads({ ...ds, job_leads: [row({ status: 'queued', candidate_id: 'c1' }), row({ id: 'lead-y', kind: 'investor_hiring', investor_id: 'blackbird' })] })).toEqual([]);
    expect(validateJobCoverage({ ...ds, job_coverage: [{ ...ds.job_coverage[0], hiring_hint_at: 'yesterday' }] })[0]).toMatch(/hiring_hint_at/);
    expect(validateJobCoverage({ ...ds, job_coverage: [{ ...ds.job_coverage[0], hiring_hint_at: ISO }] })).toEqual([]);
  });

  it('a lead\'s move on, and a hint, are worth a commit (so the next refresh, which starts from what was committed, does not lose them)', () => {
    const lead = { id: 'lead-x', status: 'needs_review' };
    expect(compareLedgers({ job_leads: [lead] }, { job_leads: [{ ...lead, status: 'in_directory' }] })).toBe(1);
    expect(compareLedgers({ job_leads: [lead] }, { job_leads: [{ ...lead, last_seen_at: ISO }] })).toBe(0);
    const cov = { company_id: 'a', outcome: 'careers_page_only', boards: [] };
    expect(compareLedgers({ job_coverage: [cov] }, { job_coverage: [{ ...cov, hiring_hint_at: ISO }] })).toBe(1);
  });

  it('the hiring desk counts the companies and firms waiting for a person, not the hiring firm the directory already holds, and lists Innovation Bay beside the venture boards', () => {
    const lead = (id, kind, status = 'needs_review') => ({ id, kind, status, name: id });
    const vc = [{ id: 'innovation-bay', name: 'Innovation Bay', platform: 'getro', access: 'public_sample', note: 'A Getro network', own_vacancies: '', checked_at: ISO }];
    const sum = syncSummary({ vc, leads: [lead('a', 'unknown_company'), lead('b', 'unknown_investor'), lead('c', 'investor_hiring'), lead('d', 'unknown_company', 'queued')] });
    expect(sum.leads_waiting).toBe(2);
    expect(sum.vc_boards).toEqual([{ name: 'Innovation Bay', platform: 'getro', access: 'public_sample', note: 'A Getro network', own_vacancies: '', checked_at: ISO }]);
  });

  it('knows which company pages are not worth a read: the directory holds the company and its board is read', () => {
    const work = base({ job_sources: [{ id: 'a-lever-jobs', company_id: 'acme-robotics', provider: 'lever', token: 'acme', board_url: 'https://jobs.lever.co/acme', status: 'approved', basis: 'x', note: '', added_at: ISO }] });
    const covered = coveredBy(work);
    expect(covered({ slug: 'acme-robotics' })).toBe(true);
    expect(covered({ slug: 'affirm-software-group' })).toBe(false); // held, but no board of its own read: its page is worth a read (it says whether the company is hiring)
    expect(covered({ slug: 'someone-new' })).toBe(false);
  });
});

// ---------- the whole refresh ----------

describe('a refresh with Innovation Bay in it', () => {
  const ACME_LEVER = 'https://api.lever.co/v0/postings/acme?mode=json&limit=50&skip=0';
  const lever = (id) => ({ id: `id-${id}`, text: 'Backend Engineer', hostedUrl: `https://jobs.lever.co/acme/id-${id}`, applyUrl: `https://jobs.lever.co/acme/id-${id}/apply`, categories: { location: 'Melbourne, Australia', commitment: 'Full-time' }, createdAt: Date.parse('2026-09-01T00:00:00Z'), workplaceType: 'hybrid' });

  async function setup({ slugs = SLUGS, profiles = {} } = {}) {
    const sources = [{ id: 'acme-robotics-lever-jobs', kind: 'company_website', url: 'https://jobs.lever.co/acme', title: 'Lever job board', publisher: 'acme.com.au', retrieved_at: ISO, note: '' }];
    const catalogue = [{ id: 'acme-robotics-lever-jobs', company_id: 'acme-robotics', provider: 'lever', token: 'acme', board_url: 'https://jobs.lever.co/acme', status: 'approved', basis: 'linked from its careers page', note: '', added_at: ISO }];
    const dir = await makeDataDir(dataset([co('Acme Robotics', { website: 'https://acme.com.au', city: 'Melbourne' }), co('Affirm Software Group', { website: 'https://affirmsoftware.com.au', city: 'Melbourne' })], { sources, job_sources: catalogue }));
    const w = netWeb({
      // Innovation Bay lists the SAME role the employer's own feed lists, under the employer's own link
      board: boardPage([gJob({ title: 'Backend Engineer', url: 'https://jobs.lever.co/acme/id-1' })]),
      slugs, profiles: { 'affirm-software-group': profile(), ...profiles },
      extra: { [ACME_LEVER]: json([lever(1)]), 'https://acme.com.au/': html('<html><body>no careers</body></html>'), 'https://affirmsoftware.com.au/': html('<html><body>hello</body></html>') },
    });
    const clock = { now: NOW };
    const now = () => clock.now;
    const fetcher = () => createFetcher({ fetchImpl: w.fetchImpl, resolveHost: PUBLIC, sleep: async () => {}, now, userAgent: 'AUStartupMapBot/1.0 (+https://stillearly-au.vercel.app/; job board sync)', minDelayMs: 1500 });
    return { dir, w, clock, now, run: (over = {}) => tick({ dir, now, fetcher: fetcher(), sources: [], by: 'tester', jobs: ['jobsync'], trigger: 'ci', limits: { slot: '2026-11-20 AM', steps: ['network', 'confirm', 'boards', 'dedupe', 'health'] }, ...over }) };
  }

  it('records Innovation Bay as a board with its sample access, queues what it names, and shows the role once, with the employer\'s own application link', async () => {
    const mine = inBlock(SLUGS, NOW);
    const t = await setup({ slugs: [...SLUGS, 'affirm-software-group'] });
    const result = await t.run();
    expect(['ok', 'partial']).toContain(result.status);
    const ds = await readDataDir(t.dir);
    const row = ds.job_vc_boards.find((r) => r.id === 'innovation-bay');
    expect(row).toMatchObject({ platform: 'getro', access: 'public_sample', investor_id: null });
    // a role: from the employer's feed, once, linked to the employer
    const open = ds.jobs.filter((j) => j.status === 'open');
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ company_id: 'acme-robotics', external_id: 'id-1', apply_url: 'https://jobs.lever.co/acme/id-1' });
    // nothing of Innovation Bay's is in the roles, and no application link goes through it
    expect(JSON.stringify(ds.jobs)).not.toMatch(/innovationbay/);
    expect(ds.jobs.every((j) => !/innovationbay\.com/.test(j.apply_url))).toBe(true);
    // the company pages of this half-day were read, and the leads they made are Australian startups the directory does not hold
    const pagesRead = t.w.pages().filter((u) => /\/companies\//.test(u)).length;
    expect(pagesRead).toBeGreaterThan(0);
    expect(pagesRead).toBeLessThanOrEqual(NETWORK_READS_PER_RUN);
    expect(ds.job_leads.length).toBeGreaterThan(0);
    expect(ds.job_leads.every((l) => l.kind === 'unknown_company' && l.status === 'needs_review' && l.seen_on[0].firm === 'innovation-bay')).toBe(true);
    expect(mine.length).toBeGreaterThan(0);
    expect(result.runs.find((x) => x.job === 'jobsync').summary).toMatch(/network company page\(s\) read/);
  });

  it('a second refresh in the same half-day reads the board but not the company list again; the next half-day reads the next slice', async () => {
    const t = await setup();
    await t.run();
    const first = t.w.pages().filter((u) => /\/companies\//.test(u)).length;
    t.clock.now = NOW + 7 * 3600000; // the board is due again (11 h) only after a while; force it so the guard, not the due time, is what is tested
    await t.run({ limits: { slot: '2026-11-20 PM', steps: ['network'], force: true } });
    expect(t.w.pages().filter((u) => /\/companies\//.test(u)).length).toBe(first);
    t.clock.now = NOW + 13 * 3600000;
    await t.run({ limits: { slot: '2026-11-21 AM', steps: ['network'] } });
    const second = t.w.pages().filter((u) => /\/companies\//.test(u)).length;
    expect(second).toBeGreaterThan(first);
    const slugsRead = t.w.pages().filter((u) => /\/companies\//.test(u)).map((u) => u.split('/').pop());
    expect(new Set(slugsRead).size).toBe(slugsRead.length); // no company read twice in a week
  });

  it('a company we hold that Innovation Bay says is hiring, with no board yet, has its own website looked at in the same refresh', async () => {
    const t = await setup({ slugs: ['affirm-software-group'] });
    await t.run({ limits: { slot: '2026-11-20 AM', steps: ['network', 'discover'] } });
    const ds = await readDataDir(t.dir);
    const row = ds.job_coverage.find((r) => r.company_id === 'affirm-software-group');
    expect(row).toBeTruthy(); // never looked at before: the discovery step looked at it
    expect(t.w.pages()).toContain('https://affirmsoftware.com.au/');
  });
});

// ---------- the command, end to end ----------

describe("jobsync leads --promote, through the directory's own engine", () => {
  it("hands the eligible startups to the review queue as candidates (reading each one's OWN website), marks the leads, and adds nothing to the directory", async () => {
    const work = base();
    applyProfiles(work, IB, [
      prof({ name: 'Zorbly Labs', slug: 'zorbly', domain: 'zorbly.com.au', websiteUrl: 'https://zorbly.com.au' }),
      prof({ name: 'Acme Robotics', slug: 'acme-robotics', domain: 'acme.com.au', websiteUrl: 'https://acme.com.au' }), // already ours: never a lead
    ], { at: ISO, now: () => NOW });
    expect(work.job_leads.map((l) => l.name)).toEqual(['Zorbly Labs']);
    const dir = await makeDataDir(work);
    const { w, fetcher } = fetcherFor({ 'https://zorbly.com.au/': { body: auPage('Zorbly Labs', { abn: '53 004 085 616' }) } });
    const lines = [];
    const dry = await jobsync(['leads', '--promote', '--by', 'tester', '--dry-run', '--data', dir], { out: (l) => lines.push(l), now: () => NOW, fetcher });
    expect(dry).toBe(0);
    expect(lines.join(' | ')).toMatch(/1 lead\(s\) to hand to the directory's review queue/);
    expect((await readDataDir(dir)).candidates).toEqual([]); // a dry run writes nothing
    expect(w.pages()).toEqual([]);

    const code = await jobsync(['leads', '--promote', '--by', 'tester', '--data', dir], { out: (l) => lines.push(l), now: () => NOW, fetcher });
    expect(code).toBe(0);
    expect(w.pages().every((u) => u.startsWith('https://zorbly.com.au/'))).toBe(true); // only the company's own site was read
    const ds = await readDataDir(dir);
    expect(ds.companies.map((c) => c.name).sort()).toEqual(['Acme Robotics', 'Affirm Software Group']); // the directory is untouched
    expect(ds.candidates).toHaveLength(1);
    expect(ds.candidates[0]).toMatchObject({ name: 'Zorbly Labs', website: 'https://zorbly.com.au', status: 'needs_review', resolution: 'NEW_COMPANY' });
    expect(ds.candidates[0].discoveries[0]).toMatchObject({ source_id: 'innovation-bay', source_kind: 'directory_listing', key: 'lead-zorbly-labs', url: 'https://jobs.innovationbay.com/companies/zorbly' });
    expect(ds.job_leads[0]).toMatchObject({ status: 'queued', candidate_id: ds.candidates[0].id, candidate_status: 'needs_review' });
    expect(validateJobLeads(ds)).toEqual([]);
    const trail = JSON.parse(await readFile(path.join(dir, 'audit_trail.json'), 'utf-8'));
    expect(trail.some((x) => x.actor === 'tester' && x.action === 'import.run')).toBe(true); // the run is recorded with the name that asked for it
    // asking again hands nothing over twice
    const again = [];
    await jobsync(['leads', '--promote', '--by', 'tester', '--data', dir], { out: (l) => again.push(l), now: () => NOW, fetcher });
    expect(again[0]).toMatch(/^0 lead\(s\)/);
    expect((await readDataDir(dir)).candidates).toHaveLength(1);
  });

  it('asks for a name, as every decision here is recorded with one', async () => {
    const dir = await makeDataDir(base());
    await expect(jobsync(['leads', '--promote', '--data', dir], { out: () => {}, now: () => NOW })).rejects.toThrow(/--by/);
  });
});
