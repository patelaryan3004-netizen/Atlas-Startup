// A company's colour (its sector's, from the map's palette) is a data colour, and text is set on it in the company's panel. Which text? Not
// always white: most of the palette is light enough that white on it reads at about 2:1. This gives the ink to set on a colour: the
// page's dark ink or white, whichever has the higher contrast, so the text is readable (WCAG AA wants 4.5:1) on any colour it is given.
export const INK_DARK = '#0a0e0f';
export const INK_LIGHT = '#ffffff';
export const INK_BLACK = '#000000';

function rgbOf(hex) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex ?? '').trim());
  if (!m) return null;
  const full = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

export function luminance(hex) {
  const rgb = rgbOf(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a, b) {
  const [la, lb] = [luminance(a), luminance(b)];
  if (la == null || lb == null) return null;
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// Dark ink on a colour it reads on at least as well as white does; white on anything darker, and on something that is not a colour. A
// mid-tone colour can leave both just short of 4.5 (a pink at 4.4 either way): black, a little darker than the page's ink, clears it.
export function readableOn(hex) {
  const dark = contrastRatio(INK_DARK, hex);
  const light = contrastRatio(INK_LIGHT, hex);
  if (dark == null || light == null) return INK_LIGHT;
  const best = dark >= light ? INK_DARK : INK_LIGHT;
  if (Math.max(dark, light) < 4.5 && contrastRatio(INK_BLACK, hex) >= 4.5) return INK_BLACK;
  return best;
}
