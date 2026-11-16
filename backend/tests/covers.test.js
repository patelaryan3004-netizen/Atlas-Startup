import { describe, it, expect, beforeAll } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRaw, parseRaw, validateDataset } from '../src/models/dataset.js';
import { toPublic, INTERNAL_FIELDS } from '../src/models/company.js';
import { CARD_FIELDS } from '../src/catalog/catalog.js';
import { findContacts } from '../src/models/contact.js';

// The gallery's pictures: each company's own preview picture (its website's og:image), kept on the site as a 16:9 WebP (scripts/covers/collect.mjs). What the data says about them, and
// that a picture is never anyone else's.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, '..', 'src', 'data');
const COVERS = path.join(HERE, '..', '..', 'frontend', 'public', 'img', 'covers');

let ds;
beforeAll(async () => { ds = parseRaw(await loadRaw(DATA)); });

describe('the covers in the shipped data', () => {
  it('are each a file of the site\'s own at /img/covers/<id>.webp, and the file is there', () => {
    const withCover = ds.companies.filter((c) => c.cover);
    expect(withCover.length).toBeGreaterThan(0);
    for (const c of withCover) {
      expect(c.cover, c.id).toBe(`/img/covers/${c.id}.webp`);
      expect(existsSync(path.join(COVERS, `${c.id}.webp`)), c.id).toBe(true);
    }
  });

  it('say where they were read and when, so a picture can be taken down at its owner\'s request, and nothing else says it', () => {
    for (const c of ds.companies) {
      if (c.cover) {
        expect(c.cover_source_url, c.id).toMatch(/^https?:\/\//);
        expect(Number.isNaN(Date.parse(c.cover_retrieved_at)), c.id).toBe(false);
      } else {
        expect(c.cover_source_url ?? null, c.id).toBeNull();
        expect(c.cover_retrieved_at ?? null, c.id).toBeNull();
      }
    }
  });

  it('have no picture file left without a company that uses it, and no two companies share a picture', () => {
    const used = new Set(ds.companies.filter((c) => c.cover).map((c) => `${c.id}.webp`));
    const files = readdirSync(COVERS).filter((f) => f.endsWith('.webp'));
    expect(files.filter((f) => !used.has(f))).toEqual([]);
    const seen = new Map();
    for (const f of files) {
      const hash = createHash('sha1').update(readFileSync(path.join(COVERS, f))).digest('hex');
      expect(seen.get(hash), `${f} is the same picture as ${seen.get(hash)}`).toBeUndefined();
      seen.set(hash, f);
    }
  });

  it('are small enough to be served to a page of forty-eight at once', () => {
    for (const f of readdirSync(COVERS).filter((name) => name.endsWith('.webp'))) {
      expect(readFileSync(path.join(COVERS, f)).length, f).toBeLessThan(120_000);
    }
  });

  it('are valid records', () => {
    expect(validateDataset(structuredClone(ds))).toEqual([]);
  });
});

describe('the cover fields of a record', () => {
  const withBad = (patch) => { const copy = structuredClone(ds); Object.assign(copy.companies[0], patch); return validateDataset(copy).join('\n'); };

  it('take a cover path of the site\'s own or nothing, an address, and a day', () => {
    expect(withBad({ cover: '/img/covers/x.webp', cover_source_url: 'https://example.com/og.png', cover_retrieved_at: '2026-11-16T10:00:00.000Z' })).toBe('');
    expect(withBad({ cover: null, cover_source_url: null, cover_retrieved_at: null })).toBe('');
  });

  it('refuse a picture on another host (the page never depends on one), a path that is not a webp, an address that is not one, and a day that is not one', () => {
    expect(withBad({ cover: 'https://example.com/og.png' })).toMatch(/cover must be/);
    expect(withBad({ cover: '/img/covers/x.png' })).toMatch(/cover must be/);
    expect(withBad({ cover_source_url: 'not an address' })).toMatch(/cover_source_url must be/);
    expect(withBad({ cover_retrieved_at: 'yesterday' })).toMatch(/cover_retrieved_at must be/);
  });

  it('are served: the card carries the cover, and the record-keeping about it is internal', () => {
    expect(CARD_FIELDS).toContain('cover');
    expect(CARD_FIELDS).not.toContain('cover_source_url');
    expect([...INTERNAL_FIELDS]).toEqual(expect.arrayContaining(['cover_source_url', 'cover_retrieved_at']));
    const out = toPublic({ id: 'acme', name: 'Acme', cover: '/img/covers/acme.webp', cover_source_url: 'https://acme.test/og.png', cover_retrieved_at: '2026-11-16T10:00:00.000Z' });
    expect(out.cover).toBe('/img/covers/acme.webp');
    expect(out).not.toHaveProperty('cover_source_url');
    expect(out).not.toHaveProperty('cover_retrieved_at');
  });

  it('keep a picture\'s address, with its @2x name, from being taken for an email address by the privacy scan', () => {
    expect(findContacts('https://example.com/img/og-home@2x.jpg')).toEqual([]);
    expect(findContacts('write to hello@example.com')).toHaveLength(1);
    expect(findContacts('a@2x.com')).toHaveLength(1); // (a real host named 2x.com would still be an address)
  });
});
