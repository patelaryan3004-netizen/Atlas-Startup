// Who might benefit from meeting, and which projects might suit someone: plain, deterministic rules over what members chose to say about themselves. No model, no hidden score, no data from
// anywhere else, and every match says in a sentence or two why it was suggested. The same two profiles always give the same answer.
//
// What counts, in points (a pair needs 4 or more, and at least one reason that is about what they want or what they can do, so sharing a city alone is never a match):
//   goals          +3 for each of up to two pairs of goals that fit: the same goal ("you both want to find a co-founder"), or complementary ones ("you want to find a startup job; they want
//                  to find talent for their team")
//   skills         +2 for each skill (up to two) that one brings and the other does not list, when the other is looking for people to build with, a co-founder, contributors or talent
//   interests      +2 for each sector (up to two) they both chose
//   place          +2 for the same city; else +1 when both are open to working remotely
//   how they work  +1 for each way of working they both chose (feedback, collaborators, work, conversations), up to two
// Only members who chose to be listed are suggested, never yourself, never someone suspended, and never someone you already have an introduction with.
import { INTENTS, skillLabel } from './taxonomy.js';

export const MIN_SCORE = 4;

// Which goals fit which. A goal fits itself where two people want the same thing (a co-founder, someone to build with, feedback, a meeting); the others are one side of a pair.
const FITS = {
  cofounder: ['cofounder'],
  'build-with': ['build-with', 'cofounder', 'contribute'],
  contribute: ['build-with', 'cofounder'],
  job: ['talent'],
  talent: ['job', 'contribute'],
  meet: ['meet', 'build-with', 'feedback'],
  feedback: ['feedback', 'meet', 'build-with'],
  explore: [],
};
// Goals that are about wanting other people's skills.
const WANTS_SKILLS = new Set(['cofounder', 'build-with', 'contribute', 'talent']);
const phrase = (id, who) => INTENTS.find((i) => i.id === id)?.[who] ?? id;
const sentence = (s) => `${s[0].toUpperCase()}${s.slice(1)}`;
// A skill's name inside a sentence: lower case, except an acronym (AI).
const inline = (id) => { const l = skillLabel(id); return /^[A-Z]{2,}/.test(l) ? l : `${l[0].toLowerCase()}${l.slice(1)}`; };
const list = (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

const set = (a) => new Set(a ?? []);
const both = (a, b) => [...set(a)].filter((x) => set(b).has(x));

// Two profiles (a is who is asking), as { score, reasons[], substance }.
export function matchPair(a, b) {
  const reasons = [];
  let score = 0;
  let substance = false;

  // goals
  const pairs = [];
  for (const ga of a.looking_for ?? []) for (const gb of b.looking_for ?? []) if ((FITS[ga] ?? []).includes(gb)) pairs.push([ga, gb]);
  pairs.sort((x, y) => Number(y[0] === y[1]) - Number(x[0] === x[1]));
  for (const [ga, gb] of pairs.slice(0, 2)) {
    score += 3; substance = true;
    reasons.push(ga === gb ? sentence(`you both want to ${phrase(ga, 'you')}.`.replace('your team', 'your teams')) : sentence(`you want to ${phrase(ga, 'you')}; they want to ${phrase(gb, 'they')}.`));
  }

  // skills: what they bring that I do not list (when I want skills), and what I bring that they do not list (when they do)
  const theyBring = (a.looking_for ?? []).some((g) => WANTS_SKILLS.has(g)) ? (b.skills ?? []).filter((s) => !set(a.skills).has(s)) : [];
  const iBring = (b.looking_for ?? []).some((g) => WANTS_SKILLS.has(g)) ? (a.skills ?? []).filter((s) => !set(b.skills).has(s)) : [];
  const brought = [...theyBring.slice(0, 2).map((s) => ({ s, who: 'they' })), ...iBring.slice(0, 2).map((s) => ({ s, who: 'you' }))].slice(0, 2);
  for (const { s, who } of brought) {
    score += 2; substance = true;
    reasons.push(who === 'they' ? `They bring ${inline(s)}, which you do not list.` : `You bring ${inline(s)}, which they do not list.`);
  }

  // interests
  const sharedInterests = both(a.interests, b.interests).slice(0, 2);
  if (sharedInterests.length) { score += 2 * sharedInterests.length; reasons.push(`You both care about ${list(sharedInterests)}.`); }

  // place
  if (a.city && b.city && a.city.toLowerCase() === b.city.toLowerCase()) { score += 2; reasons.push(`You are both in ${a.city}.`); } else if (a.remote && b.remote) { score += 1; reasons.push('You are both open to working remotely.'); }

  // how they work
  const ways = both(a.open_to, b.open_to).slice(0, 2);
  if (ways.length) {
    score += ways.length;
    const words = { feedback: 'giving and getting feedback', collaborators: 'finding collaborators', work: 'work', conversations: 'conversations' };
    reasons.push(`You are both open to ${list(ways.map((w) => words[w] ?? w))}.`);
  }
  return { score, reasons, substance };
}

// People to meet for `me`: listed members, best match first (ties by who joined most recently, then by id), each with up to three reasons.
export function recommendMembers(data, me, { limit = 6, exclude = [], toPublic } = {}) {
  const skip = new Set([me.id, ...exclude]);
  for (const i of data.introductions ?? []) { if (i.from === me.id) skip.add(i.to); if (i.to === me.id) skip.add(i.from); }
  return data.members
    .filter((m) => m.listed && !m.suspended && !skip.has(m.id))
    .map((m) => ({ m, ...matchPair(me, m) }))
    .filter((r) => r.score >= MIN_SCORE && r.substance)
    .sort((x, y) => y.score - x.score || y.m.created_at.localeCompare(x.m.created_at) || x.m.id.localeCompare(y.m.id))
    .slice(0, limit)
    .map((r) => ({ member: toPublic(r.m), score: r.score, why: r.reasons.slice(0, 3) }));
}

// Projects that might suit `me`: the skills a project asks for that I have, the kind of help it asks for against what I want, the sectors and the place.
const HELP_FITS = { cofounder: ['cofounder'], contributor: ['contribute', 'build-with'], teammate: ['job'], advisor: ['meet'], feedback: ['feedback'] };
const HELP_WORDS = { cofounder: 'a co-founder', contributor: 'contributors', teammate: 'early team members', advisor: 'an advisor or mentor', feedback: 'feedback or testers' };
export function recommendProjects(data, me, { limit = 6, toProject } = {}) {
  return data.projects
    .filter((p) => p.status === 'visible' && p.open && p.author_id !== me.id && !data.members.find((m) => m.id === p.author_id)?.suspended)
    .filter((p) => !data.interests.some((i) => i.project_id === p.id && i.member_id === me.id))
    .map((p) => {
      const reasons = [];
      let score = 0;
      let substance = false;
      const skills = both(me.skills, p.skills_needed).slice(0, 2);
      if (skills.length) { score += 3 * skills.length; substance = true; reasons.push(`It needs ${list(skills.map(inline))}, which you bring.`); }
      const help = p.collaboration.find((c) => (HELP_FITS[c] ?? []).some((g) => (me.looking_for ?? []).includes(g)));
      if (help) { score += 3; substance = true; reasons.push(`It is looking for ${HELP_WORDS[help]}, and you want to ${phrase((me.looking_for ?? []).find((g) => (HELP_FITS[help] ?? []).includes(g)), 'you')}.`); }
      const sectors = both(me.interests, p.interests).slice(0, 2);
      if (sectors.length) { score += 2 * sectors.length; reasons.push(`It is in ${list(sectors)}, which you care about.`); }
      if (me.city && p.city && me.city.toLowerCase() === p.city.toLowerCase()) { score += 2; reasons.push(`It is in ${p.city}, where you are.`); } else if (me.remote && p.remote) { score += 1; reasons.push('It can be done remotely, and so can you.'); }
      return { p, score, reasons, substance };
    })
    .filter((r) => r.score >= MIN_SCORE - 1 && r.substance)
    .sort((x, y) => y.score - x.score || y.p.created_at.localeCompare(x.p.created_at) || x.p.id.localeCompare(y.p.id))
    .slice(0, limit)
    .map((r) => ({ project: toProject(r.p), score: r.score, why: r.reasons.slice(0, 3) }));
}
