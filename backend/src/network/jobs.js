// Opportunities → Jobs: individual open roles, each one read from a company's own careers page, with the company, where it is, what the page says about the
// role, why it is listed and when it was last read. Applications go to the employer: the apply link is the employer's own.
//
// What is NOT here is as plain as what is: no salary (no page we read states one in a form we keep), no years-of-experience requirement (the level is only
// what the TITLE says, and is called that), and no working arrangement unless the listing says remote. A missing fact is said as "not stated", never guessed.
import { cleanText, httpsUrl, oneOf, bad } from './validate.js';

export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contract', 'internship', 'fixed_term'];
export const EMPLOYMENT_LABELS = { full_time: 'Full-time', part_time: 'Part-time', contract: 'Contract', internship: 'Internship', fixed_term: 'Fixed term' };
export const LEVELS = ['intern', 'graduate', 'junior', 'mid', 'senior', 'lead', 'head'];
export const LEVEL_LABELS = { intern: 'Intern', graduate: 'Graduate', junior: 'Junior', mid: 'Mid-level', senior: 'Senior', lead: 'Lead or principal', head: 'Head or director' };
export const STALE_DAYS = 14; // the site's own window for "hiring now" (backend/src/app.js HIRING_WINDOW_DAYS)

// What the listing's own words say about the kind of employment, into our few kinds. Anything else (an unknown word, a placeholder) is "not stated".
export function employmentOf(text) {
  const t = String(text ?? '').toLowerCase().replace(/[_-]+/g, ' ').trim();
  if (!t) return null;
  if (/\bintern/.test(t)) return 'internship';
  if (/\bfixed term/.test(t)) return 'fixed_term';
  if (/\bpart time/.test(t)) return 'part_time';
  if (/\bcontract|\bcasual/.test(t)) return 'contract';
  if (/\bfull time/.test(t)) return 'full_time';
  return null;
}

// The level the TITLE names. A title that names none gives none: this is not a judgement of the role.
export function levelOf(title) {
  const t = String(title ?? '').toLowerCase();
  if (/\bintern(ship)?\b/.test(t)) return 'intern';
  if (/\b(graduate|grad)\b/.test(t)) return 'graduate';
  if (/\b(junior|jr\.?|entry[- ]level)\b/.test(t)) return 'junior';
  if (/\b(head of|director|vp|vice president|chief|cto|ceo|coo|cfo|cmo)\b/.test(t)) return 'head';
  if (/\b(principal|lead)\b/.test(t)) return 'lead'; // not "manager" or "staff": an Account Manager or a Staff Accountant is not named a level
  if (/\b(senior|sr\.?)\b/.test(t)) return 'senior';
  if (/\b(mid|intermediate|ii|iii)\b/.test(t)) return 'mid';
  return null;
}

// A row that is a page and not a role: a talent community, a general application, "Other careers in the US", "Acme Careers". Such a row is not listed.
const GENERIC = [
  /\btalent (community|pool|network)\b/i, /\bfuture (job )?(openings|opportunities|roles)\b/i, /\bother careers?\b/i, /\bgeneral application\b/i,
  /\bexpressions? of interest\b/i, /\bjoin (our|the) (talent|team|community|mailing)\b/i, /\bnothing (here|for you)\b/i, /\bcareers?$/i,
  /\b(all|open|current) (jobs|roles|positions|vacancies)\b/i,
];
export const isGenericListing = (title) => GENERIC.some((re) => re.test(String(title ?? '').trim()));

// Where a role is: Australia when the listing's place names it (the country, a state or a capital), elsewhere when it names a place that is not, and nothing
// when it names none. A listing with several places says "Australia" if any one of them is.
const AU = /\baustralia\b|\b(nsw|vic|qld|tas|act)\b|\b(sydney|melbourne|brisbane|perth|adelaide|canberra|hobart|darwin|gold coast|newcastle|geelong|wollongong)\b|\bnew south wales\b|\bvictoria,|\bqueensland\b|\bwestern australia\b|\bsouth australia\b/i;
export function regionOf(location) {
  const text = String(location ?? '').trim();
  if (!text) return null;
  if (AU.test(text)) return 'au';
  if (/^remote\b/i.test(text) && !/,/.test(text)) return null; // "Remote" alone: no place
  return 'other';
}

const BOARDS = [
  [/greenhouse\.io/, 'Greenhouse'], [/lever\.co/, 'Lever'], [/ashbyhq\.com/, 'Ashby'], [/workable\.com/, 'Workable'], [/recruitee\.com/, 'Recruitee'],
  [/smartrecruiters\.com/, 'SmartRecruiters'], [/bamboohr\.com/, 'BambooHR'], [/teamtailor\.com/, 'Teamtailor'], [/pinpointhq\.com/, 'Pinpoint'],
];
const boardOf = (url) => { try { const host = new URL(url).hostname; return BOARDS.find(([re]) => re.test(host))?.[1] ?? null; } catch (e) { return null; } };
const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return null; } };

const dayOf = (iso) => String(iso ?? '').slice(0, 10);
export const daysSince = (iso, now) => Math.floor((now - Date.parse(iso)) / 86400000);

// The sentence that says why a role is listed. It states facts, never praise.
function whyListed(company, apply, checked) {
  const board = boardOf(apply);
  const where = board ? `${company}'s own careers page on ${board}` : `${company}'s own careers page (${hostOf(apply) ?? 'its website'})`;
  return `Listed on ${where}, last read ${checked}. ${company} is in the Still Early directory.`;
}

// One role as a visitor sees it. `card` is the company's directory card (or null for a role someone suggested for a company the directory does not hold).
export function presentJob(job, card, now = Date.now()) {
  const apply = job.apply_url;
  const checked = dayOf(job.retrieved_at);
  const company = card?.name ?? job.company_name ?? 'The employer';
  const age = checked ? daysSince(job.retrieved_at, now) : null;
  return {
    id: job.id, title: job.title,
    company: { name: company, slug: card?.slug ?? null, city: card?.city ?? '', sector: card?.sector ?? '', stage: card?.stage ?? '', website: card?.website ?? '' },
    location: job.location ?? '', region: regionOf(job.location), remote: job.remote === true ? true : null,
    employment_type: employmentOf(job.employment_type), level: levelOf(job.title), salary: job.salary ?? null,
    why_listed: job.why ?? whyListed(company, apply, checked), apply_url: apply, source_kind: job.source ?? 'careers_page',
    last_checked_at: job.retrieved_at ?? null, days_since_checked: age, stale: age != null ? age > STALE_DAYS : true,
    status: job.status, posted_at: job.posted_at ?? null,
  };
}

// The roles to show: open ones, each at a company in the directory, in order of company then title (an order, not a ranking). Closed roles are left out unless asked for,
// and then marked closed.
export function curatedJobs({ jobs, cardOf, extra = [], now = Date.now(), includeClosed = false }) {
  const rows = [];
  for (const j of jobs) {
    if (!j.apply_url || !/^https:\/\//.test(j.apply_url) || !j.title || isGenericListing(j.title)) continue;
    if (j.status !== 'open' && !(includeClosed && j.status === 'closed')) continue;
    const card = cardOf(j.company_id);
    if (!card) continue; // a role at a company the directory does not hold is not listed
    rows.push(presentJob(j, card, now));
  }
  for (const j of extra) rows.push(presentJob({ ...j, source: 'suggestion' }, null, now));
  return rows.sort((a, b) => a.company.name.localeCompare(b.company.name) || a.title.localeCompare(b.title));
}

export function filterJobs(list, { search = '', city = '', sector = '', stage = '', type = '', level = '', remote = '', company = '', where = '' } = {}) {
  const q = search.trim().toLowerCase();
  return list.filter((j) => (!q || [j.title, j.company.name, j.location].join(' ').toLowerCase().includes(q))
    && (!where || (where === 'au' ? j.region === 'au' : j.region === 'other'))
    && (!city || j.company.city.toLowerCase() === city.toLowerCase())
    && (!sector || j.company.sector === sector) && (!stage || j.company.stage === stage)
    && (!type || j.employment_type === type) && (!level || j.level === level)
    && (remote !== 'yes' || j.remote === true) && (!company || j.company.slug === company || j.company.name === company));
}

export function jobFacets(list) {
  const count = (pick) => { const m = new Map(); for (const j of list) { const v = pick(j); if (v) m.set(v, (m.get(v) ?? 0) + 1); } return [...m].map(([value, n]) => ({ value, count: n })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)); };
  return {
    cities: count((j) => j.company.city), sectors: count((j) => j.company.sector), stages: count((j) => j.company.stage),
    types: count((j) => j.employment_type).map((t) => ({ ...t, label: EMPLOYMENT_LABELS[t.value] })),
    levels: count((j) => j.level).map((t) => ({ ...t, label: LEVEL_LABELS[t.value] })),
    remote: list.filter((j) => j.remote === true).length,
    regions: { au: list.filter((j) => j.region === 'au').length, other: list.filter((j) => j.region === 'other').length },
    stale: list.filter((j) => j.stale).length,
    latest_checked_at: list.map((j) => j.last_checked_at).filter(Boolean).sort().at(-1) ?? null,
  };
}

// What a visitor may say about a role they would like listed.
export function jobSuggestion(input) {
  const o = input ?? {};
  return {
    title: cleanText(o.title, { name: 'Role title', min: 3, max: 120, required: true }),
    company: cleanText(o.company, { name: 'Company', min: 2, max: 100, required: true }),
    location: cleanText(o.location, { name: 'Location', max: 100 }),
    remote: o.remote === true ? true : null,
    employment_type: o.employment_type ? oneOf(o.employment_type, EMPLOYMENT_TYPES, 'Employment type') : '',
    apply_url: httpsUrl(o.apply_url, { name: 'Application link', required: true }),
    note: cleanText(o.note, { name: 'Note', max: 400, multiline: true }),
  };
}

export const SUGGESTED_JOB_REQUIRED = ['title', 'company_name', 'apply_url', 'retrieved_at', 'why'];
export function suggestedJobProblems(j) {
  const out = [];
  if (!j.title || j.title.length < 3) out.push('title');
  if (!j.company_name || j.company_name.length < 2) out.push('company_name');
  if (!/^https:\/\/\S+$/.test(j.apply_url ?? '')) out.push('apply_url: https');
  if (!/^\d{4}-\d{2}-\d{2}/.test(j.retrieved_at ?? '')) out.push('retrieved_at: the day the page was read');
  if (!j.why || j.why.trim().length < 10) out.push('why: why it is listed');
  return out;
}
export const assertJob = (j) => { const p = suggestedJobProblems(j); if (p.length) throw bad(`These need fixing: ${p.join('; ')}.`); };
