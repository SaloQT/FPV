import { Pt1 } from './filters';

/** Betaflight internal scale constants: user-facing P/I/D numbers are multiplied by these. */
export const PTERM_SCALE = 0.032029;
export const ITERM_SCALE = 0.244381;
export const DTERM_SCALE = 0.000529;
/** Feed-forward unit: PID-sum units (1000 = full motor range) per F point per deg/s^2 of smoothed setpoint acceleration. */
export const FEEDFORWARD_SCALE = 9e-5;

export interface AxisGains {
  p: number;
  i: number;
  d: number;
  f: number;
}

export interface PidConfig {
  roll: AxisGains;
  pitch: AxisGains;
  yaw: AxisGains;
  dtermLpf1Hz: number;
  dtermLpf2Hz: number;
  /** Cut-off of the setpoint smoothing whose derivative feeds the FF term. */
  ffSmoothHz: number;
  /** I-term clamp, PID units (1000 = full motor range). */
  itermLimit: number;
  itermRelaxCutoffHz: number;
  /** Setpoint high-pass (deg/s) at which the I-term is fully frozen. */
  itermRelaxThreshold: number;
  /** I accumulation multiplier per unit of high-passed throttle (0 disables). */
  antiGravityGain: number;
  antiGravityHz: number;
  /** Throttle PID attenuation applied to P and D above the breakpoint. */
  tpaRate: number;
  tpaBreakpoint: number;
  pidSumLimit: number;
  pidSumLimitYaw: number;
}

export const DEFAULT_PID: PidConfig = {
  roll: { p: 67, i: 100, d: 57, f: 60 },
  pitch: { p: 70, i: 105, d: 60, f: 63 },
  yaw: { p: 36, i: 80, d: 0, f: 30 },
  dtermLpf1Hz: 150,
  dtermLpf2Hz: 150,
  ffSmoothHz: 50,
  itermLimit: 400,
  itermRelaxCutoffHz: 15,
  itermRelaxThreshold: 40,
  antiGravityGain: 4,
  antiGravityHz: 15,
  tpaRate: 0.65,
  tpaBreakpoint: 0.35,
  pidSumLimit: 500,
  pidSumLimitYaw: 400,
};

/** Betaflight `thrust_linear`: throttle pre-compensation (paired with `applyThrustLinearization` on each motor output). */
export function compensateThrustLinearization(throttle: number, k: number): number {
  if (k === 0) return throttle;
  // Betaflight's compensate amount (k - k^2/2) keeps the map positive and monotonic over the whole 0..1.5 range
  const amount = k - 0.5 * k * k;
  return throttle * (throttle * amount + 1 - amount);
}

export function applyThrustLinearization(output: number, k: number): number {
  if (k === 0 || output <= 0) return output;
  const r = 1 - output;
  return output * (1 + k * r * r);
}

/** 3-axis rate PID (roll, pitch, yaw) with D on measurement, I-term relax, anti-gravity, TPA and feed-forward. */
export class PidController {
  /** Per-axis PID sums in units where 1000 = full motor range. */
  readonly sum = new Float64Array(3);
  readonly pTerm = new Float64Array(3);
  readonly iTerm = new Float64Array(3);
  readonly dTerm = new Float64Array(3);
  readonly fTerm = new Float64Array(3);
  private readonly gains: AxisGains[];
  private readonly d1 = [new Pt1(), new Pt1(), new Pt1()];
  private readonly d2 = [new Pt1(), new Pt1(), new Pt1()];
  private readonly ffLpf = [new Pt1(), new Pt1(), new Pt1()];
  private readonly relaxLpf = [new Pt1(), new Pt1(), new Pt1()];
  private readonly agLpf = new Pt1();
  private readonly prevGyro = new Float64Array(3);
  private primed = false;

  constructor(readonly cfg: PidConfig) {
    this.gains = [cfg.roll, cfg.pitch, cfg.yaw];
  }

  reset(): void {
    this.sum.fill(0);
    this.pTerm.fill(0);
    this.iTerm.fill(0);
    this.dTerm.fill(0);
    this.fTerm.fill(0);
    this.prevGyro.fill(0);
    this.primed = false;
    this.agLpf.reset();
  }

  resetIterm(): void {
    this.iTerm.fill(0);
  }

  /**
   * `setpoint` and `gyro` in deg/s (FC axes), `throttle` 0..1. `integrate` false holds the I-term at zero (on the ground before
   * the pilot has committed to fly).
   */
  update(dt: number, setpoint: ArrayLike<number>, gyro: ArrayLike<number>, throttle: number, integrate: boolean): void {
    const c = this.cfg;
    if (!this.primed) {
      for (let a = 0; a < 3; a++) {
        this.ffLpf[a].reset(setpoint[a]);
        this.relaxLpf[a].reset(setpoint[a]);
        this.d1[a].reset(gyro[a]);
        this.d2[a].reset(gyro[a]);
        this.prevGyro[a] = gyro[a];
      }
      this.agLpf.reset(throttle);
      this.primed = true;
    }
    this.agLpf.configure(c.antiGravityHz, dt);
    const agHpf = throttle - this.agLpf.apply(throttle);
    const agBoost = 1 + c.antiGravityGain * Math.abs(agHpf);
    const tpa = throttle > c.tpaBreakpoint ? 1 - (c.tpaRate * (throttle - c.tpaBreakpoint)) / (1 - c.tpaBreakpoint) : 1;
    for (let a = 0; a < 3; a++) {
      const g = this.gains[a];
      const sp = setpoint[a];
      const err = sp - gyro[a];

      this.relaxLpf[a].configure(c.itermRelaxCutoffHz, dt);
      const hpf = Math.abs(sp - this.relaxLpf[a].apply(sp));
      const relax = a === 2 ? 1 : Math.max(0, 1 - hpf / c.itermRelaxThreshold);

      this.d1[a].configure(c.dtermLpf1Hz, dt);
      this.d2[a].configure(c.dtermLpf2Hz, dt);
      const gd = this.d2[a].apply(this.d1[a].apply(gyro[a]));
      const dRate = -(gd - this.prevGyro[a]) / dt;
      this.prevGyro[a] = gd;

      this.ffLpf[a].configure(c.ffSmoothHz, dt);
      const before = this.ffLpf[a].y;
      const ffRate = (this.ffLpf[a].apply(sp) - before) / dt;

      const limit = a === 2 ? c.pidSumLimitYaw : c.pidSumLimit;
      const p = g.p * PTERM_SCALE * err * tpa;
      const d = g.d * DTERM_SCALE * dRate * tpa;
      const f = g.f * FEEDFORWARD_SCALE * ffRate;
      let i = this.iTerm[a];
      if (integrate) {
        const next = i + g.i * ITERM_SCALE * dt * err * relax * agBoost;
        const room = limit - Math.abs(p + d + f);
        const clampI = Math.min(c.itermLimit, Math.max(room, 0));
        i = next > clampI ? Math.max(i, clampI) : next < -clampI ? Math.min(i, -clampI) : next;
      } else {
        i = 0;
      }
      this.iTerm[a] = i;
      this.pTerm[a] = p;
      this.dTerm[a] = d;
      this.fTerm[a] = f;
      const s = p + i + d + f;
      this.sum[a] = s > limit ? limit : s < -limit ? -limit : s;
    }
  }
}
