import { Router } from 'express';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { requireAdminKey } from '../middleware/requireAdminKey.js';
import { cursorParams, cursorPage } from '../http/paging.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, '..', 'data', 'submissions.json');

async function loadSubmissions() {
  const raw = await readFile(DATA_PATH, 'utf-8');
  return JSON.parse(raw);
}

const router = Router();

// GET /api/submissions — pending submissions queue (for review). Contains
// submitter emails, so it's gated behind ADMIN_KEY rather than left public.
// Oldest first, a page at a time: this only grows, so the next page is asked for by cursor (the last row seen), which a row added
// meanwhile cannot move. { count, results, limit, hasMore, nextCursor }: 20 to a page, `limit` up to 100, and cursor=<nextCursor>
// for the next. count is every row in the queue.
router.get('/', requireAdminKey, async (req, res, next) => {
  try {
    const submissions = await loadSubmissions();
    res.json({ count: submissions.length, ...cursorPage(submissions, cursorParams(req.query)) });
  } catch (err) {
    next(err);
  }
});

// The submit form's newer fields (city, the submitter's role, whether they want to claim the profile) are kept as short plain text, and
// anything that is not text is left empty rather than refused: a form that sends them blank is the same as an older form that sends none.
const shortText = (value) => (typeof value === 'string' ? value.trim().slice(0, 200) : '');
const CLAIMS = new Set(['yes', 'no']);

// POST /api/submissions — company name + one-line description required
router.post('/', async (req, res, next) => {
  try {
    const { name, description, website = '', stage = '', email = '', hiringUrl = '', city, role, claim } = req.body || {};

    if (!name || !name.trim() || !description || !description.trim()) {
      return res.status(400).json({ error: 'name and description are required' });
    }

    const submissions = await loadSubmissions();
    const submission = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: name.trim(),
      description: description.trim(),
      website: website.trim(),
      city: shortText(city),
      role: shortText(role),
      claim: CLAIMS.has(shortText(claim).toLowerCase()) ? shortText(claim).toLowerCase() : '',
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
