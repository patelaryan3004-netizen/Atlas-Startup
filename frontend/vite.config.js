import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/directory': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.js'],
    globals: true,
    // Rendering a page of cards in jsdom takes a second or two under coverage on a busy machine; a slow run must not
    // read as a failure (and a test that times out leaves its state behind for the next).
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{js,jsx}'],
      // main.jsx only mounts the app. The shadcn/ui and AI Elements files (ui/, ai-elements/, lib/utils.js, added by the
      // shadcn setup) are generated library components that nothing in the app imports yet, so there is nothing of ours
      // in them for a test to cover; counted, they would show as 0% and hide how well the app's own code is covered.
      exclude: ['src/main.jsx', 'src/components/ui/**', 'src/components/ai-elements/**', 'src/lib/utils.js'],
    },
  },
});
