import { Router } from 'express';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { requireAdminKey } from '../middleware/requireAdminKey.js';
import { cursorParams, cursorPage } from '../http/paging.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, '..', 'data', 'feedback.json');

// 'investor' is a suggestion for the investor directory (an investor to add); a person checks it against pages the investor publishes itself.
// 'subscribe' is an address left on the welcome page to hear from the site: it needs a valid email and no message (the page says where it was left).
const TYPES = ['feedback', 'feature', 'bug', 'investor', 'subscribe'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SUBSCRIBE_NOTE = 'Signed up to hear from Still Early';

async function loadFeedback() {
  const raw = await readFile(DATA_PATH, 'utf-8');
  return JSON.parse(raw);
}

const router = Router();

// GET /api/feedback — pending queue (for review). Contains submitter
// emails, so it's gated behind ADMIN_KEY rather than left public.
// Oldest first, a page at a time: this only grows, so the next page is asked for by cursor (the last row seen), which a row added
// meanwhile cannot move. { count, results, limit, hasMore, nextCursor }: 20 to a page, `limit` up to 100, and cursor=<nextCursor>
// for the next. count is every row in the queue.
router.get('/', requireAdminKey, async (req, res, next) => {
  try {
    const items = await loadFeedback();
    res.json({ count: items.length, ...cursorPage(items, cursorParams(req.query)) });
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
    if (type === 'subscribe') {
      const address = typeof email === 'string' ? email.trim() : '';
      if (!address || address.length > 254 || !EMAIL.test(address)) return res.status(400).json({ error: 'a valid email is required' });
    } else if (!message || !message.trim()) {
      return res.status(400).json({ error: 'message is required' });
    }

    const items = await loadFeedback();
    const item = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      message: typeof message === 'string' && message.trim() ? message.trim().slice(0, 200) : SUBSCRIBE_NOTE,
      email: String(email).trim(),
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
