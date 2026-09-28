import { describe, expect, it } from 'vitest';
import { TWO_PI } from './math3d';
import { DEFAULT_PID, DTERM_SCALE, FEEDFORWARD_SCALE, ITERM_SCALE, PTERM_SCALE, PidController, type PidConfig } from './fc';

const DT = 1 / 4000;

describe('PID controller', () => {
  const make = (patch: Partial<PidConfig> = {}): PidController => new PidController({ ...DEFAULT_PID, ...patch });
  const drive = (p: PidController, steps: number, sp: number[], gyro: number[], throttle = 0.2, integrate = true): void => {
    for (let i = 0; i < steps; i++) p.update(DT, sp, gyro, throttle, integrate);
  };

  it('P term is P * 0.032029 * error on each axis with the configured gains', () => {
    const p = make();
    drive(p, 1, [100, 100, 100], [0, 0, 0], 0);
    expect(p.pTerm[0]).toBeCloseTo(67 * PTERM_SCALE * 100, 6);
    expect(p.pTerm[1]).toBeCloseTo(70 * PTERM_SCALE * 100, 6);
    expect(p.pTerm[2]).toBeCloseTo(36 * PTERM_SCALE * 100, 6);
    expect(p.sum[0]).toBeCloseTo(p.pTerm[0] + p.iTerm[0], 9);
  });

  it('D acts on the measurement: no kick from a setpoint step, negative for a rising gyro', () => {
    const p = make();
    drive(p, 10, [0, 0, 0], [0, 0, 0]);
    drive(p, 4, [500, 500, 500], [0, 0, 0]);
    expect(Math.abs(p.dTerm[0])).toBe(0);
    const q = make();
    drive(q, 10, [0, 0, 0], [0, 0, 0]);
    drive(q, 4, [0, 0, 0], [50, 50, 50]);
    expect(q.dTerm[0]).toBeLessThan(0);
    expect(Math.abs(q.dTerm[2])).toBe(0);
    const step = q.dTerm[0] / (DTERM_SCALE * 57);
    expect(step).toBeLessThan(-100);
  });

  it('I term integrates I * 0.244381 * error over time', () => {
    const p = make();
    drive(p, 400, [50, 50, 50], [0, 0, 0], 0.2);
    expect(p.iTerm[0]).toBeCloseTo(100 * ITERM_SCALE * 50 * 0.1, 0);
    expect(p.iTerm[1]).toBeCloseTo(105 * ITERM_SCALE * 50 * 0.1, 0);
    expect(p.iTerm[2]).toBeCloseTo(80 * ITERM_SCALE * 50 * 0.1, 0);
  });

  it('I term is limited and integrate=false holds it at zero', () => {
    const p = make();
    drive(p, 20000, [30, 30, 30], [0, 0, 0]);
    for (let a = 0; a < 3; a++) expect(Math.abs(p.iTerm[a])).toBeLessThanOrEqual(DEFAULT_PID.itermLimit + 1e-9);
    const off = make();
    drive(off, 4000, [100, 100, 100], [0, 0, 0], 0.2, false);
    expect(off.iTerm[0]).toBe(0);
    expect(off.iTerm[2]).toBe(0);
  });

  it('I-term relax freezes roll/pitch integration during a fast setpoint change, but not yaw', () => {
    const relaxed = make();
    drive(relaxed, 5, [0, 0, 0], [0, 0, 0]);
    drive(relaxed, 40, [200, 200, 200], [0, 0, 0]);
    expect(relaxed.iTerm[0]).toBeLessThan(0.5);
    expect(relaxed.iTerm[2]).toBeGreaterThan(5);
    const open = make({ itermRelaxThreshold: 1e9 });
    drive(open, 5, [0, 0, 0], [0, 0, 0]);
    drive(open, 40, [200, 200, 200], [0, 0, 0]);
    expect(open.iTerm[0]).toBeGreaterThan(5);
  });

  it('anti-gravity boosts I accumulation while the throttle is moving', () => {
    const run = (gain: number): number => {
      const p = make({ antiGravityGain: gain });
      drive(p, 400, [20, 20, 20], [0, 0, 0], 0.3);
      const before = p.iTerm[0];
      for (let i = 0; i < 200; i++) p.update(DT, [20, 20, 20], [0, 0, 0], 0.3 + (0.5 * i) / 200, true);
      return p.iTerm[0] - before;
    };
    expect(run(4)).toBeGreaterThan(1.2 * run(0));
  });

  it('TPA scales P and D by 1 up to the breakpoint and by 0.35 at full throttle', () => {
    const at = (thr: number): number => {
      const p = make();
      drive(p, 1, [100, 0, 0], [0, 0, 0], thr);
      return p.pTerm[0];
    };
    expect(at(0.2)).toBeCloseTo(at(0.35), 9);
    expect(at(1) / at(0.35)).toBeCloseTo(0.35, 6);
    expect(at(0.675) / at(0.35)).toBeCloseTo(0.675, 6);
  });

  it('feed-forward of a setpoint step follows the smoothed acceleration', () => {
    const p = make();
    drive(p, 5, [0, 0, 0], [0, 0, 0]);
    drive(p, 1, [200, 0, 0], [200, 0, 0]);
    const rc = 1 / (TWO_PI * DEFAULT_PID.ffSmoothHz);
    const k = DT / (rc + DT);
    expect(p.fTerm[0]).toBeCloseTo(60 * FEEDFORWARD_SCALE * ((k * 200) / DT), 3);
    drive(p, 20000, [200, 0, 0], [200, 0, 0]);
    expect(Math.abs(p.fTerm[0])).toBeLessThan(0.01);
  });

  it('PID sum is limited to 500 (roll, pitch) and 400 (yaw) in both directions', () => {
    const p = make();
    drive(p, 3, [1000, -1000, 1000], [0, 0, 0]);
    expect(p.sum[0]).toBe(500);
    expect(p.sum[1]).toBe(-500);
    expect(p.sum[2]).toBe(400);
  });

  it('reset clears every term', () => {
    const p = make();
    drive(p, 100, [100, 100, 100], [0, 0, 0]);
    p.reset();
    for (let a = 0; a < 3; a++) {
      expect(p.sum[a]).toBe(0);
      expect(p.iTerm[a]).toBe(0);
    }
  });
});
