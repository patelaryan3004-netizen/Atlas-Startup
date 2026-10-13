import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import { readFile, writeFile, access } from 'node:fs/promises';
import { main, checkPeople, checkInstitutions } from '../scripts/seeds.js';
import { tempDir, removeTempDirs } from './helpers/catalog.js';

afterEach(removeTempDirs);

const person = (over = {}) => ({
  id: 'ada-example', name: 'Ada Example', type: 'person', roleType: 'founder', title: 'Co-founder', orgName: 'Example Co', orgType: 'company', city: null,
  whyFollow: 'Built a thing people use.', sources: [{ label: 'Team page', url: 'https://example.example/team' }], confidence: 'high', verifiedAt: '2026-10-13', ...over,
});
const firm = (over = {}) => ({ id: 'example-vc', name: 'Example VC', website: 'https://vc.example', offices: [{ label: 'Sydney', address: '12 Example Street, Sydney NSW 2000', city: 'Sydney', state: 'NSW' }], ...over });

async function folders({ people, institutions } = {}) {
  const from = await tempDir();
  const data = await tempDir();
  if (people !== undefined) await writeFile(path.join(from, 'people_seed.json'), typeof people === 'string' ? people : JSON.stringify(people));
  if (institutions !== undefined) await writeFile(path.join(from, 'institutions_seed.json'), typeof institutions === 'string' ? institutions : JSON.stringify(institutions));
  return { from, data };
}
const run = async (args, dirs) => {
  const lines = [];
  const code = await main(args, { out: (s) => lines.push(s), dataDir: dirs.data, rootDir: dirs.from });
  return { code, text: lines.join('\n') };
};
const exists = (file) => access(file).then(() => true, () => false);

describe('checking the seeds', () => {
  it('says what the people file holds: by role, by confidence, the ones to re-check, the held (counted, never named) and the gaps it notes', async () => {
    const dirs = await folders({ people: { _readme: 'x', people: [person(), person({ id: 'b', name: 'Bea', roleType: 'operator', confidence: 'medium' }), person({ id: 'c', name: 'Cy', roleType: 'founder', confidence: 'medium', city: 'Perth' })],
      hold: [{ name: 'Secret Name (Org)', issue: 'unsure' }], gaps: ['No angels yet.'] } });
    const { code, text } = await run(['check'], dirs);
    expect(code).toBe(0);
    expect(text).toMatch(/3 people in the file, 3 meet every rule/);
    expect(text).toMatch(/by role: founder 2, operator 1/);
    expect(text).toMatch(/by confidence in the file: high 1, medium 2/);
    expect(text).toMatch(/not yet "high" \(re-check before anyone is shown\): 2/);
    expect(text).toMatch(/on hold, never shown: 1/);
    expect(text).toMatch(/gap noted in the file: No angels yet\./);
    expect(text).toMatch(/valid JSON; 0 problems/);
    expect(text).not.toMatch(/Secret Name|unsure/);
    expect(text).toMatch(/institutions_seed.json[\s\S]*not there/);
  });

  it('says what the institutions file holds: those with offices, those with none (listed, no pin), and the held', async () => {
    const dirs = await folders({ institutions: { institutions: [firm(), firm({ id: 'none', name: 'No Office Capital', offices: [] }), firm({ id: 'h', name: 'Held VC', placeholder: true })], hold: [{ name: 'Another', issue: 'y' }] } });
    const { code, text } = await run(['check'], dirs);
    expect(code).toBe(0);
    expect(text).toMatch(/2 institutions meet every rule: 1 with offices \(1 offices\), 1 with offices: \[\] \(listed, no pin\)/);
    expect(text).toMatch(/on hold, never shown: 2/);
    expect(text).not.toMatch(/Held VC|Another/);
  });

  it('names every problem in a file and exits 1, without changing anything', async () => {
    const dirs = await folders({ people: { people: [person(), person({ id: 'Bad Id', name: 'Bad' }), person({ id: 'long', name: 'Long', whyFollow: 'x'.repeat(141) })] } });
    const before = await readFile(path.join(dirs.from, 'people_seed.json'), 'utf8');
    const { code, text } = await run(['check'], dirs);
    expect(code).toBe(1);
    expect(text).toMatch(/3 people in the file, 1 meet every rule/);
    expect(text).toMatch(/person "Bad Id": id must be/);
    expect(text).toMatch(/person "long": whyFollow must be text of 140 characters or fewer/);
    expect(text).toMatch(/valid JSON; 2 problems/);
    expect(await readFile(path.join(dirs.from, 'people_seed.json'), 'utf8')).toBe(before);
  });

  it('says a file that is not JSON is not, and exits 1', async () => {
    const dirs = await folders({ people: '{ not json', institutions: JSON.stringify({ institutions: [firm()] }) });
    const { code, text } = await run(['check'], dirs);
    expect(code).toBe(1);
    expect(text).toMatch(/people_seed.json is not valid JSON/);
    expect(text).toMatch(/1 institutions meet every rule/);
  });

  it('exits 2 when neither file is there', async () => {
    const { code, text } = await run(['check'], await folders());
    expect(code).toBe(2);
    expect(text).toMatch(/Neither file is there/);
  });

  it('reads from the folder it is told to', async () => {
    const dirs = await folders({ people: { people: [person()] } });
    const elsewhere = await tempDir();
    const lines = [];
    const code = await main(['check', '--from', elsewhere], { out: (s) => lines.push(s), dataDir: dirs.data, rootDir: dirs.from });
    expect(code).toBe(2); // the folder it was told to read has neither
    expect(lines.join('\n')).toContain(elsewhere);
  });
});

describe('installing the seeds', () => {
  it('copies a valid file where the server reads it, and says so', async () => {
    const dirs = await folders({ people: { people: [person()] }, institutions: { institutions: [firm()] } });
    const { code, text } = await run(['install'], dirs);
    expect(code).toBe(0);
    expect(text).toMatch(/installed people_seed.json/);
    expect(text).toMatch(/installed institutions_seed.json/);
    expect(JSON.parse(await readFile(path.join(dirs.data, 'people_seed.json'), 'utf8')).people[0].id).toBe('ada-example');
    expect(await exists(path.join(dirs.data, 'institutions_seed.json'))).toBe(true);
  });

  it('installs only the file that is there, and nothing when there is none', async () => {
    const dirs = await folders({ people: { people: [person()] } });
    await run(['install'], dirs);
    expect(await exists(path.join(dirs.data, 'people_seed.json'))).toBe(true);
    expect(await exists(path.join(dirs.data, 'institutions_seed.json'))).toBe(false);
  });

  it('does not install a file with a problem, or one that is not JSON, and leaves what is installed as it was', async () => {
    const dirs = await folders({ people: { people: [person({ id: 'Bad Id' })] }, institutions: '{ nope' });
    await writeFile(path.join(dirs.data, 'people_seed.json'), '{"people":[]}');
    const { code, text } = await run(['install'], dirs);
    expect(code).toBe(1);
    expect(text).toMatch(/was not installed/);
    expect(await readFile(path.join(dirs.data, 'people_seed.json'), 'utf8')).toBe('{"people":[]}');
    expect(await exists(path.join(dirs.data, 'institutions_seed.json'))).toBe(false);
  });

  it('installs a file with a problem only when told to (--force)', async () => {
    const dirs = await folders({ people: { people: [person(), person({ id: 'Bad Id' })] } });
    const { code } = await run(['install', '--force'], dirs);
    expect(code).toBe(1); // still says there was a problem
    expect(JSON.parse(await readFile(path.join(dirs.data, 'people_seed.json'), 'utf8')).people).toHaveLength(2);
  });

  it('refuses a command it does not know', async () => {
    await expect(run(['publish'], await folders())).rejects.toThrow(/unknown command "publish"/);
  });
});

describe('the summaries', () => {
  it('count the people and the offices without naming anyone held', () => {
    const people = checkPeople({ people: [person()], hold: [{ name: 'Held Name', issue: 'x' }] });
    expect(people.problems).toEqual([]);
    expect(people.lines.join('\n')).toMatch(/on hold, never shown: 1/);
    expect(people.lines.join('\n')).not.toContain('Held Name');
    expect(checkInstitutions({ institutions: [firm()] }).lines[0]).toMatch(/1 with offices \(1 offices\)/);
  });
});
