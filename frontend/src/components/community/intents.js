// What a visitor can come to the Community for, and what each choice shows them. The choice is optional, can be changed or cleared at any time, and is kept only in this browser (and in the
// address, ?for=<id>, so a link carries it). There is no sign-up step, no question after it, and nothing is sent anywhere when a choice is made.
//
// What a choice changes is plain and written down here, so it can be checked: which sections of the page lead ("blocks"), which kind of project to look for, which sort of person to show first,
// and one sentence saying what the choice brings. It never hides the rest of the page and never says something that is not so.

export const INTENTS = [
  { id: 'build-with', label: 'Find people to build with' },
  { id: 'cofounder', label: 'Find a co-founder' },
  { id: 'contribute', label: 'Contribute to a startup' },
  { id: 'job', label: 'Find a startup job' },
  { id: 'meet', label: 'Meet founders or investors' },
  { id: 'feedback', label: 'Get feedback on an idea' },
  { id: 'talent', label: 'Find talent for my team' },
  { id: 'explore', label: 'Explore the ecosystem' },
];
export const INTENT_IDS = INTENTS.map((i) => i.id);
export const labelOf = (id) => INTENTS.find((i) => i.id === id)?.label ?? '';

// The blocks the "For you" section can show, in the order a choice puts them:
//   projects   projects and collaboration requests members shared (needs the members' side open)
//   members    members who chose to be listed (the same)
//   ideas      the short posts members wrote (the same)
//   products   verified companies in the directory, those with a picture first (not a ranking)
//   new        companies added to the directory in the last week
//   hiring     companies with open roles, read from their own job pages
//   roles      the newest roles on the hiring desk
//   founders   founders named on public company pages (not members)
//   investors  investor firms in the directory that have been published
//   lists      collections of companies and investors, each defined by a filter (always in the right rail, and in full under "Curated lists")
//   events     upcoming events from organisers' own pages
export const PLANS = {
  none: { lead: 'A few places to start: what is new, what is being built, and what members are asking for help with.', blocks: ['new', 'products', 'projects'] },
  'build-with': { lead: 'Projects asking for collaborators, and members who say they want to build with others.', blocks: ['projects', 'members', 'ideas'], help: 'contributor', people: 'members' },
  cofounder: { lead: 'Projects looking for a co-founder, and members who are looking for one too.', blocks: ['projects', 'members', 'ideas'], help: 'cofounder', people: 'members' },
  contribute: { lead: 'Projects asking for contributors, and startups with open roles.', blocks: ['projects', 'hiring', 'products'], help: 'contributor', people: 'founders' },
  job: { lead: 'Open roles at Australian startups, read from each company’s own job page.', blocks: ['roles', 'hiring', 'events'], people: 'founders' },
  meet: { lead: 'Founders and investors named on public pages, and events where people meet.', blocks: ['founders', 'investors', 'events'], people: 'both' },
  feedback: { lead: 'Members asking for feedback, and ideas people are sharing.', blocks: ['ideas', 'projects', 'events'], help: 'feedback', people: 'members' },
  talent: { lead: 'Members who are open to work, and where to list a role.', blocks: ['members', 'projects', 'hiring'], help: 'teammate', people: 'members' },
  explore: { lead: 'Products built in Australia, what is new, and the investors in the directory. The collections are on the right.', blocks: ['products', 'new', 'investors'], people: 'both' },
};
export const planFor = (id) => PLANS[id] ?? PLANS.none;

// Words in an event's audience that make it fit a choice. Only the order changes: an event that fits none is still shown.
export const EVENT_WORDS = {
  meet: /founder|investor|network|meetup/i,
  'build-with': /founder|builder|maker|developer|network/i,
  cofounder: /founder|co-?found|network/i,
  contribute: /founder|startup|builder|developer/i,
  job: /student|graduate|career|talent|hiring|job/i,
  feedback: /founder|pitch|startup/i,
  talent: /talent|hiring|student|graduate|developer/i,
  explore: /./,
};

const KEY = 'stillEarlyCommunityIntent';
const storage = () => { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch (e) { return null; } };

// The choice a visit starts with: the address wins (a shared link), then what this browser remembered, else none.
export function readIntent(search = typeof window === 'undefined' ? '' : window.location.search) {
  const asked = new URLSearchParams(search).get('for');
  if (INTENT_IDS.includes(asked)) return asked;
  try { const kept = storage()?.getItem(KEY); return INTENT_IDS.includes(kept) ? kept : ''; } catch (e) { return ''; }
}

// Remembers the choice (or clears it) in this browser, and writes it to the address without adding a history step.
export function writeIntent(id) {
  try { if (id) storage()?.setItem(KEY, id); else storage()?.removeItem(KEY); } catch (e) { /* a browser that will not keep it: the choice lasts for the visit */ }
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (id) url.searchParams.set('for', id); else url.searchParams.delete('for');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}
