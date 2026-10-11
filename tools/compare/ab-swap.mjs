// Interleaved A/B renders with tools/tree-shots.mjs. B is the working tree; A swaps in the files of --a <dir> (matched by name to the
// paths below) and, with --oak, the old oak sprig setting (9 at 0.52 m). Swapped files hold only until tree-shots reports its bundle written, so
// other agents' builds and tests see the working tree. Waits while the GPU lock is busy.
// Usage: node tools/compare/ab-swap.mjs --prefix p --rounds 2 [--a dir] [--oak] [--only-a | --only-b] -- <tree-shots args without --out>
// Writes .bench/trees/<prefix>-<A|B>-<round>/. --oak only works while treePlanBroad.ts holds the setting it names; PATHS lists the
// vegetation files an A side can replace. Swapping writes into src/ for a few seconds: warn the agents working there first.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PATHS = ['src/render/vegetation/placementRules.ts', 'src/render/vegetation/treePlan.ts', 'src/render/vegetation/placement.ts', 'src/render/shaders/vegetation/veg_far.wgsl', 'src/render/shaders/vegetation/tree_bark.wgsl', 'src/render/vegetation/treePlanBroad.ts', 'src/render/vegetation/treeGen.ts', 'src/render/shaders/vegetation/tree.wgsl', 'src/render/shaders/rt/rt_bvh.wgsl', 'src/render/shaders/rt/rt_canopy.wgsl', 'src/render/vegetation/colliders.ts', 'src/render/vegetation/index.ts', 'src/render/shaders/rt/rt_scene.wgsl'];
const OAK_FILE = 'src/render/vegetation/treePlanBroad.ts', OAK_B = 'cardsPerCluster: 11, cardSize: 0.45', OAK_A = 'cardsPerCluster: 9, cardSize: 0.52';

const argv = process.argv.slice(2), split = argv.indexOf('--');
const own = split < 0 ? argv : argv.slice(0, split), shots = split < 0 ? [] : argv.slice(split + 1);
const opt = (k) => { const i = own.indexOf(`--${k}`); return i < 0 ? null : own[i + 1] && !own[i + 1].startsWith('--') ? own[i + 1] : '1'; };
const prefix = opt('prefix') ?? 'ab', rounds = Number(opt('rounds') ?? 1), aDir = opt('a'), oak = !!opt('oak'), onlyA = !!opt('only-a'), onlyB = !!opt('only-b');

function swapsFor(name) {
  if (name === 'B') return [];
  const out = [];
  if (aDir) for (const p of PATHS) {
    let text;
    try { text = readFileSync(resolve(aDir, basename(p)), 'utf8'); } catch { continue; }
    out.push({ path: resolve(ROOT, p), text });
  }
  if (oak) {
    const path = resolve(ROOT, OAK_FILE), base = out.find((s) => s.path === path)?.text ?? readFileSync(path, 'utf8');
    if (!base.includes(OAK_B)) throw new Error('current oak setting not found');
    const rest = out.filter((s) => s.path !== path);
    rest.push({ path, text: base.replace(OAK_B, OAK_A) });
    return rest;
  }
  return out;
}

function run(out, swaps) {
  const saved = swaps.map((s) => ({ path: s.path, text: readFileSync(s.path, 'utf8') }));
  for (const s of swaps) writeFileSync(s.path, s.text);
  return new Promise((done) => {
    let text = '', restored = false;
    const restore = () => { if (!restored) { restored = true; for (const s of saved) writeFileSync(s.path, s.text); } };
    const child = spawn(process.execPath, ['tools/tree-shots.mjs', '--out', out, ...shots], { cwd: ROOT });
    // tree-shots prints "bundled <dir>" once its own bundle has read the working tree.
    child.stdout.on('data', (d) => { text += d; if (/^bundled /m.test(text)) restore(); }); child.stderr.on('data', (d) => { text += d; });
    child.on('close', () => { restore(); done(text); });
  });
}

const names = onlyA ? ['A'] : onlyB ? ['B'] : ['A', 'B'];
for (let r = 1; r <= rounds; r++) for (const name of names) {
  for (;;) {
    const text = await run(`.bench/trees/${prefix}-${name}-${r}`, swapsFor(name));
    if (/GPU benchmark is locked/.test(text)) { console.log(`${name}-${r}: lock busy, waiting`); await new Promise((f) => setTimeout(f, 30000)); continue; }
    console.log(`== ${name}-${r}\n${text.split('\n').filter((l) => /ms median|rror/.test(l)).join('\n')}`);
    break;
  }
}
