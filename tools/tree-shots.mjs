#!/usr/bin/env node
/** Tree close-ups and forest views rendered offline by the production renderer (Dawn in Node), with the GPU frame time of each view.
 * The views are picked from the vegetation placement on the first run and saved, so later runs (after a change) frame the same spots.
 *
 *   node tools/tree-shots.mjs --out .bench/trees/before [--quality high,ultra] [--width 1280] [--views .bench/trees/views.json] [--only bark-oak,edge]
 *     [--frames 90] [--timed 60] [--hour 9] [--seed 1337] [--no-clouds] [--no-scans] [--atmos JSON] [--skip modules] [--artifact dir]
 *
 * Writes <out>/<view>-<quality>.png and <out>/timings.json (mean and median GPU ms over the last --timed frames of each view). */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = resolve(ROOT, '.bench/trees/bundle');
const EXPORTS = [
  ['Renderer', 'src/render/renderer.ts'], ['createDefaultModules', 'src/render/modules.ts'], ['DEFAULT_SETTINGS', 'src/contracts.ts'],
  ['generateTerrain', 'src/world/terrain/generate.ts'], ['createTerrainSampler', 'src/world/terrain/sampler.ts'], ['generateTrack', 'src/world/track/generator.ts'],
  ['computeAstro', 'src/world/astro/clock.ts'], ['quatLookAlong', 'src/game/quat.ts'], ['placeVegetation, TIER_LIMITS', 'src/render/vegetation/placement.ts'],
  ['VARIANT_DEFS', 'src/render/vegetation/variants.ts'],
];

if (process.argv[2] === '--build') {
  // The bundler runs in its own process: Vite's native bundler loaded next to Dawn crashes Dawn's pipeline compiler (tools/brain/bundle.mjs).
  // `--build [dir]` bundles into dir (default .bench/trees/bundle, which the helper scripts in .bench/trees import).
  const { build } = await import('vite');
  const dir = resolve(process.argv[3] ?? BUNDLE);
  await mkdir(dir, { recursive: true });
  const entry = resolve(dir, 'entry.ts');
  await writeFile(entry, EXPORTS.map(([names, path]) => `export { ${names} } from ${JSON.stringify(resolve(ROOT, path).replaceAll('\\', '/'))};`).join('\n'));
  await build({ root: ROOT, configFile: false, logLevel: 'warn', publicDir: false, build: { ssr: entry, outDir: dir, emptyOutDir: false, target: 'es2022', rolldownOptions: { output: { entryFileNames: 'trees.mjs' } } } });
  process.exit(0);
}

const args = Object.fromEntries(process.argv.slice(2).reduce((out, v, i, all) => v.startsWith('--') ? [...out, [v.slice(2), all[i + 1]?.startsWith('--') === false ? all[i + 1] : '1']] : out, []));
const width = Number(args.width ?? 1280), height = Math.round(width * 9 / 16), seed = Number(args.seed ?? 1337), hour = Number(args.hour ?? 9);
const qualities = (args.quality ?? 'high,ultra').split(','), frames = Number(args.frames ?? 90), timed = Number(args.timed ?? 60);
const outDir = resolve(args.out ?? '.bench/trees/shots'), viewsFile = resolve(args.views ?? '.bench/trees/views.json');
const only = args.only ? new Set(args.only.split(',')) : null;
if (!(width >= 320 && width <= 3840 && width % 16 === 0) || !(frames >= timed && timed >= 1 && frames <= 600)) throw new Error('Invalid --width (multiple of 16, at most 3840) or --frames/--timed');
for (const q of qualities) if (!['low', 'medium', 'high', 'ultra', 'extreme'].includes(q)) throw new Error(`Invalid quality ${q}`);
await mkdir(outDir, { recursive: true });

// --artifact <dir> renders with a native-bench artifact (tools/native-bench, `npm run bench:artifact`) instead of the working tree, for
// before/after timing on the same views; it has no placement exports, so the views file must exist already.
let a;
if (args.artifact) a = await import(pathToFileURL(resolve(args.artifact, 'renderer.mjs')).href);
else {
  // Each run bundles into its own directory, removed when it exits, so runs started side by side (other agents, A/B scripts) never load
  // each other's bundle. "bundled <dir>" tells a driving script the working tree has been read.
  const dir = resolve(`${BUNDLE}-${process.pid}`);
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
  execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--build', dir], { stdio: 'inherit' });
  console.log(`bundled ${dir}`);
  a = await import(pathToFileURL(resolve(dir, 'trees.mjs')).href);
}
const { acquireGpuLock } = await import('./native-bench/lock.mjs');
const { offscreenSurface, openRuntime } = await import('./native-bench/runtime.mjs');

const terrain = a.generateTerrain({ seed, quality: 'medium', resolution: 1024, cellSize: 2.5, relief: 220 });
const sampler = a.createTerrainSampler(terrain);
const track = a.generateTrack({ seed, style: 'race', gateCount: 10, laps: 1, difficulty: 0.35 }, sampler);
const ground = (x, z) => sampler.heightAt(x, z);

/** Views picked from the placement: bark close-ups, a forest interior, a forest edge, a lone tree, a conifer stand and a distant forest. */
function pickViews() {
  const place = a.placeVegetation(terrain, track, a.TIER_LIMITS.ultra).plants;
  const trees = [];
  for (let i = 0; i < place.count; i++) {
    const def = a.VARIANT_DEFS[place.variant[i]];
    if (def.group === 'tree') trees.push({ i, x: place.pos[i * 3], y: place.pos[i * 3 + 1], z: place.pos[i * 3 + 2], s: place.scale[i], name: def.name, h: def.height * place.scale[i], path: place.pathDist[i] });
  }
  const cell = 20, grid = new Map(), key = (x, z) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  for (const t of trees) { const k = key(t.x, t.z); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(t); }
  const near = (t, r) => {
    const out = [];
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const u of grid.get(key(t.x + dx * cell, t.z + dz * cell)) ?? []) if (u !== t && Math.hypot(u.x - t.x, u.z - t.z) < r) out.push(u);
    return out;
  };
  const views = {};
  const look = (eye, target, fov = 80) => ({ eye, target, fov });
  const best = (list, score) => list.reduce((b, t) => (score(t) > score(b) ? t : b), list[0]);
  const close = (t, label) => {
    // One metre and a bit off the trunk, on the side facing the open ground, at a pilot's eye height.
    const n = near(t, 6), away = n.reduce((d, u) => [d[0] + t.x - u.x, d[1] + t.z - u.z], [0.3, 0.7]), l = Math.hypot(...away), d = [away[0] / l, away[1] / l];
    const ex = t.x + d[0] * 1.6, ez = t.z + d[1] * 1.6;
    views[label] = look([ex, ground(ex, ez) + 1.5, ez], [t.x, ground(t.x, t.z) + 1.0, t.z], 75);
  };
  const near60 = trees.filter(t => t.path < 60);
  for (const [label, species] of [['bark-oak', 'oak'], ['bark-pine', 'pine'], ['bark-birch', 'birch'], ['bark-spruce', 'spruce']]) {
    const list = near60.filter(t => t.name.startsWith(species));
    if (list.length) close(best(list, t => t.s), label);
  }
  const interior = best(trees.filter(t => t.path < 100), t => near(t, 14).length);
  {
    const n = near(interior, 14), c = n.reduce((p, u) => [p[0] + u.x / n.length, p[1] + u.z / n.length], [0, 0]);
    const ex = (c[0] + interior.x) / 2 + 1.5, ez = (c[1] + interior.z) / 2 + 1.5, yaw = 0.7;
    views.interior = look([ex, ground(ex, ez) + 2.2, ez], [ex + 20 * Math.cos(yaw), ground(ex, ez) + 4, ez + 20 * Math.sin(yaw)], 85);
  }
  {
    // A tree with neighbours on one side only, seen from the open side.
    const edge = best(trees.filter(t => t.path < 120 && near(t, 16).length >= 6), t => {
      const n = near(t, 16), m = n.reduce((p, u) => [p[0] + (u.x - t.x), p[1] + (u.z - t.z)], [0, 0]);
      return Math.hypot(...m) / n.length - (near(t, 30).length > 40 ? 5 : 0);
    });
    const n = near(edge, 16), m = n.reduce((p, u) => [p[0] + (u.x - edge.x), p[1] + (u.z - edge.z)], [0, 0]), l = Math.hypot(...m), d = [-m[0] / l, -m[1] / l];
    const ex = edge.x + d[0] * 30, ez = edge.z + d[1] * 30;
    views.edge = look([ex, ground(ex, ez) + 3, ez], [edge.x, ground(edge.x, edge.z) + 6, edge.z], 75);
  }
  {
    const lone = best(trees.filter(t => !t.name.startsWith('spruce') && !t.name.startsWith('pine') && near(t, 20).length === 0), t => t.s);
    const ex = lone.x + 16, ez = lone.z + 9;
    views.lone = look([ex, ground(ex, ez) + 2, ez], [lone.x, ground(lone.x, lone.z) + lone.h * 0.4, lone.z], 70);
  }
  {
    const stand = best(trees.filter(t => t.name.startsWith('spruce') && t.path < 200), t => near(t, 16).filter(u => u.name.startsWith('spruce')).length);
    const ex = stand.x - 28, ez = stand.z - 14;
    views.conifers = look([ex, Math.max(ground(ex, ez) + 4, ground(stand.x, stand.z) + 2), ez], [stand.x, ground(stand.x, stand.z) + 8, stand.z], 70);
  }
  {
    const [sx, , sz] = track.start.pos, ex = sx, ez = sz;
    views.distant = look([ex, ground(ex, ez) + 70, ez], [ex + 400 * Math.cos(1.1), ground(ex, ez) + 20, ez + 400 * Math.sin(1.1)], 70);
  }
  return views;
}

let views;
if (existsSync(viewsFile)) views = JSON.parse(await readFile(viewsFile, 'utf8'));
else { views = pickViews(); await mkdir(dirname(viewsFile), { recursive: true }); await writeFile(viewsFile, JSON.stringify(views, null, 2)); }

// Other agents share the GPU lock: wait for it (up to half an hour) instead of failing.
let release;
for (let tries = 0; !release; tries++) {
  try { release = await acquireGpuLock(); }
  catch (error) { if (tries > 600 || !/locked/.test(error.message)) throw error; await new Promise(done => setTimeout(done, 3000)); }
}
let runtime, renderer;
const timings = {};
try {
  runtime = await openRuntime({ backend: args.backend ?? 'd3d12' });
  // The renderer fetches the star catalogue and the bark scans from public/; --no-scans leaves the scans out (the procedural bark stands in).
  globalThis.fetch = async url => {
    const m = /(^|\/)(data\/stars\.bin|textures\/bark\/bark\.bin)$/.exec(String(url));
    if (!m || (args['no-scans'] && m[2].startsWith('textures'))) throw new Error(`Unexpected asset: ${url}`);
    const b = await readFile(resolve(ROOT, 'public', m[2]));
    return { ok: true, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
  };
  for (const quality of qualities) {
    const out = offscreenSurface(width, height);
    const settings = { ...a.DEFAULT_SETTINGS, quality, performance240: false, renderScale: 1, dynamicResolution: false, targetFps: 0, frameCap: 0, lensDistortion: 0, videoNoise: 0 };
    // --skip vegetation,objects leaves render modules out, to tell what draws a feature.
    const skip = new Set((args.skip ?? '').split(',').filter(Boolean));
    const modules = a.createDefaultModules().filter((m) => !skip.has(m.name));
    renderer = await a.Renderer.create(out.surface, settings, modules);
    renderer.device.pushErrorScope('validation');
    renderer.setScene({ terrain, sampler, track });
    for (const m of modules) if (m.name === 'vegetation' || m.name === 'objects') m.setWind?.([0, -1], 0);
    // --atmos '{"cloudsEnabled":false}' overrides atmosphere settings (src/render/atmosphere/settings.ts).
    // --no-clouds clears the sky for before/after comparisons, so drifting cloud shadows do not land on the views (final look sheets keep them).
    const atmos = { ...(args['no-clouds'] ? { cloudsEnabled: false } : {}), ...(args.atmos ? JSON.parse(args.atmos) : {}) };
    if (Object.keys(atmos).length) modules.find((m) => m.name === 'atmosphere')?.setSettings(atmos);
    const astro = a.computeAstro(Date.UTC(2026, 5, 21, Math.floor(hour), Math.round((hour % 1) * 60)), settings.observer);
    const camera = { pos: [0, 0, 0], quat: [0, 0, 0, 1], fovY: 1.2, aspect: width / height, near: 0.05, far: 20000 };
    for (const [name, v] of Object.entries(views)) {
      if (only && !only.has(name)) continue;
      camera.pos = [...v.eye]; camera.fovY = v.fov * Math.PI / 180; camera.near = 0.03;
      a.quatLookAlong(...v.target.map((x, k) => x - v.eye[k]), camera.quat);
      const gpu = [], passes = [];
      for (let f = 0; f < frames; f++) {
        renderer.render({ dt: 1 / 60, time: 10 + f / 60, camera, astro, quad: null });
        if (f % 8 === 7) await renderer.device.queue.onSubmittedWorkDone();
        const ms = renderer.stats?.gpuMs;
        if (f >= frames - timed && Number.isFinite(ms)) { gpu.push(ms); passes.push([...(renderer.stats?.passMs ?? [])]); }
      }
      await renderer.device.queue.onSubmittedWorkDone();
      const rgba = await out.read();
      const png = resolve(outDir, `${name}-${quality}.png`);
      const ff = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`, '-i', '-', '-frames:v', '1', png], { input: Buffer.from(rgba.buffer) });
      if (ff.status !== 0) throw new Error(`ffmpeg: ${ff.stderr}`);
      const sorted = [...gpu].sort((p, q) => p - q);
      const median = list => { const v = list.filter(Number.isFinite).sort((p, q) => p - q); return v.length ? v[v.length >> 1] : null; };
      const passMs = Object.fromEntries(['pre', 'gbuffer', 'rt', 'lighting', 'sky+fwd', 'post'].map((n, k) => [n, median(passes.map(x => x[k]))]));
      (timings[quality] ??= {})[name] = { meanMs: gpu.reduce((s, x) => s + x, 0) / Math.max(gpu.length, 1), medianMs: sorted[sorted.length >> 1] ?? null, samples: gpu.length, passMs };
      console.log(`${quality} ${name}: ${timings[quality][name].medianMs?.toFixed(2)} ms median GPU (${Object.entries(passMs).map(([n, v]) => `${n} ${v?.toFixed(2)}`).join(', ')}) -> ${png}`);
    }
    const validation = await renderer.device.popErrorScope();
    if (validation || renderer.errors?.length) throw new Error(`GPU errors: ${validation?.message ?? ''} ${[...(renderer.errors ?? [])].join('; ')}`);
    renderer.destroy(); renderer = null;
  }
  await writeFile(resolve(outDir, 'timings.json'), JSON.stringify({ width, height, hour, seed, frames, timed, timings }, null, 2));
} finally { renderer?.destroy(); runtime?.close(); await release(); }
