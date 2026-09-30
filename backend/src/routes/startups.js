import { Router } from 'express';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, '..', 'data', 'startups.json');

async function loadStartups() {
  const raw = await readFile(DATA_PATH, 'utf-8');
  return JSON.parse(raw);
}

const router = Router();

// A bare value matches exactly, same as before. A comma-separated value (only
// ever sent by curated lists that roll up several real sector/city strings,
// e.g. "HealthTech,Healthtech") matches any one of them - still an exact
// membership check, just against a set instead of a single string.
function matchesAny(value, param) {
  if (!param) return true;
  return String(param).split(',').includes(value);
}

// GET /api/startups?search=&sector=&city=&investor=&stage=&hiring=yes|no&taskGate=yes|no
router.get('/', async (req, res, next) => {
  try {
    const startups = await loadStartups();
    const { search, sector, city, investor, stage, hiring, taskGate } = req.query;

    const filtered = startups.filter((s) => {
      if (search) {
        const q = String(search).toLowerCase();
        const nameMatch = s.name.toLowerCase().includes(q);
        const founderMatch = (s.founders || []).some((f) => f.toLowerCase().includes(q));
        if (!nameMatch && !founderMatch) return false;
      }
      if (!matchesAny(s.sector, sector)) return false;
      if (!matchesAny(s.city, city)) return false;
      if (investor && !s.investors.includes(investor)) return false;
      if (stage && s.stage !== stage) return false;
      if (hiring === 'yes' && !s.hiring) return false;
      if (hiring === 'no' && s.hiring) return false;
      if (taskGate === 'yes' && !s.taskGate?.enabled) return false;
      if (taskGate === 'no' && s.taskGate?.enabled) return false;
      return true;
    });

    res.json({ total: startups.length, count: filtered.length, results: filtered });
  } catch (err) {
    next(err);
  }
});

// GET /api/startups/meta — distinct filter option values, for populating dropdowns
router.get('/meta', async (req, res, next) => {
  try {
    const startups = await loadStartups();
    const uniqueSorted = (arr) => [...new Set(arr)].sort();
    res.json({
      sectors: uniqueSorted(startups.map((s) => s.sector)),
      cities: uniqueSorted(startups.map((s) => s.city)),
      investors: uniqueSorted(startups.flatMap((s) => s.investors)),
      stages: uniqueSorted(startups.map((s) => s.stage)),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
