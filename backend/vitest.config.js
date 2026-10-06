import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Many tests run the real store, worker or scheduler against real files in a temp folder; a few take a few seconds
    // on a busy machine, and a slow run must not read as a failure.
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.js'],
      // The Command Center's page (src/admin/ui) is browser code served as static files; Node never runs it. Its
      // structure is checked by adminUi.test.js and its behaviour by looking at it in a browser, so it is not counted.
      exclude: ['src/server.js', 'src/data/**', 'src/admin/ui/**'],
    },
  },
});
