// A catalog (and an app over it) on synthetic companies in a temporary folder, for the scale and API tests.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../../src/app.js';
import { createCatalog } from '../../src/catalog/catalog.js';
import { generateCompanies, writeFixture } from '../../scripts/scale/fixtures.js';

const made = [];
export async function tempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'au-catalog-test-'));
  made.push(dir);
  return dir;
}
export async function removeTempDirs() {
  await Promise.all(made.splice(0).map((d) => rm(d, { recursive: true, force: true })));
}

// n synthetic companies; the catalog is loaded and ready, and `rewrite(rows)` changes the file under it.
export async function fixture(n, { seed = 1, cache, reloadMs = 0 } = {}) {
  const dir = await tempDir();
  const file = await writeFixture(n, dir, { seed });
  const catalog = createCatalog({ file, reloadMs });
  await catalog.refresh();
  const app = createApp({ catalog, cache });
  return {
    dir, file, catalog, app, rows: generateCompanies(n, { seed }),
    rewrite: (rows) => writeFile(file, `${JSON.stringify(rows, null, 2)}\n`),
  };
}
