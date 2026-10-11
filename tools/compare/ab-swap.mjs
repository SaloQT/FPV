// Interleaved A/B renders with tools/tree-shots.mjs. B is the working tree. A is a scratch copy of src/ under .bench/ab/<prefix>-A/, with
// the files of --a <dir> laid over it (matched by file name to the paths below) and, with --oak, the old oak sprig setting (9 at 0.52 m).
// The working tree is never written to: A renders through tree-shots --source. Waits while the GPU lock is busy.
// Usage: node tools/compare/ab-swap.mjs --prefix p --rounds 2 [--a dir] [--oak] [--only-a | --only-b] -- <tree-shots args without --out>
// Writes .bench/trees/<prefix>-<A|B>-<round>/. Run it from the repo root, or from a sub-shell: ( cd <repo> && node tools/compare/ab-swap.mjs ... ).
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PATHS = ['src/render/vegetation/placementRules.ts', 'src/render/vegetation/treePlan.ts', 'src/render/vegetation/params.ts', 'src/render/vegetation/variants.ts',
  'src/render/vegetation/placement.ts', 'src/render/shaders/vegetation/veg_far.wgsl', 'src/render/shaders/vegetation/tree_bark.wgsl', 'src/render/vegetation/treePlanBroad.ts',
  'src/render/vegetation/treeGen.ts', 'src/render/shaders/vegetation/tree.wgsl', 'src/render/shaders/rt/rt_bvh.wgsl', 'src/render/shaders/rt/rt_canopy.wgsl',
  'src/render/vegetation/colliders.ts', 'src/render/vegetation/index.ts', 'src/render/shaders/rt/rt_scene.wgsl', 'src/render/shaders/rt/shadow.wgsl',
  'src/render/shaders/rt/aux_pass.wgsl', 'src/render/shaders/rt/rt_trace_io.wgsl', 'src/render/terrain/canopyShadow.ts'];
const OAK_FILE = 'src/render/vegetation/treePlanBroad.ts', OAK_B = 'cardsPerCluster: 11, cardSize: 0.45', OAK_A = 'cardsPerCluster: 9, cardSize: 0.52';

const argv = process.argv.slice(2), split = argv.indexOf('--');
const own = split < 0 ? argv : argv.slice(0, split), shots = split < 0 ? [] : argv.slice(split + 1);
const opt = (k) => { const i = own.indexOf(`--${k}`); return i < 0 ? null : own[i + 1] && !own[i + 1].startsWith('--') ? own[i + 1] : '1'; };
const prefix = opt('prefix') ?? 'ab', rounds = Number(opt('rounds') ?? 1), aDir = opt('a'), oak = !!opt('oak'), onlyA = !!opt('only-a'), onlyB = !!opt('only-b');

/** The A side's copy: the working tree's src/ as it is now, with the A files laid over it. Built once per run. */
function makeA() {
  const copy = resolve(ROOT, '.bench/ab', `${prefix}-A`);
  rmSync(copy, { recursive: true, force: true });
  cpSync(resolve(ROOT, 'src'), resolve(copy, 'src'), { recursive: true });
  if (aDir) for (const p of PATHS) {
    const from = resolve(aDir, basename(p));
    if (existsSync(from)) cpSync(from, resolve(copy, p));
  }
  if (oak) {
    const path = resolve(copy, OAK_FILE), text = readFileSync(path, 'utf8');
    if (!text.includes(OAK_B)) throw new Error('current oak setting not found');
    writeFileSync(path, text.replace(OAK_B, OAK_A));
  }
  return copy;
}

function run(out, source) {
  return new Promise((done) => {
    let text = '';
    const child = spawn(process.execPath, [resolve(ROOT, 'tools/tree-shots.mjs'), '--out', out, ...(source ? ['--source', source] : []), ...shots], { cwd: ROOT });
    child.stdout.on('data', (d) => { text += d; }); child.stderr.on('data', (d) => { text += d; });
    child.on('close', () => done(text));
  });
}

const names = onlyA ? ['A'] : onlyB ? ['B'] : ['A', 'B'];
const aCopy = names.includes('A') ? makeA() : null;
for (let r = 1; r <= rounds; r++) for (const name of names) {
  for (;;) {
    const text = await run(`.bench/trees/${prefix}-${name}-${r}`, name === 'A' ? aCopy : null);
    if (/GPU benchmark is locked/.test(text)) { console.log(`${name}-${r}: lock busy, waiting`); await new Promise((f) => setTimeout(f, 30000)); continue; }
    console.log(`== ${name}-${r}\n${text.split('\n').filter((l) => /ms median|rror/.test(l)).join('\n')}`);
    break;
  }
}
