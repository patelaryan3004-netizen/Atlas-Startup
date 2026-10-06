import { describe, it, expect } from 'vitest';
import { createFetcher, FetchPolicyError } from '../src/discovery/http.js';
import { scriptedWeb } from './helpers/scheduler.js';

const make = (routes, over = {}) => {
  const w = scriptedWeb(routes);
  const clock = { now: Date.parse('2026-10-05T04:00:00.000Z') };
  return { w, clock, fetcher: createFetcher({ fetchImpl: w.fetchImpl, resolveHost: async () => ['93.184.216.34'], sleep: async () => {}, now: () => clock.now, ...over }) };
};
const ok = { body: '<html><title>x</title></html>', headers: { 'content-type': 'text/html' } };

describe('hosts that asked us to slow down in an earlier run', () => {
  it('are left alone from the first request, as if they had just asked, without a single request to them', async () => {
    const { w, fetcher } = make({ 'https://slow.example/': ok, 'https://fine.example/': ok }, { coolDownHosts: ['slow.example'] });
    // (refused while reading robots.txt, which is where every first request to a site starts, so it says so in those words)
    await expect(fetcher.get('https://slow.example/')).rejects.toMatchObject({ code: 'robots_unavailable', message: expect.stringMatching(/asked us to slow down; leaving it alone/) });
    expect(w.calls.filter((u) => u.includes('slow.example'))).toEqual([]);
    await expect(fetcher.get('https://fine.example/')).resolves.toMatchObject({ status: 200 });
  });

  it('are not reported as having asked again this run (they did not)', async () => {
    const { fetcher } = make({}, { coolDownHosts: ['slow.example'] });
    await fetcher.get('https://slow.example/').catch(() => {});
    expect(fetcher.askedToWait()).toEqual([]);
  });
});

describe('what a host asking us to slow down is remembered as', () => {
  it('records the host and how long it asked for, from Retry-After in seconds', async () => {
    const { fetcher } = make({ 'https://slow.example/': { status: 429, body: 'slow', headers: { 'content-type': 'text/html', 'retry-after': '120' } } });
    await fetcher.get('https://slow.example/').catch((e) => { expect(e).toBeInstanceOf(FetchPolicyError); });
    expect(fetcher.askedToWait()).toEqual([{ host: 'slow.example', retryAfterSeconds: 120 }]);
  });

  it('reads Retry-After as a date too, against the fetcher\'s own clock, and caps it at a week', async () => {
    const { fetcher, clock } = make({
      'https://a.example/': { status: 503, body: 'x', headers: { 'content-type': 'text/html', 'retry-after': new Date(Date.parse('2026-10-05T04:10:00.000Z')).toUTCString() } },
      'https://b.example/': { status: 429, body: 'x', headers: { 'content-type': 'text/html', 'retry-after': '99999999' } },
    });
    void clock;
    await fetcher.get('https://a.example/').catch(() => {});
    await fetcher.get('https://b.example/').catch(() => {});
    expect(fetcher.askedToWait()).toEqual([{ host: 'a.example', retryAfterSeconds: 600 }, { host: 'b.example', retryAfterSeconds: 7 * 86400 }]);
  });

  it('records a host with no Retry-After as having asked without saying for how long', async () => {
    const { fetcher } = make({ 'https://slow.example/': { status: 429, body: 'slow', headers: { 'content-type': 'text/html' } } });
    await fetcher.get('https://slow.example/').catch(() => {});
    expect(fetcher.askedToWait()).toEqual([{ host: 'slow.example', retryAfterSeconds: null }]);
  });

  it('records a robots.txt that answered 429 the same way, and then leaves the host alone for the run', async () => {
    const { fetcher, w } = make({ 'https://slow.example/robots.txt': { status: 429, body: 'x', headers: { 'content-type': 'text/plain', 'retry-after': '30' } }, 'https://slow.example/': ok });
    await expect(fetcher.get('https://slow.example/')).rejects.toMatchObject({ code: 'robots_unavailable' });
    expect(fetcher.askedToWait()).toEqual([{ host: 'slow.example', retryAfterSeconds: 30 }]);
    const before = w.calls.length;
    await expect(fetcher.get('https://slow.example/about')).rejects.toBeInstanceOf(FetchPolicyError);
    expect(w.calls.length).toBe(before);
  });
});
