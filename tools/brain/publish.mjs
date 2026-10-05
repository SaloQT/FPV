// Copies brain files into public/brains (named after the file) and rebuilds public/brains/index.json from every brain there.
//
//   node tools/brain/publish.mjs .bench/brain/roster/ace.json .bench/brain/roster/dash.json
//   node tools/brain/publish.mjs            (only rebuilds the index)
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { loadTrainer, ROOT } from './bundle.mjs';

const t = await loadTrainer();
const dir = resolve(ROOT, 'public/brains');
await mkdir(dir, { recursive: true });
for (const f of process.argv.slice(2)) {
  const brain = t.parseBrain(await readFile(resolve(ROOT, f), 'utf8'));
  brain.name = basename(f, '.json');
  await writeFile(resolve(dir, `${brain.name}.json`), t.serializeBrain(brain));
  console.log(`published ${brain.name}`);
}
const brains = [];
for (const file of (await readdir(dir)).filter((n) => n.endsWith('.json') && n !== 'index.json').sort()) {
  const b = t.parseBrain(await readFile(resolve(dir, file), 'utf8'));
  brains.push({ file, name: b.name, stats: b.stats });
}
await writeFile(resolve(dir, 'index.json'), `${JSON.stringify({ brains }, null, 1)}\n`);
console.log(`index: ${brains.map((b) => b.name).join(', ')}`);
process.exit(0);
