import { describe, it, expect } from 'vitest';
import { appendAudit, makeAuditRow, validateAuditTrail, diffChanges, clipValue, AUDIT_ACTIONS } from '../src/models/auditTrail.js';

const AT = '2026-10-06T03:15:12.123Z';
const entry = (over = {}) => ({
  actor: { name: 'aryan', role: 'admin' }, via: 'admin-ui', action: 'candidate.approve', target: { type: 'candidate', id: 'cand-acme' },
  summary: 'Approved Acme', reason: null, changes: [], ...over,
});
const trail = (rows) => ({ audit_trail: rows });

describe('writing the audit trail', () => {
  it('records who, what, to what, when, and what moved', () => {
    const work = {};
    const [row] = appendAudit(work, [entry({ reason: 'looks right', changes: [{ field: 'status', from: 'needs_review', to: 'approved' }] })], AT);
    expect(row).toEqual({
      id: 'aud-20261006031512123-1', at: AT, actor: 'aryan', role: 'admin', via: 'admin-ui', action: 'candidate.approve',
      target: { type: 'candidate', id: 'cand-acme' }, summary: 'Approved Acme', reason: 'looks right',
      changes: [{ field: 'status', from: 'needs_review', to: 'approved' }],
    });
    expect(work.audit_trail).toEqual([row]);
  });

  it('numbers the rows written in the same millisecond so every id is unique, across calls too', () => {
    const work = {};
    appendAudit(work, [entry(), entry()], AT);
    appendAudit(work, [entry()], AT);
    expect(work.audit_trail.map((r) => r.id)).toEqual(['aud-20261006031512123-1', 'aud-20261006031512123-2', 'aud-20261006031512123-3']);
  });

  it('keeps a long value small enough to read: a long description is clipped, a long list cut', () => {
    const long = 'x'.repeat(500);
    expect(clipValue(long)).toHaveLength(300);
    expect(clipValue(long).endsWith('...')).toBe(true);
    expect(clipValue(Array.from({ length: 50 }, (_, i) => i))).toHaveLength(20);
    expect(makeAuditRow(entry({ summary: long }), 'aud-1-1', AT).summary).toHaveLength(300);
  });

  it('finds what changed between two versions of a record, and only that', () => {
    expect(diffChanges({ a: 1, b: [1, 2], c: null }, { a: 1, b: [1, 3], c: undefined, d: 'new' }, ['a', 'b', 'c', 'd'])).toEqual([
      { field: 'b', from: [1, 2], to: [1, 3] }, { field: 'd', from: null, to: 'new' },
    ]);
  });
});

describe('checking the audit trail', () => {
  const good = () => appendAudit({}, [entry(), entry({ action: 'candidate.reject', reason: 'not a startup' })], AT);

  it('accepts a well-formed trail, and an empty one', () => {
    expect(validateAuditTrail(trail(good()))).toEqual([]);
    expect(validateAuditTrail({})).toEqual([]);
  });

  it('refuses an unknown action, role, door or target, so a new kind of action must be registered', () => {
    const [a] = good();
    const errors = (over) => validateAuditTrail(trail([{ ...a, ...over }])).join(' ');
    expect(errors({ action: 'candidate.vaporise' })).toMatch(/unknown action/);
    expect(errors({ role: 'root' })).toMatch(/invalid role/);
    expect(errors({ via: 'telepathy' })).toMatch(/invalid via/);
    expect(errors({ target: { type: 'banana', id: 'x' } })).toMatch(/target needs a type and an id/);
    expect(errors({ actor: '' })).toMatch(/actor must be a name/);
    expect(errors({ summary: '' })).toMatch(/summary is required/);
    expect(errors({ at: 'yesterday' })).toMatch(/ISO-8601/);
  });

  it('refuses a duplicate id and an entry that is earlier than the one before it', () => {
    const [a, b] = good();
    expect(validateAuditTrail(trail([a, { ...b, id: a.id }])).join(' ')).toMatch(/duplicate id/);
    expect(validateAuditTrail(trail([{ ...a, at: '2026-10-07T00:00:00.000Z' }, b])).join(' ')).toMatch(/time order/);
  });

  it('registers every action the Command Center and the worker will write', () => {
    for (const action of ['candidate.approve', 'candidate.publish', 'conflict.resolve', 'suggestion.apply', 'enrichment.task', 'import.dismiss']) {
      expect(AUDIT_ACTIONS).toContain(action);
    }
  });
});
