import { describe, it, expect, vi, afterEach } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

const load = () => import('../src/tally.js');

describe('where the forms point', () => {
  it('keeps the live waitlist form (kdVrGo) and the placeholder for the submit form when nothing is set', async () => {
    const { WAITLIST_URL, TALLY_SUBMIT_URL, tallyEmbed } = await load();
    expect(WAITLIST_URL).toBe('https://tally.so/r/kdVrGo');
    expect(tallyEmbed(WAITLIST_URL)).toBe('https://tally.so/embed/kdVrGo?hideTitle=1&alignLeft=1');
    expect(TALLY_SUBMIT_URL).toBe('TALLY_SUBMIT_URL_HERE');
    expect(tallyEmbed(TALLY_SUBMIT_URL)).toBeNull(); // the placeholder is never framed
  });

  it('takes another waitlist form, and a submit form, from the build settings', async () => {
    vi.stubEnv('VITE_TALLY_WAITLIST_URL', 'https://tally.so/r/newWait');
    vi.stubEnv('VITE_TALLY_SUBMIT_URL', 'https://tally.so/r/newSub1');
    vi.resetModules();
    const { WAITLIST_URL, TALLY_SUBMIT_URL, tallyEmbed } = await load();
    expect(tallyEmbed(WAITLIST_URL)).toBe('https://tally.so/embed/newWait?hideTitle=1&alignLeft=1');
    expect(tallyEmbed(TALLY_SUBMIT_URL)).toBe('https://tally.so/embed/newSub1?hideTitle=1&alignLeft=1');
  });

  it('frames only a Tally address: nothing else, however it is written', async () => {
    const { tallyEmbed } = await load();
    for (const bad of ['', undefined, null, 'TALLY_FORM_URL_HERE', 'http://tally.so/r/abc', 'https://evil.example/r/abc', 'https://tally.so.evil.example/r/abc', 'javascript:alert(1)']) {
      expect(tallyEmbed(bad), String(bad)).toBeNull();
    }
    expect(tallyEmbed('https://tally.so/embed/abc123?x=1')).toBe('https://tally.so/embed/abc123?hideTitle=1&alignLeft=1');
  });
});
