import app from './app.js';

// Render sets both RENDER and PORT; only honor PORT there, so a stray PORT
// leaked into local dev (e.g. via the harness's own concurrently setup)
// doesn't collide with the frontend's port.
const PORT = (process.env.RENDER && process.env.PORT) || process.env.BACKEND_PORT || 4000;

app.listen(PORT, () => {
  console.log(`au-startup-map backend listening on http://localhost:${PORT}`);
});
