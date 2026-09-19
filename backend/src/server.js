import app from './app.js';

const PORT = process.env.PORT || process.env.BACKEND_PORT || 4000;

app.listen(PORT, () => {
  console.log(`au-startup-map backend listening on http://localhost:${PORT}`);
});
