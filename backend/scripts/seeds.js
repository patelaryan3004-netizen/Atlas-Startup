// The owner's two reviewed files, people_seed.json and institutions_seed.json: check them, and put them where the server reads them.
//
//   node scripts/seeds.js check   [--from <folder>]            what each file holds and every problem in it (default folder: the project root)
//   node scripts/seeds.js install [--from <folder>] [--force]  check, then copy the files that are there into backend/src/data, where the server
//                                                             reads them. A file with a problem is NOT installed unless --force: the server
//                                                             would leave the entry out and say so, but a slip is better found here.
//
// Nothing is changed in either file. An entry in "hold" is only counted, never listed or served; an entry with offices: [] is listed with no pin.
// Exit code: 0 ok, 1 a problem (or a file that is not JSON), 2 nothing to check.
import os from 'node:os';
import path from 'node:path';
import { copyFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { checkSeed } from '../src/models/community.js';
import { checkInstitutionSeed } from '../src/models/institutionSeed.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(HERE, '..', 'src', 'data');
const ROOT = path.join(HERE, '..', '..');
const FILES = { people: 'people_seed.json', institutions: 'institutions_seed.json' };

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) { positional.push(argv[i]); continue; }
    const next = argv[i + 1];
    flags[argv[i].slice(2)] = next === undefined || next.startsWith('--') ? true : (i += 1, next);
  }
  return { positional, flags };
}

async function read(file) {
  try { return { json: JSON.parse(await readFile(file, 'utf8')) }; } catch (err) {
    if (err.code === 'ENOENT') return { missing: true };
    return { error: `${path.basename(file)} is not valid JSON: ${err.message}` };
  }
}

const tally = (rows, key) => rows.reduce((acc, row) => ({ ...acc, [row[key] ?? 'none']: (acc[row[key] ?? 'none'] ?? 0) + 1 }), {});
const show = (counts) => Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ');

// What the people file holds, and what is wrong with it.
export function checkPeople(json) {
  const checked = checkSeed(json, { production: true });
  const entries = Array.isArray(json?.people) ? json.people : [];
  const lines = [`${entries.length} people in the file, ${checked.people.length} meet every rule`];
  if (checked.people.length) {
    lines.push(`  by role: ${show(tally(checked.people, 'roleType'))}`);
    lines.push(`  by confidence in the file: ${show(tally(entries, 'confidence'))}`);
    lines.push(`  with a city: ${checked.people.filter((p) => p.city).length}, with a source: ${checked.people.filter((p) => p.sources.length).length}, with a vouch the person agreed to: ${checked.people.filter((p) => p.vouches.length).length}`);
  }
  const medium = entries.filter((p) => p.confidence && p.confidence !== 'high');
  if (medium.length) lines.push(`  not yet "high" (re-check before anyone is shown): ${medium.length}`);
  const held = Array.isArray(json?.hold) ? json.hold.length : 0;
  lines.push(`  on hold, never shown: ${held}`);
  for (const gap of Array.isArray(json?.gaps) ? json.gaps : []) lines.push(`  gap noted in the file: ${gap}`);
  return { lines, problems: checked.problems };
}

export function checkInstitutions(json) {
  const checked = checkInstitutionSeed(json);
  const withOffices = checked.institutions.filter((i) => i.offices.length > 0);
  const lines = [
    `${checked.institutions.length} institutions meet every rule: ${withOffices.length} with offices (${withOffices.reduce((n, i) => n + i.offices.length, 0)} offices), ${checked.institutions.length - withOffices.length} with offices: [] (listed, no pin)`,
    `  on hold, never shown: ${checked.held.length}`,
  ];
  return { lines, problems: checked.problems };
}

export async function main(argv, deps = {}) {
  const { out = (s) => console.log(s), dataDir = DATA_DIR, rootDir = ROOT } = deps;
  const { positional: [command], flags } = parseArgs(argv);
  if (!command || command === 'help') { out('Commands: check, install. See scripts/seeds.js.'); return 0; }
  if (!['check', 'install'].includes(command)) throw new Error(`unknown command "${command}"`);
  const from = typeof flags.from === 'string' ? path.resolve(flags.from) : rootDir;

  let found = 0;
  let bad = 0;
  const ready = [];
  for (const [kind, name] of Object.entries(FILES)) {
    const file = path.join(from, name);
    const got = await read(file);
    out(`\n${name}  (${file})`);
    if (got.missing) { out('  not there'); continue; }
    found += 1;
    if (got.error) { out(`  ${got.error}`); bad += 1; continue; }
    const { lines, problems } = kind === 'people' ? checkPeople(got.json) : checkInstitutions(got.json);
    for (const line of lines) out(`  ${line}`);
    out(`  valid JSON; ${problems.length} problem${problems.length === 1 ? '' : 's'}`);
    for (const p of problems) out(`    - ${p}`);
    if (problems.length) bad += 1;
    else ready.push({ name, file });
  }
  if (found === 0) { out('\nNeither file is there.'); return 2; }

  if (command === 'install') {
    const toCopy = flags.force ? [...ready, ...Object.values(FILES).map((name) => ({ name, file: path.join(from, name) }))].filter((r, i, all) => all.findIndex((x) => x.name === r.name) === i) : ready;
    for (const { name, file } of toCopy) {
      if ((await read(file)).missing) continue;
      await copyFile(file, path.join(dataDir, name));
      out(`\ninstalled ${name} -> ${path.join(dataDir, name)}`);
    }
    if (bad && !flags.force) out('\nA file with a problem was not installed (--force installs it anyway: the server leaves out the entries that fail).');
  }
  return bad ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { os.setPriority(0, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* not allowed here: carry on */ }
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (err) => { console.error(`error: ${err.message}`); process.exitCode = 1; });
}
