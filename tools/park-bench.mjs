#!/usr/bin/env node
/** Native park verification and steady-state benchmark; the legacy benchmark workload is untouched. */
import { build } from 'vite';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { Session } from 'node:inspector';
import { acquireGpuLock } from './native-bench/lock.mjs';
import { adapterIdentity, offscreenSurface, openRuntime } from './native-bench/runtime.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((out, v, i, all) => v.startsWith('--') ? [...out, [v.slice(2), all[i + 1]?.startsWith('--') === false ? all[i + 1] : '1']] : out, []));
const number = (key, fallback, min, max) => { const v = Number(args[key] ?? fallback); if (!Number.isFinite(v) || v < min || v > max) throw new Error(`Invalid --${key}`); return v; };
const width = number('width', 3840, 320, 7680), height = Math.round(width * 9 / 16), warmup = number('warmup', 240, 60, 3000), frames = number('frames', 300, 60, 3000);
const quality = args.quality ?? 'high', size = args.park ?? 'destination', dynamic = args.dynamic !== '0', scale = number('scale', 1, 0.25, 1), seed = number('seed', 1337, 0, 4294967295);
const inFlight = number('in-flight', 2, 1, 3), performance240 = args.perf240 === '1', flightPhysics = args['flight-physics'] !== '0';
const simulationLead = number('sim-seconds', 0, 0, 600);
if (!Number.isInteger(inFlight)) throw new Error('Invalid --in-flight');
if (!['low', 'medium', 'high', 'ultra', 'extreme'].includes(quality) || !['compact', 'destination', 'mega'].includes(size)) throw new Error('Invalid quality or park size');
const scenarios = (args.scenes ?? 'aerial,midway,coaster,indoor,night').split(',');
if (scenarios.some(s => !['aerial', 'midway', 'coaster', 'indoor', 'night', 'shop', 'enterprise', 'topspin', 'crowd', 'stairs', 'district', 'station', 'train', 'coupler', 'inverted', 'wheel', 'swings', 'tower', 'roof', 'junction', 'tree'].includes(s))) throw new Error('Invalid scene');
const output = resolve(args.out ?? '.bench/park-bench'); await mkdir(output, { recursive: true });
const bundle = resolve(output, 'bundle'); await mkdir(bundle, { recursive: true });
const entry = resolve(bundle, 'entry.ts');
const imports = [
  ['Renderer', 'src/render/renderer.ts'], ['createDefaultModules', 'src/render/modules.ts'], ['buildPark', 'src/world/park/build.ts'],
  ['defaultParkRecipe', 'src/world/park/recipe.ts'], ['ParkRuntime', 'src/world/park/runtime.ts'], ['createTerrainSampler', 'src/world/terrain/sampler.ts'],
  ['computeAstro', 'src/world/astro/clock.ts'], ['quatLookAlong', 'src/game/quat.ts'], ['DEFAULT_SETTINGS', 'src/contracts.ts'],
  ['QuadPhysics', 'src/sim/quad.ts'], ['QUAD_5IN_6S', 'src/sim/presets.ts'], ['railSample, sampleRail', 'src/world/park/curve.ts'], ['yawPoint, cross, rotate', 'src/world/park/math.ts'],
  ['parkDistrictGeometry', 'src/world/park/districts.ts'],
];
await writeFile(entry, imports.map(([names, path]) => `export { ${names} } from ${JSON.stringify(resolve(path).replaceAll('\\', '/'))};`).join('\n'));
await build({ configFile: false, logLevel: 'warn', publicDir: false, build: { ssr: entry, outDir: bundle, emptyOutDir: false, target: 'es2022', rolldownOptions: { output: { entryFileNames: 'park.mjs' } } } });
const bundleSha256 = createHash('sha256').update(await readFile(resolve(bundle, 'park.mjs'))).digest('hex');

function png(rgba) {
  const crc = data => { let c = 0xffffffff; for (const v of data) { c ^= v; for (let i = 0; i < 8; i++) c = c >>> 1 ^ (c & 1 ? 0xedb88320 : 0); } return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const b = Buffer.alloc(data.length + 12); b.writeUInt32BE(data.length); b.write(type, 4); data.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, b.length - 4)), b.length - 4); return b; };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc(height * (width * 4 + 1)); for (let y = 0; y < height; y++) rows.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
const summarize = values => { values = values.filter(Number.isFinite).sort((a, b) => a - b); return { samples: values.length, mean: values.reduce((a, b) => a + b, 0) / values.length, p50: values[Math.floor(values.length * 0.5)], p95: values[Math.floor(values.length * 0.95)] }; };
const release = await acquireGpuLock(); let renderer, runtime, exitCode = 0;
const cpuSession = args['cpu-profile'] === '1' ? new Session() : null;
const cpuCommand = (name, params = {}) => new Promise((resolve, reject) => cpuSession.post(name, params, (error, result) => error ? reject(error) : resolve(result)));
try {
  if (cpuSession) { cpuSession.connect(); await cpuCommand('Profiler.enable'); }
  runtime = await openRuntime({ backend: args.backend ?? 'd3d12' }); const { identity } = await adapterIdentity(runtime.gpu);
  globalThis.fetch = async url => { if (!/(^|\/)data\/stars\.bin$/.test(String(url))) throw new Error(`Unexpected asset: ${url}`); const b = await readFile(resolve('public/data/stars.bin')); return { ok: true, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; };
  const a = await import(pathToFileURL(resolve(bundle, 'park.mjs')).href), surface = offscreenSurface(width, height);
  const settings = { ...a.DEFAULT_SETTINGS, quality, performance240, renderScale: scale, dynamicResolution: dynamic, targetFps: 60, frameCap: 0, lensDistortion: 0, videoNoise: 0 };
  const modules = a.createDefaultModules(), parkModule = modules.find(m => m.name === 'park'), rt = modules.find(m => m.name === 'rt');
  renderer = await a.Renderer.create(surface.surface, settings, modules, undefined, { gpuProfile: args.profile === '1' }); renderer.setDisplayRefresh(60, 'override'); renderer.device.pushErrorScope('validation');
  if (renderer.errors.length) throw new Error(renderer.errors.join('\n'));
  const generationStart = performance.now(), recipe = { ...a.defaultParkRecipe(seed, size), ...(args.guests ? { guests: number('guests', 3000, 0, 10000) } : {}) };
  const built = a.buildPark(recipe), park = new a.ParkRuntime(built.park), sampler = a.createTerrainSampler(built.terrain), quad = new a.QuadPhysics(a.QUAD_5IN_6S, sampler, seed);
  quad.reset(built.park.launch.pos, built.park.launch.yaw); quad.collision.environment = park.collision; quad.setWind({ meanSpeed: 0, turbulence: 0, gustsPerMinute: 0 });
  renderer.setScene({ terrain: built.terrain, sampler, track: built.track, park });
  const generationMs = performance.now() - generationStart, camera = { pos: [0, 100, 220], quat: [0, 0, 0, 1], fovY: 85 * Math.PI / 180, aspect: width / height, near: 0.05, far: 20000 };
  const report = { bundleSha256, adapter: identity, options: { width, height, quality, performance240, dynamic, scale, warmup, frames, inFlight, flightPhysics, simulationLead }, recipe, generationMs,
    scope: `Production park, crowd and 4 kHz quad physics ${flightPhysics ? 'at the scripted flight camera, including nearby moving collisions' : 'on the launch pad'}; production rendering. Scripted positions replace pilot input; UI/audio excluded. At most ${inFlight} GPU submission(s) in flight.`, results: [], selfTest: null, errors: [], validation: null };
  const stick = { throttle: 0, roll: 0, pitch: 0, yaw: 0, armed: false, mode: 'angle', turtle: false }, rail = a.railSample(); let physicsTicks = 0, frameCount = 0, measured = null;
  // Inspection can start later in a real operating cycle without changing the measured workload.
  for (let i = 0; i < Math.round(simulationLead * 250); i++) park.advance(1 / 250);
  const samples = new Map(); renderer.listenGpuTimings(sample => { if (sample.status === 'measured' && measured) measured.set(sample.frameIndex, sample); });
  for (const scene of scenarios) {
    let portraitGuest = -1, contactInspection = null;
    const astro = a.computeAstro(Date.UTC(2026, 5, 21, scene === 'night' ? 0 : 12), settings.observer);
    measured = null; const cpu = [], simulation = [], render = [], gpu = new Map(), pending = []; let elapsed = 0;
    for (let i = 0; i < warmup + frames; i++) {
      if (i === warmup) { measured = gpu; if (cpuSession) await cpuCommand('Profiler.start'); }
      const begin = performance.now();
      if (flightPhysics) { for (let k = 0; k < 3; k++) { quad.state.pos[k] = camera.pos[k]; quad.state.vel[k] = 0; } }
      const targetTick = Math.round(++frameCount * 4000 / 60);
      while (physicsTicks < targetTick) { park.drone = quad.state.pos; park.advance(1 / 4000); quad.step(1 / 4000, stick); physicsTicks++; }
      park.present(1, 1 / 4000);
      if (scene === 'train' || scene === 'inverted') {
        const ride = scene === 'inverted' ? built.park.rides.find(r => r.family === 'inverted') : built.park.rides[0];
        if (!ride) throw new Error(`${scene} is absent from this park size`);
        a.sampleRail(ride.curve, park.rides[ride.id].trains[0].s, rail); const right = a.cross(rail.tangent, rail.up), lift = scene === 'inverted' ? -1 : 2;
        camera.pos = rail.pos.map((v, k) => v + rail.up[k] * lift + right[k] * 4.8 + rail.tangent[k] * 3.5);
        const direction = rail.pos.map((v, k) => v + rail.up[k] * (scene === 'inverted' ? -1.5 : 1) - camera.pos[k]); a.quatLookAlong(...direction, camera.quat);
      } else if (scene === 'coupler') {
        const ride = built.park.rides[0], id = ride.bodies.find(i => built.park.bodies[i].role === 'coupler' && built.park.bodies[i].train === 0);
        const link = park.bodies[id]; a.sampleRail(ride.curve, park.rides[ride.id].trains[0].s - ride.carLength / 2, rail);
        const right = a.cross(rail.tangent, rail.up);
        camera.pos = link.pos.map((v, k) => v + right[k] * 2.8 + rail.up[k] * 0.25);
        a.quatLookAlong(...link.pos.map((v, k) => v - camera.pos[k]), camera.quat);
      } else if (scene === 'station') {
        const ride = built.park.rides[0]; a.sampleRail(ride.curve, ride.curve.stationEnd - 6 - ride.carLength * 2, rail); const right = a.cross(rail.tangent, rail.up);
        camera.pos = rail.pos.map((v, k) => v + right[k] * 6 + rail.up[k] * 3.2 - rail.tangent[k] * 7);
        const direction = rail.pos.map((v, k) => v + rail.up[k] - camera.pos[k]); a.quatLookAlong(...direction, camera.quat);
      } else if (scene === 'coaster' || scene === 'indoor') {
        const ride = scene === 'indoor' ? built.park.rides.find(r => r.family === 'space') ?? built.park.rides[0] : built.park.rides[0];
        a.sampleRail(ride.curve, park.rides[ride.id].trains.at(-1).s + 7, rail); const right = a.cross(rail.tangent, rail.up);
        camera.pos = rail.pos.map((v, k) => v + rail.up[k] * 3.1 + right[k] * 3.5); a.quatLookAlong(...rail.tangent, camera.quat);
      } else if (scene === 'midway') { const ride = built.park.rides.find(r => r.family === 'carousel'); camera.pos = a.yawPoint(ride.pos, ride.yaw, [0, 2.2, ride.radius + 10]); const d = ride.pos.map((v, k) => v - camera.pos[k]); a.quatLookAlong(d[0], 0.04, d[2], camera.quat); }
      else if (scene === 'enterprise' || scene === 'topspin') {
        const ride = built.park.rides.find(r => r.family === scene); if (!ride) throw new Error(`${scene} is absent from this park size`);
        camera.pos = a.yawPoint(ride.pos, ride.yaw, [ride.radius * 1.2, 8, ride.radius * 1.65]); const d = ride.pos.map((v, k) => v + (k === 1 ? 7 : 0) - camera.pos[k]); a.quatLookAlong(...d, camera.quat);
      } else if (scene === 'wheel' || scene === 'swings' || scene === 'tower') {
        const family = scene === 'tower' ? 'observation' : scene, ride = built.park.rides.find(r => r.family === family);
        if (!ride) throw new Error(`${scene} is absent from this park size`);
        const role = scene === 'wheel' ? 'gondola' : scene === 'swings' ? 'seat' : 'tower';
        const id = ride.bodies.find(id => built.park.bodies[id].role === role), body = park.bodies[id];
        const offset = scene === 'tower' ? [9, 3, 11] : [5, 2, 6], targetOffset = scene === 'swings' ? [0, 2.5, 0] : [0, 0.8, 0];
        camera.pos = a.yawPoint(body.pos, ride.yaw, offset); const target = a.yawPoint(body.pos, ride.yaw, targetOffset);
        a.quatLookAlong(...target.map((v, k) => v - camera.pos[k]), camera.quat);
      } else if (scene === 'roof') {
        const roof = built.park.parts.find(p => p.shape === 'gable' && p.surface !== 'paving' && p.half[1] > 0.5);
        if (!roof) throw new Error('No pitched roof in park');
        const offset = a.rotate(roof.rot, [roof.half[0] * 0.55, roof.half[1] * 0.2, -(roof.half[2] + roof.half[0] * 1.5)]);
        camera.pos = roof.pos.map((v, k) => v + offset[k]); a.quatLookAlong(...offset.map(v => -v), camera.quat);
      } else if (scene === 'junction') {
        const node = built.park.nodes.filter(n => n.links.length >= 3).sort((a, b) => Math.hypot(a.pos[0], a.pos[2]) - Math.hypot(b.pos[0], b.pos[2]))[0];
        camera.pos = node.pos.map((v, k) => v + [12, 15, 18][k]); a.quatLookAlong(-12, -15, -18, camera.quat);
      } else if (scene === 'tree') {
        const tree = built.park.plantings[0]; if (!tree) throw new Error('No planting in park');
        camera.pos = a.yawPoint(tree.pos, tree.yaw, [0, 5 * tree.scale, 4.5 * tree.scale]);
        const target = a.yawPoint(tree.pos, tree.yaw, [0, 4.5 * tree.scale, 0]); a.quatLookAlong(...target.map((v, k) => v - camera.pos[k]), camera.quat);
      } else if (scene === 'district') {
        const ride = built.park.rides[0], retailZ = a.parkDistrictGeometry(size).retailZ;
        camera.pos = a.yawPoint(ride.pos, ride.yaw, [-92, 1.8, retailZ + 28]);
        const target = a.yawPoint(ride.pos, ride.yaw, [-92, 2.1, retailZ - 32]), direction = target.map((v, k) => v - camera.pos[k]);
        a.quatLookAlong(...direction, camera.quat);
      } else if (scene === 'stairs') {
        const c = park.crowd, contacts = new Float64Array(8);
        const eligible = n => n >= 0 && c.stairFlight[n] >= 0 && c.seatBlend[n] === 0 && park.guestStairContacts(n, c.pos.subarray(n * 3, n * 3 + 3), park.renderTime, contacts);
        if (!eligible(portraitGuest)) portraitGuest = Array.from({ length: c.count }, (_, n) => n).find(eligible) ?? -1;
        if (portraitGuest < 0) throw new Error('No stair walker in operating snapshot; try a different --sim-seconds');
        eligible(portraitGuest);
        const n = portraitGuest, o = n * 3, yaw = c.yaw[n], h = c.height[n];
        const side = [Math.cos(yaw), 0, -Math.sin(yaw)], front = [-Math.sin(yaw), 0, -Math.cos(yaw)];
        camera.pos = [c.pos[o] + side[0] * 2.5 + front[0], c.pos[o + 1] + h * 0.55, c.pos[o + 2] + side[2] * 2.5 + front[2]];
        const target = [c.pos[o], c.pos[o + 1] + h * 0.35, c.pos[o + 2]];
        a.quatLookAlong(...target.map((v, k) => v - camera.pos[k]), camera.quat);
        contactInspection = { guest: n, ride: c.stairFlight[n], position: Array.from(c.pos.subarray(o, o + 3)), height: h, yaw, contacts: Array.from(contacts), time: park.renderTime };
      } else if (scene === 'crowd') {
        if (!park.crowd.count) throw new Error('Crowd portrait requires guests');
        if (portraitGuest < 0) { let nearest = Infinity; for (let n = 0; n < park.crowd.count; n++) { const c = park.crowd; if (c.mode[n] > 1 || c.height[n] < 1.7) continue; const d = c.pos[n * 3] ** 2 + c.pos[n * 3 + 2] ** 2; if (d < nearest) { nearest = d; portraitGuest = n; } } portraitGuest = Math.max(0, portraitGuest); }
        const c = park.crowd, n = portraitGuest, yaw = c.yaw[n], h = c.height[n];
        camera.pos = [c.pos[n * 3] - Math.sin(yaw) * 2.5, c.pos[n * 3 + 1] + h * 0.82, c.pos[n * 3 + 2] - Math.cos(yaw) * 2.5];
        a.quatLookAlong(Math.sin(yaw), -0.08, Math.cos(yaw), camera.quat);
      } else if (scene === 'shop') {
        camera.pos = [Math.cos(0.25) * 42, 14.1, Math.sin(0.25) * 42]; a.quatLookAlong(Math.cos(0.25) * 23, 1.7, Math.sin(0.25) * 23, camera.quat);
      }
      else { camera.pos = scene === 'night' ? [0, 32, 95] : [0, 100, 220]; a.quatLookAlong(0, scene === 'night' ? -0.12 : -0.4, -1, camera.quat); }
      const simulated = performance.now(); renderer.render({ dt: 1 / 60, time: park.elapsed, camera, astro, quad: null }); const rendered = performance.now();
      if (i >= warmup) { cpu.push(rendered - begin); simulation.push(simulated - begin); render.push(rendered - simulated); samples.set(renderer.stats.frameIndex, scene); }
      pending.push(renderer.device.queue.onSubmittedWorkDone());
      if (pending.length >= inFlight) await pending.shift();
      if (i === warmup - 1 || i === warmup + frames - 1) { await Promise.all(pending); pending.length = 0; }
      if (i >= warmup) elapsed += performance.now() - begin;
    }
    if (cpuSession) { const { profile } = await cpuCommand('Profiler.stop'); await writeFile(resolve(output, `${scene}.cpuprofile`), JSON.stringify(profile)); }
    await renderer.drainGpuTimings(10000); measured = null;
    const timing = [...gpu].filter(([id]) => samples.get(id) === scene).map(([, sample]) => sample);
    const passMs = Object.fromEntries(['pre', 'gbuffer', 'rt', 'lighting', 'sky+fwd', 'post'].map((name, i) => [name, summarize(timing.map(t => t.passMs[i]))]));
    const detailMs = Object.fromEntries(Object.keys(timing.find(t => t.detailMs)?.detailMs ?? {}).map(name => [name, summarize(timing.map(t => t.detailMs?.[name]).filter(v => v !== null))]));
    const attractions = built.park.rides.map(r => { const s = park.rides[r.id]; return { family: r.family, phase: s.phase, theta: s.theta, omega: s.omega, phi: s.phi, completed: s.completed, passengers: s.trains.reduce((n, t) => n + t.passengers, 0) }; });
    const result = { scene, throughputFps: 1000 * frames / elapsed, cpuMs: summarize(cpu), simulationMs: summarize(simulation), renderMs: summarize(render), gpuMs: summarize(timing.map(t => t.gpuMs)), passMs, detailMs, stats: structuredClone(renderer.stats), park: parkModule.stats(), rt: rt.stats(), simulationTime: park.elapsed, attractions };
    if (contactInspection) result.contactInspection = contactInspection;
    report.results.push(result); if (args.capture !== '0') await writeFile(resolve(output, `${scene}.png`), png(await surface.read()));
    console.log(`${scene}: ${result.throughputFps.toFixed(1)} fps, CPU ${result.cpuMs.p50.toFixed(2)} ms, GPU ${result.gpuMs.p50?.toFixed(2)} ms, internal ${result.stats.renderWidth}×${result.stats.renderHeight}`);
  }
  if (args['self-test'] !== '0') { report.selfTest = await rt.selfTest(); console.log('ray tracing self-test', JSON.stringify(report.selfTest)); }
  report.validation = (await renderer.device.popErrorScope())?.message ?? null; report.errors = [...renderer.errors];
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
  if (report.validation || report.errors.length || report.selfTest?.bvh.mismatches || report.selfTest?.heightfield.mismatches) throw new Error('Park GPU validation failed; inspect report.json');
  console.log(`Report and captures: ${output}`);
} catch (error) { console.error(error); exitCode = 1; }
finally { cpuSession?.disconnect(); renderer?.destroy(); runtime?.close(); await release(); }
process.exit(exitCode);
