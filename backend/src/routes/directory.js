import { Router } from 'express';
import { HttpError } from '../catalog/respond.js';

const PAGE_SIZE = 250;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
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
        <td>${s.hiring ? 'Yes' : 'No'}</td>
        <td>${s.website ? `<a href="${esc(s.website)}">${esc(s.website.replace(/^https?:\/\//, ''))}</a>` : ''}</td>
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
<title>AU Startup Directory — full list${pages > 1 ? ` (page ${page})` : ''}</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${rel}
<style>
  body{font-family:Georgia,serif;max-width:1000px;margin:24px auto;padding:0 16px;color:#12130f;}
  h1{font-size:22px;} p{color:#5a5648;font-size:14px;}
  table{width:100%;border-collapse:collapse;font-size:14px;}
  th,td{text-align:left;padding:6px 10px;border-bottom:1px solid #d8d2c2;}
  th{background:#f6f3ec;}
  a{color:#c05a2e;}
</style>
</head>
<body>
<h1>AU Startup Directory — full list (${snap.count} companies)</h1>
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
