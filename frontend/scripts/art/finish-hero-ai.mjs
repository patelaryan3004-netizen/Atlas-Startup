// Makes public/img/hero-night.webp (3200 px wide) and hero-night-sm.webp (the phone's slice of it) from the output of a trained upscaler (Real-ESRGAN x4plus).
//   node scripts/art/finish-hero-ai.mjs <the upscaler's 4x png> [out folder, default public/img] [--mix=0.2] [--report=<folder>]
// How the 4x picture is made (a one-off, about 5 minutes on a laptop; the program is not part of the repo, and neither is its 22 MB output):
//   realesrgan-ncnn-vulkan -i scripts/art/hero-night-source.webp -o x4.png -n realesrgan-x4plus -s 4 -t 128
//   (realesrgan-ncnn-vulkan-20220424-windows.zip from the official release of github.com/xinntao/Real-ESRGAN)
// The trained model draws plausible detail the 1527 px original does not hold (stars, hair, rock, the cloud and the valley); this finishes its output for the page:
//   1. the 6108 px picture is brought down to 3200 px with a Lanczos-3 filter widened for the reduction (so it is smooth, never aliased), in 32-bit floats;
//   2. a share of the classical resampling of the original (--mix, default .2, from upscale-hero.mjs's method: Lanczos-3 with an anti-ringing clamp) is blended back
//      in, because a trained model alone can look painted: the original's own tones and noise keep it photographic;
//   3. a fine dither, so the dark sky does not band in a lossy file;
//   then a lossy WebP at quality .92 (.9 for the phone slice, the same slice of the picture as always: 29.6% to 70.6% of the width, the person in the middle).
// The framing is the original's, so the page's crop does not change. Needs Chrome or Edge (the pixels are worked on in a page).
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { withPage } from './cdp.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name, fallback) => (args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]) ?? fallback;
const [aiArg, outArg = 'public/img'] = args.filter((a) => !a.startsWith('--'));
if (!aiArg) throw new Error('finish-hero-ai: give the upscaler\'s 4x picture');
const mix = Number(flag('mix', '0.2'));
const reportDir = flag('report', '');
const outDir = path.resolve(outArg);
mkdirSync(outDir, { recursive: true });
if (reportDir) mkdirSync(path.resolve(reportDir), { recursive: true });

const OUT_W = 3200;
const PHONE = [0.2963, 0.7062];
const QUALITY = { wide: 0.92, phone: 0.9 };
const source = path.join(here, 'hero-night-source.webp');
const holder = path.join(tmpdir(), 'finish-hero-ai.html');
writeFileSync(holder, `<img id="ai" src="${pathToFileURL(path.resolve(aiArg)).href}"><img id="src" src="${pathToFileURL(source).href}">`);

const PAGE_FN = `async () => {
  const ai = document.getElementById('ai'), srcImg = document.getElementById('src');
  await Promise.all([ai.decode(), srcImg.decode()]);
  const ow = ${OUT_W}, oh = Math.round(ow * srcImg.naturalHeight / srcImg.naturalWidth);
  const A = 3;
  const lanczos = (x) => { if (x === 0) return 1; if (Math.abs(x) >= A) return 0; const p = Math.PI * x; return (A * Math.sin(p) * Math.sin(p / A)) / (p * p); };
  // taps for one axis: when reducing, the filter is widened by the reduction so it averages instead of skipping pixels
  const weights = (inN, outN) => {
    const scale = outN / inN; const widen = Math.max(1, 1 / scale); const taps = Math.ceil(2 * A * widen) + 1;
    const idx = new Int32Array(outN * taps), w = new Float32Array(outN * taps);
    for (let o = 0; o < outN; o += 1) {
      const centre = (o + 0.5) / scale - 0.5; const first = Math.floor(centre - A * widen) + 1; let sum = 0;
      for (let t = 0; t < taps; t += 1) { const s = first + t; const v = lanczos((centre - s) / widen); w[o * taps + t] = v; sum += v; idx[o * taps + t] = Math.min(inN - 1, Math.max(0, s)); }
      for (let t = 0; t < taps; t += 1) w[o * taps + t] /= sum;
    }
    return { idx, w, taps };
  };
  const pixels = (img) => { const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0); return g.getImageData(0, 0, c.width, c.height).data; };
  const resize = (data, sw, sh) => {
    const wx = weights(sw, ow), wy = weights(sh, oh);
    const mid = new Float32Array(ow * sh * 3);
    for (let y = 0; y < sh; y += 1) for (let x = 0; x < ow; x += 1) {
      let r = 0, g = 0, b = 0;
      for (let t = 0; t < wx.taps; t += 1) { const k = wx.w[x * wx.taps + t]; const s = (y * sw + wx.idx[x * wx.taps + t]) * 4; r += data[s] * k; g += data[s + 1] * k; b += data[s + 2] * k; }
      const d = (y * ow + x) * 3; mid[d] = r; mid[d + 1] = g; mid[d + 2] = b;
    }
    const out = new Float32Array(ow * oh * 3);
    for (let y = 0; y < oh; y += 1) for (let x = 0; x < ow; x += 1) {
      let r = 0, g = 0, b = 0;
      for (let t = 0; t < wy.taps; t += 1) { const k = wy.w[y * wy.taps + t]; const s = (wy.idx[y * wy.taps + t] * ow + x) * 3; r += mid[s] * k; g += mid[s + 1] * k; b += mid[s + 2] * k; }
      const d = (y * ow + x) * 3; out[d] = r; out[d + 1] = g; out[d + 2] = b;
    }
    return out;
  };
  const modelOut = resize(pixels(ai), ai.naturalWidth, ai.naturalHeight);

  // the classical resampling of the original (Lanczos-3 up, with the anti-ringing clamp), for the blend
  const sdata = pixels(srcImg); const sw = srcImg.naturalWidth, sh = srcImg.naturalHeight;
  const classical = resize(sdata, sw, sh);
  for (let y = 0; y < oh; y += 1) {
    const cy = (y + 0.5) * sh / oh - 0.5; const y0 = Math.min(sh - 1, Math.max(0, Math.floor(cy))); const y1 = Math.min(sh - 1, y0 + 1);
    for (let x = 0; x < ow; x += 1) {
      const cx = (x + 0.5) * sw / ow - 0.5; const x0 = Math.min(sw - 1, Math.max(0, Math.floor(cx))); const x1 = Math.min(sw - 1, x0 + 1);
      const a = (y0 * sw + x0) * 4, b = (y0 * sw + x1) * 4, c = (y1 * sw + x0) * 4, d = (y1 * sw + x1) * 4; const o = (y * ow + x) * 3;
      for (let ch = 0; ch < 3; ch += 1) {
        const lo = Math.min(sdata[a + ch], sdata[b + ch], sdata[c + ch], sdata[d + ch]) - 3, hi = Math.max(sdata[a + ch], sdata[b + ch], sdata[c + ch], sdata[d + ch]) + 3;
        const v = classical[o + ch]; classical[o + ch] = v < lo ? lo : v > hi ? hi : v;
      }
    }
  }
  const mix = ${mix};
  const out = new Float32Array(ow * oh * 3);
  for (let i = 0; i < out.length; i += 1) out[i] = modelOut[i] * (1 - mix) + classical[i] * mix;

  let seed = 20261016; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const toCanvas = (x0, w) => {
    const c = document.createElement('canvas'); c.width = w; c.height = oh; const g = c.getContext('2d', { willReadFrequently: true });
    const id = g.createImageData(w, oh); const p = id.data;
    for (let y = 0; y < oh; y += 1) for (let x = 0; x < w; x += 1) {
      const s = (y * ow + x0 + x) * 3, d = (y * w + x) * 4; const n = (rnd() + rnd() - 1) * 1.6;
      p[d] = out[s] + n; p[d + 1] = out[s + 1] + n; p[d + 2] = out[s + 2] + n; p[d + 3] = 255;
    }
    g.putImageData(id, 0, 0); return c;
  };
  const phoneX0 = Math.round(ow * ${PHONE[0]}), phoneX1 = Math.round(ow * ${PHONE[1]});
  const wide = toCanvas(0, ow); const phone = toCanvas(phoneX0, phoneX1 - phoneX0);
  window.__wide = wide; window.__classical = classical; window.__model = modelOut; window.__dims = { ow, oh };
  return { ow, oh, phone: [phoneX1 - phoneX0, oh], aiSize: [ai.naturalWidth, ai.naturalHeight], wideUrl: wide.toDataURL('image/webp', ${QUALITY.wide}), phoneUrl: phone.toDataURL('image/webp', ${QUALITY.phone}) };
}`;

const REPORT_FN = `async () => {
  const { ow, oh } = window.__dims; const wide = window.__wide; const cl = window.__classical;
  const fd = wide.getContext('2d').getImageData(0, 0, ow, oh).data;
  const lap = (get, x0, y0, w, h) => { let s = 0, s2 = 0, n = 0; const L = (x, y) => get((y * ow + x)); for (let y = y0 + 1; y < y0 + h - 1; y += 1) for (let x = x0 + 1; x < x0 + w - 1; x += 1) { const v = 4 * L(x, y) - L(x - 1, y) - L(x + 1, y) - L(x, y - 1) - L(x, y + 1); s += v; s2 += v * v; n += 1; } return Math.round((s2 / n - (s / n) ** 2) * 10) / 10; };
  const lumaCl = (i) => 0.299 * cl[i * 3] + 0.587 * cl[i * 3 + 1] + 0.114 * cl[i * 3 + 2];
  const lumaFd = (i) => 0.299 * fd[i * 4] + 0.587 * fd[i * 4 + 1] + 0.114 * fd[i * 4 + 2];
  const regions = { person: [1400, 1420, 640, 700], milkyWay: [2000, 950, 640, 440], sky: [200, 120, 640, 440], valley: [200, 1750, 800, 300] };
  const metrics = {};
  for (const [name, [x, y, w, h]] of Object.entries(regions)) metrics[name] = { classical: lap(lumaCl, x, y, w, h), final: lap(lumaFd, x, y, w, h) };
  const cmp = (box) => { const [x, y, w, h] = box; const c = document.createElement('canvas'); c.width = w * 2 + 12; c.height = h; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); const id = g.createImageData(w, h); for (let yy = 0; yy < h; yy += 1) for (let xx = 0; xx < w; xx += 1) { const s = ((y + yy) * ow + x + xx) * 3, d = (yy * w + xx) * 4; id.data[d] = cl[s]; id.data[d + 1] = cl[s + 1]; id.data[d + 2] = cl[s + 2]; id.data[d + 3] = 255; } g.putImageData(id, 0, 0); g.drawImage(wide, x, y, w, h, w + 12, 0, w, h); return c.toDataURL('image/png'); };
  return { metrics, face: cmp([1380, 1430, 420, 360]), stars: cmp([2060, 1000, 420, 360]), valley: cmp([200, 1780, 420, 300]) };
}`;

const { made, report } = await withPage(async ({ send, evaluate, sleep }) => {
  await send('Page.navigate', { url: pathToFileURL(holder).href });
  await sleep(2500);
  const made = await evaluate(`(${PAGE_FN})()`);
  const report = reportDir ? await evaluate(`(${REPORT_FN})()`) : null;
  return { made, report };
});
const decode = (url) => Buffer.from(url.split(',')[1], 'base64');
writeFileSync(path.join(outDir, 'hero-night.webp'), decode(made.wideUrl));
writeFileSync(path.join(outDir, 'hero-night-sm.webp'), decode(made.phoneUrl));
console.log(JSON.stringify({ model: made.aiSize, wide: [made.ow, made.oh], phone: made.phone, mix, wideKB: Math.round(decode(made.wideUrl).length / 1024), phoneKB: Math.round(decode(made.phoneUrl).length / 1024) }));
if (report) {
  for (const k of ['face', 'stars', 'valley']) writeFileSync(path.join(path.resolve(reportDir), `ai-compare-${k}.png`), decode(report[k]));
  console.log(JSON.stringify(report.metrics, null, 1));
}
