/**
 * Assembles the training environment shader (env.wgsl on top of the flight model and the world) for one training run: every
 * size and coefficient is a WGSL constant, so the compiler sees fixed loop counts and folds the configuration in.
 */
import type { QuadConfig } from '../../sim/presets';
import type { RateProfile } from '../../sim/fc/rates';
import {
  ACT_SIZE, AGL_MAX, AGL_SCALE, BRAIN_PHYSICS_HZ, CELL_VOLT_CENTRE, DIST_MAX, DIST_SCALE, MOTOR_SCALE, OBS_SIZE, PHYSICS_PER_ACTION,
  POLICY_HZ, RATE_SCALE, VEL_SCALE,
} from '../spec';
import { PATH_AHEAD, PATH_BACK, PATH_MAX_STEP } from '../train/pathProgress';
import { ENV_LAYOUT } from './envState';
import { QUAD_LAYOUT } from './quadState';
import { f32, quadConstsWgsl, worldConstsWgsl } from './quadConsts';
import { layoutWgsl } from './stateLayout';
import worldWgsl from './world.wgsl?raw';
import quadWgsl from './quad.wgsl?raw';
import envWgsl from './env.wgsl?raw';

/** How training episodes start, what they reward and when they end. */
export interface EnvConfig {
  /** Share of episodes that start on the pad (the rest start before a random gate). */
  padSpawnProb: number;
  /** Share of episodes in still air; the rest get a mean wind up to `windMax` m/s from any direction. */
  calmProb: number;
  windMax: number;
  /** Site altitude 0..altMax m, air temperature tempMin..tempMax C. */
  altMax: number;
  tempMin: number;
  tempMax: number;
  /**
   * Reward per metre of progress along the track's centreline (clamped to PATH_MAX_STEP per decision), or per metre closed on
   * the gate due next on a track without a path.
   */
  progressReward: number;
  /** Reward per gate cleared in order. */
  gateReward: number;
  /** Penalty for a crash (an impact over the crash speed) or leaving the world. */
  crashPenalty: number;
  /** Penalty when no gate was cleared for `stallSeconds`. */
  stallPenalty: number;
  stallSeconds: number;
  /** Per step: rate penalty times |body rate|^2 (rad/s), smoothness penalty times |action change|^2. */
  ratePenalty: number;
  smoothPenalty: number;
  /** Longest episode, seconds. */
  episodeSeconds: number;
  /** Height above the highest terrain that counts as leaving the world, m. */
  ceiling: number;
  /** Per-cell voltage that ends an episode. */
  batteryEmptyV: number;
}

export const DEFAULT_ENV: EnvConfig = {
  padSpawnProb: 0.2,
  calmProb: 0.3,
  windMax: 8,
  altMax: 1500,
  tempMin: 5,
  tempMax: 30,
  progressReward: 1,
  gateReward: 5,
  crashPenalty: 10,
  stallPenalty: 2,
  stallSeconds: 8,
  ratePenalty: 2e-4,
  smoothPenalty: 0.02,
  episodeSeconds: 60,
  ceiling: 120,
  batteryEmptyV: 3.0,
};

export interface EnvShaderOptions {
  envs: number;
  worlds: number;
  quad: QuadConfig;
  rates: RateProfile;
  env: EnvConfig;
  /**
   * Drones whose positions are recorded every step for the training dashboard (a multiple of 16, at most envs; 0 = none). Their
   * episodes always start on world e % worlds, so every world has drones to watch. With K > 0 the module has a trace buffer at
   * group 0 binding 7 (one vec4f per traced drone and step: x, y, z, packed word; see src/ai/train/trace.ts).
   */
  traceEnvs?: number;
}

/** WGSL for the trajectory trace: the binding and its writer when tracing, an empty writer otherwise. */
function traceWgsl(k: number): string {
  if (k <= 0) return 'fn traceWrite(e : u32, p : vec3f, bits : u32) {}';
  return [
    '@group(0) @binding(7) var<storage, read_write> trace : array<vec4f>;',
    'fn traceWrite(e : u32, p : vec3f, bits : u32) {',
    '  if (e < TRACE_K) { trace[e] = vec4f(p, bitcast<f32>(bits)); }',
    '}',
  ].join('\n');
}

/** Checks a trace size against the env count. */
export function checkTraceEnvs(k: number, envs: number): void {
  if (!Number.isInteger(k) || k < 0 || k % 16 || k > envs) throw new Error(`traceEnvs ${k} must be a multiple of 16 between 0 and the ${envs} envs`);
}

function envConstsWgsl(o: EnvShaderOptions): string {
  const c = o.env;
  const u = (name: string, v: number): string => `const ${name} : u32 = ${Math.round(v)}u;`;
  const f = (name: string, v: number): string => `const ${name} : f32 = ${f32(v)};`;
  return [
    u('NENV', o.envs), u('N_WORLDS', o.worlds), u('OBS_SIZE', OBS_SIZE), u('ACT_SIZE', ACT_SIZE),
    u('PHYSICS_PER_ACTION', PHYSICS_PER_ACTION),
    f('VEL_SCALE', VEL_SCALE), f('RATE_SCALE', RATE_SCALE), f('AGL_MAX', AGL_MAX), f('AGL_SCALE', AGL_SCALE), f('DIST_MAX', DIST_MAX),
    f('DIST_SCALE', DIST_SCALE), f('MOTOR_SCALE', MOTOR_SCALE), f('CELL_VOLT_CENTRE', CELL_VOLT_CENTRE),
    f('PAD_SPAWN_PROB', c.padSpawnProb), f('CALM_PROB', c.calmProb), f('WIND_MAX', c.windMax), f('ALT_MAX', c.altMax),
    f('TEMP_MIN', c.tempMin), f('TEMP_MAX', c.tempMax),
    f('PROGRESS_REWARD', c.progressReward), f('GATE_REWARD', c.gateReward), f('CRASH_PENALTY', c.crashPenalty),
    f('STALL_PENALTY', c.stallPenalty), u('STALL_STEPS', c.stallSeconds * POLICY_HZ), f('RATE_PENALTY', c.ratePenalty),
    f('SMOOTH_PENALTY', c.smoothPenalty), u('EPISODE_STEPS', c.episodeSeconds * POLICY_HZ), f('CEILING_M', c.ceiling),
    f('BATTERY_EMPTY_V', c.batteryEmptyV),
    u('PATH_BACK', PATH_BACK), u('PATH_AHEAD', PATH_AHEAD), f('PATH_MAX_STEP', PATH_MAX_STEP), u('TRACE_K', o.traceEnvs ?? 0),
  ].join('\n');
}

/** The full environment shader: entry points `initEnvs` and `stepEnvs`. */
export function envShader(o: EnvShaderOptions): string {
  checkTraceEnvs(o.traceEnvs ?? 0, o.envs);
  return [
    quadConstsWgsl(o.quad, 1 / BRAIN_PHYSICS_HZ, o.rates),
    worldConstsWgsl(),
    envConstsWgsl(o),
    layoutWgsl('Quad', QUAD_LAYOUT, 'S', 'NENV', 'q'),
    layoutWgsl('Env', ENV_LAYOUT, 'E', 'NENV', 'ev'),
    worldWgsl,
    quadWgsl,
    traceWgsl(o.traceEnvs ?? 0),
    envWgsl,
  ].join('\n\n');
}

/** Slot of an Env field in the environment buffer (`E[slot * NENV + e]`). */
export function envSlot(name: string): number {
  const o = ENV_LAYOUT.offsets[name];
  if (o === undefined) throw new Error(`no env field ${name}`);
  return o;
}
