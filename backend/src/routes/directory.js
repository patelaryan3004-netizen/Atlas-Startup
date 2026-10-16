import { Router } from 'express';
import { HttpError } from '../catalog/respond.js';

const PAGE_SIZE = 250;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '');

// What the page may say about hiring: a company is "Yes" only when a page confirmed its open roles recently; a reading from earlier is said
// with its date, a job board that lists none is said so, and everything else is unverified, never "No".
function hiringCell(s) {
  if (s.hiring) return 'Yes';
  if (s.hiringState === 'checked') return `Checked ${esc(day(s.hiring_checked_at))}`;
  if (s.hiringState === 'none') return `No open roles listed (${esc(day(s.hiring_checked_at))})`;
  return 'Roles unverified';
}

function pageHtml(snap, page) {
  const pages = Math.max(1, Math.ceil(snap.count / PAGE_SIZE));
  if (page > pages) throw new HttpError(404, 'There is no such page');
  const start = (page - 1) * PAGE_SIZE;
  const rows = Array.from(snap.orders.name.subarray(start, start + PAGE_SIZE), (i) => {
    const s = snap.records[i];
    return `
      <tr>
        <td>${esc(s.name)}</td>
        <td>${esc(s.sectorFull || s.sector)}</td>
        <td>${esc(s.city)}</td>
        <td>${esc(s.stage)}</td>
        <td>${hiringCell(s)}</td>
        <td>${s.website_status === 'unavailable' ? '<span class="muted">Website unavailable</span>' : s.website ? `<a href="${esc(s.website)}">${esc(s.website.replace(/^https?:\/\//, ''))}</a>` : ''}</td>
      </tr>`;
  }).join('');
  const link = (n, label) => `<a href="/directory${n > 1 ? `?page=${n}` : ''}">${label}</a>`;
  const nav = pages > 1
    ? `<p class="pages">Page ${page} of ${pages}: ${page > 1 ? `${link(page - 1, 'previous')} ` : ''}${page < pages ? link(page + 1, 'next') : ''}</p>`
    : '';
  const rel = `${page > 1 ? `<link rel="prev" href="/directory${page > 2 ? `?page=${page - 1}` : ''}">` : ''}${page < pages ? `<link rel="next" href="/directory?page=${page + 1}">` : ''}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Still Early directory — full list${pages > 1 ? ` (page ${page})` : ''}</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${rel}
<style>
  :root{--bg:#ffffff;--surface:#fafaf7;--border:#e2e5e0;--text:#171c19;--muted:#626a65;--accent:#234b3a;--accent-ink:#234b3a;}
  body{font-family:'Inter',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;max-width:1120px;margin:0 auto;padding:24px 16px;background:var(--bg);color:var(--text);font-size:15px;line-height:1.5;}
  h1{font-size:22px;letter-spacing:-.01em;} p{color:var(--muted);font-size:15px;}
  table{width:100%;border-collapse:collapse;}
  th,td{text-align:left;padding:8px 12px;border-bottom:1px solid var(--border);vertical-align:top;}
  th{background:var(--surface);font-weight:600;font-size:13px;color:var(--muted);}
  a{color:var(--accent-ink);} a:focus-visible{outline:2px solid var(--accent);outline-offset:3px;border-radius:4px;}
  .muted{color:var(--muted);}
</style>
</head>
<body>
<h1>Still Early directory — full list (${snap.count} companies)</h1>
<p>Static, no-JavaScript list. For the interactive map, filters, and pins, see <a href="/">the map</a>.</p>
${nav}
<table>
<thead><tr><th>Company</th><th>Sector</th><th>City</th><th>Stage</th><th>Hiring</th><th>Website</th></tr></thead>
<tbody>${rows}</tbody>
</table>
${nav}
</body>
</html>`;
}

// GET /directory[?page=n] — plain server-rendered HTML list of every company, 250 to a page, by name.
// No JavaScript required: works for crawlers, screen readers, and the <noscript> fallback link in the SPA.
export function createDirectoryRouter({ respond }) {
  const router = Router();
  router.get('/', (req, res, next) => {
    const page = req.query.page === undefined ? 1 : Number(req.query.page);
    if (!Number.isInteger(page) || page < 1) return res.status(400).type('text/plain').send('page must be a whole number from 1');
    return respond(req, res, (snap) => pageHtml(snap, page), { key: `directory?page=${page}`, type: 'text/html; charset=utf-8' }).catch(next);
  });
  return router;
}
