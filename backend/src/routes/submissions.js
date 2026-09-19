import { Router } from 'express';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, '..', 'data', 'submissions.json');

async function loadSubmissions() {
  const raw = await readFile(DATA_PATH, 'utf-8');
  return JSON.parse(raw);
}

const router = Router();

// GET /api/submissions — pending submissions queue (for review)
router.get('/', async (req, res, next) => {
  try {
    const submissions = await loadSubmissions();
    res.json({ count: submissions.length, results: submissions });
  } catch (err) {
    next(err);
  }
});

// POST /api/submissions — company name + one-line description required
router.post('/', async (req, res, next) => {
  try {
    const { name, description, website = '', stage = '', email = '', hiringUrl = '' } = req.body || {};

    if (!name || !name.trim() || !description || !description.trim()) {
      return res.status(400).json({ error: 'name and description are required' });
    }

    const submissions = await loadSubmissions();
    const submission = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: name.trim(),
      description: description.trim(),
      website: website.trim(),
      stage: stage.trim(),
      email: email.trim(),
      hiringUrl: hiringUrl.trim(),
      status: 'pending',
      submittedAt: new Date().toISOString(),
    };
    submissions.push(submission);
    await writeFile(DATA_PATH, JSON.stringify(submissions, null, 2) + '\n', 'utf-8');

    res.status(201).json(submission);
  } catch (err) {
    next(err);
  }
});

export default router;
