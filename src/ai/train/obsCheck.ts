/**
 * Checks the GPU observation (env.wgsl writeObs) against the TypeScript `observe` the game uses: runs a few environment steps
 * with random actions, rebuilds each drone's QuadState from the GPU state and compares the two observation vectors slot by slot
 * (the obstacle slots value by value, counting the ones that differ). It also checks the path-progress state (env.wgsl pathSearch / pathArc) and the arc left to the gate due next (gateLeft, which
 * caps the progress reward) against pathProgress.ts.
 */
import type { QuadState } from '../../contracts';
import { Battery } from '../../sim/battery';
import { DEFAULT_RATES } from '../../sim/fc/rates';
import { Rng, quatToMat3 } from '../../sim/math3d';
import { QUAD_5IN_6S } from '../../sim/presets';
import { BrainPolicy, type Brain } from '../brain';
import { observe, obsGates } from '../observe';
import { NEAR_SIDES, OBS, OBS_SIZE, SENSE_RAYS } from '../spec';
import { sense, senseWorld } from '../sense';
import { DEFAULT_ENV, envShader, envSlot } from '../gpu/envKernel';
import { ENV_LAYOUT } from '../gpu/envState';
import { WORLD_GROUP, bindGroup, compileModule, dispatch, pipeline, readBuffer, storageBuffer, uniformBuffer, type BindKind } from '../gpu/gpu';
import { QUAD_LAYOUT } from '../gpu/quadState';
import { arcToGate, packPath, pathArc, pathDelta, pathSearch, type PackedPath } from './pathProgress';
import { packWorlds, type TrainWorld } from './worlds';
import { uploadWorlds } from './worldGpu';

/** The observation and path comparisons for one group of drones. */
export interface ObsGroupResult {
  /** Largest gap per observation slot. */
  worst: number[];
  compared: number;
  /** Largest gap between the GPU's and pathProgress.ts's arc length along the path, metres, and the drones compared. */
  pathWorst: number;
  pathCompared: number;
  /** How far from the path the drone with the worst gap was, metres. */
  pathWorstOff: number;
  /**
   * Drones whose arc length differs by more than 1 mm: off the line, two samples can be equally near within f32 rounding, and
   * the two neighbourhoods project a few cm apart.
   */
  pathOff1mm: number;
  /** The range-ray values (see SenseGaps). */
  rays: SenseGaps;
  /** The side entries (nearest collider per side), each four values compared as one. */
  near: SenseGaps;
}

/**
 * Obstacle-slot gaps. A ray that grazes a box edge or a ridge can hit on one side of f32 rounding only, so a few values differ
 * outright; `over1e3` counts them.
 */
export interface SenseGaps {
  compared: number;
  /** Values that saw something: a ray that hit within range, an entry with a collider. */
  seen: number;
  /** Rays whose first hit is a collider rather than the ground (TypeScript side); 0 for the side entries. */
  boxes: number;
  over1e4: number;
  over1e3: number;
  /** Largest gap among the values within 1e-3. */
  worst: number;
}

/**
 * The random-stick drones in the result itself; `piloted` holds the drones a brain flew (racing through gates within
 * centimetres of a gate centre and far off the line, where f32 rounding in the gate direction and near-ties between path
 * samples grow).
 */
export interface ObsCheckResult extends ObsGroupResult {
  piloted: ObsGroupResult | null;
  /**
   * Largest gap between the GPU's arc left to the gate due next and pathProgress.ts's, metres, each worked from the GPU's own
   * arc lengths, and the drones compared: carried on within a gate, measured from the gate passed, measured at a spawn.
   */
  gateLeftWorst: number;
  gateLeftCompared: { carried: number; passed: number; spawned: number };
}

/**
 * `pilot`: a brain that flies every fourth drone on the TypeScript observation (its mean action), so drones clear gates and the
 * arc left to the next gate is checked after a pass too; without one those drones tip forward and climb.
 */
export async function runObsCheck(device: GPUDevice, worlds: TrainWorld[], steps = 90, pilot?: Brain): Promise<ObsCheckResult> {
  const N = 128;
  const code = envShader({ envs: N, worlds: worlds.length, quad: QUAD_5IN_6S, rates: DEFAULT_RATES, env: DEFAULT_ENV });
  const module = await compileModule(device, code, 'obs-check');
  const kinds: BindKind[][] = [['rw', 'rw', 'ro', 'rw', 'rw', 'rw', 'uniform'], WORLD_GROUP];
  const init = await pipeline(device, module, 'initEnvs', kinds);
  const step = await pipeline(device, module, 'stepEnvs', kinds);
  const S = storageBuffer(device, QUAD_LAYOUT.slots * N * 4, 'S');
  const E = storageBuffer(device, ENV_LAYOUT.slots * N * 4, 'E');
  const actions = storageBuffer(device, N * 16, 'actions');
  const obs = storageBuffer(device, N * OBS_SIZE * 4, 'obs');
  const rew = storageBuffer(device, N * 4, 'rew');
  const done = storageBuffer(device, N * 4, 'done');
  const U = uniformBuffer(device, 16, 'u');
  device.queue.writeBuffer(U, 0, new Uint32Array([99, 0, 0, 0]));
  const world = uploadWorlds(device, packWorlds(worlds));
  const groups = (p: GPUComputePipeline): GPUBindGroup[] => [bindGroup(device, p, 0, [S, E, actions, obs, rew, done, U]), bindGroup(device, p, 1, world.entries)];
  const gi = groups(init), gs = groups(step);
  const run = (p: GPUComputePipeline, g: GPUBindGroup[]): void => {
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    dispatch(pass, p, g, N / 64);
    pass.end();
    device.queue.submit([enc.finish()]);
  };
  run(init, gi);
  const rng = new Rng(5);
  const gaps = (): SenseGaps => ({ compared: 0, seen: 0, boxes: 0, over1e4: 0, over1e3: 0, worst: 0 });
  const group = (): ObsGroupResult => ({
    worst: new Array(OBS_SIZE).fill(0), compared: 0, pathWorst: 0, pathCompared: 0, pathWorstOff: 0, pathOff1mm: 0, rays: gaps(), near: gaps(),
  });
  const gentle = group(), piloted = group();
  const gates = worlds.map((w) => obsGates(w.track.gates));
  const senses = worlds.map((w) => senseWorld(w.colliders, w.ground.groundHeightAt));
  // The rays against the ground alone, to tell which rays met a collider first
  const grounds = worlds.map((w) => senseWorld([], w.ground.groundHeightAt));
  const bare = new Float64Array(OBS_SIZE);
  const rot = new Float64Array(9);
  const tally = (t: SenseGaps, gap: number): void => {
    t.compared++;
    if (gap > 1e-4) t.over1e4++;
    if (gap > 1e-3) t.over1e3++;
    else t.worst = Math.max(t.worst, gap);
  };
  const L = QUAD_LAYOUT.offsets;
  const out = new Float64Array(OBS_SIZE);
  const policy = pilot ? new BrainPolicy(pilot) : null;
  const flown = new Float32Array(N * 4).fill(0);
  for (let i = 0; i < N; i++) flown[i * 4 + 3] = -1;
  const act = new Float64Array(4);
  const paths: PackedPath[] = worlds.map((w) => packPath(w.track));
  const prevIdx = new Int32Array(N).fill(-1);
  const prevEpisode = new Uint32Array(N);
  const prevNext = new Uint32Array(N), prevS = new Float64Array(N), prevLeft = new Float64Array(N);
  let gateLeftWorst = 0;
  const gateLeftCompared = { carried: 0, passed: 0, spawned: 0 };
  for (let k = 0; k < steps; k++) {
    // Mostly gentle actions with throttle near hover, so drones fly for a while before crashing
    const a = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) a.set([0.2 * rng.gauss(), 0.2 * rng.gauss(), 0.2 * rng.gauss(), -0.3 + 0.2 * rng.gauss()], i * 4);
    for (let i = 1; i < N; i += 4) a.set(pilot ? flown.subarray(i * 4, i * 4 + 4) : [0, k < 8 ? 0.4 : 0, 0, -0.35 + 0.1 * (i % 3)], i * 4);
    device.queue.writeBuffer(actions, 0, a);
    if (k > 0) run(step, gs);
    const s = new Float32Array(await readBuffer(device, S));
    const su = new Uint32Array(s.buffer);
    const e = new Float32Array(await readBuffer(device, E));
    const eu = new Uint32Array(e.buffer);
    const o = new Float32Array(await readBuffer(device, obs));
    for (let i = 0; i < N; i++) {
      const at = (slot: number): number => s[slot * N + i];
      const w = worlds[eu[envSlot('world') * N + i]];
      const bat = new Battery(QUAD_5IN_6S.battery);
      bat.mah = at(L.batMah);
      bat.current = at(L.batCurrent);
      bat.tempC = at(L.batTemp);
      (bat as unknown as { vPolar: number }).vPolar = at(L.batPolar);
      const state = {
        pos: [at(L.pos), at(L.pos + 1), at(L.pos + 2)],
        vel: [at(L.vel), at(L.vel + 1), at(L.vel + 2)],
        quat: [at(L.quat), at(L.quat + 1), at(L.quat + 2), at(L.quat + 3)],
        angVel: [at(L.angVel), at(L.angVel + 1), at(L.angVel + 2)],
        motorOmega: [0, 1, 2, 3].map((m) => Math.abs(at(L.mOmega + m))),
        batteryVoltage: bat.voltage(),
      } as unknown as QuadState;
      void su;
      const prev = [0, 1, 2, 3].map((m) => e[(envSlot('prevAct') + m) * N + i]);
      const wi = eu[envSlot('world') * N + i];
      observe(state, {
        gates: gates[wi], closed: w.track.closed, next: eu[envSlot('next') * N + i],
        groundY: w.ground.heightAt(state.pos[0], state.pos[2]), prevAction: prev, cells: QUAD_5IN_6S.battery.cells, sense: senses[wi],
      }, out);
      const flies = policy !== null && i % 4 === 1, g = flies ? piloted : gentle;
      for (let j = 0; j < OBS_SIZE; j++) g.worst[j] = Math.max(g.worst[j], Math.abs(out[j] - o[i * OBS_SIZE + j]));
      g.compared++;
      quatToMat3(state.quat, rot);
      sense(grounds[wi], state.pos, rot, bare);
      for (let k = 0; k < SENSE_RAYS; k++) {
        const j = OBS.rays + k;
        tally(g.rays, Math.abs(out[j] - o[i * OBS_SIZE + j]));
        if (out[j] > 0) g.rays.seen++;
        if (out[j] > bare[j] + 1e-9) g.rays.boxes++;
      }
      for (let m = 0; m < NEAR_SIDES; m++) {
        const at = i * OBS_SIZE + OBS.near + m * 4, t = OBS.near + m * 4;
        const gap = Math.max(Math.abs(out[t] - o[at]), Math.abs(out[t + 1] - o[at + 1]), Math.abs(out[t + 2] - o[at + 2]), Math.abs(out[t + 3] - o[at + 3]));
        tally(g.near, gap);
        if (o[at + 3] > 0) g.near.seen++;
      }
      // The pilot decides on what the trainer's policy sees: the GPU observation
      if (flies) flown.set(policy.act(o.subarray(i * OBS_SIZE, (i + 1) * OBS_SIZE), act), i * 4);
      // Path state: a drone still in its episode searched from its last sample; a new episode searched from its spawn's sample
      // (the checkpoint gate it faces, the one before the gate due next, or the pad's), so that is checked against both.
      const P = paths[eu[envSlot('world') * N + i]];
      const idx = eu[envSlot('pathIdx') * N + i], ep = eu[envSlot('episode') * N + i];
      if (P.count > 0) {
        const pos = state.pos;
        const ng = P.gateSample.length, checkpoint = (eu[envSlot('next') * N + i] + ng - 1) % Math.max(ng, 1);
        const froms = ep === prevEpisode[i] && prevIdx[i] >= 0 ? [prevIdx[i]] : [P.startSample, P.gateSample[checkpoint] ?? 0];
        const gap = Math.min(...froms.map((f) => Math.abs(pathArc(P, pathSearch(P, f, pos), pos) - e[envSlot('pathS') * N + i])));
        if (gap > 1e-3) g.pathOff1mm++;
        if (gap > g.pathWorst) {
          g.pathWorst = gap;
          const j = pathSearch(P, froms[0], pos);
          g.pathWorstOff = Math.hypot(pos[0] - P.points[j * 4], pos[1] - P.points[j * 4 + 1], pos[2] - P.points[j * 4 + 2]);
        }
        g.pathCompared++;
        const next = eu[envSlot('next') * N + i], sNow = e[envSlot('pathS') * N + i], left = e[envSlot('gateLeft') * N + i];
        const fresh = !(ep === prevEpisode[i] && prevIdx[i] >= 0);
        // A one-gate circuit's pass leaves the same gate due next, which this cannot tell from carrying on
        if (w.track.gates.length > 1 || (fresh && w.track.gates.length > 0)) {
          const want = fresh ? arcToGate(P, next, sNow)
            : next === prevNext[i] ? prevLeft[i] - pathDelta(P, prevS[i], sNow)
            : arcToGate(P, next, sNow, prevNext[i]);
          gateLeftWorst = Math.max(gateLeftWorst, Math.abs(want - left));
          gateLeftCompared[fresh ? 'spawned' : next === prevNext[i] ? 'carried' : 'passed']++;
        }
        prevNext[i] = next;
        prevS[i] = sNow;
        prevLeft[i] = left;
      }
      prevIdx[i] = idx;
      prevEpisode[i] = ep;
    }
  }
  return { ...gentle, piloted: policy ? piloted : null, gateLeftWorst, gateLeftCompared };
}
