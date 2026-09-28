import type { StickInput, TerrainData, TerrainSampler, Vec3 } from '../contracts';
import { DEFAULT_RATES, stickToRate, type RateProfile } from './fc/rates';
import { Battery } from './battery';
import { G0, Rng, quatRotate } from './math3d';
import { Motor } from './motor';
import { Propeller } from './propeller';
import { QuadPhysics } from './quad';
import { QUAD_5IN_6S, type QuadConfig } from './presets';

/** Shared helpers for the physics tests. */
export const DT = 1 / 4000;
export const RAD2DEG = 180 / Math.PI;
export type Axis = 'roll' | 'pitch' | 'yaw';

export function inp(o: Partial<StickInput> = {}): StickInput {
  return { roll: 0, pitch: 0, yaw: 0, throttle: 0, armed: true, mode: 'acro', turtle: false, ...o };
}

/** Flat terrain at height `h` with a constant up normal. */
export function flatTerrain(h = 0): TerrainSampler {
  const data = { seed: 0, resolution: 2, cellSize: 1e6, origin: [-1e6, -1e6], minHeight: h, maxHeight: h, waterLevel: -Infinity } as unknown as TerrainData;
  return {
    data,
    heightAt: () => h,
    normalAt: (_x, _z, out = [0, 1, 0]) => {
      out[0] = 0;
      out[1] = 1;
      out[2] = 0;
      return out;
    },
    slopeAt: () => 0,
    raycast: (o, d, maxDist) => {
      if (d[1] >= 0 || o[1] < h) return null;
      const t = (h - o[1]) / d[1];
      if (t > maxDist) return null;
      return { t, point: [o[0] + d[0] * t, h, o[2] + d[2] * t], normal: [0, 1, 0] };
    },
  };
}

/** Body +Y axis expressed in world coordinates, y component: 1 upright, -1 inverted. */
export function upDot(q: QuadPhysics): number {
  const o: Vec3 = [0, 0, 0];
  quatRotate(q.state.quat, 0, 1, 0, o);
  return o[1];
}

/** Stick deflection (0..1) that commands `rateDps` deg/s under the given rate profile. */
export function stickFor(rateDps: number, axis: Axis = 'roll', rates: RateProfile = DEFAULT_RATES): number {
  let lo = 0, hi = 1;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (stickToRate(rates.type, rates[axis], m) < rateDps) lo = m;
    else hi = m;
  }
  return lo;
}

/** Body rate about one FC axis (roll right, nose down, yaw right positive), deg/s. */
export function fcRate(q: QuadPhysics, axis: Axis): number {
  const w = q.state.angVel;
  return -(axis === 'roll' ? w[2] : axis === 'pitch' ? w[0] : w[1]) * RAD2DEG;
}

/** A quad in calm air, high above the ground, armed and hovering at the given stick throttle. */
export function airborneQuad(cfg: QuadConfig = QUAD_5IN_6S, throttle = 0.29, seed?: number): QuadPhysics {
  const q = new QuadPhysics(cfg, null, seed);
  q.setWind({ meanSpeed: 0, turbulence: 0, gustsPerMinute: 0 });
  q.reset([0, 300, 0], 0);
  for (let i = 0; i < 400; i++) q.step(DT, inp());
  for (let i = 0; i < 2000; i++) q.step(DT, inp({ throttle }));
  return q;
}

export function run(q: QuadPhysics, seconds: number, input: StickInput, dt = DT): void {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) q.step(dt, input);
}

export interface StepResult {
  /** Time to 90% of the target rate, ms (-1 if never reached). */
  t90: number;
  /** Peak overshoot, percent of the target. */
  overshoot: number;
  /** Mean rate over the last 100 ms, deg/s. */
  final: number;
  /** Largest deviation from the target over the last 100 ms, deg/s. */
  ripple: number;
}

/** Hover, then command a step to `target` deg/s (either sign) on one axis and record the response, measured along the target. */
export function rateStep(cfg: QuadConfig, axis: Axis, target: number, dt = DT, seconds = 0.4): StepResult {
  const q = airborneQuad(cfg);
  const sign = target < 0 ? -1 : 1;
  const mag = Math.abs(target);
  const stick = sign * stickFor(mag, axis, cfg.fc.rates);
  const n = Math.round(seconds / dt);
  const tail = Math.round(0.1 / dt);
  let t90 = -1, peak = 0, sum = 0, lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) {
    q.step(dt, inp({ throttle: 0.29, [axis]: stick }));
    const d = sign * fcRate(q, axis);
    if (t90 < 0 && d >= 0.9 * mag) t90 = (i + 1) * dt * 1000;
    if (d > peak) peak = d;
    if (i >= n - tail) {
      sum += d;
      lo = Math.min(lo, d);
      hi = Math.max(hi, d);
    }
  }
  return { t90, overshoot: ((peak - mag) / mag) * 100, final: sum / tail, ripple: Math.max(hi - mag, mag - lo) };
}

export interface BenchResult {
  /** Total thrust of the four props, N. */
  thrust: number;
  /** Battery current, A. */
  current: number;
  /** Bus voltage under load, V. */
  volts: number;
  /** Rotor speed, rad/s. */
  omega: number;
  /** Largest phase current of any motor, A. */
  phase: number;
  /** Electrical power drawn from the battery, W. */
  power: number;
}

/** Static bench: the four motors held in still air at a constant duty on a fresh pack, settled for `seconds`. */
export function benchStatic(cfg: QuadConfig, duty: number, seconds = 0.6, rho = 1.225): BenchResult {
  const rng = new Rng(1);
  const motors = [0, 1, 2, 3].map(() => new Motor(cfg.motor));
  const props = [0, 1, 2, 3].map(() => new Propeller(cfg.prop, rng));
  const bat = new Battery(cfg.battery);
  const n = Math.round(seconds / DT);
  let cur = 0, v = bat.emf();
  for (let s = 0; s < n; s++) {
    for (const m of motors) m.updateDuty(DT, duty);
    const emf = bat.emf(), rs = bat.seriesResistance();
    for (let it = 0; it < 40; it++) {
      cur = cfg.avionicsCurrent;
      for (const m of motors) cur += m.busCurrentAt(v);
      v = emf - rs * cur;
    }
    for (let i = 0; i < 4; i++) {
      props[i].evaluate(motors[i].omega, rho, 0, 1, DT);
      motors[i].advance(DT, v, props[i].torque, 0);
    }
    bat.step(DT, cur);
  }
  return {
    thrust: props.reduce((a, p) => a + p.thrust, 0),
    current: cur,
    volts: v,
    omega: motors[0].omega,
    phase: Math.max(...motors.map((m) => Math.abs(m.current))),
    power: v * cur,
  };
}

/** Stick throttle at which the static bench thrust equals the weight (bisection on duty, mapped through the idle offset). */
export function hoverStick(cfg: QuadConfig): number {
  const idle = cfg.fc.mixer.idle;
  let lo = idle, hi = 1;
  for (let i = 0; i < 30; i++) {
    const m = (lo + hi) / 2;
    if (benchStatic(cfg, m, 0.4).thrust < cfg.mass * G0) lo = m;
    else hi = m;
  }
  return (lo - idle) / (cfg.fc.mixer.motorLimit - idle);
}

/** Plane rising towards +X at `angleRad` (height = tan(angle) * x). */
export function slopeTerrain(angleRad: number): TerrainSampler {
  const s = Math.tan(angleRad);
  const n = Math.hypot(s, 1);
  const data = { seed: 0, resolution: 2, cellSize: 1e6, origin: [-1e6, -1e6], minHeight: -1e6, maxHeight: 1e6, waterLevel: -Infinity } as unknown as TerrainData;
  return {
    data,
    heightAt: (x) => s * x,
    normalAt: (_x, _z, out = [0, 1, 0]) => {
      out[0] = -s / n;
      out[1] = 1 / n;
      out[2] = 0;
      return out;
    },
    slopeAt: () => angleRad,
    raycast: (o, d, maxDist) => {
      const den = d[1] - s * d[0];
      const t = (s * o[0] - o[1]) / den;
      if (den >= 0 || o[1] < s * o[0] || t > maxDist) return null;
      return { t, point: [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t], normal: [-s / n, 1 / n, 0] };
    },
  };
}
