// Makes public/img/hero-night.webp and hero-night-sm.webp, the night-sky pictures of the welcome page, from the approved design.
//   node scripts/art/make-hero-art.mjs <the approved design as a picture, forward slashes> [out folder, default public/img]
// The design the owner approved is one composed picture (793 px wide) with the words, the controls and the constellation drawn in. This takes the opening out of it,
// refills each of those places from the sky around it (a smooth fill solved on a coarse grid, then the stars and the grain the sky nearby has), and writes a wide
// picture (2000 px) and a narrow one for a phone (the person's half, 900 px). Every word on the page is live text over it and the constellation is a live drawing
// (components/landing/Constellation.jsx), so none of them is in the picture.
// THIS IS A STAND-IN. The design is 793 px wide, so the picture is upscaled from a small source and softer than an original would be. The artwork to put in its
// place is a clean, text-free, full-size original of the same scene from whoever made the design: save it as public/img/hero-night.webp (about 2400 x 1620)
// and hero-night-sm.webp (about 1000 x 1650, the person in the middle) and nothing else changes. Needs Chrome or Edge (it edits the pixels on a canvas).
import { writeFileSync } from 'node:fs';
import { withPage } from './cdp.mjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const input = process.argv[2];
const outDir = process.argv[3] ?? 'public/img';
if (!input) throw new Error('make-hero-art: give the approved design as a picture');
const file = pathToFileURL(path.resolve(input)).href;

// Coordinates are in the 2x working canvas (the mockup's hero is 793 x 535 CSS px). Each rectangle is a word, a control or the constellation, with sky around it.
const RECTS = [
  [296, 14, 1346, 92],      // the navigation capsule
  [448, 168, 1186, 402],    // the headline
  [492, 408, 1106, 494],    // the email field and its button
  [556, 496, 1044, 574],    // the two lines of copy
  [652, 584, 942, 672],     // the Explore button
  [594, 994, 1006, 1034],   // "Australia's startup community"
  [1096, 96, 1556, 500],    // the constellation (drawn live as SVG)
];

const PAGE_FN = `async () => {
  const RECTS = ${JSON.stringify(RECTS)};
  const img = document.images[0];
  const W = 1586, H = 1070;
  const base = document.createElement('canvas'); base.width = W; base.height = H;
  const bg = base.getContext('2d', { willReadFrequently: true }); bg.imageSmoothingQuality = 'high';
  bg.drawImage(img, 0, 0, 793, 535, 0, 0, W, H);
  const src = bg.getImageData(0, 0, W, H);
  const px = src.data;
  const N = W * H;
  const F = new Float32Array(N * 3);
  for (let i = 0; i < N; i += 1) { F[i * 3] = px[i * 4]; F[i * 3 + 1] = px[i * 4 + 1]; F[i * 3 + 2] = px[i * 4 + 2]; }
  const filledMask = new Uint8Array(N);

  // the mean colour of a strip of pixels, a short stretch along it, so a single star in it does not become a streak
  const mean = (x, y, along, across, horizontal) => {
    let r = 0, g = 0, b = 0, n = 0;
    for (let a = -along; a <= along; a += 1) for (let c = 0; c < across; c += 1) {
      const xx = horizontal ? x + a : x + c; const yy = horizontal ? y + c : y + a;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const j = (yy * W + xx) * 3; r += F[j]; g += F[j + 1]; b += F[j + 2]; n += 1;
    }
    return n ? [r / n, g / n, b / n] : [0, 0, 0];
  };

  // low-frequency variation, so a refilled patch is not a flat gradient: random values on a coarse grid, smoothly spread
  let seed = 20261016; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const CELL = 48; const GW = Math.ceil(W / CELL) + 2; const GH = Math.ceil(H / CELL) + 2;
  const grid = new Float32Array(GW * GH); for (let i = 0; i < grid.length; i += 1) grid[i] = rnd() * 2 - 1;
  const smooth = (x, y) => {
    const fx = x / CELL; const fy = y / CELL; const x0 = Math.floor(fx); const y0 = Math.floor(fy); const tx = fx - x0; const ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx); const sy = ty * ty * (3 - 2 * ty);
    return (grid[y0 * GW + x0] * (1 - sx) + grid[y0 * GW + x0 + 1] * sx) * (1 - sy) + (grid[(y0 + 1) * GW + x0] * (1 - sx) + grid[(y0 + 1) * GW + x0 + 1] * sx) * sy;
  };

  for (const [x0, y0, x1, y1] of RECTS) for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) filledMask[y * W + x] = 1;
  // a smooth fill: the value at every cell of a coarse grid, solved so each unknown cell is the mean of its neighbours (stars clamped out of the sky round it)
  const S = 6; const GWc = Math.ceil(W / S); const GHc = Math.ceil(H / S);
  const val = new Float32Array(GWc * GHc * 3); const isKnown = new Uint8Array(GWc * GHc);
  for (let cy = 0; cy < GHc; cy += 1) for (let cx = 0; cx < GWc; cx += 1) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let dy = 0; dy < S; dy += 1) for (let dx = 0; dx < S; dx += 1) {
      const x = cx * S + dx; const y = cy * S + dy; if (x >= W || y >= H) continue; const i = y * W + x; if (filledMask[i]) continue;
      r += Math.min(F[i * 3], 105); g += Math.min(F[i * 3 + 1], 105); b += Math.min(F[i * 3 + 2], 118); n += 1;
    }
    const k = cy * GWc + cx;
    if (n >= S * S * 0.5) { isKnown[k] = 1; val[k * 3] = r / n; val[k * 3 + 1] = g / n; val[k * 3 + 2] = b / n; }
  }
  // start the unknown cells from the mean of the known ones in their column, then relax
  for (let cx = 0; cx < GWc; cx += 1) {
    let r = 0, g = 0, b = 0, n = 0; for (let cy = 0; cy < GHc; cy += 1) { const k = cy * GWc + cx; if (isKnown[k]) { r += val[k * 3]; g += val[k * 3 + 1]; b += val[k * 3 + 2]; n += 1; } }
    for (let cy = 0; cy < GHc; cy += 1) { const k = cy * GWc + cx; if (!isKnown[k]) { val[k * 3] = n ? r / n : 20; val[k * 3 + 1] = n ? g / n : 30; val[k * 3 + 2] = n ? b / n : 55; } }
  }
  for (let it = 0; it < 6000; it += 1) {
    for (let cy = 1; cy < GHc - 1; cy += 1) for (let cx = 1; cx < GWc - 1; cx += 1) {
      const k = cy * GWc + cx; if (isKnown[k]) continue;
      for (let ch = 0; ch < 3; ch += 1) {
        const avg = (val[(k - 1) * 3 + ch] + val[(k + 1) * 3 + ch] + val[(k - GWc) * 3 + ch] + val[(k + GWc) * 3 + ch]) / 4;
        val[k * 3 + ch] += 1.85 * (avg - val[k * 3 + ch]);
      }
    }
  }
  // spread it back to pixels (bilinear between cell centres)
  for (const [x0, y0, x1, y1] of RECTS) for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) {
    const fx = Math.min(GWc - 1, Math.max(0, (x + 0.5) / S - 0.5)); const fy = Math.min(GHc - 1, Math.max(0, (y + 0.5) / S - 0.5));
    const cx0 = Math.floor(fx); const cy0 = Math.floor(fy); const cx1 = Math.min(GWc - 1, cx0 + 1); const cy1 = Math.min(GHc - 1, cy0 + 1); const tx = fx - cx0; const ty = fy - cy0;
    const j = (y * W + x) * 3;
    for (let ch = 0; ch < 3; ch += 1) {
      const v = (val[(cy0 * GWc + cx0) * 3 + ch] * (1 - tx) + val[(cy0 * GWc + cx1) * 3 + ch] * tx) * (1 - ty) + (val[(cy1 * GWc + cx0) * 3 + ch] * (1 - tx) + val[(cy1 * GWc + cx1) * 3 + ch] * tx) * ty;
      F[j + ch] = v + smooth(x, y) * (ch === 2 ? 3.2 : 2.4);
    }
  }

  // the stars of the sky nearby: how dense, how bright (read from a patch of clean sky at the top right)
  const patch = [1200, 112, 1560, 190]; const peaks = []; let area = 0;
  const lum = (i) => 0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2];
  for (let y = patch[1]; y < patch[3]; y += 1) for (let x = patch[0]; x < patch[2]; x += 1) {
    const i = y * W + x; area += 1; const l = lum(i);
    if (l > 52 && l >= lum(i - 1) && l >= lum(i + 1) && l >= lum(i - W) && l >= lum(i + W)) peaks.push(l - 26);
  }
  const density = peaks.length / area;

  const out = bg.createImageData(W, H); const o = out.data;
  for (let i = 0; i < N; i += 1) {
    if (filledMask[i]) {
      const g = (rnd() + rnd() + rnd() - 1.5) * 4.2;
      o[i * 4] = F[i * 3] + g * 0.8; o[i * 4 + 1] = F[i * 3 + 1] + g * 0.9; o[i * 4 + 2] = F[i * 3 + 2] + g;
    } else { o[i * 4] = px[i * 4]; o[i * 4 + 1] = px[i * 4 + 1]; o[i * 4 + 2] = px[i * 4 + 2]; }
    o[i * 4 + 3] = 255;
  }
  let filled = 0; const pool = []; for (let i = 0; i < N; i += 1) if (filledMask[i]) { filled += 1; pool.push(i); }
  const starCount = Math.round(density * filled);
  for (let s = 0; s < starCount; s += 1) {
    const i = pool[(rnd() * pool.length) | 0]; const cx = i % W; const cy = (i / W) | 0;
    const peak = peaks.length ? peaks[(rnd() * peaks.length) | 0] : 50; const warm = rnd() < 0.2;
    for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) {
      const x = cx + dx; const y = cy + dy; if (x < 0 || y < 0 || x >= W || y >= H || !filledMask[y * W + x]) continue;
      const k = Math.exp(-(dx * dx + dy * dy) / 1.5) * peak; const j = (y * W + x) * 4;
      o[j] += k * (warm ? 1.0 : 0.84); o[j + 1] += k * (warm ? 0.86 : 0.92); o[j + 2] += k * (warm ? 0.66 : 1.0);
    }
  }
  bg.putImageData(out, 0, 0);
  window.__base = base;
  return { filled, density, starCount, peaks: peaks.length };
}`;

const SCALE_FN = (sx, sy, sw, sh, ow, oh, quality, grain) => `(() => {
  const base = window.__base;
  const c = document.createElement('canvas'); c.width = ${ow}; c.height = ${oh};
  const g = c.getContext('2d', { willReadFrequently: true }); g.imageSmoothingQuality = 'high';
  g.drawImage(base, ${sx}, ${sy}, ${sw}, ${sh}, 0, 0, ${ow}, ${oh});
  if (${grain} > 0) {
    const d = g.getImageData(0, 0, ${ow}, ${oh}); const p = d.data; let seed = 77;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < p.length; i += 4) { const n = (rnd() + rnd() - 1) * ${grain}; p[i] += n; p[i + 1] += n; p[i + 2] += n; }
    g.putImageData(d, 0, 0);
  }
  return { png: c.toDataURL('image/png'), webp: c.toDataURL('image/webp', ${quality}) };
})()`;

const save = (name, data) => writeFileSync(path.join(outDir, name + '.webp'), Buffer.from(data.webp.split(',')[1], 'base64'));
const out = await withPage(async ({ send, evaluate, sleep }) => {
  await send('Page.navigate', { url: file });
  await sleep(1200);
  const info = await evaluate(`(async () => { const fn = ${PAGE_FN}; return fn(); })()`);
  const desktop = await evaluate(SCALE_FN(0, 0, 1586, 1070, 2000, 1349, 0.82, 3.0));
  const mobile = await evaluate(SCALE_FN(470, 0, 650, 1070, 900, 1482, 0.78, 3.0));
  return { info, desktop, mobile };
});
save('hero-night', out.desktop);
save('hero-night-sm', out.mobile);
console.log(JSON.stringify(out.info));
