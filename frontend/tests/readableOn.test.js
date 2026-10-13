// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readableOn, contrastRatio, luminance, INK_DARK, INK_LIGHT, INK_BLACK } from '../src/readableOn.js';
import { PALETTE, FALLBACK_COLOR } from '../src/sectorPalette.js';

describe('the ink to set on a company\'s colour', () => {
  it('can be read on every colour a sector is drawn in, and on the colour a company with no sector gets: AA, 4.5 to 1', () => {
    expect(PALETTE).toHaveLength(20);
    for (const color of [...PALETTE, FALLBACK_COLOR]) {
      const ink = readableOn(color);
      expect(contrastRatio(ink, color), `${ink} on ${color}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('is the dark ink on the light colours the map uses, where white would read at about 2 to 1', () => {
    for (const color of PALETTE.filter((c) => contrastRatio(INK_LIGHT, c) < 4)) expect(readableOn(color), color).toBe(INK_DARK);
    expect(readableOn('#5fb894')).toBe(INK_DARK);
    expect(contrastRatio(INK_LIGHT, '#5fb894')).toBeLessThan(2.5);
  });

  it('is black, not the page\'s ink, for the one mid-tone pink where neither the ink nor white quite reaches 4.5 to 1', () => {
    expect(contrastRatio(INK_DARK, '#c4507a')).toBeLessThan(4.5);
    expect(contrastRatio(INK_LIGHT, '#c4507a')).toBeLessThan(4.5);
    expect(readableOn('#c4507a')).toBe(INK_BLACK);
    expect(contrastRatio(INK_BLACK, '#c4507a')).toBeGreaterThanOrEqual(4.5);
  });

  it('is white on a dark colour, whichever way the colour is written', () => {
    expect(readableOn('#444')).toBe(INK_LIGHT);
    expect(readableOn('#444444')).toBe(INK_LIGHT);
    expect(readableOn('#14181A')).toBe(INK_LIGHT);
    expect(readableOn('#ffffff')).toBe(INK_DARK);
  });

  it('is white for something that is not a colour, rather than throwing: an empty value, a name, a function', () => {
    for (const bad of [undefined, null, '', 'green', 'rgb(0,0,0)', 'var(--accent)', '#12']) expect(readableOn(bad), String(bad)).toBe(INK_LIGHT);
    expect(luminance('not a colour')).toBeNull();
    expect(contrastRatio('#000', 'nope')).toBeNull();
  });

  it('measures contrast the way WCAG does: black on white is 21 to 1, and a colour on itself is 1 to 1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#3ecf6e', '#3ecf6e')).toBe(1);
  });
});
