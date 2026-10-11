// Interleaved baseline / after runs of tools/terrain-shots.mjs on the same views, so GPU load from other work hits both arms alike.
//   node tools/compare/terrain-ab.mjs --before <checkout or src copy root> --after <root> [--tier high] [--rounds 3]
// Each root needs src/ (a git worktree, or a copy of src/ in a folder). Defaults: .bench/terrain/baseline-src and .bench/terrain/mine-src.
// Writes .bench/terrain/ab/<tier>-<arm>-<round>/ and prints per-view medians of the G-buffer pass and the whole frame.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const args = Object.fromEntries(process.argv.slice(2).reduce((o, v, i, all) => v.startsWith('--') ? [...o, [v.slice(2), all[i + 1]]] : o, []));
const tier = args.tier ?? 'high', rounds = Number(args.rounds ?? 3);
const arms = { before: args.before ?? '.bench/terrain/baseline-src', after: args.after ?? '.bench/terrain/mine-src' };
const runs = { before: [], after: [] };
for (let r = 0; r < rounds; r++) {
  for (const arm of r % 2 ? ['after', 'before'] : ['before', 'after']) {
    const out = resolve(ROOT, `.bench/terrain/ab/${tier}-${arm}-${r}`);
    const res = spawnSync(process.execPath, ['tools/terrain-shots.mjs', '--out', out, '--quality', tier, '--source', resolve(arms[arm]), '--time', '90', '--warm', '60'], { stdio: 'inherit', cwd: ROOT });
    if (res.status !== 0) throw new Error(`${arm} round ${r} failed`);
    runs[arm].push(JSON.parse(readFileSync(resolve(out, 'timing.json'), 'utf8')));
  }
}
const med = xs => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const views = Object.keys(runs.before[0].views);
const rows = views.map(v => {
  const g = arm => med(runs[arm].map(t => t.views[v].passMsMedian.gbuffer));
  const f = arm => med(runs[arm].map(t => t.views[v].gpuMsMedian));
  return { view: v, gbufferBefore: g('before'), gbufferAfter: g('after'), frameBefore: f('before'), frameAfter: f('after') };
});
console.log(`\n${tier}, ${rounds} interleaved rounds, medians of per-run medians (ms)`);
console.log('view'.padEnd(12), 'gbuf before', 'gbuf after', '  delta', ' frame before', 'frame after');
for (const r of rows) console.log(r.view.padEnd(12), r.gbufferBefore.toFixed(2).padStart(11), r.gbufferAfter.toFixed(2).padStart(10), (r.gbufferAfter - r.gbufferBefore).toFixed(2).padStart(7), r.frameBefore.toFixed(2).padStart(13), r.frameAfter.toFixed(2).padStart(11));
