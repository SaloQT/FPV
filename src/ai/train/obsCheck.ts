/**
 * Checks the GPU observation (env.wgsl writeObs) against the TypeScript `observe` the game uses: runs a few environment steps
 * with random actions, rebuilds each drone's QuadState from the GPU state and compares the two observation vectors slot by slot.
 * It also checks the path-progress state (env.wgsl pathSearch / pathArc) against pathProgress.ts.
 */
import type { QuadState } from '../../contracts';
import { Battery } from '../../sim/battery';
import { DEFAULT_RATES } from '../../sim/fc/rates';
import { Rng } from '../../sim/math3d';
import { QUAD_5IN_6S } from '../../sim/presets';
import { observe, obsGates } from '../observe';
import { OBS_SIZE } from '../spec';
import { DEFAULT_ENV, envShader, envSlot } from '../gpu/envKernel';
import { ENV_LAYOUT } from '../gpu/envState';
import { WORLD_GROUP, bindGroup, compileModule, dispatch, pipeline, readBuffer, storageBuffer, uniformBuffer, type BindKind } from '../gpu/gpu';
import { QUAD_LAYOUT } from '../gpu/quadState';
import { packPath, pathArc, pathSearch, type PackedPath } from './pathProgress';
import { packWorlds, type TrainWorld } from './worlds';
import { uploadWorlds } from './worldGpu';

export interface ObsCheckResult {
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
}

export async function runObsCheck(device: GPUDevice, worlds: TrainWorld[], steps = 30): Promise<ObsCheckResult> {
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
  const worst = new Array(OBS_SIZE).fill(0);
  const gates = worlds.map((w) => obsGates(w.track.gates));
  const L = QUAD_LAYOUT.offsets;
  let compared = 0;
  const out = new Float64Array(OBS_SIZE);
  const paths: PackedPath[] = worlds.map((w) => packPath(w.track));
  const prevIdx = new Int32Array(N).fill(-1);
  const prevEpisode = new Uint32Array(N);
  let pathWorst = 0, pathCompared = 0, pathWorstOff = 0, pathOff1mm = 0;
  for (let k = 0; k < steps; k++) {
    // Mostly gentle actions with throttle near hover, so drones fly for a while before crashing
    const a = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) a.set([0.2 * rng.gauss(), 0.2 * rng.gauss(), 0.2 * rng.gauss(), -0.3 + 0.2 * rng.gauss()], i * 4);
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
      observe(state, {
        gates: gates[eu[envSlot('world') * N + i]], closed: w.track.closed, next: eu[envSlot('next') * N + i],
        groundY: w.ground.heightAt(state.pos[0], state.pos[2]), prevAction: prev, cells: QUAD_5IN_6S.battery.cells,
      }, out);
      for (let j = 0; j < OBS_SIZE; j++) worst[j] = Math.max(worst[j], Math.abs(out[j] - o[i * OBS_SIZE + j]));
      compared++;
      // Path state: a drone still in its episode searched from its last sample; a new episode searched from its spawn's sample
      // (the gate it faces, or the pad's), so that is checked against both.
      const P = paths[eu[envSlot('world') * N + i]];
      const idx = eu[envSlot('pathIdx') * N + i], ep = eu[envSlot('episode') * N + i];
      if (P.count > 0) {
        const pos = state.pos;
        const froms = ep === prevEpisode[i] && prevIdx[i] >= 0 ? [prevIdx[i]] : [P.startSample, P.gateSample[eu[envSlot('next') * N + i]] ?? 0];
        const gap = Math.min(...froms.map((f) => Math.abs(pathArc(P, pathSearch(P, f, pos), pos) - e[envSlot('pathS') * N + i])));
        if (gap > 1e-3) pathOff1mm++;
        if (gap > pathWorst) {
          pathWorst = gap;
          const j = pathSearch(P, froms[0], pos);
          pathWorstOff = Math.hypot(pos[0] - P.points[j * 4], pos[1] - P.points[j * 4 + 1], pos[2] - P.points[j * 4 + 2]);
        }
        pathCompared++;
      }
      prevIdx[i] = idx;
      prevEpisode[i] = ep;
    }
  }
  return { worst, compared, pathWorst, pathCompared, pathWorstOff, pathOff1mm };
}
