// Projects and ideas a member shares to find people to work with, and the "I'm interested" a signed-in member can add to one.
//
// A project says what it is, the problem it is for, how far along it is, which skills it needs, what kind of help it is asking for, and where (a city, or remote). It is what the member wrote:
// nothing here is checked, endorsed or ranked by the site, and a list of projects is in the order they were shared, newest first. "I'm interested" tells the person who shared it that someone
// would like to talk; it shares no contact detail (an introduction does, and only when both agree: introductions.js).
//
// `status` is moderation, as for a post (visible, hidden by reports or a moderator, removed, deleted); `open` is whether the member is still looking for people.
import { bad, cleanText, oneOf, notFound, forbidden, makeId, initialsOf } from './validate.js';
import { SKILL_IDS, COLLABORATION_IDS, STAGE_IDS, INTERESTS } from './taxonomy.js';

export const MAX_OPEN_PROJECTS = 5; // a member's projects that are open at once
export const MAX_INTERESTS_GIVEN = 30; // projects one member can be interested in at once

const pickList = (value, allowed, name, max) => {
  if (!Array.isArray(value)) throw bad(`${name} must be a list.`);
  const ids = [...new Set(value.map((v) => oneOf(v, allowed, name)))];
  if (ids.length > max) throw bad(`Choose up to ${max} for ${name.toLowerCase()}.`);
  return ids;
};

// The fields of a project, checked. `partial`: an edit may leave any of them out; a new project must give the required ones.
export function projectChanges(input, { partial = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw bad('Send the project as an object.');
  const out = {};
  const has = (k) => k in input;
  if (!partial || has('name')) out.name = cleanText(input.name, { name: 'Project name', min: 3, max: 80, required: true });
  if (!partial || has('summary')) out.summary = cleanText(input.summary, { name: 'Description', min: 20, max: 600, multiline: true, required: true });
  if (!partial || has('problem')) out.problem = cleanText(input.problem, { name: 'The problem it solves', max: 300, multiline: true });
  if (!partial || has('stage')) out.stage = oneOf(input.stage, STAGE_IDS, 'Stage');
  if (!partial || has('skills_needed')) out.skills_needed = pickList(input.skills_needed ?? [], SKILL_IDS, 'Skills needed', 6);
  if (!partial || has('collaboration')) {
    out.collaboration = pickList(input.collaboration ?? [], COLLABORATION_IDS, 'Type of collaboration', 3);
    if (!out.collaboration.length) throw bad('Say what kind of help you are looking for.');
  }
  if (!partial || has('interests')) out.interests = pickList(input.interests ?? [], INTERESTS, 'Sectors', 3);
  if (!partial || has('city')) out.city = cleanText(input.city, { name: 'City', max: 60 });
  if (!partial || has('remote')) {
    const remote = input.remote ?? false;
    if (typeof remote !== 'boolean') throw bad('Remote must be true or false.');
    out.remote = remote;
  }
  if (!partial && !out.city && !out.remote) throw bad('Say where the work happens: a city, or remote.');
  if (has('open')) {
    if (typeof input.open !== 'boolean') throw bad('Open must be true or false.');
    out.open = input.open;
  }
  return out;
}

const ownerOf = (data, project) => {
  const m = data.members.find((x) => x.id === project.author_id);
  return m ? { id: m.id, name: m.name, initials: initialsOf(m.name), role: m.role, city: m.city } : { id: null, name: 'Former member', initials: '', role: '', city: '' };
};

// What anyone may see of a project. `viewer`: the member asking, if any, for whether they are interested and whether it is theirs.
export function publicProject(data, project, viewer = null) {
  const interested = data.interests.filter((i) => i.project_id === project.id);
  return {
    id: project.id, name: project.name, summary: project.summary, problem: project.problem, stage: project.stage, skills_needed: project.skills_needed,
    collaboration: project.collaboration, interests: project.interests ?? [], city: project.city, remote: project.remote, open: project.open,
    created_at: project.created_at, owner: ownerOf(data, project), interested_count: interested.length,
    mine: Boolean(viewer && viewer.id === project.author_id), interested: Boolean(viewer && interested.some((i) => i.member_id === viewer.id)),
  };
}

// Projects that can be seen: not removed, hidden or deleted, and shared by a member who is not suspended.
const visible = (data) => data.projects.filter((p) => p.status === 'visible' && !data.members.find((m) => m.id === p.author_id)?.suspended);

export function listProjects(data, { search = '', stage = '', collaboration = '', skill = '', city = '', remote = '', status = 'open', limit = 20, offset = 0, viewer = null } = {}) {
  const q = search.trim().toLowerCase();
  const rows = visible(data)
    .filter((p) => (status === 'open' ? p.open : status === 'closed' ? !p.open : true))
    .filter((p) => !stage || p.stage === stage)
    .filter((p) => !collaboration || p.collaboration.includes(collaboration))
    .filter((p) => !skill || p.skills_needed.includes(skill))
    .filter((p) => !city || p.city.toLowerCase() === city.toLowerCase())
    .filter((p) => remote !== 'yes' || p.remote)
    .filter((p) => !q || [p.name, p.summary, p.problem, p.city].join(' ').toLowerCase().includes(q))
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id));
  return { total: rows.length, results: rows.slice(offset, offset + limit).map((p) => publicProject(data, p, viewer)), offset, limit, hasMore: offset + limit < rows.length };
}

export function getProject(data, id, viewer = null) {
  const p = visible(data).find((x) => x.id === id);
  if (!p) throw notFound('That project is not here.');
  return publicProject(data, p, viewer);
}

export function createProject(draft, member, input, now = Date.now()) {
  const fields = projectChanges(input);
  if (draft.projects.filter((p) => p.author_id === member.id && p.status === 'visible' && p.open).length >= MAX_OPEN_PROJECTS) {
    throw bad(`You have ${MAX_OPEN_PROJECTS} open projects. Close one before you share another.`);
  }
  const at = new Date(now).toISOString();
  const project = { id: makeId('p', now), author_id: member.id, ...fields, open: fields.open ?? true, status: 'visible', created_at: at, updated_at: at };
  draft.projects.push(project);
  return project;
}

const mine = (draft, member, id) => {
  const p = draft.projects.find((x) => x.id === id && x.status !== 'deleted' && x.status !== 'removed');
  if (!p) throw notFound('That project is not here.');
  if (p.author_id !== member.id) throw forbidden('That is not your project.');
  return p;
};

export function editProject(draft, member, id, input, now = Date.now()) {
  const p = mine(draft, member, id);
  Object.assign(p, projectChanges(input, { partial: true }), { updated_at: new Date(now).toISOString() });
  return p;
}

export function deleteProject(draft, member, id) {
  const p = mine(draft, member, id);
  p.status = 'deleted';
  p.summary = ''; p.problem = '';
  draft.interests = draft.interests.filter((i) => i.project_id !== id);
}

// "I'm interested": one per member per project, never on your own, and a limited number at once. Switching it off removes it.
export function setInterest(draft, member, projectId, on, now = Date.now()) {
  const p = draft.projects.find((x) => x.id === projectId && x.status === 'visible' && x.open);
  if (!p) throw notFound('That project is not open.');
  if (p.author_id === member.id) throw bad('That is your own project.');
  const have = draft.interests.find((i) => i.project_id === projectId && i.member_id === member.id);
  if (on && !have) {
    if (draft.interests.filter((i) => i.member_id === member.id).length >= MAX_INTERESTS_GIVEN) throw bad(`You are interested in ${MAX_INTERESTS_GIVEN} projects. Take one off before you add another.`);
    draft.interests.push({ project_id: projectId, member_id: member.id, created_at: new Date(now).toISOString() });
  }
  if (!on && have) draft.interests = draft.interests.filter((i) => i !== have);
  return { interested: on, interested_count: draft.interests.filter((i) => i.project_id === projectId).length };
}

// Who is interested in a project: for the person who shared it, and no one else. Their public profile only, never contact details.
export function interestedIn(data, member, projectId, toPublic) {
  const p = data.projects.find((x) => x.id === projectId && x.status !== 'deleted');
  if (!p) throw notFound('That project is not here.');
  if (p.author_id !== member.id) throw forbidden('Only the person who shared a project can see who is interested.');
  return data.interests.filter((i) => i.project_id === projectId).sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((i) => ({ at: i.created_at, member: data.members.find((m) => m.id === i.member_id) })).filter((r) => r.member && !r.member.suspended)
    .map((r) => ({ at: r.at, member: toPublic(r.member) }));
}
