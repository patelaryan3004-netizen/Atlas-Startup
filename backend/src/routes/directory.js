import { Router } from 'express';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, '..', 'data', 'startups.json');

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const router = Router();

// GET /directory — plain server-rendered HTML list of every company.
// No JavaScript required: works for crawlers, screen readers, and the
// <noscript> fallback link in the SPA.
router.get('/', async (req, res, next) => {
  try {
    const raw = await readFile(DATA_PATH, 'utf-8');
    const startups = JSON.parse(raw).sort((a, b) => a.name.localeCompare(b.name));

    const rows = startups.map((s) => `
      <tr>
        <td>${esc(s.name)}</td>
        <td>${esc(s.sectorFull || s.sector)}</td>
        <td>${esc(s.city)}</td>
        <td>${esc(s.stage)}</td>
        <td>${s.hiring ? 'Yes' : 'No'}</td>
        <td>${s.website ? `<a href="${esc(s.website)}">${esc(s.website.replace(/^https?:\/\//, ''))}</a>` : ''}</td>
      </tr>`).join('');

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>AU Startup Directory — full list</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
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
<h1>AU Startup Directory — full list (${startups.length} companies)</h1>
<p>Static, no-JavaScript list. For the interactive map, filters, and pins, see <a href="/">the map</a>.</p>
<table>
<thead><tr><th>Company</th><th>Sector</th><th>City</th><th>Stage</th><th>Hiring</th><th>Website</th></tr></thead>
<tbody>${rows}</tbody>
</table>
</body>
</html>`);
  } catch (err) {
    next(err);
  }
});

export default router;
