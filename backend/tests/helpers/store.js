// A real data directory in the OS temp folder, for tests that exercise the store, the
// worker and the Command Center against actual files.
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { serializeDataset, writeFiles, migrateDataset, loadRaw, parseRaw } from '../../src/models/dataset.js';

const made = [];

// Writes a dataset (migrated, so it is valid as the shipped files are) to a new directory.
export async function makeDataDir(ds) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'austartup-data-'));
  made.push(dir);
  await writeFiles(dir, serializeDataset(migrateDataset(ds)));
  return dir;
}

export async function readDataDir(dir) {
  return parseRaw(await loadRaw(dir));
}

export async function removeMadeDirs() {
  await Promise.all(made.splice(0).map((d) => rm(d, { recursive: true, force: true })));
}
