#!/usr/bin/env node
/** Stills and GPU frame times of fixed ground views, rendered offline by the production renderer through Dawn (the same path as
 * tools/park-tour.mjs) under the machine-wide GPU lock. Views are picked from the terrain's own maps, so they land on the same spots for
 * a seed whatever the shading does: a meadow at 2 m, a steep rocky slope, a stream bed, the ground under trees, an FPV run at 8 m,
 * a high aerial view, and the theme park lawns and paths.
 *
 *   node tools/terrain-shots.mjs --out .bench/terrain/before [--quality high] [--width 1920] [--seed 1337] [--views meadow,rock]
 *     [--warm 48] [--time 60] [--hour 9.5] [--source <checkout root>]
 *
 * --source bundles another copy of src/ (for an A/B against a snapshot); --time 0 skips the timing. Writes <view>.png and timing.json. */
import { build } from 'vite';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { acquireGpuLock } from './native-bench/lock.mjs';
import { offscreenSurface, openRuntime } from './native-bench/runtime.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((out, v, i, all) => v.startsWith('--') ? [...out, [v.slice(2), all[i + 1]?.startsWith('--') === false ? all[i + 1] : '1']] : out, []));
const width = Number(args.width ?? 1920), height = Math.round(width * 9 / 16), seed = Number(args.seed ?? 1337);
const quality = args.quality ?? 'high', warm = Number(args.warm ?? 48), timeFrames = Number(args.time ?? 60), hour = Number(args.hour ?? 9.5);
const only = args.views ? new Set(args.views.split(',')) : null;
if (!['low', 'medium', 'high', 'ultra', 'extreme'].includes(quality) || !(width >= 320 && width <= 3840)) throw new Error('Invalid --quality or --width');
const out = resolve(args.out ?? `.bench/terrain/shots-${quality}`), source = resolve(args.source ?? '.');
await mkdir(out, { recursive: true });

async function bundle() {
  const dir = resolve(out, 'bundle');
  await mkdir(dir, { recursive: true });
  const imports = [
    ['Renderer', 'src/render/renderer.ts'], ['createDefaultModules', 'src/render/modules.ts'], ['buildPark', 'src/world/park/build.ts'],
    ['defaultParkRecipe', 'src/world/park/recipe.ts'], ['ParkRuntime', 'src/world/park/runtime.ts'], ['createTerrainSampler', 'src/world/terrain/sampler.ts'],
    ['computeAstro', 'src/world/astro/clock.ts'], ['quatLookAlong', 'src/game/quat.ts'], ['DEFAULT_SETTINGS', 'src/contracts.ts'],
    ['generateTerrain', 'src/world/terrain/generate.ts'], ['placeVegetation, TIER_LIMITS', 'src/render/vegetation/placement.ts'],
    ['VARIANT_DEFS', 'src/render/vegetation/variants.ts'],
  ];
  const entry = resolve(dir, 'entry.ts');
  await writeFile(entry, imports.map(([names, path]) => `export { ${names} } from ${JSON.stringify(resolve(source, path).replaceAll('\\', '/'))};`).join('\n'));
  await build({ configFile: false, logLevel: 'warn', publicDir: false, build: { ssr: entry, outDir: dir, emptyOutDir: false, target: 'es2022', rolldownOptions: { output: { entryFileNames: 'shots.mjs' } } } });
  return import(pathToFileURL(resolve(dir, 'shots.mjs')).href + `?t=${Date.now()}`);
}

function writePng(file, rgba) {
  return new Promise((done, fail) => {
    const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`, '-i', '-', '-frames:v', '1', file], { stdio: ['pipe', 'inherit', 'inherit'] });
    ff.on('error', fail); ff.on('close', c => c === 0 ? done() : fail(new Error(`ffmpeg ${c}`)));
    ff.stdin.end(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength));
  });
}

/** Camera views picked from the maps: each returns { eye, target, fov } or null when the terrain has no such place. */
function naturalViews(a, terrain, sampler, place) {
  const N = terrain.resolution, c = terrain.cellSize, [ox, oz] = terrain.origin, m = terrain.maps, H = terrain.height;
  const at = (i, j) => j * N + i, wx = i => ox + i * c, wz = j => oz + j * c, ground = (x, z) => sampler.heightAt(x, z);
  const water = Number.isFinite(terrain.waterLevel) ? terrain.waterLevel : -Infinity;
  const slope = (i, j) => Math.hypot(H[at(i + 1, j)] - H[at(i - 1, j)], H[at(i, j + 1)] - H[at(i, j - 1)]) / (2 * c);
  // Scan the middle of the map (the vegetation region and where tracks are) on a coarse stride.
  const lo = Math.round(N * 0.3), hi = Math.round(N * 0.7), step = Math.max(1, Math.round(4 / c));
  const best = score => { let b = null, bs = -Infinity; for (let j = lo; j < hi; j += step) for (let i = lo; i < hi; i += step) { const s = score(i, j); if (s > bs) { bs = s; b = [i, j]; } } return b; };
  const trees = [];
  for (let k = 0; k < place.plants.count; k++) if (a.VARIANT_DEFS[place.plants.variant[k]].group === 'tree') trees.push([place.plants.pos[k * 3], place.plants.pos[k * 3 + 2]]);
  const nearTree = (x, z, r) => trees.some(([tx, tz]) => (tx - x) ** 2 + (tz - z) ** 2 < r * r);
  const downhill = (i, j) => { const gx = H[at(i + 1, j)] - H[at(i - 1, j)], gz = H[at(i, j + 1)] - H[at(i, j - 1)], l = Math.hypot(gx, gz) || 1; return [-gx / l, -gz / l]; };
  const views = {};

  // Meadow: deep soil, gentle, damp but not a channel, open (no tree within 12 m); look across it from 2 m.
  const md = best((i, j) => { const s = slope(i, j); if (s > 0.08 || H[at(i, j)] < water + 3 || m.flow[at(i, j)] > 0.45) return -Infinity; return m.soil[at(i, j)] + 0.5 * m.wetness[at(i, j)] - 4 * s - (nearTree(wx(i), wz(j), 12) ? 5 : 0); });
  if (md) {
    const [x, z] = [wx(md[0]), wz(md[1])], d = downhill(md[0], md[1]), e = [x, ground(x, z) + 2, z];
    views.meadow = { eye: e, target: [x + d[0] * 30, ground(x + d[0] * 30, z + d[1] * 30) + 0.5, z + d[1] * 30], fov: 100 };
    // Flowers: 0.7 m up, looking down at the sward 2.5 m ahead, where single heads, stems and bracts resolve.
    const fe = [x, ground(x, z) + 0.7, z];
    views.flowers = { eye: fe, target: [x + d[0] * 2.5, ground(x + d[0] * 2.5, z + d[1] * 2.5) + 0.2, z + d[1] * 2.5], fov: 70 };
    const f = [x - d[0] * 20, 0, z - d[1] * 20]; f[1] = ground(f[0], f[2]) + 8;
    views.fpv8m = { eye: f, target: [x + d[0] * 60, ground(x + d[0] * 60, z + d[1] * 60), z + d[1] * 60], fov: 100 };
  }
  // Rocky slope: steepest bare ground; seen from 30 m out on its downhill side, a little above it.
  const rk = best((i, j) => slope(i, j) * (1.3 - m.soil[at(i, j)]));
  if (rk) {
    const [x, z] = [wx(rk[0]), wz(rk[1])], d = downhill(rk[0], rk[1]), y = ground(x, z);
    const e = [x + d[0] * 30, 0, z + d[1] * 30]; e[1] = Math.max(ground(e[0], e[2]) + 4, y - 6);
    views.rock = { eye: e, target: [x, y + 2, z], fov: 80 };
    const n = [x + d[0] * 6, 0, z + d[1] * 6]; n[1] = ground(n[0], n[2]) + 1.5;
    views.rockClose = { eye: n, target: [x, y + 0.5, z], fov: 90 };
  }
  // Stream bed: the strongest drainage on gentle dry-land ground; look down the channel from 3 m.
  const st = best((i, j) => { const s = slope(i, j); if (s > 0.12 || H[at(i, j)] < water + 0.5) return -Infinity; return m.flow[at(i, j)] + 0.3 * m.deposit[at(i, j)]; });
  if (st) {
    const [x, z] = [wx(st[0]), wz(st[1])], d = downhill(st[0], st[1]);
    const e = [x - d[0] * 6, 0, z - d[1] * 6]; e[1] = ground(e[0], e[2]) + 3;
    views.stream = { eye: e, target: [x + d[0] * 20, ground(x + d[0] * 20, z + d[1] * 20), z + d[1] * 20], fov: 100, bed: [x, ground(x, z), z] };
  }
  // Under trees: the tree with the most neighbours inside 15 m; stand 3 m off it at head height and look at the ground beyond.
  if (trees.length) {
    const sample = trees.filter((_, k) => k % Math.max(1, Math.floor(trees.length / 1500)) === 0);
    let bt = null, bn = -1;
    for (const [tx, tz] of sample) { let n = 0; for (const [ux, uz] of trees) if ((ux - tx) ** 2 + (uz - tz) ** 2 < 225) n++; if (n > bn) { bn = n; bt = [tx, tz]; } }
    const e = [bt[0] + 3, 0, bt[1] + 1]; e[1] = ground(e[0], e[2]) + 1.7;
    views.trees = { eye: e, target: [bt[0] + 14, ground(bt[0] + 14, bt[1] + 9), bt[1] + 9], fov: 90 };
  }
  // Shore: gentle ground half a metre above the water, looking downhill over the waterline (maps with water only).
  if (Number.isFinite(water)) {
    const sh = best((i, j) => { const h = H[at(i, j)] - water; return h > 0.3 && h < 1.2 ? -slope(i, j) : -Infinity; });
    if (sh) {
      const [x, z] = [wx(sh[0]), wz(sh[1])], d = downhill(sh[0], sh[1]);
      const e = [x - d[0] * 8, 0, z - d[1] * 8]; e[1] = Math.max(ground(e[0], e[2]), water) + 2.5;
      views.shore = { eye: e, target: [x + d[0] * 20, water, z + d[1] * 20], fov: 90 };
    }
  }
  // Boulders: the biggest rock in the middle of the map, from four radii away at 1.6 m.
  let br = -1;
  for (let k = 0; k < place.rocks.count; k++) {
    const x = place.rocks.pos[k * 3], z = place.rocks.pos[k * 3 + 2];
    if (Math.abs(x - wx(N / 2)) < N * c * 0.2 && Math.abs(z - wz(N / 2)) < N * c * 0.2 && (br < 0 || place.rocks.scale[k] > place.rocks.scale[br])) br = k;
  }
  if (br >= 0) {
    const x = place.rocks.pos[br * 3], z = place.rocks.pos[br * 3 + 2], r = place.rocks.scale[br];
    const e = [x + 3 * r + 1.5, 0, z + 1.5 * r]; e[1] = ground(e[0], e[2]) + 1.6;
    views.boulder = { eye: e, target: [x, ground(x, z) + 0.4 * r, z], fov: 80 };
  }
  // Aerial: 350 m above the centre of the map, looking out over kilometres at 22 degrees down.
  const cx = wx(N / 2), cz = wz(N / 2), y = ground(cx, cz) + 350;
  views.aerial = { eye: [cx, y, cz], target: [cx + 1000, y - 404, cz + 300], fov: 70 };
  views.aerialDown = { eye: [cx - 200, ground(cx - 200, cz) + 120, cz], target: [cx - 100, ground(cx - 100, cz + 60), cz + 60], fov: 70 };
  return views;
}

// Other agents share the lock: wait for it (up to --lock-wait minutes) rather than fail.
async function waitForLock(minutes) {
  for (const until = Date.now() + minutes * 60000; ;) {
    try { return await acquireGpuLock(); }
    catch (error) { if (!/locked/.test(error.message) || Date.now() > until) throw error; }
    await new Promise(done => setTimeout(done, 5000));
  }
}
// --dump-sky [view]: after that view settles, reads the sky-view and aerial-perspective tables back and prints the linear sky colour by
// elevation (away from and across the sun) and the haze the aerial perspective adds at 100 m to 3 km straight ahead, against the light a
// level 0.1-albedo meadow sends back. Values are nits, not pre-exposed.
async function readTex(device, tex, w, h, d = 1) {
  const bpr = Math.ceil(w * 8 / 256) * 256, buf = device.createBuffer({ size: bpr * h * d, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const e = device.createCommandEncoder(); e.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: bpr, rowsPerImage: h }, [w, h, d]);
  device.queue.submit([e.finish()]); await buf.mapAsync(GPUMapMode.READ);
  const raw = new Uint16Array(buf.getMappedRange().slice(0)); buf.unmap(); buf.destroy();
  const half = x => { const s = x & 0x8000 ? -1 : 1, e = (x >> 10) & 31, m = x & 1023; return s * (e === 0 ? m / 1024 * 2 ** -14 : e === 31 ? Infinity : (1 + m / 1024) * 2 ** (e - 15)); };
  return (x, y, z = 0) => { const o = (z * h * bpr + y * bpr) / 2 + x * 4; return [half(raw[o]), half(raw[o + 1]), half(raw[o + 2]), half(raw[o + 3])]; };
}
async function dumpSky(renderer, camera, astro) {
  const dev = renderer.device, t = renderer.world.tex;
  const sky = await readTex(dev, t.skyView, 192, 108);
  const rb = 6360, r = rb + Math.max(0.0001, camera.pos[1] / 1000 + 1.2);
  const beta = Math.acos(Math.sqrt(r * r - rb * rb) / r), zh = Math.PI - beta;
  const at = (elevDeg, azDeg) => {
    const z = Math.PI / 2 - elevDeg * Math.PI / 180, v = (1 - Math.sqrt(1 - z / zh)) * 0.5, u = Math.sqrt(0.5 - 0.5 * Math.cos(azDeg * Math.PI / 180));
    return sky(Math.min(191, Math.round(u * 191)), Math.min(107, Math.round(v * 107)));
  };
  const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const s = astro.sunDir, sunElev = Math.asin(s[1]) * 180 / Math.PI;
  const zen = at(89, 180), sunE = 120000 * Math.max(s[1], 0);
  const meadow = 0.1 * (sunE / Math.PI + 0.6 * lum(zen));
  console.log(`sun elevation ${sunElev.toFixed(1)} deg; level 0.1-albedo meadow about ${meadow.toFixed(0)} nits`);
  for (const az of [180, 90]) for (const el of [2, 5, 10, 20, 35, 60, 89]) {
    const c = at(el, az), l = lum(c), rgb = c.slice(0, 3);
    console.log(`sky az ${az} el ${String(el).padStart(2)}: ${l.toFixed(0).padStart(6)} nits (${Math.log2(l / meadow).toFixed(2)} EV over meadow)  rgb/l ${rgb.map(x => (x / l).toFixed(2)).join(' ')}  sat ${(1 - Math.min(...rgb) / Math.max(...rgb)).toFixed(2)}`);
  }
  const ap = await readTex(dev, t.aerialPerspective, 32, 32, 32);
  for (const d of [100, 300, 1000, 3000]) {
    const w = Math.log(1 + d * (Math.exp(6) - 1) / 12000) / 6, k = Math.min(31, Math.max(0, Math.round(w * 32 - 0.5)));
    const a = ap(16, 20, k), haze = lum(a);
    console.log(`haze at ${String(d).padStart(4)} m: transmittance ${a[3].toFixed(3)}, inscatter ${haze.toFixed(0)} nits = ${(100 * haze / (meadow * a[3] + haze)).toFixed(1)}% of what a meadow there shows`);
  }
}

const release = await waitForLock(Number(args['lock-wait'] ?? 30));
let runtime, exitCode = 0;
const timing = { quality, width, height, seed, hour, warm, timeFrames, views: {} };
try {
  const a = await bundle();
  runtime = await openRuntime({ backend: args.backend ?? 'd3d12' });
  globalThis.fetch = async url => { if (!/(^|\/)data\/stars\.bin$/.test(String(url))) throw new Error(`Unexpected asset: ${url}`); const b = await readFile(resolve('public/data/stars.bin')); return { ok: true, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; };
  // --settings '{"cloudCoverage":0}' overrides any field of the settings (for A/B checks).
  const settings = { ...a.DEFAULT_SETTINGS, ...(args.settings ? JSON.parse(args.settings) : {}), quality, performance240: false, renderScale: 1, dynamicResolution: false, targetFps: 60, frameCap: 0, lensDistortion: 0, videoNoise: 0 };
  // --date YYYY-MM-DD picks the day (default 2026-06-21); the moon's phase and position follow it.
  const [yy, mm, dd] = (args.date ?? '2026-06-21').split('-').map(Number);
  const astro = a.computeAstro(Date.UTC(yy, mm - 1, dd, Math.floor(hour), Math.round((hour % 1) * 60)), settings.observer);
  console.log(`sun elevation ${(Math.asin(astro.sunDir[1]) * 180 / Math.PI).toFixed(1)} deg, moon elevation ${(Math.asin(astro.moonDir[1]) * 180 / Math.PI).toFixed(1)} deg, moon lit ${(astro.moonIlluminatedFraction * 100).toFixed(0)}%`);

  const t0 = performance.now();
  // --track <file.json> (a track builder export: terrainSeed, quality, track) renders that track's world with its corridor and gates, and
  // adds views along the racing line (track-N: 3 m up, looking 25 m ahead along the path; trackHigh-N: 25 m up looking down at it).
  const trackFile = args.track ? JSON.parse(await readFile(resolve(args.track), 'utf8')) : null;
  const terrain = trackFile ? a.generateTerrain({ seed: trackFile.terrainSeed, quality: trackFile.quality ?? 'ultra' })
    : a.generateTerrain({ seed, quality: quality === 'extreme' ? 'ultra' : quality }); // Extreme builds ultra's world.
  const sampler = a.createTerrainSampler(terrain);
  const track = trackFile?.track ?? null;
  const place = a.placeVegetation(terrain, track, a.TIER_LIMITS[quality]);
  console.log(`terrain ${terrain.resolution}^2 at ${terrain.cellSize} m in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  const natural = naturalViews(a, terrain, sampler, place);
  // The stream bed seen against the sun from 7 m back and 2.5 m up: where wet stones would glint.
  if (natural.stream) {
    const [bx, by, bz] = natural.stream.bed, s = astro.sunDir, sl = Math.hypot(s[0], s[2]) || 1;
    const ex = bx - s[0] / sl * 7, ez = bz - s[2] / sl * 7;
    natural.streamSun = { eye: [ex, sampler.heightAt(ex, ez) + 2.5, ez], target: [bx, by, bz], fov: 90 };
  }
  // --views-file adds fixed views from a JSON file ({ name: { eye, target, fov } }, e.g. .bench/trees/views.json).
  if (args['views-file']) Object.assign(natural, JSON.parse(await readFile(resolve(args['views-file']), 'utf8')));
  if (track) {
    const P = track.path, n = P.length;
    for (let k = 0; k < 4; k++) {
      const i = Math.floor((k + 0.5) / 4 * n), j = Math.min(n - 1, i + 12), p = P[i], q = P[j];
      const g = sampler.heightAt(p[0], p[2]), gq = sampler.heightAt(q[0], q[2]);
      natural[`track-${k}`] = { eye: [p[0], g + 3, p[2]], target: [q[0], gq + 0.5, q[2]], fov: 90 };
      natural[`trackHigh-${k}`] = { eye: [p[0] - (q[0] - p[0]) * 0.8, g + 25, p[2] - (q[2] - p[2]) * 0.8], target: [q[0], gq, q[2]], fov: 75 };
    }
  }
  const scenes = [{ scene: { terrain, sampler, track }, views: natural }];
  if (!only || only.has('park')) {
    const built = a.buildPark(a.defaultParkRecipe(seed, 'compact')), ps = a.createTerrainSampler(built.terrain), l = built.park.launch;
    const fx = -Math.sin(l.yaw), fz = -Math.cos(l.yaw), e = [l.pos[0] - fx * 4, ps.heightAt(l.pos[0], l.pos[2]) + 3, l.pos[2] - fz * 4];
    scenes.push({ scene: { terrain: built.terrain, sampler: ps, track: built.track, park: new a.ParkRuntime(built.park) },
      views: { park: { eye: e, target: [e[0] + fx * 30, e[1] - 4, e[2] + fz * 30], fov: 90 },
        parkHigh: { eye: [e[0], e[1] + 40, e[2]], target: [e[0] + fx * 80, e[1] - 10, e[2] + fz * 80], fov: 80 } } });
  }

  const surface = offscreenSurface(width, height);
  const modules = a.createDefaultModules();
  const tCreate = performance.now();
  const renderer = await a.Renderer.create(surface.surface, settings, modules, undefined, { gpuProfile: timeFrames > 0 });
  console.log(`renderer ready in ${((performance.now() - tCreate) / 1000).toFixed(1)} s`);
  renderer.setDisplayRefresh(60, 'override'); renderer.device.pushErrorScope('validation');
  // --debug n shows a terrain debug view (see TerrainModule.setDebugView).
  if (args.debug) modules.find(m => m.name === 'terrain').setDebugView(Number(args.debug));
  // --atmos '{"cirrusCoverage":0}' sets atmosphere module settings (clouds, stars).
  if (args.atmos) modules.find(m => m.name === 'atmosphere').setSettings(JSON.parse(args.atmos));
  // --wind <m/s> sets the vegetation wind (default: the module's own 4 m/s).
  if (args.wind !== undefined) modules.find(m => m.name === 'vegetation').setWind([0.8, 0.6], Number(args.wind));
  const camera = { pos: [0, 0, 0], quat: [0, 0, 0, 1], fovY: 1.2, aspect: width / height, near: 0.05, far: 20000 };
  let time = 0;
  const frame = () => { time += 1 / 60; renderer.render({ dt: 1 / 60, time, camera, astro, quad: null }); };
  for (const { scene, views } of scenes) {
    renderer.setScene(scene);
    for (const [name, v0] of Object.entries(views)) {
      if (only && !only.has(name)) continue;
      // --face-sun turns the view toward the sun's azimuth at the same downward pitch (glints and back-lit grass).
      let v = v0;
      if (args['face-sun']) {
        const d = v0.target.map((x, k) => x - v0.eye[k]), flat = Math.hypot(d[0], d[2]), s = astro.sunDir, sl = Math.hypot(s[0], s[2]) || 1;
        v = { ...v0, target: [v0.eye[0] + s[0] / sl * flat, v0.eye[1] + d[1], v0.eye[2] + s[2] / sl * flat] };
      }
      camera.pos = [...v.eye]; camera.fovY = v.fov * Math.PI / 180;
      a.quatLookAlong(...v.target.map((x, k) => x - v.eye[k]), camera.quat);
      for (let i = 0; i < warm; i++) { frame(); if (i % 8 === 7) await renderer.device.queue.onSubmittedWorkDone(); }
      await renderer.device.queue.onSubmittedWorkDone();
      await writePng(resolve(out, `${name}.png`), await surface.read());
      const samples = [];
      if (timeFrames > 0) {
        const stop = renderer.listenGpuTimings(s => { if (s.status === 'measured' && Number.isFinite(s.gpuMs)) samples.push(s); });
        for (let i = 0; i < timeFrames; i++) { frame(); if (i % 2 === 1) await renderer.device.queue.onSubmittedWorkDone(); }
        await renderer.device.queue.onSubmittedWorkDone(); await renderer.drainGpuTimings(10000); stop();
      }
      if (args['dump-sky'] && name === (args['dump-sky'] === '1' ? Object.keys(views)[0] : args['dump-sky'])) await dumpSky(renderer, camera, astro);
      const med = xs => { const s = [...xs].sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : null; };
      const passes = ['pre', 'gbuffer', 'rt', 'lighting', 'sky+fwd', 'post'];
      timing.views[name] = { eye: v.eye, target: v.target, fov: v.fov, samples: samples.length, gpuMsMedian: med(samples.map(s => s.gpuMs)),
        passMsMedian: Object.fromEntries(passes.map((p, k) => [p, med(samples.map(s => s.passMs[k]))])) };
      console.log(`${name}: gpu ${timing.views[name].gpuMsMedian?.toFixed(2)} ms  gbuffer ${timing.views[name].passMsMedian.gbuffer?.toFixed(2)} ms  pre ${timing.views[name].passMsMedian.pre?.toFixed(2)} ms`);
    }
  }
  const validation = (await renderer.device.popErrorScope())?.message ?? null;
  if (validation || renderer.errors.length) throw new Error(`GPU errors: ${validation ?? ''} ${[...renderer.errors].join('; ')}`);
  renderer.destroy();
  await writeFile(resolve(out, 'timing.json'), JSON.stringify(timing, null, 2));
} catch (error) { console.error(error); exitCode = 1; }
finally { runtime?.close(); await release(); }
process.exit(exitCode);
