import express from 'express';
import cors from 'cors';
import startupsRouter from './routes/startups.js';
import newsRouter from './routes/news.js';
import submissionsRouter from './routes/submissions.js';
import editsRouter from './routes/edits.js';
import directoryRouter from './routes/directory.js';
import feedbackRouter from './routes/feedback.js';

const app = express();

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/startups', startupsRouter);
app.use('/api/news', newsRouter);
app.use('/api/submissions', submissionsRouter);
app.use('/api/edits', editsRouter);
app.use('/api/feedback', feedbackRouter);
app.use('/directory', directoryRouter);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

export default app;
