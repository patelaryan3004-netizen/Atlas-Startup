import { Router } from 'express';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, '..', 'data', 'feedback.json');

const TYPES = ['feedback', 'feature', 'bug'];

async function loadFeedback() {
  const raw = await readFile(DATA_PATH, 'utf-8');
  return JSON.parse(raw);
}

const router = Router();

// GET /api/feedback — pending queue (for review)
router.get('/', async (req, res, next) => {
  try {
    const items = await loadFeedback();
    res.json({ count: items.length, results: items });
  } catch (err) {
    next(err);
  }
});

// POST /api/feedback — type + message are required. Site-wide feedback,
// distinct from /api/edits (which is scoped to one company's listing).
router.post('/', async (req, res, next) => {
  try {
    const { type, message, email = '' } = req.body || {};

    if (!TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${TYPES.join(', ')}` });
    }
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'message is required' });
    }

    const items = await loadFeedback();
    const item = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      message: message.trim(),
      email: email.trim(),
      status: 'pending',
      submittedAt: new Date().toISOString(),
    };
    items.push(item);
    await writeFile(DATA_PATH, JSON.stringify(items, null, 2) + '\n', 'utf-8');

    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
});

export default router;
