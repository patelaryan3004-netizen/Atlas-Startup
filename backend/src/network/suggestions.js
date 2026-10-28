// Suggestions for a job or an event. They go into a queue and are shown to nobody until a person has read them, checked them against the employer's or
// organiser's own page, and completed what the page needs (the day it was checked, why it is listed). Approving one makes a real listing; rejecting says why.
import { bad, cleanText, forbidden, looksLikeEmail, makeId, notFound, oneOf } from './validate.js';
import { eventProblems, eventSuggestion, AU_ZONES, COST_STATUSES } from './events.js';
import { jobSuggestion, suggestedJobProblems, employmentOf } from './jobs.js';

export const KINDS = ['job', 'event'];

export function createSuggestion(draft, { kind, fields, memberId = null, email = '' }, now = Date.now()) {
  oneOf(kind, KINDS, 'Kind');
  const data = kind === 'job' ? jobSuggestion(fields) : eventSuggestion(fields);
  const contact = cleanText(email, { name: 'Email', max: 254 });
  if (contact && !looksLikeEmail(contact)) throw bad('That does not look like an email address. Leave it empty if you would rather not give one.');
  if (draft.suggestions.filter((s) => s.status === 'pending').length >= 500) throw forbidden('The review queue is full right now. Try again later.');
  const suggestion = {
    id: makeId('sg', now), kind, data, member_id: memberId, contact_email: contact, status: 'pending', created_at: new Date(now).toISOString(),
    reviewed_at: null, review_note: '', published_id: null,
  };
  draft.suggestions.push(suggestion);
  return { id: suggestion.id, status: 'pending' };
}

export function pendingSuggestions(data) {
  return data.suggestions.filter((s) => s.status === 'pending').sort((a, b) => a.id.localeCompare(b.id))
    .map((s) => ({ id: s.id, kind: s.kind, data: s.data, contact_email: s.contact_email, member_id: s.member_id, created_at: s.created_at }));
}

const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

// What approving needs on top of the suggestion: a reviewer's own checks. For an event: the time zone, who it is for, why it is listed, the day it was
// checked, the page it was read from and what it costs. For a job: the day it was checked and why it is listed. A missing one is a refusal that names it.
export function approveSuggestion(draft, id, completed = {}, { actor = 'admin' } = {}, now = Date.now()) {
  const s = draft.suggestions.find((x) => x.id === id);
  if (!s || s.status !== 'pending') throw notFound('That suggestion is not waiting for review.');
  const at = new Date(now).toISOString();
  if (s.kind === 'event') {
    const cost = completed.cost ?? { status: 'unconfirmed' };
    const event = {
      id: completed.id || `${slug(s.data.name)}-${s.data.starts.slice(0, 10)}`, name: completed.name ?? s.data.name, organiser: completed.organiser ?? s.data.organiser,
      type: completed.type ?? s.data.type, format: completed.format ?? s.data.format, city: completed.city ?? s.data.city, venue: completed.venue ?? s.data.venue,
      online_url: completed.online_url ?? '', timezone: completed.timezone, starts: completed.starts ?? s.data.starts, ends: completed.ends ?? (s.data.ends || undefined),
      cost: { status: oneOf(cost.status, COST_STATUSES, 'Cost'), ...(cost.amount != null ? { amount: cost.amount } : {}), ...(cost.note ? { note: cost.note } : {}) },
      audience: completed.audience, why_selected: completed.why_selected, registration_url: completed.registration_url ?? s.data.registration_url,
      source_url: completed.source_url ?? s.data.registration_url, source_checked_at: completed.source_checked_at, status: 'published', origin: 'suggestion', added_at: at,
    };
    if (event.timezone && !AU_ZONES.includes(event.timezone) && event.format !== 'online') throw bad(`timezone: an Australian event is in one of ${AU_ZONES.join(', ')}.`);
    const problems = eventProblems(event);
    if (problems.length) throw bad(`These need fixing before it can be listed: ${problems.join('; ')}.`);
    if (draft.events.some((e) => e.id === event.id)) throw bad('An event with that id is already listed.');
    draft.events.push(event);
    s.published_id = event.id;
  } else {
    const job = {
      id: completed.id || `${slug(s.data.company)}-${slug(s.data.title)}`, title: completed.title ?? s.data.title, company_name: completed.company_name ?? s.data.company,
      location: completed.location ?? s.data.location, remote: completed.remote ?? s.data.remote, employment_type: completed.employment_type ?? s.data.employment_type,
      apply_url: completed.apply_url ?? s.data.apply_url, retrieved_at: completed.retrieved_at, why: completed.why, status: 'open', posted_at: null,
    };
    if (job.employment_type && !employmentOf(job.employment_type) && !['full_time', 'part_time', 'contract', 'internship', 'fixed_term'].includes(job.employment_type)) job.employment_type = '';
    const problems = suggestedJobProblems(job);
    if (problems.length) throw bad(`These need fixing before it can be listed: ${problems.join('; ')}.`);
    if (draft.jobs.some((j) => j.id === job.id)) throw bad('A role with that id is already listed.');
    draft.jobs.push(job);
    s.published_id = job.id;
  }
  s.status = 'approved';
  s.reviewed_at = at;
  s.review_note = cleanText(completed.review_note, { name: 'Note', max: 300 });
  draft.audit.push({ at, actor, action: `suggestion.approve.${s.kind}`, target: s.id, note: s.review_note });
  return { published_id: s.published_id };
}

export function rejectSuggestion(draft, id, { note = '', actor = 'admin' } = {}, now = Date.now()) {
  const s = draft.suggestions.find((x) => x.id === id);
  if (!s || s.status !== 'pending') throw notFound('That suggestion is not waiting for review.');
  s.status = 'rejected';
  s.reviewed_at = new Date(now).toISOString();
  s.review_note = cleanText(note, { name: 'Note', max: 300 });
  draft.audit.push({ at: s.reviewed_at, actor, action: `suggestion.reject.${s.kind}`, target: s.id, note: s.review_note });
}

// A listing taken down again: an approved event or job comes out, with a note.
export function withdrawListing(draft, kind, id, { actor = 'admin', note = '' } = {}, now = Date.now()) {
  const list = kind === 'event' ? draft.events : draft.jobs;
  const item = list.find((x) => x.id === id);
  if (!item) throw notFound('That listing is not there.');
  if (kind === 'event') item.status = 'cancelled'; else item.status = 'closed';
  draft.audit.push({ at: new Date(now).toISOString(), actor, action: `listing.withdraw.${kind}`, target: id, note: cleanText(note, { name: 'Note', max: 300 }) });
}
