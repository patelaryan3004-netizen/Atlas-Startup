import { Router } from 'express';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, '..', 'data', 'editSuggestions.json');

async function loadEdits() {
  const raw = await readFile(DATA_PATH, 'utf-8');
  return JSON.parse(raw);
}

const router = Router();

// GET /api/edits — pending edit-suggestion queue (for review)
router.get('/', async (req, res, next) => {
  try {
    const edits = await loadEdits();
    res.json({ count: edits.length, results: edits });
  } catch (err) {
    next(err);
  }
});

// POST /api/edits — company + what's wrong are required. Reviewed manually
// before anything in startups.json changes — never auto-applied.
router.post('/', async (req, res, next) => {
  try {
    const { company, message, email = '' } = req.body || {};

    if (!company || !company.trim() || !message || !message.trim()) {
      return res.status(400).json({ error: 'company and message are required' });
    }

    const edits = await loadEdits();
    const edit = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      company: company.trim(),
      message: message.trim(),
      email: email.trim(),
      status: 'pending',
      submittedAt: new Date().toISOString(),
    };
    edits.push(edit);
    await writeFile(DATA_PATH, JSON.stringify(edits, null, 2) + '\n', 'utf-8');

    res.status(201).json(edit);
  } catch (err) {
    next(err);
  }
});

export default router;
