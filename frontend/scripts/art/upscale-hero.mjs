// FALLBACK (no trained model): makes public/img/hero-night.webp (3200 px wide) and hero-night-sm.webp (the phone slice of it) from the clean
// original in scripts/art/hero-night-source.webp.
//   node scripts/art/upscale-hero.mjs [source, default scripts/art/hero-night-source.webp] [out folder, default public/img] [report folder: also writes the comparisons]
// The original is 1527 x 1030, so it is enlarged 2.1 times. That is done here and not by the browser's CSS stretch:
//   1. Lanczos-3 resampling (windowed sinc, 6 taps each way) of the colour values, in two passes, in 32-bit floats;
//   2. an anti-ringing clamp: a result is kept inside the range of the four original pixels round it (plus 3 levels), so the stars and the horizon get no halo;
//   3. a soft-thresholded unsharp mask on the luminance only (sigma 1.25 px, amount .55), so small detail is crisp again without lifting the noise or the colour;
//   4. a fine triangular grain (about 1 level) as dither, so the dark sky does not band in a lossy file and does not look plastic;
//   then a lossy WebP at quality .92 (.9 for the phone slice). The framing is the original's (the page's crop is unchanged); the phone's file is the same slice of the picture as before
//   (x from 29.63% to 70.62%, the person in the middle), taken from the enlarged picture, not enlarged again.
// It is a classical resampler, not a trained model: it cannot invent detail the original does not have. Needs Chrome or Edge (the pixels are worked on in a page).
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { withPage } from './cdp.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const [sourceArg, outArg = 'public/img', reportArg] = process.argv.slice(2);
const source = path.resolve(sourceArg ?? path.join(here, 'hero-night-source.webp'));
const outDir = path.resolve(outArg);
mkdirSync(outDir, { recursive: true });
if (reportArg) mkdirSync(path.resolve(reportArg), { recursive: true });

const OUT_W = 3200;
const PHONE = [0.2963, 0.7062];
const QUALITY = { wide: 0.92, phone: 0.9 };

const PAGE_FN = `async () => {
  const img = document.images[0];
  await img.decode();
  const sw = img.naturalWidth, sh = img.naturalHeight;
  const ow = ${OUT_W}, oh = Math.round(ow * sh / sw);
  const A = 3;

  // ---- the original's pixels, as floats ----
  const c0 = document.createElement('canvas'); c0.width = sw; c0.height = sh;
  const g0 = c0.getContext('2d', { willReadFrequently: true }); g0.drawImage(img, 0, 0);
  const sd = g0.getImageData(0, 0, sw, sh).data;
  const src = new Float32Array(sw * sh * 3);
  for (let i = 0, j = 0; i < sw * sh; i += 1) { src[j++] = sd[i * 4]; src[j++] = sd[i * 4 + 1]; src[j++] = sd[i * 4 + 2]; }

  // ---- 1. Lanczos-3, two passes ----
  const lanczos = (x) => { if (x === 0) return 1; if (Math.abs(x) >= A) return 0; const p = Math.PI * x; return (A * Math.sin(p) * Math.sin(p / A)) / (p * p); };
  const weights = (inN, outN) => {
    const taps = 2 * A; const idx = new Int32Array(outN * taps); const w = new Float32Array(outN * taps); const scale = outN / inN;
    for (let o = 0; o < outN; o += 1) {
      const centre = (o + 0.5) / scale - 0.5; const first = Math.floor(centre) - A + 1; let sum = 0;
      for (let t = 0; t < taps; t += 1) { const s = first + t; const v = lanczos(centre - s); w[o * taps + t] = v; sum += v; idx[o * taps + t] = Math.min(inN - 1, Math.max(0, s)); }
      for (let t = 0; t < taps; t += 1) w[o * taps + t] /= sum;
    }
    return { idx, w, taps };
  };
  const wx = weights(sw, ow), wy = weights(sh, oh);
  const mid = new Float32Array(ow * sh * 3);
  for (let y = 0; y < sh; y += 1) for (let x = 0; x < ow; x += 1) {
    let r = 0, g = 0, b = 0;
    for (let t = 0; t < wx.taps; t += 1) { const k = wx.w[x * wx.taps + t]; const s = (y * sw + wx.idx[x * wx.taps + t]) * 3; r += src[s] * k; g += src[s + 1] * k; b += src[s + 2] * k; }
    const d = (y * ow + x) * 3; mid[d] = r; mid[d + 1] = g; mid[d + 2] = b;
  }
  const lan = new Float32Array(ow * oh * 3);
  for (let y = 0; y < oh; y += 1) for (let x = 0; x < ow; x += 1) {
    let r = 0, g = 0, b = 0;
    for (let t = 0; t < wy.taps; t += 1) { const k = wy.w[y * wy.taps + t]; const s = (wy.idx[y * wy.taps + t] * ow + x) * 3; r += mid[s] * k; g += mid[s + 1] * k; b += mid[s + 2] * k; }
    const d = (y * ow + x) * 3; lan[d] = r; lan[d + 1] = g; lan[d + 2] = b;
  }

  // ---- 2. anti-ringing: stay inside the four original pixels round the point, plus 3 levels ----
  const out = new Float32Array(lan.length);
  for (let y = 0; y < oh; y += 1) {
    const cy = (y + 0.5) * sh / oh - 0.5; const y0 = Math.min(sh - 1, Math.max(0, Math.floor(cy))); const y1 = Math.min(sh - 1, y0 + 1);
    for (let x = 0; x < ow; x += 1) {
      const cx = (x + 0.5) * sw / ow - 0.5; const x0 = Math.min(sw - 1, Math.max(0, Math.floor(cx))); const x1 = Math.min(sw - 1, x0 + 1);
      const a = (y0 * sw + x0) * 3, b = (y0 * sw + x1) * 3, c = (y1 * sw + x0) * 3, d = (y1 * sw + x1) * 3; const o = (y * ow + x) * 3;
      for (let ch = 0; ch < 3; ch += 1) {
        const lo = Math.min(src[a + ch], src[b + ch], src[c + ch], src[d + ch]) - 3, hi = Math.max(src[a + ch], src[b + ch], src[c + ch], src[d + ch]) + 3;
        const v = lan[o + ch]; out[o + ch] = v < lo ? lo : v > hi ? hi : v;
      }
    }
  }
  const resampled = Float32Array.from(out);

  // ---- 3. soft-thresholded unsharp mask on the luminance ----
  const luma = new Float32Array(ow * oh);
  for (let i = 0; i < ow * oh; i += 1) luma[i] = 0.299 * out[i * 3] + 0.587 * out[i * 3 + 1] + 0.114 * out[i * 3 + 2];
  const SIGMA = 1.25, R = 4; const kern = []; let ks = 0; for (let i = -R; i <= R; i += 1) { const v = Math.exp(-(i * i) / (2 * SIGMA * SIGMA)); kern.push(v); ks += v; } for (let i = 0; i < kern.length; i += 1) kern[i] /= ks;
  const tmp = new Float32Array(ow * oh), blur = new Float32Array(ow * oh);
  for (let y = 0; y < oh; y += 1) for (let x = 0; x < ow; x += 1) { let s = 0; for (let k = -R; k <= R; k += 1) s += luma[y * ow + Math.min(ow - 1, Math.max(0, x + k))] * kern[k + R]; tmp[y * ow + x] = s; }
  for (let y = 0; y < oh; y += 1) for (let x = 0; x < ow; x += 1) { let s = 0; for (let k = -R; k <= R; k += 1) s += tmp[Math.min(oh - 1, Math.max(0, y + k)) * ow + x] * kern[k + R]; blur[y * ow + x] = s; }
  const AMOUNT = 0.55, THRESH = 1.5, LIMIT = 22;
  for (let i = 0; i < ow * oh; i += 1) {
    const diff = luma[i] - blur[i]; const mag = Math.abs(diff);
    if (mag <= THRESH) continue;
    let d = (mag - THRESH) * Math.sign(diff) * AMOUNT; if (d > LIMIT) d = LIMIT; else if (d < -LIMIT) d = -LIMIT;
    out[i * 3] += d; out[i * 3 + 1] += d; out[i * 3 + 2] += d;
  }
  const sharpened = Float32Array.from(out);

  // ---- 4. grain / dither, and the pixels ----
  let seed = 20261016; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const toCanvas = (arr, grain, x0, w) => {
    const c = document.createElement('canvas'); c.width = w; c.height = oh; const g = c.getContext('2d', { willReadFrequently: true });
    const id = g.createImageData(w, oh); const p = id.data;
    for (let y = 0; y < oh; y += 1) for (let x = 0; x < w; x += 1) {
      const s = (y * ow + x0 + x) * 3, d = (y * w + x) * 4; const n = grain ? (rnd() + rnd() - 1) * 2.1 : 0;
      p[d] = arr[s] + n; p[d + 1] = arr[s + 1] + n; p[d + 2] = arr[s + 2] + n; p[d + 3] = 255;
    }
    g.putImageData(id, 0, 0); return c;
  };
  const phoneX0 = Math.round(ow * ${PHONE[0]}), phoneX1 = Math.round(ow * ${PHONE[1]});
  const finalWide = toCanvas(out, true, 0, ow);
  seed = 99; const finalPhone = toCanvas(out, true, phoneX0, phoneX1 - phoneX0);
  window.__stages = { resampled, sharpened, out, sw, sh, ow, oh };
  window.__finalWide = finalWide;
  return {
    sw, sh, ow, oh, phone: [phoneX1 - phoneX0, oh],
    wide: finalWide.toDataURL('image/webp', ${QUALITY.wide}),
    phoneImg: finalPhone.toDataURL('image/webp', ${QUALITY.phone}),
  };
}`;

// Sharpness, measured the same way on the same regions of: the browser's own stretch of the original, the plain Lanczos pass, Lanczos with the sharpening, and the final
// file as it decodes. (The variance of a 3 x 3 Laplacian of the luminance: higher is crisper; the grain is in the last one, so it is also given without.)
const REPORT_FN = `async () => {
  const img = document.images[0]; const { resampled, sharpened, ow, oh } = window.__stages;
  const naive = document.createElement('canvas'); naive.width = ow; naive.height = oh;
  const gn = naive.getContext('2d', { willReadFrequently: true }); gn.imageSmoothingQuality = 'high'; gn.drawImage(img, 0, 0, ow, oh);
  const nd = gn.getImageData(0, 0, ow, oh).data;
  const lumaOf = (get) => { const L = new Float32Array(ow * oh); for (let i = 0; i < ow * oh; i += 1) L[i] = get(i); return L; };
  const Ln = lumaOf((i) => 0.299 * nd[i * 4] + 0.587 * nd[i * 4 + 1] + 0.114 * nd[i * 4 + 2]);
  const Lr = lumaOf((i) => 0.299 * resampled[i * 3] + 0.587 * resampled[i * 3 + 1] + 0.114 * resampled[i * 3 + 2]);
  const Ls = lumaOf((i) => 0.299 * sharpened[i * 3] + 0.587 * sharpened[i * 3 + 1] + 0.114 * sharpened[i * 3 + 2]);
  const fd = window.__finalWide.getContext('2d').getImageData(0, 0, ow, oh).data;
  const Lf = lumaOf((i) => 0.299 * fd[i * 4] + 0.587 * fd[i * 4 + 1] + 0.114 * fd[i * 4 + 2]);
  const lap = (L, x0, y0, w, h) => { let s = 0, s2 = 0, n = 0; for (let y = y0 + 1; y < y0 + h - 1; y += 1) for (let x = x0 + 1; x < x0 + w - 1; x += 1) { const v = 4 * L[y * ow + x] - L[y * ow + x - 1] - L[y * ow + x + 1] - L[(y - 1) * ow + x] - L[(y + 1) * ow + x]; s += v; s2 += v * v; n += 1; } return Math.round((s2 / n - (s / n) ** 2) * 10) / 10; };
  const regions = { person: [1400, 1420, 640, 700], milkyWay: [2000, 950, 640, 440], sky: [200, 120, 640, 440] };
  const metrics = {};
  for (const [name, [x, y, w, h]] of Object.entries(regions)) metrics[name] = { stretch: lap(Ln, x, y, w, h), lanczos: lap(Lr, x, y, w, h), sharpened: lap(Ls, x, y, w, h), final: lap(Lf, x, y, w, h) };
  // side by side, the same place at 1:1: the browser's stretch, the final file
  const panel = (name, [x, y, w, h]) => { const c = document.createElement('canvas'); c.width = w * 2 + 12; c.height = h; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(naive, x, y, w, h, 0, 0, w, h); g.drawImage(window.__finalWide, x, y, w, h, w + 12, 0, w, h); return c.toDataURL('image/png'); };
  return { metrics, panels: { face: panel('face', [1380, 1430, 420, 360]), stars: panel('stars', [2060, 1000, 420, 360]) } };
}`;

const result = await withPage(async ({ send, evaluate, sleep }) => {
  await send('Page.navigate', { url: pathToFileURL(source).href });
  await sleep(1200);
  const made = await evaluate(`(${PAGE_FN})()`);
  const report = reportArg ? await evaluate(`(${REPORT_FN})()`) : null;
  return { made, report };
});

const { made, report } = result;
const decode = (url) => Buffer.from(url.split(',')[1], 'base64');
writeFileSync(path.join(outDir, 'hero-night.webp'), decode(made.wide));
writeFileSync(path.join(outDir, 'hero-night-sm.webp'), decode(made.phoneImg));
console.log(JSON.stringify({ from: [made.sw, made.sh], wide: [made.ow, made.oh], phone: made.phone, wideKB: Math.round(decode(made.wide).length / 1024), phoneKB: Math.round(decode(made.phoneImg).length / 1024) }));
if (report) {
  const dir = path.resolve(reportArg);
  writeFileSync(path.join(dir, 'compare-face.png'), decode(report.panels.face));
  writeFileSync(path.join(dir, 'compare-stars.png'), decode(report.panels.stars));
  console.log(JSON.stringify(report.metrics, null, 1));
}
