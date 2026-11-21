// The fixed vocabularies of the community: what a visitor can say they want to do, which skills and interests a member can name, and what a project can ask for. They are closed lists on purpose:
// matching (matching.js) compares ids, so two people who both pick "Fintech" or "Design" really do match, and nothing depends on how someone happened to spell a word. Interests are the twelve
// display sectors of the directory (models/sectors.js), so an interest also names companies the directory holds.
import { SECTOR_GROUPS } from '../models/sectors.js';

// The eight things a visitor can come for. `you`/`they` complete "You want to ...; they want to ...": the sentence a match explains itself with.
export const INTENTS = [
  { id: 'build-with', label: 'Find people to build with', you: 'find people to build with', they: 'find people to build with' },
  { id: 'cofounder', label: 'Find a co-founder', you: 'find a co-founder', they: 'find a co-founder' },
  { id: 'contribute', label: 'Contribute to a startup', you: 'contribute to a startup', they: 'contribute to a startup' },
  { id: 'job', label: 'Find a startup job', you: 'find a startup job', they: 'find a startup job' },
  { id: 'meet', label: 'Meet founders or investors', you: 'meet founders or investors', they: 'meet founders or investors' },
  { id: 'feedback', label: 'Get feedback on an idea', you: 'get feedback on an idea', they: 'get feedback on an idea' },
  { id: 'talent', label: 'Find talent for my team', you: 'find talent for your team', they: 'find talent for their team' },
  { id: 'explore', label: 'Explore the ecosystem', you: 'explore the ecosystem', they: 'explore the ecosystem' },
];
export const INTENT_IDS = INTENTS.map((i) => i.id);

export const SKILLS = [
  { id: 'engineering', label: 'Engineering' },
  { id: 'product', label: 'Product' },
  { id: 'design', label: 'Design' },
  { id: 'marketing', label: 'Marketing & growth' },
  { id: 'sales', label: 'Sales' },
  { id: 'operations', label: 'Operations' },
  { id: 'finance', label: 'Finance' },
  { id: 'legal', label: 'Legal' },
  { id: 'data', label: 'Data & analytics' },
  { id: 'ai', label: 'AI & machine learning' },
  { id: 'hardware', label: 'Hardware & electronics' },
  { id: 'science', label: 'Science & research' },
];
export const SKILL_IDS = SKILLS.map((s) => s.id);
export const skillLabel = (id) => SKILLS.find((s) => s.id === id)?.label ?? id;

// The twelve display sectors, by name: an interest is the sector's name.
export const INTERESTS = [...SECTOR_GROUPS];

// What a project can ask for, and how far along it is.
export const COLLABORATION = [
  { id: 'cofounder', label: 'A co-founder' },
  { id: 'contributor', label: 'A contributor, part-time or for a project' },
  { id: 'teammate', label: 'An early team member' },
  { id: 'advisor', label: 'An advisor or mentor' },
  { id: 'feedback', label: 'Feedback or testers' },
];
export const COLLABORATION_IDS = COLLABORATION.map((c) => c.id);
export const STAGES = [
  { id: 'idea', label: 'An idea' },
  { id: 'prototype', label: 'A prototype' },
  { id: 'building', label: 'Being built' },
  { id: 'launched', label: 'Launched' },
];
export const STAGE_IDS = STAGES.map((s) => s.id);
