import '@testing-library/jest-dom/vitest';
import { beforeEach, vi } from 'vitest';
import { configure } from '@testing-library/react';

// A page that is a file of its own (the gallery's, a view's) is loaded by the first test that shows it, and the first load is slower than the rest: wait for it.
configure({ asyncUtilTimeout: 4000 });

// The People and Institutions side of the site is off in a real build unless VITE_SHOW_PEOPLE is set (src/flags.js). The tests of that side
// run with it on; a test of the switch turns it off with vi.stubEnv('VITE_SHOW_PEOPLE', ''), or back to the real default with vi.unstubAllEnvs().
beforeEach(() => { vi.stubEnv('VITE_SHOW_PEOPLE', '1'); });
