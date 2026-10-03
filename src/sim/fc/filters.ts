import { TWO_PI, clamp } from '../math3d';

/** First-order low-pass (Betaflight PT1). */
export class Pt1 {
  y = 0;
  private k = 1;
  private cutoff = 0;
  private dt = 0;

  /** Coefficient is cached per (cutoff, dt) so repeated calls each step are free. */
  configure(cutoffHz: number, dt: number): void {
    if (cutoffHz === this.cutoff && dt === this.dt) return;
    this.cutoff = cutoffHz;
    this.dt = dt;
    if (cutoffHz <= 0) {
      this.k = 1;
      return;
    }
    const rc = 1 / (TWO_PI * cutoffHz);
    this.k = dt / (rc + dt);
  }

  apply(x: number): number {
    this.y += this.k * (x - this.y);
    return this.y;
  }

  reset(v = 0): void {
    this.y = v;
  }
}

/** Two cascaded PT1 with the cutoff corrected so the -3 dB point stays at the requested frequency (BF PT2). */
export class Pt2 {
  private readonly a = new Pt1();
  private readonly b = new Pt1();

  configure(cutoffHz: number, dt: number): void {
    const fc = cutoffHz > 0 ? cutoffHz * 1.554 : 0;
    this.a.configure(fc, dt);
    this.b.configure(fc, dt);
  }

  apply(x: number): number {
    return this.b.apply(this.a.apply(x));
  }

  reset(v = 0): void {
    this.a.reset(v);
    this.b.reset(v);
  }
}

/** Direct-form-II-transposed biquad with notch and low-pass designs (RBJ cookbook, as Betaflight). */
export class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private z1 = 0;
  private z2 = 0;

  setNotch(freqHz: number, q: number, dt: number): void {
    const omega = TWO_PI * freqHz * dt;
    const sn = Math.sin(omega);
    const cs = Math.cos(omega);
    const alpha = sn / (2 * q);
    const a0 = 1 / (1 + alpha);
    this.b0 = a0;
    this.b1 = -2 * cs * a0;
    this.b2 = a0;
    this.a1 = this.b1;
    this.a2 = (1 - alpha) * a0;
  }

  /** Reuse a filter design without copying either axis's independent delay state. */
  copyCoefficientsFrom(other: Biquad): void {
    this.b0 = other.b0;
    this.b1 = other.b1;
    this.b2 = other.b2;
    this.a1 = other.a1;
    this.a2 = other.a2;
  }

  setLowpass(freqHz: number, q: number, dt: number): void {
    const omega = TWO_PI * freqHz * dt;
    const sn = Math.sin(omega);
    const cs = Math.cos(omega);
    const alpha = sn / (2 * q);
    const a0 = 1 / (1 + alpha);
    this.b1 = (1 - cs) * a0;
    this.b0 = this.b1 * 0.5;
    this.b2 = this.b0;
    this.a1 = -2 * cs * a0;
    this.a2 = (1 - alpha) * a0;
  }

  apply(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }

  reset(): void {
    this.z1 = 0;
    this.z2 = 0;
  }
}

export interface RpmFilterConfig {
  enabled: boolean;
  harmonics: number;
  /** Notch quality factor (BF rpm_filter_q 500 -> 5.0). */
  q: number;
  /** Frequencies below this are not notched; the notch fades in up to 1.5x this value. */
  minHz: number;
  /** Per-harmonic blend (1 = full notch). */
  weights: number[];
}

const MAX_HARMONICS = 3;
const NOTCH_UPDATES_PER_STEP = 3;

/** Bank of biquad notches at each motor's rotation frequency and harmonics, applied to every gyro axis (Betaflight RPM filter). */
export class RpmFilterBank {
  private readonly notch: Biquad[];
  private readonly freq: Float64Array;
  private readonly weight: Float64Array;
  private readonly count: number;
  private cursor = 0;

  constructor(private readonly cfg: RpmFilterConfig, private readonly motors: number, private readonly axes: number) {
    const h = Math.min(cfg.harmonics, MAX_HARMONICS);
    this.count = motors * h;
    this.notch = [];
    for (let i = 0; i < this.count * axes; i++) this.notch.push(new Biquad());
    this.freq = new Float64Array(this.count);
    this.weight = new Float64Array(this.count);
  }

  reset(): void {
    for (const n of this.notch) n.reset();
    this.weight.fill(0);
  }

  /** Refresh a few notch centres per call from motor speeds (rad/s); every notch is updated within `count/3` steps. */
  update(dt: number, omega: ArrayLike<number>): void {
    if (!this.cfg.enabled) return;
    const h = this.count / this.motors;
    const nyquistLimit = 0.45 / dt;
    for (let u = 0; u < NOTCH_UPDATES_PER_STEP; u++) {
      const idx = this.cursor;
      this.cursor = (this.cursor + 1) % this.count;
      const motor = (idx / h) | 0;
      const harmonic = idx - motor * h + 1;
      const f = (Math.abs(omega[motor]) / TWO_PI) * harmonic;
      this.freq[idx] = f;
      const fade = clamp((f - this.cfg.minHz) / (0.5 * this.cfg.minHz), 0, 1);
      const w = f < nyquistLimit ? fade * (this.cfg.weights[harmonic - 1] ?? 1) : 0;
      const wasIdle = this.weight[idx] <= 0;
      this.weight[idx] = w;
      if (w > 0) {
        for (let a = 0; a < this.axes; a++) {
          const n = this.notch[idx * this.axes + a];
          if (wasIdle) n.reset();
          // All axes have the same design; keep the arithmetic and each axis's delay state unchanged.
          if (a === 0) n.setNotch(f, this.cfg.q, dt);
          else n.copyCoefficientsFrom(this.notch[idx * this.axes]);
        }
      }
    }
  }

  apply(axis: number, x: number): number {
    if (!this.cfg.enabled) return x;
    let y = x;
    for (let i = 0; i < this.count; i++) {
      const w = this.weight[i];
      if (w <= 0) continue;
      const n = this.notch[i * this.axes + axis].apply(y);
      y += w * (n - y);
    }
    return y;
  }
}
