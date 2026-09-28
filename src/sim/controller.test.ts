import { describe, expect, it } from 'vitest';
import type { Quat, StickInput, Vec3 } from '../contracts';
import {
  DEFAULT_FC,
  DEFAULT_IMU_FUSION,
  DEFAULT_LEVEL,
  DEFAULT_MIXER,
  FlightController,
  Mahony,
  applyLevel,
  pitchAngleDeg,
  rollAngleDeg,
} from './fc';
import { G0, quatRotateInv } from './math3d';
import { inp } from './testkit';

const DT = 1 / 4000;
const REST_ACCEL: Vec3 = [0, G0, 0];
const NO_ROTATION: Vec3 = [0, 0, 0];
const NO_MOTORS = [0, 0, 0, 0];

function tick(fc: FlightController, input: StickInput, steps = 1, gyro: Vec3 = NO_ROTATION): void {
  for (let i = 0; i < steps; i++) fc.update(DT, input, gyro, REST_ACCEL, NO_MOTORS);
}

function axisAngle(ax: number, ay: number, az: number, angle: number): Quat {
  const s = Math.sin(angle / 2);
  return [ax * s, ay * s, az * s, Math.cos(angle / 2)];
}

describe('arming', () => {
  it('is disarmed with the motors stopped until the switch is thrown', () => {
    const fc = new FlightController(DEFAULT_FC);
    tick(fc, inp({ armed: false }), 100);
    expect(fc.armed).toBe(false);
    expect(Array.from(fc.motors)).toEqual([0, 0, 0, 0]);
  });

  it('arms at low throttle and then idles the motors at the idle duty', () => {
    const fc = new FlightController(DEFAULT_FC);
    tick(fc, inp({ throttle: 0 }), 200);
    expect(fc.armed).toBe(true);
    for (const m of fc.motors) expect(m).toBeCloseTo(DEFAULT_MIXER.idle, 6);
  });

  it('refuses to arm with the throttle up and stays blocked until the switch is cycled', () => {
    const fc = new FlightController(DEFAULT_FC);
    tick(fc, inp({ throttle: 0.5 }), 50);
    expect(fc.armed).toBe(false);
    tick(fc, inp({ throttle: 0 }), 50);
    expect(fc.armed).toBe(false);
    tick(fc, inp({ armed: false, throttle: 0 }), 5);
    tick(fc, inp({ throttle: 0 }), 5);
    expect(fc.armed).toBe(true);
  });

  it('disarms immediately when the switch is thrown, even at full throttle', () => {
    const fc = new FlightController(DEFAULT_FC);
    tick(fc, inp({ throttle: 0 }), 10);
    tick(fc, inp({ throttle: 0.8 }), 10);
    expect(fc.armed).toBe(true);
    tick(fc, inp({ armed: false, throttle: 0.8 }), 1);
    expect(fc.armed).toBe(false);
    expect(Array.from(fc.motors)).toEqual([0, 0, 0, 0]);
  });

  it('reset disarms and clears the outputs', () => {
    const fc = new FlightController(DEFAULT_FC);
    tick(fc, inp({ throttle: 0.4 }), 100);
    fc.reset([0, 0, 0, 1]);
    expect(fc.armed).toBe(false);
    tick(fc, inp({ armed: false }), 1);
    expect(Array.from(fc.motors)).toEqual([0, 0, 0, 0]);
  });

  it('turtle mode bypasses the PID and reverses the rear motors for pitch forward', () => {
    const fc = new FlightController(DEFAULT_FC);
    tick(fc, inp({ throttle: 0 }), 10);
    tick(fc, inp({ turtle: true, pitch: 1 }), 1);
    expect(fc.motors[0]).toBeCloseTo(0, 12);
    expect(fc.motors[3]).toBeCloseTo(0, 12);
    expect(fc.motors[1]).toBeCloseTo(-DEFAULT_MIXER.turtlePower, 12);
    expect(fc.motors[2]).toBeCloseTo(-DEFAULT_MIXER.turtlePower, 12);
  });
});

describe('gyro path and rate loop', () => {
  it('flips body rates into FC axes: roll right, nose down and yaw right are positive', () => {
    const fc = new FlightController(DEFAULT_FC);
    const w: Vec3 = [-1, -2, -3];
    tick(fc, inp({ throttle: 0 }), 40000, w);
    const deg = 180 / Math.PI;
    expect(fc.gyro[0]).toBeCloseTo(3 * deg, 1);
    expect(fc.gyro[1]).toBeCloseTo(1 * deg, 1);
    expect(fc.gyro[2]).toBeCloseTo(2 * deg, 1);
  });

  it('sets the setpoint from the stick through the rate curve', () => {
    const fc = new FlightController(DEFAULT_FC);
    tick(fc, inp({ throttle: 0 }), 2);
    tick(fc, inp({ throttle: 0, roll: 1, pitch: -1, yaw: 0.5 }), 1);
    expect(fc.setpoint[0]).toBeCloseTo(670, 6);
    expect(fc.setpoint[1]).toBeCloseTo(-670, 6);
    expect(fc.setpoint[2]).toBeCloseTo(70 * 0.5 + 530 * 0.25, 6);
  });

  it('answers a roll error with the right motors slower (positive roll demand)', () => {
    const fc = new FlightController(DEFAULT_FC);
    tick(fc, inp({ throttle: 0 }), 5);
    tick(fc, inp({ throttle: 0.3 }), 20);
    tick(fc, inp({ throttle: 0.3, roll: 0.5 }), 40);
    expect(fc.motors[0]).toBeLessThan(fc.motors[2]);
    expect(fc.motors[1]).toBeLessThan(fc.motors[3]);
  });
});

describe('level controller', () => {
  const upFor = (rollDeg: number, pitchDeg: number): Vec3 => {
    const r = (rollDeg * Math.PI) / 180, p = (pitchDeg * Math.PI) / 180;
    return [-Math.sin(r) * Math.cos(p), Math.cos(r) * Math.cos(p), Math.sin(p)];
  };
  const rate = (): Float64Array => new Float64Array([0, 0, 0]);

  it('reads roll-right and nose-down angles from the body-frame up vector', () => {
    expect(rollAngleDeg(upFor(30, 0))).toBeCloseTo(30, 6);
    expect(pitchAngleDeg(upFor(0, 20))).toBeCloseTo(20, 6);
    expect(rollAngleDeg(upFor(120, 0))).toBeCloseTo(120, 6);
    expect(rollAngleDeg([0, 1, 0])).toBeCloseTo(0, 12);
  });

  it('angle mode: half stick commands half of the limit at the 5/s loop gain, sticks are attitude targets', () => {
    const sp = rate();
    applyLevel(DEFAULT_LEVEL, 'angle', [0, 1, 0], 0.5, -0.5, sp);
    expect(sp[0]).toBeCloseTo(0.5 * 55 * 5, 6);
    expect(sp[1]).toBeCloseTo(-0.5 * 55 * 5, 6);
    expect(sp[2]).toBe(0);
  });

  it('angle mode drives a banked quad back to level (right bank asks for a left roll)', () => {
    const sp = rate();
    applyLevel(DEFAULT_LEVEL, 'angle', upFor(40, 0), 0, 0, sp);
    expect(sp[0]).toBeCloseTo(-200, 6);
    applyLevel(DEFAULT_LEVEL, 'angle', upFor(0, 40), 0, 0, sp);
    expect(sp[1]).toBeCloseTo(-200, 6);
  });

  it('angle mode bounds the rate it requests, even when inverted', () => {
    const sp = rate();
    applyLevel(DEFAULT_LEVEL, 'angle', upFor(170, 0), 0, 0, sp);
    expect(Math.abs(sp[0])).toBe(DEFAULT_LEVEL.maxRate);
  });

  it('horizon mode adds levelling at centre stick, fades out by the transition and keeps the acro rate', () => {
    const centre = new Float64Array([10, 0, 0]);
    applyLevel(DEFAULT_LEVEL, 'horizon', upFor(40, 0), 0, 0, centre);
    expect(centre[0]).toBeCloseTo(10 - 200, 6);
    const half = new Float64Array([0, 0, 0]);
    applyLevel(DEFAULT_LEVEL, 'horizon', upFor(40, 0), 0.375, 0, half);
    expect(half[0]).toBeCloseTo(-100, 6);
    const full = new Float64Array([300, 0, 0]);
    applyLevel(DEFAULT_LEVEL, 'horizon', upFor(40, 0), 0.8, 0, full);
    expect(full[0]).toBe(300);
  });

  it('acro mode leaves the setpoints alone', () => {
    const sp = new Float64Array([50, -60, 70]);
    applyLevel(DEFAULT_LEVEL, 'acro', upFor(40, 0), 0.5, 0.5, sp);
    expect(Array.from(sp)).toEqual([50, -60, 70]);
  });
});

describe('Mahony attitude filter', () => {
  const tiltError = (m: Mahony): number => (Math.acos(Math.min(1, m.up[1])) * 180) / Math.PI;

  it('pulls a 40 degree attitude error out with the accelerometer (time constant about 1 / kp)', () => {
    const m = new Mahony(DEFAULT_IMU_FUSION);
    m.reset(axisAngle(0, 0, 1, (40 * Math.PI) / 180));
    m.update(1 / 1000, 0, 0, 0, 0, G0, 0);
    expect(tiltError(m)).toBeGreaterThan(39);
    for (let i = 0; i < 12000; i++) m.update(1 / 1000, 0, 0, 0, 0, G0, 0);
    expect(tiltError(m)).toBeLessThan(2.5);
    for (let i = 0; i < 20000; i++) m.update(1 / 1000, 0, 0, 0, 0, G0, 0);
    expect(tiltError(m)).toBeLessThan(0.05);
  });

  it('corrects towards the measured gravity from either side', () => {
    for (const s of [1, -1]) {
      const m = new Mahony(DEFAULT_IMU_FUSION);
      m.reset(axisAngle(1, 0, 0, (s * 30 * Math.PI) / 180));
      for (let i = 0; i < 16000; i++) m.update(1 / 1000, 0, 0, 0, 0, G0, 0);
      expect(tiltError(m)).toBeLessThan(1);
    }
  });

  it('integrates the gyro alone when the accelerometer is not trustworthy', () => {
    const m = new Mahony(DEFAULT_IMU_FUSION);
    m.reset([0, 0, 0, 1]);
    for (let i = 0; i < 1000; i++) m.update(1 / 1000, 0, 1, 0, 0, 0, 0);
    const out: Vec3 = [0, 0, 0];
    quatRotateInv(m.q, 0, 0, -1, out);
    expect(out[0]).toBeCloseTo(Math.sin(1), 9);
    expect(out[2]).toBeCloseTo(-Math.cos(1), 9);
  });

  it('ignores an accelerometer far from 1 g (hard manoeuvres, impacts)', () => {
    const m = new Mahony(DEFAULT_IMU_FUSION);
    m.reset(axisAngle(0, 0, 1, (20 * Math.PI) / 180));
    for (let i = 0; i < 5000; i++) m.update(1 / 1000, 0, 0, 0, 0, 2 * G0, 0);
    expect(tiltError(m)).toBeGreaterThan(19.9);
  });

  it('keeps a unit quaternion', () => {
    const m = new Mahony(DEFAULT_IMU_FUSION);
    for (let i = 0; i < 200000; i++) m.update(1 / 4000, 3, -2, 5, 1, G0, -2);
    expect(Math.hypot(m.q[0], m.q[1], m.q[2], m.q[3])).toBeCloseTo(1, 9);
  });
});
