#!/usr/bin/env node
/** CPU-only whole terrain submission preparation A/B across actual source checkouts.
 * Node >=24. node tools/perf-terrain-compare.mjs --baseline ../previous --out ../terrain.json
 * Includes clipmap/frustum/packing. No WebGPU upload timing or FPS claim.
 */
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { deepStrictEqual } from 'node:assert/strict';
const args = Object.fromEntries(process.argv.slice(2).filter((_, i) => i % 2 === 0).map((k, i) => [k.replace(/^--/, ''), process.argv[3 + 2 * i]]));
if (!args.baseline) throw new Error('Pass --baseline /path/to/clean/source-checkout');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), base = resolve(args.baseline);
const git = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' }).trim();
for (const dir of [root, base]) if (git(dir, 'status', '--porcelain')) throw new Error(`Benchmark requires a clean source tree: ${dir}`);
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:') && !extname(specifier)) {
      const url = new URL(specifier + '.ts', context.parentURL);
      if (existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith('file:') && url.endsWith('.ts')) return { format: 'module', shortCircuit: true,
      source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), { mode: 'transform', sourceUrl: url }) };
    return next(url, context);
  },
});
async function load(dir) {
  const get = p => import(pathToFileURL(resolve(dir, 'src/render/terrain', p)).href);
  return { ...await get('clipmap.ts'), ...await get('waterMask.ts'),
    ...(existsSync(resolve(dir, 'src/render/terrain/tilePayload.ts')) ? await get('tilePayload.ts') : {}) };
}
const [before, after] = await Promise.all([load(base), load(root)]);
const n = 1024, origin = -1024, frames = 6000;
const heights = Float32Array.from({ length: n * n }, (_, i) => 50 + 40 * Math.sin((i % n) / 120) * Math.cos(Math.floor(i / n) / 120));
heights[0] = 0;
function mask(m, water) { return new m.WaterMask(heights, n, 2, [origin, origin], 0, 90, water === 'dry' ? -1 : 1); }
function pipeline(m, waterMask) {
  const clip = new m.Clipmap(), frustum = new m.Frustum(), payload = m.TilePayload ? new m.TilePayload(clip.tiles) : null;
  const data = payload ? payload.data : new Float32Array(2 * m.MAX_TILES * m.TILE_FLOATS);
  const pos = [0, 70, 0], quat = [0, 0, 0, 1];
  const state = { data, count: 0, water: 0, quads: 0, uploads: 0 };
  return { state, frame(mode, i) {
    const x = mode === 'stable' ? 0 : mode === 'slow' ? Math.sin(i * .001) * 10 : mode === 'moving' ? i * .12 : mode === 'boundary' ? 2 + (i % 2 ? 1e-4 : -1e-4) : Math.sin(i * 1.79) * 6000;
    pos[0] = x;
    const yaw = mode === 'adversarial' ? i * .33 : mode === 'moving' ? i * .0003 : 0;
    quat[1] = Math.sin(yaw / 2); quat[3] = Math.cos(yaw / 2);
    frustum.setFromCamera(pos, quat, 1.8, 16 / 9);
    const count = clip.build(x, 0, origin, origin, 2, 7, 0, 90, frustum);
    if (payload) {
      if (payload.update(count, origin, origin, waterMask)) state.uploads++;
      state.water = payload.waterCount; state.quads = payload.waterQuads;
    } else {
      // Original upstream index.ts loops, used only when that checkout predates TilePayload.
      const tiles = clip.tiles, size = m.TILE_FLOATS;
      for (let j = 0; j < count * size; j++) data[j] = tiles[j];
      let water = 0;
      if (waterMask.enabled) for (let j = 0; j < count; j++) {
        const o = j * size, s = tiles[o + 4], x0 = origin + tiles[o] * s, z0 = origin + tiles[o + 1] * s;
        if (waterMask.regionBelow(x0, z0, x0 + tiles[o + 2] * s, z0 + tiles[o + 3] * s)) {
          const dest = (count + water++) * size;
          for (let k = 0; k < size; k++) data[dest + k] = tiles[o + k];
        }
      }
      let quads = 0;
      for (let j = 0; j < water; j++) quads += data[(count + j) * size + 2] * data[(count + j) * size + 3];
      state.water = water; state.quads = quads; state.uploads++;
    }
    state.count = count;
    return state;
  } };
}
function run(m, waterMask, mode, count) {
  const p = pipeline(m, waterMask); let checksum = 0;
  const start = performance.now();
  for (let i = 0; i < count; i++) { const s = p.frame(mode, i); checksum += s.count + s.water + s.quads; }
  return { usPerFrame: (performance.now() - start) * 1000 / count, uploads: p.state.uploads, checksum };
}
const metadata = { baselineCommit: git(base, 'rev-parse', 'HEAD'), optimizedCommit: git(root, 'rev-parse', 'HEAD'), node: process.version,
  timestamp: new Date().toISOString(), baselinePacking: before.TilePayload ? 'actual baseline TilePayload' : 'frozen original index.ts packing loops' };
const result = { metadata, frames, exactPayloadFramesCompared: 0, samples: [], note: 'CPU build/frustum/water query/packing only; no native GPU upload timing or FPS claims' };
const modes = ['stable', 'slow', 'moving', 'boundary', 'adversarial'];
for (const water of ['sparse', 'dry']) for (const mode of modes) {
  const bm = mask(before, water), am = mask(after, water), bp = pipeline(before, bm), ap = pipeline(after, am);
  for (let i = 0; i < 1000; i++) {
    const b = bp.frame(mode, i), a = ap.frame(mode, i);
    deepStrictEqual([a.count, a.water, a.quads], [b.count, b.water, b.quads]);
    const size = (b.count + b.water) * before.TILE_FLOATS;
    deepStrictEqual(new Uint32Array(a.data.buffer, a.data.byteOffset, size), new Uint32Array(b.data.buffer, b.data.byteOffset, size));
    result.exactPayloadFramesCompared++;
  }
  run(before, bm, mode, 2000); run(after, am, mode, 2000);
  const oldSamples = [], newSamples = [];
  for (let r = 0; r < 5; r++) {
    let b, a;
    if (r % 2) { a = run(after, am, mode, frames); b = run(before, bm, mode, frames); }
    else { b = run(before, bm, mode, frames); a = run(after, am, mode, frames); }
    deepStrictEqual(a.checksum, b.checksum);
    oldSamples.push(b); newSamples.push(a);
  }
  const median = values => values.map(x => x.usPerFrame).sort((a, b) => a - b)[2];
  const item = { water, mode, before: oldSamples, after: newSamples, beforeMedianUs: median(oldSamples), afterMedianUs: median(newSamples) };
  result.samples.push(item);
  console.log(water, mode, item.beforeMedianUs, item.afterMedianUs);
}
if (args.out) writeFileSync(args.out, JSON.stringify(result, null, 2) + '\n');
else console.log(JSON.stringify(result, null, 2));
