#!/usr/bin/env node
/**
 * A flight clip through the tree-shots views with a bundle measure.mjs built, for white-balance pumping and GPU cost.
 *   node tools/lightcast/flight.mjs --bundle .bench/lightcast/variants/<tag>-real/bundle/bundle.mjs --out .bench/lightcast/flight-on.mp4
 *     [--hour 12] [--quality ultra] [--seconds 12] [--width 960] [--track tools/views/hard-210-t2.json --speed 20] [--camera game]
 * The bundle comes from a measure.mjs run (any --tag with the real term). Needs ffmpeg on PATH. Clouds are off unless --clouds.
 * [--date 2026-06-28] the UTC date (default 2026-06-21); [--static] holds the camera at the first pose, for flicker: the log then carries
 * topDiff, the mean absolute change (codes) of the top third (the sky and clouds) from the previous frame.
 * Writes the mp4 and <out>.json: per frame the mean displayed chromaticity (r/g, b/g of the linear frame mean) and the GPU ms per pass.
 */
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const args = Object.fromEntries(process.argv.slice(2).reduce((out, v, i, all) => v.startsWith('--') ? [...out, [v.slice(2), all[i + 1]?.startsWith('--') === false ? all[i + 1] : '1']] : out, []));
const width = Number(args.width ?? 960), height = Math.round(width * 9 / 16) & ~1, hour = Number(args.hour ?? 12), fps = 60;
const frames = Math.round(Number(args.seconds ?? 12) * fps), quality = args.quality ?? 'ultra', out = resolve(args.out);
const a = await import(pathToFileURL(resolve(args.bundle)).href);
const { acquireGpuLock } = await import(pathToFileURL(resolve(ROOT, 'tools/native-bench/lock.mjs')).href);
const { offscreenSurface, openRuntime } = await import(pathToFileURL(resolve(ROOT, 'tools/native-bench/runtime.mjs')).href);
const views = JSON.parse(await readFile(resolve(ROOT, 'tools/views/trees.json'), 'utf8'));
// Out of the open (edge view, 30 m off the trees) into the stand, round the interior, then out past a lone tree.
const keys = ['edge', 'interior', 'bark-birch', 'lone'].map((k) => views[k]);
const lerp = (p, q, t) => p.map((v, i) => v + (q[i] - v) * t);
const smooth = (t) => t * t * (3 - 2 * t);
// --track <file.json>: fly the track's racing line from the start at --speed m/s (default 20) instead of the tree views.
const trackFile = args.track ? JSON.parse(await readFile(resolve(args.track), 'utf8')) : null;
const speed = Number(args.speed ?? 20);
function along(path, dist) {
  let left = dist;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], l = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (left <= l) return lerp(a, b, left / l);
    left -= l;
  }
  return path[path.length - 1];
}
function pose(t) {
  if (trackFile) {
    const d = t * speed * (frames - 1) / fps, path = trackFile.track.path;
    return { eye: along(path, d), target: along(path, d + 15) };
  }
  const s = t * (keys.length - 1), i = Math.min(Math.floor(s), keys.length - 2), u = smooth(s - i);
  return { eye: lerp(keys[i].eye, keys[i + 1].eye, u), target: lerp(keys[i].target, keys[i + 1].target, u) };
}

let release;
for (let tries = 0; !release; tries++) {
  try { release = await acquireGpuLock(); }
  catch (error) { if (tries > 5000 || !(/locked/.test(error.message) || error.code === 'EPERM')) throw error; await new Promise((done) => setTimeout(done, 3000)); }
}
// A timeout or Ctrl+C must not leave the shared GPU lock behind.
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { Promise.resolve(release?.()).finally(() => process.exit(130)); });
let runtime, renderer;
const log = [];
try {
  runtime = await openRuntime({ backend: 'd3d12' });
  // Assets the renderer fetches (stars, bark scans) come from public/.
  globalThis.fetch = async (url) => { const m = /(?:^|\/)((?:data|textures)\/.+)$/.exec(String(url)); if (!m) throw new Error(`Unexpected asset: ${url}`); const b = await readFile(resolve(ROOT, 'public', m[1])); return { ok: true, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; };
  const seed = 1337;
  const terrain = trackFile ? a.generateTerrain({ seed: trackFile.terrainSeed, quality: trackFile.quality ?? 'ultra' }) : a.generateTerrain({ seed, quality: 'medium', resolution: 1024, cellSize: 2.5, relief: 220 });
  const sampler = a.createTerrainSampler(terrain);
  const track = trackFile ? trackFile.track : a.generateTrack({ seed, style: 'race', gateCount: 10, laps: 1, difficulty: 0.35 }, sampler);
  const surf = offscreenSurface(width, height);
  const settings = { ...a.DEFAULT_SETTINGS, quality, performance240: false, renderScale: 1, dynamicResolution: false, targetFps: 0, frameCap: 0, ...(args.camera === 'game' ? {} : { lensDistortion: 0, videoNoise: 0 }) };
  const modules = a.createDefaultModules();
  renderer = await a.Renderer.create(surf.surface, settings, modules);
  renderer.setScene({ terrain, sampler, track });
        // Start-up timing per render module stage (init and setScene), the slow ones first.
        console.error(`[start-up] ${[...renderer.initTimings].sort((x, y) => y.ms - x.ms).filter((t) => t.ms >= 50).map((t) => `${t.stage} ${(t.ms / 1000).toFixed(1)} s`).join(', ')}`);
  for (const m of modules) if (m.name === 'vegetation' || m.name === 'objects') m.setWind?.([0, -1], 0);
  if (!args.clouds) modules.find((m) => m.name === 'atmosphere')?.setSettings?.({ cloudsEnabled: false });
  const [dy, dm, dd] = (args.date ?? '2026-06-21').split('-').map(Number);
  const astro = a.computeAstro(Date.UTC(dy, dm - 1, dd, Math.floor(hour), Math.round((hour % 1) * 60)), settings.observer);
  const camera = { pos: [0, 0, 0], quat: [0, 0, 0, 1], fovY: 80 * Math.PI / 180, aspect: width / height, near: 0.03, far: 20000 };
  const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`, '-r', String(fps), '-i', '-', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const lin = (u) => { const v = u / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  let prevTop = null;
  // Warm-up at the first pose so exposure and white balance start settled.
  for (let f = -60; f < frames; f++) {
    const p = pose(args.static ? 0 : Math.max(f, 0) / (frames - 1));
    camera.pos = p.eye;
    a.quatLookAlong(...p.target.map((x, k) => x - p.eye[k]), camera.quat);
    renderer.render({ dt: 1 / fps, time: 10 + (f + 60) / fps, camera, astro, quad: null });
    if (f < 0) { if (f % 8 === 7) await renderer.device.queue.onSubmittedWorkDone(); continue; }
    const rgba = await surf.read();
    const m = [0, 0, 0];
    for (let i = 0; i < rgba.length; i += 16) { m[0] += lin(rgba[i]); m[1] += lin(rgba[i + 1]); m[2] += lin(rgba[i + 2]); }
    const top = Math.floor(height / 3) * width * 4;
    let topDiff = null;
    if (prevTop) { let sd = 0; for (let i = 0; i < top; i += 4) sd += Math.abs(rgba[i + 1] - prevTop[i + 1]); topDiff = +(sd / (top / 4)).toFixed(3); }
    prevTop = rgba.slice(0, top);
    log.push({ f, topDiff, rg: +(m[0] / m[1]).toFixed(4), bg: +(m[2] / m[1]).toFixed(4), gpuMs: renderer.stats?.gpuMs ?? null, passMs: [...(renderer.stats?.passMs ?? [])] });
    if (!ff.stdin.write(Buffer.from(rgba.buffer))) await new Promise((done) => ff.stdin.once('drain', done));
  }
  ff.stdin.end();
  await new Promise((done) => ff.on('close', done));
  await writeFile(out.replace(/\.mp4$/, '.json'), JSON.stringify({ width, height, hour, quality, frames: log }, null, 1));
  console.log('wrote', out);
} finally { renderer?.destroy(); runtime?.close(); await release(); }
