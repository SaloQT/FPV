import { describe, expect, it } from 'vitest';
import type { Quat } from '../contracts';
import { QUAD_5IN_6S, type QuadConfig } from './presets';
import { QuadPhysics } from './quad';
import { RAD2DEG, airborneQuad, fcRate, inp, rateStep, run, stickFor, upDot, type Axis } from './testkit';

const cfg = QUAD_5IN_6S;
const HOVER = 0.29;
const AXES: Axis[] = ['roll', 'pitch', 'yaw'];

function tiltDeg(q: QuadPhysics): number {
  return RAD2DEG * Math.acos(Math.min(1, Math.max(-1, upDot(q))));
}

/** Attitude with the body tilted `deg` right (roll) or nose-down (pitch) from level, no yaw. */
function tilted(axis: 'roll' | 'pitch', deg: number): Quat {
  const h = (deg * Math.PI) / 360;
  return axis === 'roll' ? [0, 0, -Math.sin(h), Math.cos(h)] : [-Math.sin(h), 0, 0, Math.cos(h)];
}

describe('closed-loop rate tracking (acro, hover throttle)', () => {
  const HZ: Array<[number, number]> = [[4000, 1 / 4000], [2000, 1 / 2000]];

  for (const [hz, dt] of HZ) {
    for (const axis of AXES) {
      for (const target of [200, -200]) {
        it(`${axis} ${target > 0 ? '+' : ''}${target} deg/s at ${hz} Hz: 90% in under 25 ms, overshoot under 15%, settles on target`, () => {
          const r = rateStep(cfg, axis, target, dt, 0.5);
          console.log(`[rate ${axis} ${target} @${hz}] t90 ${r.t90.toFixed(1)} ms, overshoot ${r.overshoot.toFixed(1)}%, final ${r.final.toFixed(1)}, ripple ${r.ripple.toFixed(1)}`);
          expect(r.t90).toBeGreaterThan(0);
          expect(r.t90).toBeLessThan(25);
          expect(r.overshoot).toBeLessThan(15);
          expect(Math.abs(r.final - 200)).toBeLessThan(0.04 * 200);
          expect(r.ripple).toBeLessThan(0.06 * 200);
        });
      }
    }
  }

  it('100, 400 and 50 deg/s roll steps stay fast (under 25 / 40 / 25 ms) and well damped', () => {
    for (const [target, limit] of [[100, 25], [400, 40]]) {
      const r = rateStep(cfg, 'roll', target);
      console.log(`[rate roll ${target}] t90 ${r.t90.toFixed(1)} ms, overshoot ${r.overshoot.toFixed(1)}%`);
      expect(r.t90).toBeGreaterThan(0);
      expect(r.t90).toBeLessThan(limit);
      expect(r.overshoot).toBeLessThan(15);
    }
    const small = rateStep(cfg, 'roll', 50);
    expect(small.t90).toBeLessThan(25);
    expect(small.overshoot).toBeLessThan(25);
  });

  it('full stick reaches about the 670 deg/s superRate on every axis without diverging', () => {
    for (const axis of AXES) {
      const q = airborneQuad(cfg, HOVER);
      let peak = 0;
      for (let i = 0; i < 2000; i++) {
        q.step(1 / 4000, inp({ throttle: HOVER, [axis]: 1 }));
        peak = Math.max(peak, fcRate(q, axis));
        expect(Number.isFinite(q.state.angVel[0] + q.state.angVel[1] + q.state.angVel[2])).toBe(true);
      }
      const target = axis === 'yaw' ? 600 : 670;
      console.log(`[full stick ${axis}] peak ${peak.toFixed(0)} deg/s (command ${target})`);
      expect(peak).toBeGreaterThan(0.9 * target);
      expect(peak).toBeLessThan(1.1 * target);
    }
  });

  it('centred sticks hold a hover with under 3 deg/s of gyro rms on every axis', () => {
    const q = airborneQuad(cfg, HOVER);
    const sum = [0, 0, 0];
    const n = 4000;
    for (let i = 0; i < n; i++) {
      q.step(1 / 4000, inp({ throttle: HOVER }));
      for (let a = 0; a < 3; a++) sum[a] += fcRate(q, AXES[a]) ** 2;
    }
    for (let a = 0; a < 3; a++) expect(Math.sqrt(sum[a] / n)).toBeLessThan(3);
  });

  it('a simultaneous 150 deg/s command on all three axes is tracked on each within 12%', () => {
    const q = airborneQuad(cfg, HOVER);
    const cmd = { roll: stickFor(150, 'roll'), pitch: -stickFor(150, 'pitch'), yaw: stickFor(150, 'yaw') };
    run(q, 0.06, inp({ throttle: HOVER, ...cmd }));
    expect(fcRate(q, 'roll')).toBeGreaterThan(150 * 0.88);
    expect(fcRate(q, 'roll')).toBeLessThan(150 * 1.12);
    expect(fcRate(q, 'pitch')).toBeLessThan(-150 * 0.88);
    expect(fcRate(q, 'pitch')).toBeGreaterThan(-150 * 1.12);
    expect(fcRate(q, 'yaw')).toBeGreaterThan(150 * 0.85);
    expect(fcRate(q, 'yaw')).toBeLessThan(150 * 1.15);
  });
});

describe('call rate independence', () => {
  const trace = (dt: number): number[] => {
    const q = airborneQuad(cfg, HOVER);
    const stick = stickFor(200, 'roll');
    const out: number[] = [];
    const per = Math.round(0.001 / dt);
    for (let ms = 1; ms <= 300; ms++) {
      for (let k = 0; k < per; k++) q.step(dt, inp({ throttle: HOVER, roll: stick }));
      out.push(fcRate(q, 'roll'));
    }
    return out;
  };

  it('the 200 deg/s roll response at 4 kHz and 2 kHz agrees within 20 deg/s (mean 6)', () => {
    const a = trace(1 / 4000);
    const b = trace(1 / 2000);
    let max = 0, mean = 0;
    for (let i = 0; i < a.length; i++) {
      const d = Math.abs(a[i] - b[i]);
      max = Math.max(max, d);
      mean += d / a.length;
    }
    console.log(`[4k vs 2k] roll step trace: max diff ${max.toFixed(2)} deg/s, mean ${mean.toFixed(2)} deg/s`);
    expect(max).toBeLessThan(20);
    expect(mean).toBeLessThan(6);
  });

  it('stays stable and on target when called at 1 kHz, 500 Hz and the 60 Hz render rate', () => {
    for (const dt of [1 / 1000, 1 / 500, 1 / 120]) {
      for (const axis of AXES) {
        const r = rateStep(cfg, axis, 200, dt, 0.6);
        console.log(`[call ${(1 / dt).toFixed(0)} Hz ${axis}] t90 ${r.t90.toFixed(1)} ms, overshoot ${r.overshoot.toFixed(1)}%, final ${r.final.toFixed(1)}`);
        expect(r.t90).toBeGreaterThan(0);
        expect(r.overshoot).toBeLessThan(30);
        expect(Math.abs(r.final - 200)).toBeLessThan(12);
        expect(r.ripple).toBeLessThan(20);
      }
    }
  });
});

describe('angle and horizon modes', () => {
  const levelled = (axis: 'roll' | 'pitch', deg: number): { t: number; worstAfter: number; final: number } => {
    const q = airborneQuad(cfg, HOVER);
    q.setAttitude(tilted(axis, deg));
    let t = -1, worstAfter = 0;
    for (let i = 0; i < 4000 * 3; i++) {
      q.step(1 / 4000, inp({ throttle: HOVER, mode: 'angle' }));
      const tilt = tiltDeg(q);
      if (t < 0 && tilt < 2) t = (i + 1) / 4000;
      else if (t >= 0) worstAfter = Math.max(worstAfter, tilt);
    }
    return { t, worstAfter, final: tiltDeg(q) };
  };

  for (const axis of ['roll', 'pitch'] as const) {
    for (const deg of [40, -40]) {
      it(`angle mode levels a ${Math.abs(deg)} degree ${deg > 0 ? '' : 'opposite '}${axis} bank in under 1.5 s and stays level`, () => {
        const r = levelled(axis, deg);
        console.log(`[angle ${axis} ${deg}] level (<2 deg) after ${r.t.toFixed(2)} s, worst tilt afterwards ${r.worstAfter.toFixed(2)} deg`);
        expect(r.t).toBeGreaterThan(0);
        expect(r.t).toBeLessThan(1.5);
        expect(r.worstAfter).toBeLessThan(3);
        expect(r.final).toBeLessThan(0.5);
      });
    }
  }

  it('a half stick in angle mode holds the estimated attitude at half the 55 degree limit, in the stick direction', () => {
    const estTilt = (q: QuadPhysics): number => RAD2DEG * Math.acos(Math.min(1, q.fc.imu.up[1]));
    const fwd = airborneQuad(cfg, HOVER);
    run(fwd, 1, inp({ throttle: HOVER, mode: 'angle', pitch: 0.5 }));
    console.log(`[angle stick] pitch 0.5 after 1 s: true tilt ${tiltDeg(fwd).toFixed(1)} deg, estimated ${estTilt(fwd).toFixed(1)} deg`);
    expect(fwd.fc.imu.up[2]).toBeGreaterThan(0);
    expect(estTilt(fwd)).toBeGreaterThan(25);
    expect(estTilt(fwd)).toBeLessThan(29);
    expect(tiltDeg(fwd)).toBeGreaterThan(24);
    expect(tiltDeg(fwd)).toBeLessThan(33);
    expect(fwd.state.vel[2]).toBeLessThan(-2);
    const left = airborneQuad(cfg, HOVER);
    run(left, 1, inp({ throttle: HOVER, mode: 'angle', roll: -0.5 }));
    expect(left.fc.imu.up[0]).toBeGreaterThan(0);
    expect(estTilt(left)).toBeGreaterThan(25);
    expect(estTilt(left)).toBeLessThan(29);
    expect(left.state.vel[0]).toBeLessThan(-2);
  });

  it('full stick in angle mode is limited to the 55 degree bank, in horizon mode the quad rolls right over', () => {
    const angle = airborneQuad(cfg, HOVER);
    let maxAngle = 0;
    for (let i = 0; i < 4000; i++) {
      angle.step(1 / 4000, inp({ throttle: HOVER, mode: 'angle', roll: 1 }));
      maxAngle = Math.max(maxAngle, tiltDeg(angle));
    }
    expect(maxAngle).toBeGreaterThan(50);
    expect(maxAngle).toBeLessThan(62);
    const horizon = airborneQuad(cfg, HOVER);
    let maxHorizon = 0;
    for (let i = 0; i < 2000; i++) {
      horizon.step(1 / 4000, inp({ throttle: HOVER, mode: 'horizon', roll: 1 }));
      maxHorizon = Math.max(maxHorizon, tiltDeg(horizon));
    }
    expect(maxHorizon).toBeGreaterThan(120);
  });

  it('horizon mode brings a banked quad back to level with the sticks released', () => {
    const q = airborneQuad(cfg, HOVER);
    q.setAttitude(tilted('roll', 40));
    run(q, 2, inp({ throttle: HOVER, mode: 'horizon' }));
    expect(tiltDeg(q)).toBeLessThan(2);
  });
});

describe('RPM filter', () => {
  const noise = (c: QuadConfig): { motor: number; gyro: number } => {
    const q = airborneQuad(c, HOVER);
    let m = 0, g = 0;
    const n = 8000;
    for (let i = 0; i < n; i++) {
      q.step(1 / 4000, inp({ throttle: HOVER }));
      const d = q.fc.motors[0] - q.fc.motors[2];
      m += d * d;
      g += q.fc.gyro[0] ** 2;
    }
    return { motor: Math.sqrt(m / n), gyro: Math.sqrt(g / n) };
  };

  it('cuts the motor-command noise that the vibrating gyro would otherwise feed to the mixer', () => {
    const off: QuadConfig = { ...cfg, fc: { ...cfg.fc, rpmFilter: { ...cfg.fc.rpmFilter, enabled: false } } };
    const a = noise(cfg);
    const b = noise(off);
    console.log(`[rpm filter] motor command rms on ${a.motor.toExponential(2)} off ${b.motor.toExponential(2)}, gyro rms on ${a.gyro.toFixed(3)} off ${b.gyro.toFixed(3)}`);
    expect(a.motor).toBeLessThan(0.1 * b.motor);
    expect(a.gyro).toBeLessThan(0.1 * b.gyro);
  });
});
