#!/usr/bin/env node
// Flies a brain on track files in the game's own sim (as tools/brain/eval.mjs does) and scores how watchable each clean flight is, not only
// whether it finishes. Per track it prints the clean flights and, over those, three smoothness measures:
//   stick  mean change of the sticks per policy decision (sum over roll, pitch, yaw, throttle; 0 = perfectly steady sticks)
//   rate   RMS body rotation rate, deg/s (camera swing a viewer feels)
//   jerk   mean change of the body rotation rate per decision, deg/s (twitchiness: snaps, wobble)
// Lower is smoother. The totals line averages the three over every clean flight, so two brains compare on one line.
//   node tools/brain/smooth-score.mjs <brain.json> <track.json,...> [flights=8]
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { loadParkModules } from '../park-video-common.mjs';

const [brainFile, list, flightsArg = '8'] = process.argv.slice(2);
if (!brainFile || !list) throw new Error('usage: smooth-score.mjs <brain.json> <track.json,...> [flights]');
const a = await loadParkModules(resolve('.bench/smooth-score/bundle'), [['buildTrainWorld', 'src/ai/train/worlds.ts'], ['parseBrain', 'src/ai/brain.ts'],
  ['BrainRacer', 'src/ai/racer.ts'], ['BRAIN_PHYSICS_HZ', 'src/ai/spec.ts'], ['POLICY_HZ', 'src/ai/spec.ts'], ['Rng', 'src/sim/math3d.ts'], ['parseTrackFile', 'src/ai/train/trackFile.ts']]);
const brain = a.parseBrain(await readFile(resolve(brainFile), 'utf8'));
const DEG = 180 / Math.PI, dt = 1 / a.BRAIN_PHYSICS_HZ, every = Math.round(a.BRAIN_PHYSICS_HZ / a.POLICY_HZ), flights = Number(flightsArg);

function fly(world, sample) {
  const racer = new a.BrainRacer(brain, { ground: world.ground, groundHeightAt: world.ground.groundHeightAt, track: world.track, colliders: world.colliders },
    { seed: 1, wind: { meanSpeed: 0, turbulence: 0, gustsPerMinute: 0 }, sample: sample === undefined ? undefined : new a.Rng(sample) });
  racer.go = true;
  let laps = 0, n = 0, stick = 0, rate2 = 0, jerk = 0;
  const prevA = [...racer.pilot.lastAction], prevW = [...racer.physics.state.angVel];
  for (let i = 0; i < 160 * a.BRAIN_PHYSICS_HZ && !racer.finished; i++) {
    const ev = racer.step(dt);
    if (ev === 'lap' || ev === 'finish') laps++;
    if (i % every !== every - 1) continue;
    const act = racer.pilot.lastAction, w = racer.physics.state.angVel;
    for (let k = 0; k < act.length; k++) { stick += Math.abs(act[k] - prevA[k]); prevA[k] = act[k]; }
    rate2 += (w[0] ** 2 + w[1] ** 2 + w[2] ** 2) * DEG * DEG;
    jerk += Math.hypot(w[0] - prevW[0], w[1] - prevW[1], w[2] - prevW[2]) * DEG; prevW[0] = w[0]; prevW[1] = w[1]; prevW[2] = w[2];
    n++;
  }
  const clean = racer.crashes === 0 && racer.stalls === 0 && laps >= 2;
  return { clean, finish: racer.finishedAt, stick: stick / n, rate: Math.sqrt(rate2 / n), jerk: jerk / n };
}

const all = [];
let reliable = 0;
for (const file of list.split(',')) {
  const tf = a.parseTrackFile(await readFile(resolve(file), 'utf8'));
  const world = a.buildTrainWorld({ seed: tf.terrainSeed ?? tf.track.seed, quality: tf.quality ?? 'low', track: tf.track });
  const runs = Array.from({ length: flights }, (_, k) => fly(world, k === 0 ? undefined : k)), clean = runs.filter(r => r.clean);
  if (clean.length >= 0.75 * flights) reliable++;
  all.push(...clean);
  const avg = key => clean.reduce((s, r) => s + r[key], 0) / Math.max(1, clean.length);
  console.log(`${basename(file, '.json').padEnd(16)} clean ${String(clean.length).padStart(2)}/${flights}` +
    (clean.length ? `  time ${avg('finish').toFixed(1)} s  stick ${avg('stick').toFixed(3)}  rate ${avg('rate').toFixed(0)}  jerk ${avg('jerk').toFixed(1)}` : ''));
}
const avg = key => all.reduce((s, r) => s + r[key], 0) / Math.max(1, all.length);
console.log(`${basename(brainFile, '.json')}: ${all.length} clean flights, ${reliable} tracks reliable; stick ${avg('stick').toFixed(3)}  rate ${avg('rate').toFixed(0)} deg/s  jerk ${avg('jerk').toFixed(1)} deg/s  time ${avg('finish').toFixed(1)} s`);
