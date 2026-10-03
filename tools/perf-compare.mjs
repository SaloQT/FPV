#!/usr/bin/env node
/** CPU A/B verification; no GPU/FPS claims. Node >=24, npm ci first.
 * node tools/perf-compare.mjs --baseline ../baseline-checkout --out comparison.json
 * Baseline: git worktree add --detach ../baseline-checkout 4f56d904aa2b46acafcab4238d423e2fc6934940
 * Baseline needs no installed dependencies. Alternate timed order, compare full states exactly.
 */
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deepStrictEqual, ok } from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const args = Object.fromEntries(process.argv.slice(2).filter((_, i) => i % 2 === 0).map((k, i) => [k.replace(/^--/, ''), process.argv[3 + 2 * i]]));
if (!args.baseline) throw new Error('Pass --baseline /path/to/pristine/baseline-checkout');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = resolve(args.baseline);
for (const dir of [base, root]) {
  const dirty = execFileSync('git', ['-C', dir, 'status', '--porcelain'], { encoding: 'utf8' }).trim();
  if (dirty) throw new Error(`Benchmark requires clean tracked/untracked source in ${dir}:\n${dirty}`);
}
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:') && !extname(specifier)) {
      const url = new URL(specifier + '.ts', context.parentURL);
      if (existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith('file:') && url.endsWith('.ts')) return {
      format: 'module', shortCircuit: true,
      source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), { mode: 'transform', sourceUrl: url }),
    };
    return next(url, context);
  },
});
async function load(dir) {
  const get = p => import(pathToFileURL(resolve(dir, p)).href);
  return { ...await get('src/sim/quad.ts'), ...await get('src/sim/presets.ts'), ...await get('src/world/terrain/sampler.ts') };
}
const [before, after] = await Promise.all([load(base), load(root)]);
const n = 64, cell = 2, height = Float32Array.from({ length: n * n }, (_, i) => Math.sin(i % n * .17) * Math.cos(Math.floor(i / n) * .13) * .08);
const data = { seed: 42, resolution: n, cellSize: cell, origin: [-64, -64], height, maps: {}, minHeight: -.08, maxHeight: .08, waterLevel: -Infinity };
const dt = 1 / 4000;
const input = { throttle: 0, roll: 0, pitch: 0, yaw: 0, armed: true, mode: 'acro', turtle: false };
const denseColliders = Array.from({ length: 1024 }, (_, i) => ({ kind: 'box', center: [(i % 32 - 16) * 8 + 4, 1.5, (Math.floor(i / 32) - 16) * 8 + 4], half: [1, 1.5, 1], yaw: i * .37 }));
function make(mod, ground, dense = false) {
  const q = new mod.QuadPhysics(mod.QUAD_5IN_6S, ground ? mod.createTerrainSampler(data) : null, 42);
  if (dense) q.setColliders(denseColliders);
  q.reset([0, ground ? .06 : dense ? 3 : 300, 0], 0);
  q.step(dt, { ...input, throttle: 0 });
  ok(q.state.armed, 'benchmark must really arm at zero throttle');
  return q;
}
let comparedStates = 0;
for (const [ground, dense] of [[false, false], [true, false], [false, true], [true, true]]) {
  const a = make(before, ground, dense), b = make(after, ground, dense);
  for (let i = 0; i < 24000; i++) {
    input.throttle = ground ? .18 : .38;
    input.roll = Math.sin(i * .0004) * .3;
    input.pitch = Math.cos(i * .0003) * .2;
    input.yaw = Math.sin(i * .0002) * .1;
    a.step(dt, input); b.step(dt, input);
    deepStrictEqual(b.state, a.state, `quad state differs at step ${i}, ground=${ground}, dense=${dense}`);
    comparedStates++;
  }
}
const aNormal = before.createTerrainSampler(data), bNormal = after.createTerrainSampler(data);
const va = [0, 0, 0], vb = [0, 0, 0];
for (let i = 0; i < 20000; i++) {
  const x = Math.sin(i * .01) * 80, z = Math.cos(i * .012) * 80;
  deepStrictEqual(bNormal.normalAt(x, z, vb), aNormal.normalAt(x, z, va));
}
function flight(mod, ground, dense = false) {
  const q = make(mod, ground, dense), cmd = { ...input, throttle: ground ? .18 : .38, roll: .3, pitch: .2, yaw: .1 };
  const start = performance.now();
  for (let i = 0; i < 4000; i++) q.step(dt, cmd);
  const ms = performance.now() - start;
  ok(q.state.motorOmega.some(x => x > 0), 'motors must be running');
  return ms;
}
function normals(mod) {
  const s = mod.createTerrainSampler(data), out = [0, 0, 0];
  const start = performance.now();
  for (let i = 0; i < 200000; i++) s.normalAt(.1 + (i % 10) * .01, .1 + (i % 7) * .01, out);
  return performance.now() - start;
}
function median(v) { const x = [...v].sort((a, b) => a - b); return (x[5] + x[6]) / 2; }
const results = {};
for (const [name, fn] of [['flight_4000_steps', m => flight(m, false)], ['ground_4000_steps', m => flight(m, true)], ['dense_flight_4000_steps_1024_boxes', m => flight(m, false, true)], ['dense_ground_4000_steps_1024_boxes', m => flight(m, true, true)], ['same_cell_200000_normals', normals]]) {
  for (let i = 0; i < 6; i++) { fn(before); fn(after); }
  const oldMs = [], newMs = [];
  for (let i = 0; i < 12; i++) {
    if (i % 2) { newMs.push(fn(after)); oldMs.push(fn(before)); }
    else { oldMs.push(fn(before)); newMs.push(fn(after)); }
  }
  const baselineMedianMs = median(oldMs), optimizedMedianMs = median(newMs);
  results[name] = { baselineMedianMs, optimizedMedianMs, timeReductionPercent: 100 * (1 - optimizedMedianMs / baselineMedianMs), baselineSamplesMs: oldMs, optimizedSamplesMs: newMs };
}
const sha = dir => execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const output = { kind: 'CPU-only microbenchmark, NOT game FPS', node: process.version, baselineCommit: sha(base), optimizedCommit: sha(root), exactQuadStatesCompared: comparedStates, exactNormalsCompared: 20000, results };
console.log(JSON.stringify(output, null, 2));
if (args.out) writeFileSync(args.out, JSON.stringify(output, null, 2) + '\n');
