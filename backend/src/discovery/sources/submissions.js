// Founder and company submissions: the submit form's queue (/api/submissions).
// The most legitimate source there is, since the company asked to be listed.
//
// The queue lives on the deployed server's disk, which does not survive a
// restart, so reading it into candidates.json is also what makes a submission
// durable. Two ways to read it:
//   - from the deployed API, with the project's own ADMIN_KEY from the environment
//     (this is our own service and our own key, so it does not go through the
//     crawling fetcher), or
//   - from a local copy of submissions.json.
//
// A submission carries the submitter's email. It is never copied into a lead, so it
// can never reach candidates.json or the repository. What a submitter says about
// their own company is a claim, kept at low confidence until the company's own
// website corroborates it.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { websiteUrl } from '../../models/identity.js';

const DEFAULT_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'submissions.json');
const STAGES = new Set(['Pre-seed', 'Seed', 'Series A', 'Series B', 'Series C', 'Series D', 'Growth', 'Early']);

// Only these fields are ever read from a submission. Email and hiringUrl are not.
export function submissionToLead(row, { retrievedAt }) {
  const name = String(row.name ?? '').replace(/\s+/g, ' ').trim();
  if (!name) return null;
  const website = websiteUrl(row.website);
  const description = String(row.description ?? '').trim().slice(0, 500) || null;
  const stage = [...STAGES].find((s) => s.toLowerCase() === String(row.stage ?? '').trim().toLowerCase()) ?? null;
  const evidence = [];
  if (description) evidence.push({ field: 'description', value: description, confidence: 'low', note: 'Submitted by the company or founder.' });
  if (website) evidence.push({ field: 'website', value: website, confidence: 'low', note: 'Submitted by the company or founder; not yet checked against the site.' });
  if (stage) evidence.push({ field: 'stage', value: stage, confidence: 'low', note: 'Submitted by the company or founder.' });
  return {
    key: String(row.id), name, website, description, url: null, title: `Submission: ${name}`,
    observed_at: row.submittedAt ?? retrievedAt, retrieved_at: retrievedAt, publisher: 'Submission form',
    evidence, text: description ?? '', extraction: { method: 'submission', agreed: false },
  };
}

export function createSubmissionsSource(config, env = process.env) {
  const { id, region = 'AU', url, file = DEFAULT_FILE, admin_key_env: adminKeyEnv = 'ADMIN_KEY', timeoutMs = 20000 } = config;
  return {
    id, kind: 'user_supplied', region, license: config.license,
    async discover(ctx) {
      let rows;
      if (url) {
        const key = env[adminKeyEnv];
        if (!key) throw new Error(`set ${adminKeyEnv} in the environment to read submissions from ${url}`);
        const res = await (ctx.fetchImpl ?? globalThis.fetch)(url, { headers: { 'x-admin-key': key, accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
        if (!res.ok) throw new Error(`the submissions API answered HTTP ${res.status}`);
        rows = (await res.json()).results ?? [];
      } else {
        try { rows = JSON.parse(await readFile(file, 'utf-8')); } catch (err) { if (err.code === 'ENOENT') rows = []; else throw err; }
      }
      const retrievedAt = new Date(ctx.now()).toISOString();
      return rows.filter((r) => !r.status || r.status === 'pending').map((r) => submissionToLead(r, { retrievedAt })).filter(Boolean);
    },
  };
}
