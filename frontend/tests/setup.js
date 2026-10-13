import '@testing-library/jest-dom/vitest';
import { beforeEach, vi } from 'vitest';

// The People and Institutions side of the site is off in a real build unless VITE_SHOW_PEOPLE is set (src/flags.js). The tests of that side
// run with it on; a test of the switch turns it off with vi.stubEnv('VITE_SHOW_PEOPLE', ''), or back to the real default with vi.unstubAllEnvs().
beforeEach(() => { vi.stubEnv('VITE_SHOW_PEOPLE', '1'); });
