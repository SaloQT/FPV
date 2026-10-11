#!/usr/bin/env node
/** A video of a brain flying one or more laps (--laps) of a theme park's race course or a track builder export (--track), rendered offline by the production renderer: the
 * game's FPV camera with its OSD fills the frame, with a helicopter shot of the drone on the left edge and the game's chase camera on
 * the right. The sound is the drone's own (motors, wind, gate beeps) and a park's rides, and another video (--pip) can sit at the
 * bottom centre with its music mixed under the drone.
 *
 * The flight runs first in the game's TypeScript sim (BrainRacer: QuadPhysics, BrainPilot and GateTimer, on the world the trainer and
 * tools/brain/eval.mjs fly), one state per video frame. A crash spoils the lap, so it tries the brain's mean action and then sampled
 * flights (--tries) and keeps the fastest that flies its laps without a crash or a put-back. Each view then renders in its own pass,
 * every frame at one frame interval of sim time, the audio is rendered from the FPV frames in Chrome (OfflineAudioContext,
 * tools/pilot-lap-browser.html, which also draws the OSD), and ffmpeg lays everything together. --views fpv,chase,heli renders only those passes (no mix without fpv);
 * --reuse keeps passes already rendered for the same flight.
 *
 *   node tools/pilot-lap-video.mjs --brain public/brains/ace.json --out .bench/pilot-video/lap.mp4 [--seed 1337] [--park destination | --track export.json]
 *     [--width 1920] [--fps 60] [--quality ultra] [--hour 15] [--tries 12] [--laps 1] [--pip video.mp4] [--pip-volume 0.8] [--crf 16]
 *     [--views fpv,chase,heli] [--reuse fpv,chase] [--pick fastest|smooth] [--no-lock] [--lens 0.35] [--video-noise 0.15] [--flight-only]
 */
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { acquireGpuLock } from './native-bench/lock.mjs';
import { offscreenSurface, openRuntime } from './native-bench/runtime.mjs';
import { drawtextFont, drawtextText, frameReader, loadParkModules, startEncoder } from './park-video-common.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((out, v, i, all) => v.startsWith('--') ? [...out, [v.slice(2), all[i + 1]?.startsWith('--') === false ? all[i + 1] : '1']] : out, []));
const width = Number(args.width ?? 1920), height = Math.round(width * 9 / 16), fps = Number(args.fps ?? 60), tries = Number(args.tries ?? 12), lapCount = Number(args.laps ?? 1);
const trackFile = args.track ? resolve(args.track) : null, seed = Number(args.seed ?? 1337), size = args.park ?? 'destination', quality = args.quality ?? 'ultra', hour = Number(args.hour ?? 15), crf = Number(args.crf ?? 16);
if (!args.brain) throw new Error('--brain <file.json> is required');
if (!(width >= 320 && width <= 7680 && width % 16 === 0) || !(fps >= 24 && fps <= 120) || !Number.isInteger(seed) || !['compact', 'destination', 'mega'].includes(size)) throw new Error('Invalid --width (multiple of 16), --fps, --seed or --park');
if (!['low', 'medium', 'high', 'ultra', 'extreme'].includes(quality) || !(tries >= 1 && tries <= 64) || !(Number.isInteger(lapCount) && lapCount >= 1 && lapCount <= 3)) throw new Error('Invalid --quality, --tries or --laps');
const out = resolve(args.out ?? '.bench/pilot-video/lap.mp4'), work = resolve(dirname(out), 'work'); await mkdir(work, { recursive: true });
const a = await loadParkModules(resolve(work, 'bundle'), [['buildTrainWorld', 'src/ai/train/worlds.ts'], ['parseBrain', 'src/ai/brain.ts'], ['BrainRacer', 'src/ai/racer.ts'],
  ['CameraRig', 'src/game/cameraRig.ts'], ['BRAIN_PHYSICS_HZ', 'src/ai/spec.ts'], ['Rng', 'src/sim/math3d.ts'], ['createRaceSnapshot', 'src/game/gateTimer.ts'], ['parseTrackFile', 'src/ai/train/trackFile.ts']]);
const brain = a.parseBrain(await readFile(resolve(args.brain), 'utf8'));

/** Seconds on the pad before GO (the countdown beeps at 3, 2, 1), and seconds flown on past the lap line. */
const PAD_S = 3.5, COUNTDOWN = [3, 2, 1, 0], AFTER_LAP_S = 2.5, MAX_S = 300;
/** Park time run before the first frame, so the rides are under way and the guests spread out. */
const PARK_PREROLL_S = 90;
const OMEGA_HOVER_SCALE = 1.1e-6;

// The flight: the world the trainer flies, either a track file (a builder export on its own terrain) or this park (its race course on the
// pad, the park as box stand-ins round the line).
const file = trackFile ? a.parseTrackFile(await readFile(trackFile, 'utf8')) : null;
if (file && (file.terrainSeed === undefined || file.quality === undefined)) throw new Error('--track needs a builder export with terrainSeed and quality');
const world = file ? a.buildTrainWorld({ seed: file.terrainSeed, quality: file.quality, track: file.track }) : a.buildTrainWorld({ seed, park: size, parkRoute: 'race' });
const place = file ? `Track builder · ${file.track.style} · seed ${file.track.seed}` : `Theme park · ${size} · seed ${seed}`;
const copyState = s => ({ pos: [...s.pos], vel: [...s.vel], quat: [...s.quat], angVel: [...s.angVel], motorOmega: [...s.motorOmega], motorCmd: [...s.motorCmd], gForce: [...s.gForce],
  batteryVoltage: s.batteryVoltage, batteryCurrent: s.batteryCurrent, batteryMah: s.batteryMah, armed: s.armed, onGround: s.onGround, crashed: s.crashed, impactSpeed: s.impactSpeed, time: s.time });
/** Index of the frame in which lap n (from 1) ends. */
const lineFrame = (list, n) => { let seen = 0; return list.findIndex(x => (seen += x.events.filter(e => e === 'lap' || e === 'finish').length) >= n); };
function fly(sample) {
  const racer = new a.BrainRacer(brain, { ground: world.ground, groundHeightAt: world.ground.groundHeightAt, track: world.track, colliders: world.colliders }, { seed: 1, sample: sample === null ? undefined : new a.Rng(sample) });
  const hz = a.BRAIN_PHYSICS_HZ, dt = 1 / hz, frames = [], goFrame = Math.round(PAD_S * fps);
  let steps = 0;
  const laps = [];
  // The countdown frames hold the quad as placed on the pad: the trainer starts its episodes flying from GO, and a brain that idles on
  // the pad first takes off differently.
  racer.go = true;
  for (let f = 0; f < (MAX_S + PAD_S) * fps; f++) {
    const events = [];
    for (const until = Math.round((f + 1 - goFrame) * hz / fps); steps < until; steps++) {
      const ev = racer.step(dt);
      if (ev === 'gate' || ev === 'lap' || ev === 'finish') events.push(ev);
      if (ev === 'lap' || ev === 'finish') laps.push(racer.time);
    }
    // A crash, or the game putting the quad back at its last gate for going too long without one, cuts the flight.
    // Past the finish the race is over: a crash in the fly-on after it ends the video a few frames before the hit, half a second after
    // the line at the earliest, instead of spoiling the flight.
    if ((racer.crashes > 0 || racer.stalls > 0) && laps.length >= lapCount) {
      const keep = Math.max(frames.length - 6, lineFrame(frames, lapCount) + 1 + Math.round(fps / 2));
      if (keep <= frames.length) return { sample, crashed: false, lap: laps[lapCount - 1], laps: laps.slice(0, lapCount), frames: frames.slice(0, keep), goFrame };
    }
    if (racer.crashes > 0 || racer.stalls > 0) return { sample, crashed: true, at: racer.time, why: `${racer.crashes > 0 ? 'crashed' : 'put back at a gate'} (lap ${laps.length + 1}, next gate ${racer.timer.nextGate})` };
    // What the OSD shows: the session snapshot the game would build, with the race-start count on the pad and GO for a second after.
    const toGo = (goFrame - f) / fps, count = Math.ceil(toGo), cmd = racer.cmd;
    const hud = { state: f < goFrame ? 'ready' : racer.finished ? 'finished' : 'flying', simTime: racer.time, flightTime: racer.time, throttle: cmd.throttle, stick: { roll: cmd.roll, pitch: cmd.pitch, yaw: cmd.yaw },
      countdown: { active: toGo > -1, locked: toGo > 0, value: toGo <= 0 ? 0 : count > 3 ? -1 : count, fraction: toGo <= 0 ? -toGo : 1 - (toGo - (count - 1)) },
      race: { ...racer.timer.fill(a.createRaceSnapshot(), racer.time) } };
    frames.push({ state: copyState(racer.physics.state), nextGate: racer.timer.nextGate, events, countdown: COUNTDOWN.find(n => f === goFrame - n * fps) ?? null, hud });
    if (laps.length >= lapCount && racer.time >= laps[lapCount - 1] + AFTER_LAP_S) return { sample, crashed: false, lap: laps[lapCount - 1], laps: laps.slice(0, lapCount), frames, goFrame };
  }
  return { sample, crashed: true, at: racer.time, why: 'out of time' };
}
/** How twitchy a clean flight looks: the mean change of the body rotation rate from one video frame to the next over the laps, deg/s. */
function twitch(r) {
  const end = lineFrame(r.frames, lapCount), DEG = 180 / Math.PI;
  let sum = 0, n = 0;
  for (let f = r.goFrame + 1; f <= end; f++) {
    const w = r.frames[f].state.angVel, p = r.frames[f - 1].state.angVel;
    sum += Math.hypot(w[0] - p[0], w[1] - p[1], w[2] - p[2]) * DEG; n++;
  }
  return sum / Math.max(1, n);
}
// --pick fastest (default) keeps the fastest clean flight; --pick smooth keeps the calmest one, which films better.
const pick = args.pick ?? 'fastest';
if (!['fastest', 'smooth'].includes(pick)) throw new Error('--pick is fastest or smooth');
let best = null;
for (let k = 0; k < tries; k++) {
  const sample = k === 0 ? null : k, began = performance.now(), r = fly(sample);
  if (!r.crashed) r.twitch = twitch(r);
  console.log(`flight ${k + 1}/${tries} (${sample === null ? 'mean action' : `sample ${sample}`}): ${r.crashed ? `${r.why} at ${r.at.toFixed(1)} s` : `clean, laps ${r.laps.map((t, i) => (t - (r.laps[i - 1] ?? 0)).toFixed(2)).join(', ')} s, twitch ${r.twitch.toFixed(1)} deg/s`} (${((performance.now() - began) / 1000).toFixed(0)} s wall)`);
  if (!r.crashed && (!best || (pick === 'smooth' ? r.twitch < best.twitch : r.lap < best.lap))) best = r;
}
if (!best) throw new Error(`No clean lap in ${tries} flights`);
const frames = best.frames, total = frames.length;
const lapTimes = best.laps.map((t, i) => t - (best.laps[i - 1] ?? 0));
console.log(`Using ${best.sample === null ? 'the mean action' : `sample ${best.sample}`} (${pick}): ${lapCount} laps in ${best.lap.toFixed(2)} s, twitch ${best.twitch.toFixed(1)} deg/s, ${total} frames (${(total / fps).toFixed(1)} s)`);
const recipe = file ? null : { ...a.defaultParkRecipe(seed, size), route: 'race' };
// What the browser stage needs: each frame's state, OSD snapshot and height above the ground; the FPV pass adds its camera.
const telemetry = { fps, seed, size, recipe, parkPrerollS: PARK_PREROLL_S, frames: frames.map(f => ({ ...f, agl: f.state.pos[1] - world.ground.groundHeightAt(f.state.pos[0], f.state.pos[2]) })) };
const telemetryFile = resolve(work, 'telemetry.json');
if (args['flight-only']) { await writeFile(telemetryFile, JSON.stringify(telemetry)); process.exit(0); }

// The render: one pass per view over the same frames, each with its own renderer and its own copy of the full park (guests included,
// the same race course), run for PARK_PREROLL_S first and then one frame interval per frame, so every pass sees the same park.
// A track file renders the world it flies; a park is built again in full, which must lay the same race course.
const built = recipe ? a.buildPark(recipe) : { terrain: world.terrain, track: world.track, park: null };
const gatesMatch = built.track.gates.length === world.track.gates.length && built.track.gates.every((g, i) => g.pos.every((x, k) => Math.abs(x - world.track.gates[i].pos[k]) < 1e-6));
if (!gatesMatch) throw new Error('The rendered park lays its race course differently from the flown one');
const frameTime = 1 / fps, sampler = file ? world.sampler : a.createTerrainSampler(built.terrain);

/** The helicopter shot: a camera ship hanging back and to one side of the drone and above it, filming it on a long lens that keeps
 * HELI_FRAME_M of scene in frame height round the drone. The whole flight is known, so the ship's path is smoothed both ways in time:
 * it drifts after the drone like a pilot holding station, never jerks, and the operator keeps the drone in the middle of the frame. */
const HELI_BACK_M = 85, HELI_SIDE_M = 55, HELI_UP_M = 30, HELI_CLEAR_M = 20, HELI_FRAME_M = 35, HELI_FOV_DEG = [8, 45];
const heli = heliShots();
/** Views: the FPV picture fills the frame; the chase camera and the helicopter are rendered at twice the size they are shown. */
const VIEWS = {
  fpv: { width, height, rig: 'fpv', fx: true },
  chase: { width: 960, height: 540, rig: 'chase', fx: false },
  heli: { width: 960, height: 540, rig: null, fx: false },
};

/** Per frame: where the camera ship is, where it looks and its lens. */
function heliShots() {
  const n = frames.length, P = frames.map(f => f.state.pos);
  // A box filter run twice (close to a Gaussian) of the given half-width in frames, holding the ends.
  const smooth = (list, half) => {
    let cur = list;
    for (let pass = 0; pass < 2; pass++) {
      const sums = [[0, 0, 0]];
      for (const v of cur) sums.push(sums.at(-1).map((s, k) => s + v[k]));
      cur = cur.map((_, i) => { const lo = Math.max(0, i - half), hi = Math.min(n, i + half + 1); return [0, 1, 2].map(k => (sums[hi][k] - sums[lo][k]) / (hi - lo)); });
    }
    return cur;
  };
  const S = smooth(P, 2 * fps), yaw = world.track.start.yaw;
  let last = [-Math.sin(yaw), 0, -Math.cos(yaw)];
  const heading = smooth(S.map((_, i) => {
    const p = S[Math.max(0, i - fps / 2)], q = S[Math.min(n - 1, i + fps / 2)], dx = q[0] - p[0], dz = q[2] - p[2], l = Math.hypot(dx, dz);
    if (l > 2) last = [dx / l, 0, dz / l];
    return last;
  }), 2 * fps);
  const ship = smooth(S.map((s, i) => {
    const d = heading[i], l = Math.hypot(d[0], d[2]) || 1, fx = d[0] / l, fz = d[2] / l;
    const x = s[0] - fx * HELI_BACK_M - fz * HELI_SIDE_M, z = s[2] - fz * HELI_BACK_M + fx * HELI_SIDE_M;
    return [x, Math.max(s[1] + HELI_UP_M, world.ground.groundHeightAt(x, z) + HELI_CLEAR_M), z];
  }), 3 * fps);
  // Centred in time, the operator's smoothing leaves the drone in the middle on straights and lets it drift a little off centre in turns.
  const aim = smooth(P, Math.round(fps / 2));
  const fov = smooth(ship.map((c, i) => { const d = Math.hypot(...c.map((x, k) => x - P[i][k])); const f = 2 * Math.atan(HELI_FRAME_M / 2 / d) * 180 / Math.PI; return [Math.min(Math.max(f, HELI_FOV_DEG[0]), HELI_FOV_DEG[1]), 0, 0]; }), 2 * fps);
  return ship.map((pos, i) => ({ pos, aim: aim[i], fovY: fov[i][0] * Math.PI / 180 }));
}
const only = args.views ? new Set(args.views.split(',')) : null, reuse = new Set((args.reuse ?? '').split(',').filter(Boolean));
// A reused FPV pass brings the cameras the audio needs from the telemetry it wrote.
if (reuse.has('fpv')) {
  const old = JSON.parse(await readFile(telemetryFile, 'utf8'));
  if (old.frames.length !== total || old.frames.some((f, i) => f.state.pos.some((x, k) => x !== frames[i].state.pos[k]))) throw new Error('--reuse fpv: the saved FPV pass flew a different flight');
  old.frames.forEach((f, i) => Object.assign(telemetry.frames[i], { parkTime: f.parkTime, camera: f.camera }));
}
// The renderer fetches the star catalogue and the bark scans from public/.
globalThis.fetch = async url => { const m = /(^|\/)(data\/stars\.bin|textures\/bark\/bark\.bin)$/.exec(String(url)); if (!m) throw new Error(`Unexpected asset: ${url}`); const b = await readFile(resolve('public', m[2])); return { ok: true, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; };

// --no-lock renders alongside whatever holds the shared GPU lock (screenshots, training): slower, but nothing waits.
const release = args['no-lock'] ? async () => {} : await acquireGpuLock(); let runtime, exitCode = 0;
try {
  runtime = await openRuntime({ backend: args.backend ?? 'd3d12' });
  for (const [name, view] of Object.entries(VIEWS)) if ((!only || only.has(name)) && !reuse.has(name)) await renderView(name, view);
} catch (error) { console.error(error); exitCode = 1; }
finally { runtime?.close(); await release(); }
if (exitCode) process.exit(exitCode);

async function renderView(name, view) {
  const { width: w, height: h } = view, file = resolve(work, `${name}.mp4`);
  const sim = built.park ? new a.ParkRuntime(built.park) : null;
  if (sim) for (let t = 0; t < PARK_PREROLL_S; t += frameTime) sim.advance(frameTime);
  const parkStart = sim?.elapsed ?? 0;
  const surface = offscreenSurface(w, h);
  const settings = { ...a.DEFAULT_SETTINGS, quality, performance240: false, renderScale: 1, dynamicResolution: false, targetFps: fps, frameCap: 0,
    // The FPV view keeps the game's lens and video-link look unless --lens or --video-noise override it (0 to 1; --video-noise 0 is a clean HD feed).
    ...(view.fx ? { ...(args.lens !== undefined ? { lensDistortion: Number(args.lens) } : {}), ...(args['video-noise'] !== undefined ? { videoNoise: Number(args['video-noise']) } : {}) } : { lensDistortion: 0, videoNoise: 0 }) };
  const modules = a.createDefaultModules(), objects = modules.find(m => typeof m.setActiveGate === 'function'), vegetation = modules.find(m => typeof m.setQuad === 'function');
  const renderer = await a.Renderer.create(surface.surface, settings, modules); let encoder;
  try {
    renderer.setDisplayRefresh(fps, 'override'); renderer.device.pushErrorScope('validation');
    const astro = a.computeAstro(Date.UTC(2026, 5, 21, Math.floor(hour), Math.round((hour % 1) * 60)), settings.observer);
    renderer.setScene({ terrain: built.terrain, sampler, track: built.track, park: sim ?? undefined });
    objects?.setActiveGate(0); objects?.setHideQuad(view.rig === 'fpv');
    const rig = new a.CameraRig(world.ground.groundHeightAt); rig.mode = view.rig ?? 'chase'; rig.snap();
    // The game's FPV camera: its default lens, up-tilt and motor buzz; the chase camera keeps still.
    const camSettings = { fov: settings.fov, cameraTiltDeg: settings.cameraTiltDeg, camVibration: view.rig === 'fpv' ? 0.15 : 0 };
    const heliCam = { pos: [0, 0, 0], quat: [0, 0, 0, 1], fovY: 0.5, aspect: w / h, near: 0.5, far: 20000 };
    const heliCamera = i => {
      const s = heli[i]; heliCam.pos = [...s.pos]; heliCam.fovY = s.fovY;
      a.quatLookAlong(...s.aim.map((x, k) => x - s.pos[k]), heliCam.quat);
      return heliCam;
    };
    const reader = frameReader(renderer.device, () => surface.surface.getContext('webgpu').getCurrentTexture(), w, h, async (frame, i) => {
      await encoder.write(frame);
    });
    const filterFile = resolve(work, `${name}-filters.txt`); await writeFile(filterFile, 'format=yuv420p10le');
    encoder = startEncoder({ out: file, width: w, height: h, fps, pixelFormat: reader.pixelFormat, filterFile, crf, preset: 'medium' });
    let clock = 0;
    const draw = (f, settle, i) => {
      const q = f.state, dt = settle ? 0 : frameTime;
      if (sim) { sim.drone = q.pos; if (!settle) sim.advance(frameTime); sim.present(1, 0); }
      if (!settle) clock += frameTime;
      objects?.setActiveGate(f.nextGate);
      const m = q.motorOmega; vegetation?.setQuad(q.pos, q.vel, q.armed ? OMEGA_HOVER_SCALE * (m[0] * m[0] + m[1] * m[1] + m[2] * m[2] + m[3] * m[3]) : 0);
      const camera = view.rig ? rig.update(dt, q, camSettings, w / h) : heliCamera(i);
      renderer.render({ dt: frameTime, time: sim?.elapsed ?? clock, camera, astro, quad: q });
      return camera;
    };
    // Let the temporal filters settle on the first view before recording.
    for (let i = 0; i < 30; i++) draw(frames[0], true, 0);
    const began = performance.now();
    for (const [i, f] of frames.entries()) {
      const camera = draw(f, false, i);
      if (name === 'fpv') Object.assign(telemetry.frames[i], { parkTime: (sim?.elapsed ?? clock) - parkStart, camera: { pos: [...camera.pos], quat: [...camera.quat], fovY: camera.fovY, aspect: camera.aspect, near: camera.near, far: camera.far } });
      await reader.capture(i);
      if ((i + 1) % (fps * 10) === 0) { const rate = (i + 1) / ((performance.now() - began) / 1000); console.log(`${name}: frame ${i + 1}/${total}, ${rate.toFixed(1)} frames/s, about ${((total - i - 1) / rate / 60).toFixed(1)} min left`); }
    }
    await reader.drain(); await encoder.finish(); encoder = null;
    const validation = (await renderer.device.popErrorScope())?.message ?? null;
    if (validation || renderer.errors.length) throw new Error(`GPU errors in the ${name} view: ${validation ?? ''} ${[...renderer.errors].join('; ')}`);
    console.log(`Rendered the ${name} view (${w}x${h}) in ${((performance.now() - began) / 60000).toFixed(1)} min`);
  } catch (error) { encoder?.abort(); throw error; }
  finally { renderer.destroy(); }
}

// The audio, rendered in Chrome from the FPV frames (the camera microphone on the drone, the park heard from the FPV camera), then the mix.
if (only && !only.has('fpv') && !reuse.has('fpv')) process.exit(0);
await writeFile(telemetryFile, JSON.stringify(telemetry));
const wav = resolve(work, 'drone.wav');
await run(process.execPath, [resolve('tools/pilot-lap-browser.mjs'), telemetryFile, work, '--osd', `${width}x${height}`]);

// Layout, kept clear of the OSD's four corners: the FPV picture under the game's OSD fills the frame, the helicopter shot sits on the left
// edge and the chase camera on the right edge, both centred in height, and the --pip video bottom centre. Titles and lap times appear
// in the top centre under the flight timer.
const font = drawtextFont('tools/fonts/inter/Inter-SemiBold.ttf'), lapFrames = frames.flatMap((f, i) => f.events.filter(e => e === 'lap' || e === 'finish').map(() => i));
const fade = (t0, t1) => `if(lt(t\\,${(t0 + 0.5).toFixed(3)})\\,(t-${t0.toFixed(3)})/0.5\\,if(gt(t\\,${(t1 - 0.5).toFixed(3)})\\,(${t1.toFixed(3)}-t)/0.5\\,1))`;
const centred = (s, t0, t1, y, px) => `drawtext=fontfile='${font}':expansion=none:text='${drawtextText(s)}':fontsize=${Math.round(height * px)}:fontcolor=white:shadowcolor=black@0.7:shadowx=2:shadowy=2:x=(w-text_w)/2:y=${Math.round(y)}:alpha='${fade(t0, t1)}':enable='between(t\\,${t0.toFixed(3)}\\,${t1.toFixed(3)})'`;
const label = (s, x, y) => `drawtext=fontfile='${font}':expansion=none:text='${drawtextText(s)}':fontsize=${Math.round(height * 0.02)}:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=6:x=${Math.round(x)}:y=${Math.round(y)}`;
const end = total / fps, margin = Math.round(height * 0.025), inset = Math.round(width / 4 / 2) * 2, insetH = Math.round(inset * 9 / 16 / 2) * 2, insetY = Math.round((height - insetH) / 2);
const titles = [centred(brain.name, 0.3, PAD_S + 1.5, height * 0.15, 0.04), centred(`${place} · ${lapCount === 1 ? 'one lap' : `${lapCount} laps`}`, 0.3, PAD_S + 1.5, height * 0.205, 0.026),
  ...lapTimes.map((t, i) => centred(`Lap ${i + 1}  ${t.toFixed(2)} s`, lapFrames[i] / fps + 0.1, Math.min(end, lapFrames[i] / fps + 5), height * 0.15, 0.04))];
const frameEdge = 'pad=iw+4:ih+4:2:2:color=black@0.85';
let graph = `[0:v]setpts=PTS-STARTPTS[fpv];[4:v]format=rgba[osd];[fpv][osd]overlay=0:0:format=auto[main];`
  + `[2:v]scale=${inset}:${insetH}:flags=lanczos,${frameEdge}[chase];[3:v]scale=${inset}:${insetH}:flags=lanczos,${frameEdge}[heli];`
  + `[main][heli]overlay=${margin}:${insetY}[m1];[m1][chase]overlay=W-w-${margin}:${insetY}[m2];`;
const ffArgs = ['-hide_banner', '-loglevel', 'warning', '-y', '-i', resolve(work, 'fpv.mp4'), '-i', wav, '-i', resolve(work, 'chase.mp4'), '-i', resolve(work, 'heli.mp4'),
  '-framerate', String(fps), '-i', resolve(work, 'osd/%05d.png')];
const labels = [label('Helicopter', margin + 10, insetY + 8), label('Chase cam', width - margin - inset + 6, insetY + 8)];
if (args.pip) {
  ffArgs.push('-i', resolve(args.pip));
  graph += `[5:v]fps=${fps},scale=${inset}:-2:flags=lanczos,${frameEdge},setpts=PTS-STARTPTS[pip];[m2][pip]overlay=(W-w)/2:H-h-${margin}:shortest=1,${[...titles, ...labels].join(',')},fade=t=out:st=${(end - 0.6).toFixed(3)}:d=0.6,format=yuv420p[v];`
    + `[5:a]aresample=48000,volume=${Number(args['pip-volume'] ?? 0.8)}[music];[1:a][music]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95,afade=t=out:st=${(end - 0.6).toFixed(3)}:d=0.6[a]`;
} else graph += `[m2]${[...titles, ...labels].join(',')},fade=t=out:st=${(end - 0.6).toFixed(3)}:d=0.6,format=yuv420p[v];[1:a]alimiter=limit=0.95,afade=t=out:st=${(end - 0.6).toFixed(3)}:d=0.6[a]`;
const graphFile = resolve(work, 'compose.txt'); await writeFile(graphFile, graph);
ffArgs.push('-/filter_complex', graphFile, '-map', '[v]', '-map', '[a]', '-t', end.toFixed(3), '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-profile:v', 'high', '-r', String(fps),
  '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', out);
await run('ffmpeg', ffArgs);
await writeFile(out.replace(/\.mp4$/, '.json'), JSON.stringify({ brain: basename(args.brain), track: trackFile, seed, size, quality, width, height, fps, laps: lapTimes, sample: best.sample, frames: total, pip: args.pip ?? null }, null, 2));
console.log(`Wrote ${out}`);

function run(cmd, list) {
  return new Promise((done, fail) => spawn(cmd, list, { stdio: 'inherit' }).on('error', fail).on('close', code => code === 0 ? done() : fail(new Error(`${basename(cmd)} exited with ${code}`))));
}
