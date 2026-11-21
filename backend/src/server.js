import app from './app.js';

// Render sets both RENDER and PORT; only honor PORT there, so a stray PORT
// leaked into local dev (e.g. via the harness's own concurrently setup)
// doesn't collide with the frontend's port.
const PORT = (process.env.RENDER && process.env.PORT) || process.env.BACKEND_PORT || 4000;

app.listen(PORT, () => {
  console.log(`au-startup-map backend listening on http://localhost:${PORT}`);
  // Bring the database's tables up to date now (when there is one), so the first sign-up does not wait for it. A failure is logged by its code and tried again on the next sign-up.
  const database = app.locals.network?.database;
  if (database) database.ready().then(() => console.log('[db] ready'), (err) => console.error(`[db] could not be made ready (${err?.code ?? err?.name ?? 'error'})`));
});
