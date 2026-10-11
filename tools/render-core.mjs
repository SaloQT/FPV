// The shot path the render server (tools/render-server.mjs) and its fresh-process fallback (tools/shot-client.mjs --fresh) share: the
// bundle, the Dawn device, the scene and the frame loop. The loop is tree-shots.mjs's (90 frames per view, 60 timed, a fixed terrain of
// 1024 cells at 2.5 m), so a view renders the same here as there.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** What the shot bundle exports, by source file. */
export const EXPORTS = [
  ['Renderer', 'src/render/renderer.ts'], ['createDefaultModules', 'src/render/modules.ts'], ['DEFAULT_SETTINGS', 'src/contracts.ts'],
  ['generateTerrain', 'src/world/terrain/generate.ts'], ['createTerrainSampler', 'src/world/terrain/sampler.ts'], ['generateTrack', 'src/world/track/generator.ts'],
  ['computeAstro', 'src/world/astro/clock.ts'], ['quatLookAlong', 'src/game/quat.ts'],
  ['buildPark', 'src/world/park/build.ts'], ['defaultParkRecipe', 'src/world/park/recipe.ts'], ['ParkRuntime', 'src/world/park/runtime.ts'],
  ['importClosure', 'src/render/vegetation/sourceClosure.ts'], ['resolveShader, setShaderListener, setShaderSource', 'src/render/shaderLib.ts'],
];

/** `--key value` and bare `--flag` (value '1') arguments. */
export function parseArgs(argv) {
  return Object.fromEntries(argv.reduce((out, v, i, all) => v.startsWith('--') ? [...out, [v.slice(2), all[i + 1]?.startsWith('--') === false ? all[i + 1] : '1']] : out, []));
}

/** The entry module of a shot bundle of `source` (a checkout root with src/). */
export function entryText(source = ROOT) {
  return EXPORTS.map(([names, path]) => `export { ${names} } from ${JSON.stringify(resolve(source, path).replaceAll('\\', '/'))};`).join('\n');
}

/** Bundles `source` into `dir`/shots.mjs in a child process (Vite's native bundler next to Dawn crashes Dawn's compiler, tools/brain/bundle.mjs). */
export function bundleOnce(dir, source = ROOT) {
  execFileSync(process.execPath, [resolve(ROOT, 'tools/render-bundler.mjs'), '--once', dir, source], { stdio: 'inherit' });
  return resolve(dir, 'shots.mjs');
}

/** The renderer reads the star catalogue and the bark scans from public/; `noScans` leaves the scans out (procedural bark stands in). */
export function installFetch({ noScans = false } = {}) {
  globalThis.fetch = async (url) => {
    const m = /(^|\/)(data\/stars\.bin|textures\/bark\/bark\.bin)$/.exec(String(url));
    if (!m || (noScans && m[2].startsWith('textures'))) throw new Error(`Unexpected asset: ${url}`);
    const b = await readFile(resolve(ROOT, 'public', m[2]));
    return { ok: true, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
  };
}

/**
 * Opens Dawn and makes navigator.gpu hand every Renderer the same device, so pipelines compiled for one renderer are found in Dawn's
 * cache by the next. The renderer's device.destroy() is a no-op on it; close() destroys it.
 */
export async function openSharedGpu({ backend = 'd3d12', onDevice = null } = {}) {
  const { openRuntime } = await import('./native-bench/runtime.mjs');
  const runtime = await openRuntime({ backend });
  const gpu = runtime.gpu;
  const real = await gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!real) throw new Error(`no ${backend} adapter`);
  let device = null, descriptor = null, destroyDevice = null;
  const adapter = new Proxy(real, {
    get(target, key) {
      if (key === 'requestDevice') return async (desc) => {
        const text = JSON.stringify(desc ?? {});
        if (device && text !== descriptor) throw new Error('render-core: a renderer asked for a different device than the shared one');
        if (!device) {
          device = await target.requestDevice(desc);
          descriptor = text;
          destroyDevice = device.destroy.bind(device);
          device.destroy = () => {};
          onDevice?.(device);
        }
        return device;
      };
      const v = Reflect.get(target, key);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
  const shim = { requestAdapter: async () => adapter, getPreferredCanvasFormat: () => gpu.getPreferredCanvasFormat(), wgslLanguageFeatures: gpu.wgslLanguageFeatures };
  Object.defineProperty(globalThis, 'navigator', { value: { gpu: shim }, configurable: true });
  return { get device() { return device; }, close() { destroyDevice?.(); runtime.close(); } };
}

/** Waits for the machine-wide GPU lock (other agents render too) for up to `minutes`, and returns its release function. */
export async function waitForGpuLock(minutes = 30) {
  const { acquireGpuLock } = await import('./native-bench/lock.mjs');
  for (const until = Date.now() + minutes * 60000; ;) {
    try { return await acquireGpuLock(); }
    catch (error) { if (!/locked/.test(error.message) || Date.now() > until) throw error; }
    await new Promise((done) => setTimeout(done, 1000));
  }
}

const QUALITIES = ['low', 'medium', 'high', 'ultra', 'extreme'];

/**
 * A shot request from tree-shots-style arguments: --out dir, --views file (default .bench/trees/views.json) or --view JSON, --only a,b,
 * --quality high,ultra, --width (or --size WxH), --hour, --seed, --frames, --timed, --no-clouds, --atmos JSON, --skip modules, --no-scans.
 */
export function requestFromArgs(args) {
  const terrain = args.mode === 'terrain';
  const [sw, sh] = args.size ? String(args.size).split('x').map(Number) : [];
  const width = Number(args.width ?? sw ?? (terrain ? 1920 : 1280)), height = sh ?? Math.round(width * 9 / 16);
  const req = {
    mode: terrain ? 'terrain' : 'trees',
    out: resolve(args.out ?? '.bench/render-server/shots'),
    views: args.view ? JSON.parse(args.view) : null,
    // terrain-shots' own spelling: --views names the views, --views-file holds them (its timing.json will do).
    viewsFile: args.view ? null : resolve((terrain ? args['views-file'] : args.views) ?? (terrain ? '.bench/terrain/views.json' : '.bench/trees/views.json')),
    only: (terrain ? args.views : args.only) ? String(terrain ? args.views : args.only).split(',') : null,
    qualities: String(args.quality ?? 'high').split(','),
    width, height,
    hour: Number(args.hour ?? (terrain ? 9.5 : 9)), seed: Number(args.seed ?? 1337), date: args.date ?? '2026-06-21',
    // trees mode: --frames per view, the last --timed timed. terrain mode: --warm frames before the still, then --time timed frames.
    frames: Number(terrain ? args.warm ?? 48 : args.frames ?? 90), timed: Number(terrain ? args.time ?? 60 : args.timed ?? 60),
    noClouds: !!args['no-clouds'], atmos: args.atmos ? JSON.parse(args.atmos) : null,
    settings: args.settings ? JSON.parse(args.settings) : null, wind: args.wind !== undefined ? Number(args.wind) : null,
    skip: args.skip ? String(args.skip).split(',').filter(Boolean) : [], noScans: !!args['no-scans'],
  };
  checkRequest(req);
  return req;
}

export function checkRequest(req) {
  if (!(req.width >= 64 && req.width <= 3840 && req.height >= 64 && req.height <= 2160)) throw new Error('width/height out of range (64..3840 x 64..2160)');
  if (req.mode === 'terrain' ? !(req.frames >= 1 && req.frames <= 600 && req.timed >= 0 && req.timed <= 600) : !(req.frames >= req.timed && req.timed >= 0 && req.frames >= 1 && req.frames <= 600)) throw new Error('bad frame counts');
  for (const q of req.qualities) if (!QUALITIES.includes(q)) throw new Error(`bad quality ${q}`);
}

/** The views: { name: { eye, target, fov } }, or a terrain-shots timing.json (its `views`). */
export async function viewsOf(req) {
  let views = req.views ?? (existsSync(req.viewsFile) ? JSON.parse(await readFile(req.viewsFile, 'utf8')) : null);
  if (views?.views && !views.views.eye) views = views.views;
  if (!views) throw new Error(`no views: ${req.viewsFile} does not exist (run tools/tree-shots.mjs or tools/terrain-shots.mjs once to pick them, or pass --view JSON)`);
  const picked = Object.entries(views).filter(([name, v]) => v?.eye && v?.target && (!req.only || req.only.includes(name)));
  if (!picked.length) throw new Error('no view matches --only');
  return picked;
}

/** The scene a request renders, and the key it is kept under (terrain mode generates the world at the quality's own resolution). */
export function sceneKey(req, quality) {
  return req.mode === 'terrain' ? `terrain:${req.seed}:${quality === 'extreme' ? 'ultra' : quality}` : `trees:${req.seed}`;
}

/** tree-shots.mjs's world (a 1024-cell terrain at 2.5 m and a race track), or terrain-shots.mjs's (the quality's terrain, no track). */
export function makeScene(a, req, quality) {
  if (req.mode === 'terrain') {
    const terrain = a.generateTerrain({ seed: req.seed, quality: quality === 'extreme' ? 'ultra' : quality }); // Extreme builds ultra's world.
    return { terrain, sampler: a.createTerrainSampler(terrain), track: null };
  }
  const seed = req.seed;
  const terrain = a.generateTerrain({ seed, quality: 'medium', resolution: 1024, cellSize: 2.5, relief: 220 });
  const sampler = a.createTerrainSampler(terrain);
  const track = a.generateTrack({ seed, style: 'race', gateCount: 10, laps: 1, difficulty: 0.35 }, sampler);
  return { terrain, sampler, track };
}

export function settingsFor(a, quality, req = null) {
  const terrain = req?.mode === 'terrain';
  return { ...a.DEFAULT_SETTINGS, ...(terrain ? req.settings ?? {} : {}), quality, performance240: false, renderScale: 1, dynamicResolution: false, targetFps: terrain ? 60 : 0, frameCap: 0, lensDistortion: 0, videoNoise: 0 };
}

/** Renderer options for a request: terrain-shots times with the GPU profiler on. */
export const rendererOptions = (req) => (req.mode === 'terrain' ? { gpuProfile: req.timed > 0 } : {});

/** Points the modules the way the tool does after setScene: tree-shots stills the wind; both apply the atmosphere overrides. */
export function applyModuleSettings(modules, req) {
  if (req.mode === 'terrain') { if (req.wind !== null) modules.find((m) => m.name === 'vegetation')?.setWind([0.8, 0.6], req.wind); }
  else for (const m of modules) if (m.name === 'vegetation' || m.name === 'objects') m.setWind?.([0, -1], 0);
  const atmos = { ...(req.noClouds ? { cloudsEnabled: false } : {}), ...(req.atmos ?? {}) };
  if (Object.keys(atmos).length) modules.find((m) => m.name === 'atmosphere')?.setSettings(atmos);
}

export function writePng(file, rgba, width, height) {
  const ff = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`, '-i', '-', '-frames:v', '1', file], { input: Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength) });
  if (ff.status !== 0) throw new Error(`ffmpeg: ${ff.stderr}`);
}

/**
 * Renders the views of one quality with `renderer` (set up on `scene`, modules configured), tree-shots' frame loop: `frames` frames per view
 * at 60 Hz from time 10, the GPU time of the last `timed`. Writes <out>/<view>-<quality>.png (and <view>-<quality>.rgba when `raw`).
 */
export async function renderViews(a, renderer, read, req, quality, views, { raw = false } = {}) {
  const { width, height } = req;
  const settings = settingsFor(a, quality, req);
  const [yy, mm, dd] = req.date.split('-').map(Number);
  const astro = a.computeAstro(Date.UTC(yy, mm - 1, dd, Math.floor(req.hour), Math.round((req.hour % 1) * 60)), settings.observer);
  const camera = { pos: [0, 0, 0], quat: [0, 0, 0, 1], fovY: 1.2, aspect: width / height, near: 0.05, far: 20000 };
  const timings = {}, files = [];
  await mkdir(req.out, { recursive: true });
  if (req.mode === 'terrain') return terrainLoop(a, renderer, read, req, views, astro, camera, raw);
  for (const [name, v] of views) {
    camera.pos = [...v.eye]; camera.fovY = v.fov * Math.PI / 180; camera.near = 0.03;
    a.quatLookAlong(...v.target.map((x, k) => x - v.eye[k]), camera.quat);
    const gpu = [];
    for (let f = 0; f < req.frames; f++) {
      renderer.render({ dt: 1 / 60, time: 10 + f / 60, camera, astro, quad: null });
      if (f % 8 === 7) await renderer.device.queue.onSubmittedWorkDone();
      const ms = renderer.stats?.gpuMs;
      if (f >= req.frames - req.timed && Number.isFinite(ms)) gpu.push(ms);
    }
    await renderer.device.queue.onSubmittedWorkDone();
    const rgba = await read();
    const png = resolve(req.out, `${name}-${quality}.png`);
    writePng(png, rgba, width, height);
    if (raw) await writeFile(resolve(req.out, `${name}-${quality}.rgba`), rgba);
    files.push(png);
    const sorted = [...gpu].sort((p, q) => p - q);
    timings[name] = { medianMs: sorted[sorted.length >> 1] ?? null, samples: gpu.length };
  }
  return { timings, files };
}

/**
 * terrain-shots.mjs's loop: one clock for every view (60 Hz from 0), `frames` warm frames, the still, then `timed` frames timed through the
 * GPU profiler. Writes <out>/<view>.png, as terrain-shots does.
 */
async function terrainLoop(a, renderer, read, req, views, astro, camera, raw) {
  const timings = {}, files = [];
  let time = 0;
  const frame = () => { time += 1 / 60; renderer.render({ dt: 1 / 60, time, camera, astro, quad: null }); };
  renderer.setDisplayRefresh?.(60, 'override');
  for (const [name, v] of views) {
    camera.pos = [...v.eye]; camera.fovY = v.fov * Math.PI / 180;
    a.quatLookAlong(...v.target.map((x, k) => x - v.eye[k]), camera.quat);
    for (let i = 0; i < req.frames; i++) { frame(); if (i % 8 === 7) await renderer.device.queue.onSubmittedWorkDone(); }
    await renderer.device.queue.onSubmittedWorkDone();
    const rgba = await read(), png = resolve(req.out, `${name}.png`);
    writePng(png, rgba, req.width, req.height);
    if (raw) await writeFile(resolve(req.out, `${name}.rgba`), rgba);
    files.push(png);
    const samples = [];
    if (req.timed > 0) {
      const stop = renderer.listenGpuTimings((s) => { if (s.status === 'measured' && Number.isFinite(s.gpuMs)) samples.push(s.gpuMs); });
      for (let i = 0; i < req.timed; i++) { frame(); if (i % 2 === 1) await renderer.device.queue.onSubmittedWorkDone(); }
      await renderer.device.queue.onSubmittedWorkDone(); await renderer.drainGpuTimings(10000); stop();
    }
    const sorted = samples.sort((p, q) => p - q);
    timings[name] = { medianMs: sorted[sorted.length >> 1] ?? null, samples: samples.length };
  }
  return { timings, files };
}

/** Throws on validation errors in the scope pushed at setup, or on errors the renderer collected. */
export async function checkErrors(renderer) {
  const validation = await renderer.device.popErrorScope();
  if (validation || renderer.errors?.length) throw new Error(`GPU errors: ${validation?.message ?? ''} ${[...(renderer.errors ?? [])].join('; ')}`);
}

/** Imports a bundle file as a fresh module instance (a new URL each time, so an edited bundle at the same path is read again). */
export function importBundle(file) {
  return import(`${pathToFileURL(file).href}?v=${Date.now()}-${Math.random().toString(36).slice(2)}`);
}
