import { clamp } from '../math3d';
import { Pt1 } from './filters';
import { applyThrustLinearization, compensateThrustLinearization } from './pid';

/**
 * Quad-X mix coefficients per motor (0 FR, 1 RR, 2 RL, 3 FL) for the FC axes (positive = roll right, nose down, yaw right).
 * Roll right needs the right motors slower, nose down the front motors slower, yaw right the CCW props (FL, RR) faster.
 */
export const MIX_ROLL = [-1, -1, 1, 1] as const;
export const MIX_PITCH = [-1, 1, 1, -1] as const;
export const MIX_YAW = [-1, 1, -1, 1] as const;

export interface MixerConfig {
  /** Motor idle as a fraction of full duty (dshot_idle_value 5.5%). */
  idle: number;
  airmode: boolean;
  /** Maximum duty, 0..1. */
  motorLimit: number;
  /** Betaflight throttle curve: pivot `throttleMid`, expo 0..1. */
  throttleMid: number;
  throttleExpo: number;
  /** Betaflight `throttle_boost` (0..10): adds a high-passed throttle term to the throttle. */
  throttleBoost: number;
  /** Betaflight `thrust_linear` (0..1.5). */
  thrustLinear: number;
  /** Stick deflection below which turtle mode leaves the motors stopped. */
  turtleDeadband: number;
  /** Fraction of full duty used for the reversed motors in turtle mode. */
  turtlePower: number;
}

export const DEFAULT_MIXER: MixerConfig = {
  idle: 0.055,
  airmode: true,
  motorLimit: 1,
  throttleMid: 0.5,
  throttleExpo: 0,
  throttleBoost: 5,
  thrustLinear: 0,
  turtleDeadband: 0.05,
  turtlePower: 0.45,
};

/** Betaflight throttle curve; identity when expo is 0. */
export function throttleCurve(t: number, mid: number, expo: number): number {
  const x = clamp(t, 0, 1);
  const tmp = x - mid;
  const y = tmp > 0 ? 1 - mid : mid;
  if (y <= 0) return x;
  return mid + tmp * (1 - expo + (expo * tmp * tmp) / (y * y));
}

/** Motor mixer with airmode desaturation, idle, throttle boost, thrust linearisation and turtle (crash-flip) mixing. */
export class Mixer {
  /** Signed duty per motor, -1..1 (negative = reversed spin). */
  readonly out = new Float64Array(4);
  private readonly mix = new Float64Array(4);
  private readonly boostLpf = new Pt1();
  private boostPrimed = false;

  constructor(readonly cfg: MixerConfig) {}

  reset(): void {
    this.out.fill(0);
    this.boostPrimed = false;
  }

  /** `pid` is the PID sum (1000 = full range) for roll, pitch, yaw; `throttle` is the stick throttle 0..1. */
  run(dt: number, pid: ArrayLike<number>, throttle: number, airmodeActive: boolean): void {
    const c = this.cfg;
    let thr = throttleCurve(throttle, c.throttleMid, c.throttleExpo);
    if (!this.boostPrimed) {
      this.boostLpf.reset(thr);
      this.boostPrimed = true;
    }
    if (c.throttleBoost > 0) {
      this.boostLpf.configure(10, dt);
      thr = clamp(thr + c.throttleBoost * 0.1 * (thr - this.boostLpf.apply(thr)), 0, 1);
    }
    thr = compensateThrustLinearization(thr, c.thrustLinear);
    const r = pid[0] * 0.001, p = pid[1] * 0.001, y = pid[2] * 0.001;
    let mMin = Infinity;
    let mMax = -Infinity;
    for (let i = 0; i < 4; i++) {
      const m = r * MIX_ROLL[i] + p * MIX_PITCH[i] + y * MIX_YAW[i];
      this.mix[i] = m;
      if (m < mMin) mMin = m;
      if (m > mMax) mMax = m;
    }
    const range = mMax - mMin;
    let scale = 1;
    if (range > 1) {
      scale = 1 / range;
      thr = -mMin * scale;
    } else if (c.airmode && airmodeActive) {
      thr = clamp(thr, -mMin, 1 - mMax);
    }
    const span = c.motorLimit - c.idle;
    for (let i = 0; i < 4; i++) {
      const u = clamp(thr + this.mix[i] * scale, 0, 1);
      this.out[i] = c.idle + span * applyThrustLinearization(u, c.thrustLinear);
    }
  }

  /** Crash-flip: reverse the motors selected by the stick vector; everything else stays stopped. */
  turtle(roll: number, pitch: number, yaw: number): void {
    const c = this.cfg;
    const mag = Math.max(Math.abs(roll), Math.abs(pitch), Math.abs(yaw));
    if (mag < c.turtleDeadband) {
      this.out.fill(0);
      return;
    }
    for (let i = 0; i < 4; i++) {
      const v = MIX_ROLL[i] * roll + MIX_PITCH[i] * pitch + MIX_YAW[i] * yaw;
      this.out[i] = -clamp(v, 0, 1) * c.turtlePower;
    }
  }
}
