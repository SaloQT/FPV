/**
 * Flies the same scripted flights through the GPU flight model and the game's QuadPhysics side by side and measures how far
 * the two drift apart. The GPU runs in float32 and the TypeScript model in float64, so the states agree closely at first and
 * separate slowly (fast flips and hard impacts amplify rounding most).
 */
import type { StickInput, Vec3 } from '../../contracts';
import { DEFAULT_RATES } from '../../sim/fc/rates';
import { QUAD_5IN_6S, type QuadConfig } from '../../sim/presets';
import { QuadPhysics } from '../../sim/quad';
import { BRAIN_PHYSICS_HZ } from '../spec';
import { WORLD_GROUP, bindGroup, compileModule, dispatch, pipeline, readBuffer, storageBuffer, type BindKind } from '../gpu/gpu';
import { QUAD_LAYOUT } from '../gpu/quadState';
import { quadConstsWgsl, worldConstsWgsl } from '../gpu/quadConsts';
import { layoutWgsl } from '../gpu/stateLayout';
import worldWgsl from '../gpu/world.wgsl?raw';
import quadWgsl from '../gpu/quad.wgsl?raw';
import parityWgsl from '../gpu/parity.wgsl?raw';
import { packWorlds, type TrainWorld } from './worlds';
import { uploadWorlds } from './worldGpu';

export interface ParityFlight {
  name: string;
  world: number;
  pos: Vec3;
  yaw: number;
  /** Mean wind m/s, from-direction rad, turbulence, gusts per minute, gust factor. */
  wind: [number, number, number, number, number];
  altitude: number;
  tempC: number;
  seed: number;
  /** Sticks at time t (s); the harness holds them for each block. */
  sticks(t: number): { roll: number; pitch: number; yaw: number; throttle: number; armed: boolean };
}

export interface ParitySample {
  t: number;
  pos: number;
  vel: number;
  angle: number;
  rate: number;
  motor: number;
  armed: boolean;
  crashed: [boolean, boolean];
  gpuPos: Vec3;
  cpuPos: Vec3;
}

export interface ParityResult {
  name: string;
  samples: ParitySample[];
}

export function parityShader(envs: number, quad: QuadConfig = QUAD_5IN_6S): string {
  return [
    quadConstsWgsl(quad, 1 / BRAIN_PHYSICS_HZ, DEFAULT_RATES),
    worldConstsWgsl(),
    `const NENV : u32 = ${envs}u;`,
    layoutWgsl('Quad', QUAD_LAYOUT, 'S', 'NENV', 'q'),
    worldWgsl,
    quadWgsl,
    parityWgsl,
  ].join('\n\n');
}

const FLIGHT_WORDS = 20;

export async function runParity(device: GPUDevice, worlds: TrainWorld[], flights: ParityFlight[], seconds: number, blockSteps = 20): Promise<ParityResult[]> {
  const n = flights.length;
  const envs = Math.ceil(n / 64) * 64;
  const module = await compileModule(device, parityShader(envs), 'parity');
  const groups: BindKind[][] = [['rw', 'ro'], WORLD_GROUP];
  const init = await pipeline(device, module, 'parityInit', groups);
  const step = await pipeline(device, module, 'parityStep', groups);
  const state = storageBuffer(device, QUAD_LAYOUT.slots * envs * 4, 'parity-state');
  const fbuf = storageBuffer(device, FLIGHT_WORDS * 4 * envs, 'parity-flights');
  const world = uploadWorlds(device, packWorlds(worlds));
  const fdata = new ArrayBuffer(FLIGHT_WORDS * 4 * envs);
  const ff = new Float32Array(fdata), fu = new Uint32Array(fdata);
  const dt = 1 / BRAIN_PHYSICS_HZ;
  const cpu = flights.map((f) => {
    const w = worlds[f.world];
    const p = new QuadPhysics(QUAD_5IN_6S, w.ground, f.seed);
    p.setColliders(w.colliders);
    p.setWind({ meanSpeed: f.wind[0], fromDirection: f.wind[1], turbulence: f.wind[2], gustsPerMinute: f.wind[3], gustFactor: f.wind[4] });
    p.setAtmosphere(f.altitude, f.tempC);
    p.reset(f.pos, f.yaw);
    return p;
  });
  const write = (t: number): void => {
    flights.forEach((f, e) => {
      const o = e * FLIGHT_WORDS;
      const s = f.sticks(t);
      ff[o] = f.pos[0]; ff[o + 1] = f.pos[1]; ff[o + 2] = f.pos[2]; ff[o + 3] = f.yaw;
      ff[o + 4] = s.roll; ff[o + 5] = s.pitch; ff[o + 6] = s.yaw; ff[o + 7] = s.throttle;
      ff.set(f.wind.slice(0, 4), o + 8);
      ff[o + 12] = f.wind[4]; ff[o + 13] = f.altitude; ff[o + 14] = f.tempC; fu[o + 15] = f.seed >>> 0;
      fu[o + 16] = f.world; fu[o + 17] = s.armed ? 1 : 0; fu[o + 18] = blockSteps;
    });
    device.queue.writeBuffer(fbuf, 0, fdata);
  };
  const g0 = (p: GPUComputePipeline): GPUBindGroup => bindGroup(device, p, 0, [state, fbuf]);
  const g1 = (p: GPUComputePipeline): GPUBindGroup => bindGroup(device, p, 1, world.entries);
  const groupsInit = [g0(init), g1(init)], groupsStep = [g0(step), g1(step)];
  const run = (p: GPUComputePipeline, groups: GPUBindGroup[]): void => {
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    dispatch(pass, p, groups, envs / 64);
    pass.end();
    device.queue.submit([enc.finish()]);
  };
  write(0);
  run(init, groupsInit);
  const results: ParityResult[] = flights.map((f) => ({ name: f.name, samples: [] }));
  const stick: StickInput = { roll: 0, pitch: 0, yaw: 0, throttle: 0, armed: false, mode: 'acro', turtle: false };
  const blocks = Math.round(seconds / (blockSteps * dt));
  const L = QUAD_LAYOUT.offsets;
  for (let b = 0; b < blocks; b++) {
    const t = b * blockSteps * dt;
    write(t);
    run(step, groupsStep);
    flights.forEach((f, e) => {
      const s = f.sticks(t);
      Object.assign(stick, s);
      for (let k = 0; k < blockSteps; k++) cpu[e].step(dt, stick);
    });
    const raw = new Float32Array(await readBuffer(device, state));
    const u = new Uint32Array(raw.buffer);
    const at = (slot: number, e: number): number => raw[slot * envs + e];
    flights.forEach((_, e) => {
      const c = cpu[e].state;
      const v3 = (o: number): Vec3 => [at(o, e), at(o + 1, e), at(o + 2, e)];
      const gp = v3(L.pos), gv = v3(L.vel), gw = v3(L.angVel);
      const gq = [at(L.quat, e), at(L.quat + 1, e), at(L.quat + 2, e), at(L.quat + 3, e)];
      const dist = (a: ArrayLike<number>, bb: ArrayLike<number>): number => Math.hypot(a[0] - bb[0], a[1] - bb[1], a[2] - bb[2]);
      const dot = Math.abs(gq[0] * c.quat[0] + gq[1] * c.quat[1] + gq[2] * c.quat[2] + gq[3] * c.quat[3]);
      let motor = 0;
      for (let i = 0; i < 4; i++) motor = Math.max(motor, Math.abs(Math.abs(at(L.mOmega + i, e)) - c.motorOmega[i]));
      results[e].samples.push({
        t: t + blockSteps * dt,
        pos: dist(gp, c.pos), vel: dist(gv, c.vel), angle: 2 * Math.acos(Math.min(1, dot)), rate: dist(gw, c.angVel), motor,
        armed: (u[L.fcArmed * envs + e] !== 0) === c.armed,
        crashed: [u[L.crashed * envs + e] !== 0, c.crashed],
        gpuPos: gp, cpuPos: [c.pos[0], c.pos[1], c.pos[2]],
      });
    });
  }
  return results;
}
