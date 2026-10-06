import { describe, it, expect } from 'vitest';
import { statusSignals, claimsOf, briefSignals } from '../src/enrichment/status.js';
import { extractFacts } from '../src/discovery/enrich.js';
import { canonicalDomain } from '../src/models/identity.js';

const NAMES = ['Acme Robotics', 'Acme'];

// A site as readSite returns it, with a homepage whose visible text is `body`.
function siteWith(body, { title = 'Acme Robotics | Home', finalUrl = 'https://acme.com.au/', stored = 'https://acme.com.au', description = '' } = {}) {
  const html = `<html><head><title>${title}</title>${description ? `<meta name="description" content="${description}">` : ''}</head><body><p>${body}</p></body></html>`;
  return {
    site: { domain: canonicalDomain(stored), pages: [{ url: 'https://acme.com.au/', finalUrl, status: 200, html }], errors: [], retrieved_at: '2026-10-05T04:00:00.000Z' },
    facts: extractFacts(html, { home: true }),
  };
}
const read = (body, opts, names = NAMES) => { const { site, facts } = siteWith(body, opts); return statusSignals(site, { facts, names }); };
const codes = (signals) => signals.map((s) => s.code);

describe('a page that says the company was acquired', () => {
  it.each([
    ['Acme Robotics has been acquired by Beta Group.', 'Beta Group'],
    ['Acme Robotics was acquired by Orbit Systems in March.', 'Orbit Systems'],
    ["We've been acquired by Globex Corporation and are excited about what is next.", 'Globex Corporation'],
    ['We were acquired by Initech Holdings last month.', 'Initech Holdings'],
    ['Acme Robotics is now part of the Hooli Group.', 'Hooli Group'],
  ])('says so, naming who: %s', (body, other) => {
    const [s] = read(body);
    expect(s).toMatchObject({ code: 'acquired_notice', claim: 'acquired', value: 'acquired' });
    expect(s.other).toBe(other);
    expect(s.detail).toMatch(/^the homepage says: "/);
  });

  it('calls a company that is now a subsidiary or a brand of another one a subsidiary, not acquired', () => {
    expect(read('Acme Robotics is a wholly-owned subsidiary of Initech Holdings.')[0]).toMatchObject({ code: 'subsidiary_notice', claim: 'subsidiary', other: 'Initech Holdings' });
    expect(read("We're now a division of Globex Corporation.")[0]).toMatchObject({ claim: 'subsidiary' });
  });

  it('is not fooled by a company acquiring someone else, or by another company being acquired', () => {
    expect(read('We acquired Beta Labs last year and are growing fast.')).toEqual([]);
    expect(read('Acme Robotics acquired Beta Labs to expand into Europe.')).toEqual([]);
    expect(read('Beta Labs has been acquired by Acme Robotics.')).toEqual([]);
    expect(read('Our customer Initech was acquired by Globex this year.')).toEqual([]);
  });

  it('needs somebody on the other side of "acquired by"', () => {
    expect(read('Acme Robotics was acquired by.')).toEqual([]);
    expect(read('Acme Robotics was acquired by, well, nobody yet.')).toEqual([]);
  });
});

describe('a page that says the company has closed', () => {
  it.each([
    'We have closed our doors. Thank you to everyone who supported us.',
    "We've ceased trading and our website is kept for reference.",
    'Acme Robotics has ceased operations.',
    'Acme Robotics has entered voluntary administration.',
    'Acme Robotics has been placed into liquidation.',
    'We are shutting down at the end of the month.',
    "We've shut down.",
    'Acme Robotics has shut down.',
    'Acme Robotics is no longer operating.',
  ])('says so: %s', (body) => {
    expect(read(body)[0]).toMatchObject({ code: 'closed_notice', claim: 'defunct', value: 'defunct' });
  });

  it('is not fooled by closing a round, closing the gap, or shutting something else down', () => {
    expect(read("We've closed our $5M Series A round led by Blackbird.")).toEqual([]);
    expect(read('Closing the gap between robots and warehouses.')).toEqual([]);
    expect(read('We are closing in on 100 customers.')).toEqual([]);
    expect(read('We shut down the incident within an hour, every time.')).toEqual([]);
    expect(read('We have shut down the old API and moved everyone to v2.')).toEqual([]);
    expect(read('Acme Robotics has shut down the legacy dashboard.')).toEqual([]);
    expect(read('Beta Labs is no longer operating; we recommend Acme Robotics instead.')).toEqual([]);
  });
});

describe('what is only worth a look, never a claim', () => {
  it('notices an address that now leads to another domain, but not www or a path', () => {
    const moved = read('Welcome.', { finalUrl: 'https://orbit.io/welcome' });
    expect(moved).toEqual([expect.objectContaining({ code: 'moved_domain', claim: null, other: 'orbit.io', detail: 'acme.com.au now redirects to orbit.io' })]);
    expect(read('Welcome.', { finalUrl: 'https://www.acme.com.au/en/home' })).toEqual([]);
  });

  it('notices a parked or for-sale domain, but only when there is nothing else on the page', () => {
    expect(codes(read('This domain is for sale. Buy this domain today.', { title: 'acme.com.au' }))).toEqual(['parked_domain']);
    const long = `${'Acme Robotics builds warehouse robots. '.repeat(60)} This domain name may be for sale in some other universe.`;
    expect(read(long)).toEqual([]);
  });

  it('notices a company saying it used to be called something else, or that it has rebranded', () => {
    expect(codes(read('Orbit AI, formerly known as Acme Robotics, builds robots.', { title: 'Orbit AI' }))).toEqual(['renamed_notice']);
    expect(read("We've rebranded to Orbit AI.")[0]).toMatchObject({ code: 'renamed_notice', claim: null, other: 'Orbit AI' });
    expect(read("We've rebranded to Acme Robotics.")).toEqual([]);
  });

  it('says nothing for an ordinary page', () => {
    expect(read('Acme Robotics builds warehouse robots for Australian logistics. Talk to us.')).toEqual([]);
  });

  it('says nothing when the site could not be read', () => {
    expect(statusSignals({ domain: canonicalDomain('https://acme.com.au'), pages: [], errors: [] }, { names: NAMES })).toEqual([]);
  });
});

describe('what the signals become', () => {
  it('turns only claims into evidence rows, with the sentence as the note', () => {
    const signals = [...read('Acme Robotics has been acquired by Beta Group.'), ...read('Welcome.', { finalUrl: 'https://orbit.io/' })];
    expect(codes(signals).sort()).toEqual(['acquired_notice', 'moved_domain']);
    expect(claimsOf(signals)).toEqual([{ field: 'company_status', value: 'acquired', note: expect.stringMatching(/^the homepage says: "/) }]);
  });

  it('keeps a short, stable summary for the status clock', () => {
    const signals = read('Acme Robotics has been acquired by Beta Group.');
    expect(briefSignals(signals)).toEqual([{ code: 'acquired_notice', detail: expect.any(String), other: 'Beta Group' }]);
    expect(briefSignals(new Array(20).fill(signals[0])).length).toBe(6);
  });
});
