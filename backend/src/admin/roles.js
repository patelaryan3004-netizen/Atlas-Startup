// Who may do what in the Command Center. Three roles, each able to do everything the one below can:
//
//   viewer    sees everything: the dashboard, the candidates, the evidence, the audit trail
//   reviewer  decides about candidates (still staging data, never public): approve, reject, edit,
//             reopen, add a note, settle a duplicate, queue a read of a website, turn down a suggestion,
//             look an address up on the map (which changes nothing)
//   admin     does what changes what the PUBLIC sees: merge a candidate into a company, publish one,
//             settle a conflict, apply a suggestion to a record, set where a company is on the map,
//             seed and run the enrichment queue
//
// The line is drawn at the public record: until something reaches a company, a mistake costs a reviewer's
// time; once it does, it is on the live site. The check is made in the service, not only in a route, so
// no door into it can skip it.
import { ForbiddenError } from './errors.js';

export const ROLES = ['viewer', 'reviewer', 'admin'];
const RANK = { viewer: 0, reviewer: 1, admin: 2 };

// permission -> the lowest role that holds it. 'read' is everything that only looks.
export const PERMISSIONS = {
  read: 'viewer',
  'candidate.approve': 'reviewer', 'candidate.reject': 'reviewer', 'candidate.reopen': 'reviewer', 'candidate.edit': 'reviewer',
  'candidate.note': 'reviewer', 'candidate.distinct': 'reviewer', 'candidate.enrich': 'reviewer',
  'candidate.merge': 'admin', 'candidate.publish': 'admin',
  'conflict.resolve': 'admin', 'suggestion.apply': 'admin', 'suggestion.dismiss': 'reviewer',
  'location.lookup': 'reviewer', 'location.set': 'admin',
  'enrichment.seed': 'admin', 'enrichment.run': 'admin', 'enrichment.enqueue': 'reviewer', 'enrichment.retry': 'reviewer', 'enrichment.cancel': 'reviewer',
  'import.dismiss': 'reviewer',
};

export const can = (role, permission) => permission in PERMISSIONS && role in RANK && RANK[role] >= RANK[PERMISSIONS[permission]];

export function requireRole(actor, permission) {
  if (!actor || !can(actor.role, permission)) {
    const needs = PERMISSIONS[permission];
    throw new ForbiddenError(needs ? `${permission} needs the ${needs} role${actor?.role ? `, and you are a ${actor.role}` : ''}` : `unknown action "${permission}"`);
  }
}

// What an actor may do, for the interface to show only buttons that will work.
export const permissionsOf = (role) => Object.keys(PERMISSIONS).filter((p) => can(role, p));
