import { describe, expect, it } from 'vitest';
import { bladePassFrequency, TWO_PI } from './dsp';
import { DEFAULT_OMEGA_MAX, MOTOR_AMP_SCALE, MotorModel } from './motorModel';
import { MOTOR_FREQ_MAX, MOTOR_PARAM_COUNT, MOTOR_PARAM_SPECS, P_AMP, P_FLUTTER, P_FREQ, P_NOISE, P_NOISE_FC, P_RUMBLE, P_SPREAD } from './motorParams';

const frame = (w: number, extra: Partial<{ dt: number; vy: number; doppler: number; onboard: boolean }> = {}) => ({
  omega: [w, w, w, w] as number[], dt: 1 / 60, vy: 0, doppler: 1, onboard: false, ...extra,
});

describe('parameter layout', () => {
  it('has one spec per parameter and unique names', () => {
    expect(MOTOR_PARAM_SPECS.length).toBe(MOTOR_PARAM_COUNT);
    expect(new Set(MOTOR_PARAM_SPECS.map((s) => s.name)).size).toBe(MOTOR_PARAM_COUNT);
  });
});

describe('MotorModel', () => {
  it('is silent with the motors stopped', () => {
    const p = new MotorModel().update(frame(0));
    for (let i = 0; i < 4; i++) {
      expect(p[P_AMP + i]).toBe(0);
      expect(p[P_FREQ + i]).toBe(0);
    }
    expect(p[P_NOISE]).toBe(0);
    expect(p[P_RUMBLE]).toBe(0);
  });

  it('maps rad/s to mechanical Hz with per-motor detune, so 3x is the blade pass', () => {
    const m = new MotorModel();
    const w = (30000 * TWO_PI) / 60;
    const p = m.update(frame(w));
    expect(p[P_FREQ] * 3).toBeCloseTo(bladePassFrequency(w), 6);
    const fs = [0, 1, 2, 3].map((i) => p[P_FREQ + i]);
    expect(new Set(fs).size).toBe(4);
    for (const f of fs) expect(Math.abs(f / fs[0] - 1)).toBeLessThan(0.006);
  });

  it('amplitude rises monotonically with speed up to the full-throttle scale', () => {
    const m = new MotorModel();
    let prev = -1;
    for (let w = 0; w <= DEFAULT_OMEGA_MAX; w += 150) {
      const a = m.update(frame(w))[P_AMP];
      expect(a).toBeGreaterThanOrEqual(prev);
      prev = a;
    }
    expect(prev).toBeCloseTo(MOTOR_AMP_SCALE, 6);
    expect(new MotorModel().update(frame(DEFAULT_OMEGA_MAX * 1.5))[P_AMP]).toBeCloseTo(MOTOR_AMP_SCALE, 6);
  });

  it('whoosh gets louder and brighter with speed', () => {
    const lo = new MotorModel().update(frame(800)).slice();
    const hi = new MotorModel().update(frame(3000)).slice();
    expect(hi[P_NOISE]).toBeGreaterThan(lo[P_NOISE] * 5);
    expect(hi[P_NOISE_FC]).toBeGreaterThan(lo[P_NOISE_FC]);
    expect(hi[P_NOISE_FC]).toBeLessThanOrEqual(6000);
    expect(lo[P_NOISE_FC]).toBeGreaterThanOrEqual(2000);
  });

  it('applies the Doppler scale and never leaves the synth range', () => {
    const base = new MotorModel().update(frame(2000))[P_FREQ];
    expect(new MotorModel().update(frame(2000, { doppler: 1.1 }))[P_FREQ]).toBeCloseTo(base * 1.1, 9);
    expect(new MotorModel().update(frame(3300, { doppler: 50 }))[P_FREQ]).toBe(MOTOR_FREQ_MAX);
  });

  it('flutter follows how fast the motors change speed and settles afterwards', () => {
    const m = new MotorModel();
    for (let i = 0; i < 30; i++) m.update(frame(1500));
    expect(m.params[P_FLUTTER]).toBeLessThan(0.01);
    let w = 1500;
    for (let i = 0; i < 10; i++) {
      w += 200;
      m.update(frame(w));
    }
    expect(m.params[P_FLUTTER]).toBeGreaterThan(0.2);
    for (let i = 0; i < 180; i++) m.update(frame(w));
    expect(m.params[P_FLUTTER]).toBeLessThan(0.02);
  });

  it('rumbles on a fast descent with spinning motors, not on a climb or with the motors off', () => {
    const run = (w: number, vy: number): number => {
      const m = new MotorModel();
      for (let i = 0; i < 120; i++) m.update(frame(w, { vy }));
      return m.params[P_RUMBLE];
    };
    const drop = run(1200, -12);
    expect(drop).toBeGreaterThan(0.15);
    expect(drop).toBeGreaterThan(run(1200, 6) * 4);
    expect(drop).toBeGreaterThan(run(1200, 0) * 4);
    expect(run(0, -12)).toBe(0);
  });

  it('spreads the motors across the stereo field only when onboard', () => {
    expect(new MotorModel().update(frame(2000))[P_SPREAD]).toBe(0);
    expect(new MotorModel().update(frame(2000, { onboard: true }))[P_SPREAD]).toBeGreaterThan(0.3);
  });

  it('survives junk input and reuses one output array', () => {
    const m = new MotorModel();
    const first = m.update({ omega: [NaN, -5, Infinity, 100], dt: 0, vy: NaN, doppler: 1, onboard: false });
    for (const v of first) expect(Number.isFinite(v)).toBe(true);
    expect(m.update(frame(500))).toBe(first);
  });
});
