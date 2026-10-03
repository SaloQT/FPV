import { describe, expect, it, vi } from 'vitest';
import { Biquad, RpmFilterBank, type RpmFilterConfig } from './filters';
import { TWO_PI, clamp } from '../math3d';

// Frozen pre-optimization update/apply algorithm: every axis designs its own notch.
const MAX_HARMONICS = 3;
const NOTCH_UPDATES_PER_STEP = 3;
class ReferenceRpmFilterBank {
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
          n.setNotch(f, this.cfg.q, dt);
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

const config = (): RpmFilterConfig => ({ enabled: true, harmonics: 3, q: 5, minHz: 100, weights: [1, 0.5, 0.25] });

describe('shared RPM notch coefficients', () => {
  it('matches the original bank exactly through changing RPM, weights, dt, disable and reset', () => {
    for (const axes of [1, 3, 4]) {
      const cfg = config();
      const bank = new RpmFilterBank(cfg, 4, axes);
      const old = new ReferenceRpmFilterBank(cfg, 4, axes);
      const omega = new Float64Array(4);
      for (let step = 0; step < 12000; step++) {
        const dt = [1 / 4000, 1 / 2000, 1 / 8000, 1 / 16000][Math.floor(step / 301) % 4];
        cfg.enabled = step % 509 < 480;
        cfg.q = step % 701 < 350 ? 5 : 2.3;
        cfg.weights = step % 613 < 300 ? [1, 0.5, 0.25] : [0, 0.8];
        for (let m = 0; m < 4; m++) {
          // Include zero, min/fade boundaries, the Nyquist limit, reverse rotation, and changing RPM.
          const hz = [0, 99, 100, 125, 150, 0.45 / dt, 0.45 / dt + 1, 400 + 230 * Math.sin(step * 0.021 + m)][Math.floor(step / 17 + m) % 8];
          omega[m] = TWO_PI * hz * (m % 2 ? -1 : 1);
        }
        if (step % 997 === 0) { bank.reset(); old.reset(); }
        bank.update(dt, omega);
        old.update(dt, omega);
        for (let axis = 0; axis < axes; axis++) {
          const x = Math.sin(step * (0.019 + axis * 0.011)) * (axis + 1) + (step % 43 === 0 ? 5 : 0);
          expect(bank.apply(axis, x)).toBe(old.apply(axis, x));
        }
      }
    }
  });

  it('shares only coefficients and preserves each destination filter state', () => {
    const design = new Biquad();
    const copied = new Biquad();
    const direct = new Biquad();
    copied.setNotch(270, 3, 1 / 4000);
    direct.setNotch(270, 3, 1 / 4000);
    for (let i = 0; i < 100; i++) {
      copied.apply(Math.sin(i));
      direct.apply(Math.sin(i));
      design.apply(i);
    }
    design.setNotch(510, 5, 1 / 8000);
    copied.copyCoefficientsFrom(design);
    direct.setNotch(510, 5, 1 / 8000);
    for (let i = 0; i < 100; i++) expect(copied.apply(Math.cos(i))).toBe(direct.apply(Math.cos(i)));
  });

  it('designs three updated notches once each rather than once per axis', () => {
    const bank = new RpmFilterBank(config(), 4, 3);
    const omega = [TWO_PI * 400, TWO_PI * 420, TWO_PI * 440, TWO_PI * 460];
    const sin = vi.spyOn(Math, 'sin');
    const cos = vi.spyOn(Math, 'cos');
    try {
      bank.update(1 / 4000, omega);
      expect(sin).toHaveBeenCalledTimes(3);
      expect(cos).toHaveBeenCalledTimes(3);
    } finally {
      sin.mockRestore(); cos.mockRestore();
    }
  });
});
