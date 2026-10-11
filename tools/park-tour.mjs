#!/usr/bin/env node
/** A camera tour of a generated park, rendered offline by the production renderer and encoded with ffmpeg (libx265).
 * One aerial pass over the park, then one shot per ride family: a slow orbit while the ride runs, and for coasters a chase from the
 * air and a ride-along from the front of the first car. Simulation time advances exactly one frame interval per frame, so motion is
 * even however slow the render is. Each shot opens out of black; the black hides the skip forward to a moment when that ride is running
 * and gives the renderer's temporal filters frames to settle at the new camera.
 *
 *   node tools/park-tour.mjs --out .bench/park-tour/tour.mp4 [--width 3840] [--fps 60] [--quality ultra] [--seed 1337] [--park destination]
 *     [--hour 15] [--crf 16] [--preset medium] [--only steel,carousel] [--pace 1] [--no-ride-along] [--no-titles]
 *
 * --pace scales every shot's length (0.25 for a quick test). --hour is UTC; the default observer stands at 8 degrees east. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { acquireGpuLock } from './native-bench/lock.mjs';
import { offscreenSurface, openRuntime } from './native-bench/runtime.mjs';
import { drawtextFont, drawtextText, frameReader, loadParkModules, smoother, startEncoder } from './park-video-common.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((out, v, i, all) => v.startsWith('--') ? [...out, [v.slice(2), all[i + 1]?.startsWith('--') === false ? all[i + 1] : '1']] : out, []));
const width = Number(args.width ?? 3840), height = Math.round(width * 9 / 16), fps = Number(args.fps ?? 60), pace = Number(args.pace ?? 1);
const seed = Number(args.seed ?? 1337), size = args.park ?? 'destination', quality = args.quality ?? 'ultra', hour = Number(args.hour ?? 15);
const crf = Number(args.crf ?? 16), preset = args.preset ?? 'medium', only = args.only ? new Set(args.only.split(',')) : null;
const rideAlong = !args['no-ride-along'], titles = !args['no-titles'];
if (!(width >= 320 && width <= 7680 && width % 16 === 0) || !(fps >= 24 && fps <= 120) || !(pace > 0 && pace <= 4) || !Number.isInteger(seed) || !['compact', 'destination', 'mega'].includes(size)) throw new Error('Invalid --width (multiple of 16), --fps, --pace, --seed or --park');
if (!['low', 'medium', 'high', 'ultra', 'extreme'].includes(quality) || !(crf >= 0 && crf <= 51)) throw new Error('Invalid --quality or --crf');
const out = resolve(args.out ?? '.bench/park-tour/tour.mp4'); await mkdir(dirname(out), { recursive: true });
const a = await loadParkModules(resolve(dirname(out), 'bundle'), [['coasterSeatHeight', 'src/world/park/rideDimensions.ts']]);
const TITLE_FONT = drawtextFont('tools/fonts/inter/Inter-SemiBold.ttf');

const FAMILY_TITLES = { steel: 'Steel coaster', launch: 'Launched coaster', inverted: 'Inverted coaster', wooden: 'Wooden coaster', hyper: 'Hyper coaster', mine: 'Mine train', space: 'Indoor space coaster',
  wheel: 'Ferris wheel', carousel: 'Carousel', swings: 'Flying swings', ship: 'Swinging ship', pendulum: 'Giant pendulum', drop: 'Drop tower', teacups: 'Teacups', scrambler: 'Scrambler', observation: 'Observation tower', enterprise: 'Enterprise', topspin: 'Top Spin' };
const mix = (p, q, u) => p.map((x, k) => x + (q[k] - x) * u);

const release = await acquireGpuLock(); let renderer, runtime, encoder, exitCode = 0;
try {
  runtime = await openRuntime({ backend: args.backend ?? 'd3d12' });
  globalThis.fetch = async url => { if (!/(^|\/)data\/stars\.bin$/.test(String(url))) throw new Error(`Unexpected asset: ${url}`); const b = await readFile(resolve('public/data/stars.bin')); return { ok: true, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; };
  const surface = offscreenSurface(width, height);
  const settings = { ...a.DEFAULT_SETTINGS, quality, performance240: false, renderScale: 1, dynamicResolution: false, targetFps: fps, frameCap: 0, lensDistortion: 0, videoNoise: 0 };
  renderer = await a.Renderer.create(surface.surface, settings, a.createDefaultModules()); renderer.setDisplayRefresh(fps, 'override'); renderer.device.pushErrorScope('validation');
  const recipe = a.defaultParkRecipe(seed, size), built = a.buildPark(recipe), park = built.park, sim = new a.ParkRuntime(park);
  const sampler = a.createTerrainSampler(built.terrain), astro = a.computeAstro(Date.UTC(2026, 5, 21, Math.floor(hour), Math.round((hour % 1) * 60)), settings.observer);
  renderer.setScene({ terrain: built.terrain, sampler, track: built.track, park: sim });
  const ground = (x, z) => sampler.heightAt(x, z);

  // Where each ride is and how big: flat rides from their radius and height, coasters from every point of their track.
  const extent = ride => {
    if (!ride.curve) return { centre: [ride.pos[0], ride.pos[1] + ride.height * 0.4, ride.pos[2]], size: Math.max(ride.radius, ride.height * 0.6, 4) };
    const s = ride.curve.samples, min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < ride.curve.count; i++) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], s[i * a.CURVE_STRIDE + k]); max[k] = Math.max(max[k], s[i * a.CURVE_STRIDE + k]); }
    return { centre: mix(min, max, 0.5), size: Math.max(Math.hypot(max[0] - min[0], max[2] - min[2]) / 2, (max[1] - min[1]) * 0.8, 10) };
  };
  const rides = [], seen = new Set();
  for (const ride of park.rides) if (!seen.has(ride.family) && (!only || only.has(ride.family))) { seen.add(ride.family); rides.push(ride); }
  const parkCentre = park.rides.reduce((c, r) => c.map((x, k) => x + r.pos[k] / park.rides.length), [0, 0, 0]);
  const parkRadius = Math.max(60, ...park.rides.map(r => Math.hypot(r.pos[0] - parkCentre[0], r.pos[2] - parkCentre[2]) + (r.curve ? extent(r).size : r.radius)));
  // Visit the rides round the park in one direction, so consecutive shots are neighbours.
  rides.sort((p, q) => Math.atan2(p.pos[2] - parkCentre[2], p.pos[0] - parkCentre[0]) - Math.atan2(q.pos[2] - parkCentre[2], q.pos[0] - parkCentre[0]));

  // A ride is worth filming once it is running: a flat ride in its running phase, a coaster train moving at speed.
  const running = ride => {
    const state = sim.rides[ride.id];
    if (ride.curve) { const train = state.trains[0]; return train.phase === 'running' && Math.abs(train.v) > 9; }
    return state.phase === 'running' && state.phaseTime > 1.5;
  };
  const carBody = ride => park.bodies.findIndex(b => b.ride === ride.id && b.role === 'car' && (b.train ?? 0) === 0 && b.index === 0);
  // A front-row rider's eyes, in the car's frame (forward is -z): seated eye height above the seat, just behind the front of the car
  // at that height (an inverted car's hanger reaches up to the rail, so only the parts round the seats count).
  const SEATED_EYE = 0.8;
  const noseOf = (ride, body) => {
    const eyeY = a.coasterSeatHeight(ride.family) + SEATED_EYE; let front = Infinity;
    for (const p of park.parts) if (p.body === body && Math.abs(p.pos[1] - eyeY) < Math.max(...p.half) + 0.6) front = Math.min(front, p.pos[2] - Math.max(...p.half));
    return [0, eyeY, (Number.isFinite(front) ? front : 0) + 0.35];
  };
  const carPose = a.pose();
  const carPoint = (body, local) => { sim.bodyPose(body, sim.renderTime, carPose); return a.rotate(carPose.rot, local).map((x, k) => x + carPose.pos[k]); };

  const shots = [];
  shots.push({ title: titles ? `Seed ${seed} · ${size} park` : null, seconds: 14 * pace, wait: null, camera: u => {
    const angle = -0.6 + u * 1.3, r = parkRadius * (1.25 - 0.3 * u), y = parkCentre[1] + parkRadius * (0.55 - 0.2 * u);
    return { eye: [parkCentre[0] + Math.cos(angle) * r, y, parkCentre[2] + Math.sin(angle) * r], target: [parkCentre[0], parkCentre[1] + 5, parkCentre[2]], fov: 50 };
  } });
  for (const ride of rides) {
    const { centre, size: s } = extent(ride), start = Math.atan2(centre[2] - parkCentre[2], centre[0] - parkCentre[0]) - 0.5;
    const distance = ride.curve ? s * 1.35 + 10 : s * 2.3 + 8, sweep = ride.curve ? 0.7 : 0.9;
    const label = titles ? `${FAMILY_TITLES[ride.family] ?? ride.family}${ride.name ? ` — ${ride.name}` : ''}` : null;
    shots.push({ title: label, seconds: (ride.curve ? 9 : 10) * pace, wait: ride, camera: u => {
      const angle = start + sweep * smoother(u), elevation = 0.32 - 0.1 * u, flat = distance * Math.cos(elevation);
      const eye = [centre[0] + Math.cos(angle) * flat, centre[1] + distance * Math.sin(elevation), centre[2] + Math.sin(angle) * flat];
      eye[1] = Math.max(eye[1], ground(eye[0], eye[2]) + 2.5);
      return { eye, target: centre, fov: 50 };
    } });
    // The indoor space coaster runs in the dark under a roof, so it is filmed from outside only.
    const body = ride.curve && ride.family !== 'space' ? carBody(ride) : -1;
    if (body >= 0) {
      // A chase from the air: the camera keeps a fixed height and distance from the first car and slowly swings round it.
      const swing = start + 1.2;
      shots.push({ title: label, seconds: 9 * pace, wait: ride, camera: u => {
        const train = carPoint(body, [0, 0, 0]), angle = swing + 0.8 * smoother(u);
        const eye = [train[0] + Math.cos(angle) * 26, train[1] + 11, train[2] + Math.sin(angle) * 26];
        eye[1] = Math.max(eye[1], ground(eye[0], eye[2]) + 3);
        return { eye, target: train, fov: 45 };
      } });
    }
    if (body >= 0 && rideAlong) {
      // The ride-along starts a fresh run, as the train first gathers speed, rather than wherever the chase left it.
      const nose = noseOf(ride, body);
      shots.push({ title: label ? `${label} · front seat` : null, seconds: 14 * pace, wait: ride, fresh: true, camera: () => ({ eye: carPoint(body, nose), quat: [...carPose.rot], fov: 72 }) });
    }
  }

  const frameTime = 1 / fps, fade = Math.round(0.45 * fps), settle = Math.round(0.5 * fps);
  const plan = shots.map(shot => ({ ...shot, frames: Math.max(2 * fade + 1, Math.round(shot.seconds * fps)) })), total = plan.reduce((n, s) => n + s.frames, 0);
  console.log(`${plan.length} shots, ${total} frames (${(total / fps).toFixed(1)} s) at ${width}x${height} ${fps} fps, quality ${quality}`);

  // Each shot fades in from black and out to black; titles fade in after the picture and out before it. A fade acts only inside
  // its own window (enable), because ffmpeg otherwise holds black before a fade-in and after a fade-out.
  const filters = [], texts = [];
  let at = 0;
  for (const shot of plan) {
    const start = at / fps, end = (at + shot.frames) / fps, d = fade / fps;
    filters.push(`fade=t=in:st=${start.toFixed(4)}:d=${d.toFixed(4)}:color=black:enable='between(t\\,${start.toFixed(4)}\\,${(start + d).toFixed(4)})'`,
      `fade=t=out:st=${(end - d).toFixed(4)}:d=${d.toFixed(4)}:color=black:enable='between(t\\,${(end - d).toFixed(4)}\\,${end.toFixed(4)})'`);
    if (shot.title) {
      const t0 = start + d + 0.3, t1 = end - d - 0.4, alpha = `if(lt(t\\,${t0.toFixed(3)})\\,0\\,if(lt(t\\,${(t0 + 0.6).toFixed(3)})\\,(t-${t0.toFixed(3)})/0.6\\,if(lt(t\\,${(t1 - 0.6).toFixed(3)})\\,1\\,if(lt(t\\,${t1.toFixed(3)})\\,(${t1.toFixed(3)}-t)/0.6\\,0))))`;
      texts.push(`drawtext=fontfile='${TITLE_FONT}':expansion=none:text='${drawtextText(shot.title)}':fontsize=${Math.round(height * 0.032)}:fontcolor=white:shadowcolor=black@0.45:shadowx=${Math.max(1, Math.round(height / 720))}:shadowy=${Math.max(1, Math.round(height / 720))}:x=${Math.round(width * 0.045)}:y=h-${Math.round(height * 0.09)}-th:alpha='${alpha}':enable='between(t\\,${t0.toFixed(3)}\\,${t1.toFixed(3)})'`);
    }
    at += shot.frames;
  }
  filters.push(...texts, 'format=yuv420p10le');
  const filterFile = resolve(dirname(out), 'tour-filters.txt'); await writeFile(filterFile, filters.join(',\n'));

  const device = renderer.device;
  let written = 0;
  const reader = frameReader(device, () => surface.surface.getContext('webgpu').getCurrentTexture(), width, height, async frame => { await encoder.write(frame); written++; });
  encoder = startEncoder({ out, width, height, fps, pixelFormat: reader.pixelFormat, filterFile, crf, preset });
  const camera = { pos: [0, 0, 0], quat: [0, 0, 0, 1], fovY: 0.9, aspect: width / height, near: 0.05, far: 20000 };
  const aim = view => {
    camera.pos = [...view.eye]; camera.fovY = view.fov * Math.PI / 180; camera.near = view.fov > 60 ? 0.03 : 0.05;
    if (view.quat) camera.quat = view.quat; else a.quatLookAlong(...view.target.map((x, k) => x - view.eye[k]), camera.quat);
  };
  const step = () => { sim.advance(frameTime); sim.present(1, 0); };

  const began = performance.now(); let done = 0;
  for (const [index, shot] of plan.entries()) {
    // Skip ahead, during the black between shots, to when this ride is running (at most three minutes of park time); a fresh shot
    // first lets the current run end, so it opens as a new run gathers speed.
    let t = 0;
    if (shot.fresh) while (t < 180 && running(shot.wait)) { step(); t += frameTime; }
    if (shot.wait) while (t < 360 && !running(shot.wait)) { step(); t += frameTime; }
    aim(shot.camera(0));
    for (let i = 0; i < settle; i++) renderer.render({ dt: frameTime, time: sim.elapsed, camera, astro, quad: null });
    for (let f = 0; f < shot.frames; f++) {
      step(); aim(shot.camera(f / (shot.frames - 1)));
      renderer.render({ dt: frameTime, time: sim.elapsed, camera, astro, quad: null });
      await reader.capture(); done++;
      if (done % (fps * 2) === 0) { const rate = done / ((performance.now() - began) / 1000); console.log(`shot ${index + 1}/${plan.length} frame ${done}/${total}, ${rate.toFixed(2)} frames/s, about ${((total - done) / rate / 60).toFixed(0)} min left`); }
    }
  }
  await reader.drain(); await encoder.finish();
  const validation = (await device.popErrorScope())?.message ?? null;
  if (validation || renderer.errors.length) throw new Error(`GPU errors: ${validation ?? ''} ${[...renderer.errors].join('; ')}`);
  if (written !== total) throw new Error(`Wrote ${written} of ${total} frames`);
  await writeFile(out.replace(/\.mp4$/, '.json'), JSON.stringify({ recipe, width, height, fps, quality, hour, crf, preset, frames: total, shots: plan.map(s => ({ title: s.title, frames: s.frames })) }, null, 2));
  console.log(`Wrote ${out}: ${total} frames in ${((performance.now() - began) / 60000).toFixed(1)} min`);
} catch (error) { console.error(error); exitCode = 1; encoder?.abort(); }
finally { renderer?.destroy(); runtime?.close(); await release(); }
process.exit(exitCode);
