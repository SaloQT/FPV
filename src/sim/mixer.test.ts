import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MIXER,
  MIX_PITCH,
  MIX_ROLL,
  MIX_YAW,
  Mixer,
  applyThrustLinearization,
  compensateThrustLinearization,
  throttleCurve,
  type MixerConfig,
} from './fc';
import { QUAD_5IN_6S } from './presets';
import { benchStatic } from './testkit';

const DT = 1 / 4000;
const IDLE = DEFAULT_MIXER.idle;
const SPAN = 1 - IDLE;

function mix(pid: number[], throttle: number, airmode = false, cfg: Partial<MixerConfig> = {}): number[] {
  const m = new Mixer({ ...DEFAULT_MIXER, ...cfg });
  m.run(DT, pid, throttle, airmode);
  return Array.from(m.out);
}

describe('mixer', () => {
  it('maps throttle linearly onto [idle, 1] with no PID demand', () => {
    for (const o of mix([0, 0, 0], 0)) expect(o).toBeCloseTo(IDLE, 12);
    for (const o of mix([0, 0, 0], 1)) expect(o).toBeCloseTo(1, 12);
    for (const o of mix([0, 0, 0], 0.5)) expect(o).toBeCloseTo(IDLE + SPAN * 0.5, 12);
  });

  it('respects the motor limit', () => {
    for (const o of mix([0, 0, 0], 1, false, { motorLimit: 0.9 })) expect(o).toBeCloseTo(0.9, 12);
  });

  it('roll right (positive) slows the right motors (FR, RR) and speeds the left ones', () => {
    const o = mix([100, 0, 0], 0.5);
    expect(o[0]).toBeLessThan(o[2]);
    expect(o[1]).toBeLessThan(o[3]);
    expect(o[0]).toBeCloseTo(o[1], 12);
    expect(o[2]).toBeCloseTo(o[3], 12);
    expect(o[2] - o[0]).toBeCloseTo(0.2 * SPAN, 9);
  });

  it('nose down (positive pitch) slows the front motors (FR, FL) and speeds the rear ones', () => {
    const o = mix([0, 100, 0], 0.5);
    expect(o[0]).toBeLessThan(o[1]);
    expect(o[3]).toBeLessThan(o[2]);
    expect(o[0]).toBeCloseTo(o[3], 12);
    expect(o[1]).toBeCloseTo(o[2], 12);
  });

  it('yaw right (positive) speeds the counter-clockwise props (RR, FL) and slows the clockwise ones', () => {
    const o = mix([0, 0, 100], 0.5);
    expect(o[1]).toBeGreaterThan(o[0]);
    expect(o[3]).toBeGreaterThan(o[2]);
    expect(o[1]).toBeCloseTo(o[3], 12);
    expect(o[0]).toBeCloseTo(o[2], 12);
  });

  it('mix tables are balanced: no net thrust, roll or pitch from any single axis', () => {
    for (const t of [MIX_ROLL, MIX_PITCH, MIX_YAW]) expect(t[0] + t[1] + t[2] + t[3]).toBe(0);
    let rp = 0, ry = 0, py = 0;
    for (let i = 0; i < 4; i++) {
      rp += MIX_ROLL[i] * MIX_PITCH[i];
      ry += MIX_ROLL[i] * MIX_YAW[i];
      py += MIX_PITCH[i] * MIX_YAW[i];
    }
    expect([rp, ry, py]).toEqual([0, 0, 0]);
  });

  it('airmode lifts the throttle so the demanded differential survives at zero throttle', () => {
    const on = mix([200, 0, 0], 0, true);
    const off = mix([200, 0, 0], 0, false);
    expect(Math.max(...on) - Math.min(...on)).toBeCloseTo(0.4 * SPAN, 9);
    expect(Math.min(...on)).toBeCloseTo(IDLE, 12);
    expect(Math.max(...off) - Math.min(...off)).toBeCloseTo(0.2 * SPAN, 9);
  });

  it('saturating demands are scaled to fit and keep the motor pattern balanced', () => {
    const o = mix([1000, 1000, 0], 0.5, true);
    expect(Math.min(...o)).toBeCloseTo(IDLE, 12);
    expect(Math.max(...o)).toBeCloseTo(1, 12);
    expect((o[1] + o[3]) / 2).toBeCloseTo(IDLE + SPAN * 0.5, 9);
  });

  it('throttle boost adds a transient on a fast throttle rise and decays away', () => {
    const run = (boost: number): number[] => {
      const m = new Mixer({ ...DEFAULT_MIXER, throttleBoost: boost });
      for (let i = 0; i < 400; i++) m.run(DT, [0, 0, 0], 0.3, false);
      m.run(DT, [0, 0, 0], 0.6, false);
      const first = m.out[0];
      for (let i = 0; i < 4000; i++) m.run(DT, [0, 0, 0], 0.6, false);
      return [first, m.out[0]];
    };
    const [boosted, settled] = run(5);
    const [plain, plainSettled] = run(0);
    expect(boosted).toBeGreaterThan(plain);
    expect(settled).toBeCloseTo(plainSettled, 9);
  });

  it('throttle curve is the identity without expo and monotonic with it', () => {
    for (let t = 0; t <= 1.0001; t += 0.1) expect(throttleCurve(t, 0.5, 0)).toBeCloseTo(t, 12);
    expect(throttleCurve(0, 0.5, 0.6)).toBeCloseTo(0, 12);
    expect(throttleCurve(1, 0.5, 0.6)).toBeCloseTo(1, 12);
    expect(throttleCurve(0.5, 0.5, 0.6)).toBeCloseTo(0.5, 12);
    let prev = -1;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const y = throttleCurve(t, 0.5, 0.6);
      expect(y).toBeGreaterThan(prev);
      prev = y;
    }
  });
});

describe('turtle mixer', () => {
  const turtle = (r: number, p: number, y: number, cfg: Partial<MixerConfig> = {}): number[] => {
    const m = new Mixer({ ...DEFAULT_MIXER, ...cfg });
    m.turtle(r, p, y);
    return Array.from(m.out);
  };

  it('stays stopped inside the deadband', () => {
    expect(turtle(0.03, -0.04, 0.02)).toEqual([0, 0, 0, 0]);
  });

  it('pitch forward reverses the two rear motors at turtlePower and leaves the front two stopped', () => {
    const o = turtle(0, 1, 0);
    expect(o[0]).toBeCloseTo(0, 12);
    expect(o[3]).toBeCloseTo(0, 12);
    expect(o[1]).toBeCloseTo(-DEFAULT_MIXER.turtlePower, 12);
    expect(o[2]).toBeCloseTo(-DEFAULT_MIXER.turtlePower, 12);
  });

  it('pitch back reverses the front pair, roll picks a side pair, yaw a diagonal pair', () => {
    const p = turtle(0, -1, 0);
    expect(p[0]).toBeLessThan(0);
    expect(p[3]).toBeLessThan(0);
    expect(p[1]).toBeCloseTo(0, 12);
    const r = turtle(1, 0, 0);
    expect(r[2]).toBeLessThan(0);
    expect(r[3]).toBeLessThan(0);
    expect(r[0]).toBeCloseTo(0, 12);
    const y = turtle(0, 0, 1);
    expect(y[1]).toBeLessThan(0);
    expect(y[3]).toBeLessThan(0);
    expect(y[0]).toBeCloseTo(0, 12);
  });

  it('never exceeds turtlePower', () => {
    for (const o of turtle(1, 1, 1, { turtlePower: 0.6 })) expect(Math.abs(o)).toBeLessThanOrEqual(0.6 + 1e-12);
  });
});

describe('thrust linearisation', () => {
  it('leaves 0 and 1 fixed, is the identity at k = 0 and never lowers a motor output', () => {
    for (const k of [0, 0.3, 0.6, 1, 1.5]) {
      expect(applyThrustLinearization(0, k)).toBe(0);
      expect(applyThrustLinearization(1, k)).toBeCloseTo(1, 12);
      expect(Math.abs(compensateThrustLinearization(0, k))).toBe(0);
      expect(compensateThrustLinearization(1, k)).toBeCloseTo(1, 12);
      for (let o = 0; o <= 1.0001; o += 0.05) expect(applyThrustLinearization(o, k)).toBeGreaterThanOrEqual(o - 1e-12);
    }
    expect(applyThrustLinearization(0.37, 0)).toBe(0.37);
    expect(compensateThrustLinearization(0.37, 0)).toBe(0.37);
  });

  it('the output map and the throttle pre-compensation are strictly monotonic and never negative up to k = 1.5', () => {
    for (const k of [0.5, 1, 1.5]) {
      let a = -1, c = -1;
      for (let x = 0; x <= 1.0001; x += 0.01) {
        const ya = applyThrustLinearization(x, k);
        expect(ya).toBeGreaterThan(a);
        a = ya;
        const yc = compensateThrustLinearization(x, k);
        expect(yc).toBeGreaterThan(c);
        expect(yc).toBeGreaterThanOrEqual(0);
        c = yc;
      }
    }
  });

  it('compensation followed by the output map is close to the identity at moderate k, so hover throttle is preserved', () => {
    for (const k of [0.25, 0.5]) {
      for (let t = 0.1; t <= 1.0001; t += 0.05) {
        const back = applyThrustLinearization(compensateThrustLinearization(t, k), k);
        expect(Math.abs(back - t)).toBeLessThan(0.05 * t + 0.01);
      }
    }
  });

  it('gives more differential thrust per PID unit at low throttle, through the real motor and propeller', () => {
    const thrust = new Map<number, number>();
    const perMotor = (duty: number): number => {
      const key = Math.round(duty * 1e6);
      let t = thrust.get(key);
      if (t === undefined) {
        t = benchStatic(QUAD_5IN_6S, duty, 0.3).thrust / 4;
        thrust.set(key, t);
      }
      return t;
    };
    const authority = (k: number, throttle: number): number => {
      const o = mix([60, 0, 0], throttle, true, { thrustLinear: k, throttleBoost: 0 });
      return perMotor(o[2]) - perMotor(o[0]);
    };
    const ratio = (k: number): number => authority(k, 0.15) / authority(k, 0.8);
    const plain = ratio(0);
    const linear = ratio(0.5);
    console.log(`[thrust_linear] differential thrust at 15% vs 80% throttle: k=0 ${plain.toFixed(3)}, k=0.5 ${linear.toFixed(3)}`);
    expect(plain).toBeLessThan(0.5);
    expect(linear).toBeGreaterThan(plain * 1.15);
    expect(linear).toBeLessThanOrEqual(1.05);
  }, 30000);
});
