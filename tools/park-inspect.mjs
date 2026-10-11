#!/usr/bin/env node
/** Native close-up renders of the production park at chosen simulation times and cameras.
 * Views are JSON: { name, time, ride?, frame?: 'ride'|'world', eye, target, fov?, highlight?: part ids }
 * or { name, time, part, dir, distance } to frame one generated part from a direction. Diagnostics from
 * tools/park-audit.mjs carry views in this format, so every reported defect has a reproducible camera. */
import { build } from 'vite';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { acquireGpuLock } from './native-bench/lock.mjs';
import { offscreenSurface, openRuntime } from './native-bench/runtime.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((out, v, i, all) => v.startsWith('--') ? [...out, [v.slice(2), all[i + 1]?.startsWith('--') === false ? all[i + 1] : '1']] : out, []));
const width = Number(args.width ?? 1600), height = Math.round(width * 9 / 16), frames = Number(args.frames ?? 36);
const seed = Number(args.seed ?? 1337), size = args.park ?? 'destination', guests = args.guests === undefined ? undefined : Number(args.guests);
if (!(width >= 320 && width <= 7680) || !(frames >= 4 && frames <= 600) || !Number.isInteger(seed) || !['compact', 'destination', 'mega'].includes(size)) throw new Error('Invalid --width, --frames, --seed or --park');
if (!args.views) throw new Error('Pass --views <file.json>');
const views = JSON.parse(await readFile(resolve(args.views), 'utf8'));
const output = resolve(args.out ?? '.bench/park-inspect'); await mkdir(output, { recursive: true });
const bundle = resolve(args.bundle ?? resolve(output, 'bundle')); await mkdir(bundle, { recursive: true });
const entry = resolve(bundle, 'entry.ts');
const imports = [
  ['Renderer', 'src/render/renderer.ts'], ['createDefaultModules', 'src/render/modules.ts'], ['buildPark', 'src/world/park/build.ts'],
  ['defaultParkRecipe', 'src/world/park/recipe.ts'], ['ParkRuntime', 'src/world/park/runtime.ts'], ['createTerrainSampler', 'src/world/terrain/sampler.ts'],
  ['computeAstro', 'src/world/astro/clock.ts'], ['quatLookAlong', 'src/game/quat.ts'], ['DEFAULT_SETTINGS', 'src/contracts.ts'],
  ['yawPoint, rotate, pose', 'src/world/park/math.ts'], ['PARK_DT', 'src/world/park/ridePhysics.ts'],
];
await writeFile(entry, imports.map(([names, path]) => `export { ${names} } from ${JSON.stringify(resolve(path).replaceAll('\\', '/'))};`).join('\n'));
await build({ configFile: false, logLevel: 'warn', publicDir: false, build: { ssr: entry, outDir: bundle, emptyOutDir: false, target: 'es2022', rolldownOptions: { output: { entryFileNames: 'inspect.mjs' } } } });
const bundleSha256 = createHash('sha256').update(await readFile(resolve(bundle, 'inspect.mjs'))).digest('hex');

function png(rgba) {
  const crc = data => { let c = 0xffffffff; for (const v of data) { c ^= v; for (let i = 0; i < 8; i++) c = c >>> 1 ^ (c & 1 ? 0xedb88320 : 0); } return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const b = Buffer.alloc(data.length + 12); b.writeUInt32BE(data.length); b.write(type, 4); data.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, b.length - 4)), b.length - 4); return b; };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc(height * (width * 4 + 1)); for (let y = 0; y < height; y++) rows.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

const release = await acquireGpuLock(); let renderer, runtime, exitCode = 0;
try {
  runtime = await openRuntime({ backend: args.backend ?? 'd3d12' });
  globalThis.fetch = async url => { if (!/(^|\/)data\/stars\.bin$/.test(String(url))) throw new Error(`Unexpected asset: ${url}`); const b = await readFile(resolve('public/data/stars.bin')); return { ok: true, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; };
  const current = await import(pathToFileURL(resolve(bundle, 'inspect.mjs')).href), surface = offscreenSurface(width, height);
  // --park-bundle <file.mjs>: build and run the park with another bundle of the generator and runtime (for example an
  // earlier tools/park-audit.mjs bundle), drawn by the current renderer, so the same views give before/after pairs.
  const parkBundle = args['park-bundle'] ? resolve(args['park-bundle']) : null, other = parkBundle ? await import(pathToFileURL(parkBundle).href) : null;
  const a = other ? { ...current, buildPark: other.buildPark, ParkRuntime: other.ParkRuntime, defaultParkRecipe: other.defaultParkRecipe, PARK_DT: other.PARK_DT } : current;
  const settings = { ...a.DEFAULT_SETTINGS, quality: args.quality ?? 'high', performance240: false, renderScale: 1, dynamicResolution: false, targetFps: 60, frameCap: 0, lensDistortion: 0, videoNoise: 0 };
  renderer = await a.Renderer.create(surface.surface, settings, a.createDefaultModules()); renderer.setDisplayRefresh(60, 'override'); renderer.device.pushErrorScope('validation');
  const recipe = { ...a.defaultParkRecipe(seed, size), ...(guests === undefined ? {} : { guests }) };
  const built = a.buildPark(recipe), park = built.park;
  // Diagnostic renders recolour selected parts; ordinary renders leave every material untouched.
  const highlighted = new Set(views.flatMap(v => v.highlight ?? []));
  for (const id of highlighted) { const p = park.parts[id]; if (p) { p.color = [0.95, 0.05, 0.75]; p.emissive = 0.4; p.render = true; } }
  const order = views.map((v, i) => ({ v, i })).sort((x, y) => (x.v.time ?? 0) - (y.v.time ?? 0));
  // An earlier park bundle's crowd lacks per-guest fields added since; the current renderer reads those as zero.
  const runtimeFor = data => {
    const s = new a.ParkRuntime(data);
    if (other) { const zeros = new Map(), count = s.crowd.count ?? s.crowd.height?.length ?? 0; s.crowd = new Proxy(s.crowd, { get: (t, k, r) => k in t || typeof k !== 'string' ? Reflect.get(t, k, r) : zeros.get(k) ?? zeros.set(k, new Float32Array(count * 16)).get(k) }); }
    return s;
  };
  let sim = runtimeFor(park), scene = false;
  const sampler = a.createTerrainSampler(built.terrain), astro = a.computeAstro(Date.UTC(2026, 5, 21, Number(args.hour ?? 3)), settings.observer);
  const manifest = { bundleSha256, parkBundle, parkBundleSha256: parkBundle ? createHash('sha256').update(await readFile(parkBundle)).digest('hex') : null, recipe, width, height, frames, views: [] };
  const tmp = a.pose();
  for (const { v } of order) {
    const time = v.time ?? 0;
    if (time < sim.elapsed - 1e-9) { sim = runtimeFor(park); scene = false; }
    while (sim.elapsed < time - 1e-9) sim.advance(Math.min(a.PARK_DT, time - sim.elapsed));
    sim.present(1, 0);
    if (!scene) { renderer.setScene({ terrain: built.terrain, sampler, track: built.track, park: sim }); scene = true; }
    let eye, target;
    if (v.part !== undefined) {
      const part = park.parts[v.part]; let center = part.pos;
      if (part.body >= 0) { sim.bodyPose(part.body, sim.renderTime, tmp); center = a.rotate(tmp.rot, part.pos).map((x, k) => x + tmp.pos[k]); }
      target = v.offset ? center.map((x, k) => x + v.offset[k]) : center;
      const d = v.dir ?? [1, 0.6, 1], n = Math.hypot(...d), distance = v.distance ?? Math.max(1.5, 4 * Math.hypot(...part.half));
      eye = target.map((x, k) => x + d[k] / n * distance);
    } else if (v.ride !== undefined) {
      const ride = typeof v.ride === 'number' ? park.rides[v.ride] : park.rides.filter(r => r.family === v.ride)[v.index ?? 0];
      if (!ride) throw new Error(`${v.name}: ride ${v.ride} absent`);
      eye = a.yawPoint(ride.pos, ride.yaw, v.eye); target = a.yawPoint(ride.pos, ride.yaw, v.target);
    } else { eye = v.eye; target = v.target; }
    const camera = { pos: [...eye], quat: [0, 0, 0, 1], fovY: (v.fov ?? 50) * Math.PI / 180, aspect: width / height, near: 0.03, far: 20000 };
    a.quatLookAlong(...target.map((x, k) => x - eye[k]), camera.quat);
    for (let i = 0; i < frames; i++) renderer.render({ dt: 1 / 60, time: sim.elapsed, camera, astro, quad: null });
    await renderer.device.queue.onSubmittedWorkDone();
    const file = `${v.name}.png`; await writeFile(resolve(output, file), png(await surface.read()));
    manifest.views.push({ ...v, file, eye, target, simTime: sim.elapsed });
    console.log(`${v.name}: t=${sim.elapsed.toFixed(3)} eye=${eye.map(x => x.toFixed(2)).join(',')}`);
  }
  manifest.validation = (await renderer.device.popErrorScope())?.message ?? null; manifest.errors = [...renderer.errors];
  await writeFile(resolve(output, 'views.json'), JSON.stringify(manifest, null, 2));
  if (manifest.validation || manifest.errors.length) throw new Error('GPU validation failed; see views.json');
} catch (error) { console.error(error); exitCode = 1; }
finally { renderer?.destroy(); runtime?.close(); await release(); }
process.exit(exitCode);
