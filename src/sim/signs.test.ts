import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../contracts';
import { QUAD_X_SPIN, QUAD_5IN_6S } from './presets';
import { quatRotate } from './math3d';
import { QuadPhysics } from './quad';
import { RAD2DEG, airborneQuad, fcRate, inp, run, type Axis } from './testkit';

const cfg = QUAD_5IN_6S;
const HOVER = 0.29;

function bodyToWorld(q: QuadPhysics, x: number, y: number, z: number): Vec3 {
  const o: Vec3 = [0, 0, 0];
  quatRotate(q.state.quat, x, y, z, o);
  return o;
}

/** Replace the flight controller output by fixed per-motor duties (open loop), keeping it armed. */
function openLoop(q: QuadPhysics, duty: (i: number) => number): void {
  q.fc.update = () => {
    q.fc.armed = true;
    for (let i = 0; i < 4; i++) q.fc.motors[i] = duty(i);
  };
}

/** Quad in calm air at y = 300 running open loop at a hover-ish common duty so that props are spinning at rest. */
function openLoopQuad(base: number): QuadPhysics {
  const q = new QuadPhysics(cfg);
  q.setWind({ meanSpeed: 0, turbulence: 0, gustsPerMinute: 0 });
  q.reset([0, 300, 0], 0);
  openLoop(q, () => base);
  run(q, 0.3, inp());
  return q;
}

describe('motor layout and spin directions', () => {
  it('motors are 0 FR, 1 RR, 2 RL, 3 FL with FR and RL clockwise', () => {
    const p = cfg.motorPos;
    expect(p[0][0]).toBeGreaterThan(0);
    expect(p[0][2]).toBeLessThan(0);
    expect(p[1][0]).toBeGreaterThan(0);
    expect(p[1][2]).toBeGreaterThan(0);
    expect(p[2][0]).toBeLessThan(0);
    expect(p[2][2]).toBeGreaterThan(0);
    expect(p[3][0]).toBeLessThan(0);
    expect(p[3][2]).toBeLessThan(0);
    expect([...cfg.motorSpin]).toEqual([...QUAD_X_SPIN]);
    expect(QUAD_X_SPIN).toEqual([-1, 1, -1, 1]);
  });

  it('the CoM sits within 3 mm of the motor-plane centre', () => {
    const sum = [0, 0, 0];
    for (const m of cfg.motorPos) for (let a = 0; a < 3; a += 2) sum[a] += m[a];
    expect(Math.abs(sum[0]) / 4).toBeLessThan(0.003);
    expect(Math.abs(sum[2]) / 4).toBeLessThan(0.003);
  });
});

describe('open-loop torque signs (body axes of QuadState.angVel)', () => {
  const kick = (dutyOf: (i: number) => number): Vec3 => {
    const q = openLoopQuad(0.4);
    const w0: Vec3 = [q.state.angVel[0], q.state.angVel[1], q.state.angVel[2]];
    openLoop(q, dutyOf);
    run(q, 0.03, inp());
    return [q.state.angVel[0] - w0[0], q.state.angVel[1] - w0[1], q.state.angVel[2] - w0[2]];
  };

  it('front motors faster pitches the nose up (wx > 0), rear motors faster pitches it down', () => {
    expect(kick((i) => (i === 0 || i === 3 ? 0.46 : 0.4))[0]).toBeGreaterThan(0.5);
    expect(kick((i) => (i === 1 || i === 2 ? 0.46 : 0.4))[0]).toBeLessThan(-0.5);
  });

  it('right motors faster rolls left (wz > 0), left motors faster rolls right', () => {
    expect(kick((i) => (i === 0 || i === 1 ? 0.46 : 0.4))[2]).toBeGreaterThan(0.5);
    expect(kick((i) => (i === 2 || i === 3 ? 0.46 : 0.4))[2]).toBeLessThan(-0.5);
  });

  it('clockwise props (FR, RL) faster yaws left (wy > 0), counter-clockwise faster yaws right', () => {
    expect(kick((i) => (i === 0 || i === 2 ? 0.46 : 0.4))[1]).toBeGreaterThan(0.5);
    expect(kick((i) => (i === 1 || i === 3 ? 0.46 : 0.4))[1]).toBeLessThan(-0.5);
  });

  it('a symmetric change of all four motors produces almost no rotation', () => {
    const w = kick(() => 0.5);
    expect(Math.abs(w[0])).toBeLessThan(0.5);
    expect(Math.abs(w[1])).toBeLessThan(0.5);
    expect(Math.abs(w[2])).toBeLessThan(0.5);
  });

  it('the CW and CCW pairs cancel in yaw torque at equal duty', () => {
    const q = openLoopQuad(0.4);
    run(q, 0.2, inp());
    expect(Math.abs(q.state.angVel[1])).toBeLessThan(0.1);
  });
});

describe('rotor inertia reaction (vacuum: only rotor spin-up torque acts on the frame)', () => {
  it('spinning up the clockwise pair kicks the frame left by J*sum(w)/Iyy, conserving angular momentum', () => {
    const q = new QuadPhysics(cfg);
    q.setAtmosphere(50000, -50);
    q.setWind({ meanSpeed: 0, turbulence: 0, gustsPerMinute: 0 });
    q.reset([0, 300, 0], 0);
    openLoop(q, (i) => (i === 0 || i === 2 ? 0.5 : 0));
    run(q, 0.15, inp());
    let h = 0;
    for (let i = 0; i < 4; i++) h += cfg.motor.inertia * cfg.motorSpin[i] * q.motors[i].omega;
    expect(h).toBeLessThan(0);
    expect(q.state.angVel[1]).toBeGreaterThan(5);
    expect(q.state.angVel[1] * cfg.inertia[1] + h).toBeCloseTo(0, 2);
    expect(Math.abs(q.state.angVel[1] * cfg.inertia[1] + h) / Math.abs(h)).toBeLessThan(0.05);
  });

  it('braking a spinning rotor kicks the frame the other way', () => {
    const q = new QuadPhysics(cfg);
    q.setAtmosphere(50000, -50);
    q.setWind({ meanSpeed: 0, turbulence: 0, gustsPerMinute: 0 });
    q.reset([0, 300, 0], 0);
    openLoop(q, (i) => (i === 1 ? 0.5 : 0));
    run(q, 0.15, inp());
    const spun = q.state.angVel[1];
    expect(spun).toBeLessThan(-5);
    openLoop(q, () => 0);
    run(q, 0.15, inp());
    expect(q.state.angVel[1]).toBeGreaterThan(spun + 3);
  });
});

describe('closed-loop stick signs in acro', () => {
  const settle = (axis: Axis, sign: number): { q: QuadPhysics; rate: number } => {
    const q = airborneQuad(cfg, HOVER);
    const stick = 0.25 * sign;
    run(q, 0.12, inp({ throttle: HOVER, [axis]: stick }));
    return { q, rate: fcRate(q, axis) };
  };

  it('roll stick right rolls right: wz < 0, thrust tilts to +X, quad drifts east', () => {
    const { q, rate } = settle('roll', 1);
    expect(rate).toBeGreaterThan(20);
    expect(q.state.angVel[2]).toBeLessThan(0);
    expect(bodyToWorld(q, 0, 1, 0)[0]).toBeGreaterThan(0.05);
    run(q, 0.3, inp({ throttle: HOVER, roll: 0 }));
    expect(q.state.vel[0]).toBeGreaterThan(0);
  });

  it('roll stick left is the mirror image', () => {
    const { q, rate } = settle('roll', -1);
    expect(rate).toBeLessThan(-20);
    expect(q.state.angVel[2]).toBeGreaterThan(0);
    expect(bodyToWorld(q, 0, 1, 0)[0]).toBeLessThan(-0.05);
  });

  it('pitch stick forward is nose down: wx < 0, thrust tilts to -Z (forward), quad flies forward', () => {
    const { q, rate } = settle('pitch', 1);
    expect(rate).toBeGreaterThan(20);
    expect(q.state.angVel[0]).toBeLessThan(0);
    expect(bodyToWorld(q, 0, 1, 0)[2]).toBeLessThan(-0.05);
    run(q, 0.3, inp({ throttle: HOVER, pitch: 0 }));
    expect(q.state.vel[2]).toBeLessThan(0);
  });

  it('pitch stick back is nose up and flies backward', () => {
    const { q, rate } = settle('pitch', -1);
    expect(rate).toBeLessThan(-20);
    expect(q.state.angVel[0]).toBeGreaterThan(0);
    expect(bodyToWorld(q, 0, 1, 0)[2]).toBeGreaterThan(0.05);
  });

  it('yaw stick right turns the nose right (clockwise from above): wy < 0, nose swings from -Z towards +X', () => {
    const { q, rate } = settle('yaw', 1);
    expect(rate).toBeGreaterThan(20);
    expect(q.state.angVel[1]).toBeLessThan(0);
    run(q, 0.3, inp({ throttle: HOVER, yaw: 0.25 }));
    const nose = bodyToWorld(q, 0, 0, -1);
    expect(nose[0]).toBeGreaterThan(0.05);
    expect(Math.abs(nose[1])).toBeLessThan(0.05);
  });

  it('yaw stick left turns the nose left', () => {
    const { q, rate } = settle('yaw', -1);
    expect(rate).toBeLessThan(-20);
    expect(q.state.angVel[1]).toBeGreaterThan(0);
    run(q, 0.3, inp({ throttle: HOVER, yaw: -0.25 }));
    expect(bodyToWorld(q, 0, 0, -1)[0]).toBeLessThan(-0.05);
  });

  it('more throttle climbs and less throttle sinks', () => {
    const up = airborneQuad(cfg, HOVER);
    run(up, 0.4, inp({ throttle: 0.6 }));
    expect(up.state.vel[1]).toBeGreaterThan(3);
    const down = airborneQuad(cfg, HOVER);
    run(down, 0.4, inp({ throttle: 0.1 }));
    expect(down.state.vel[1]).toBeLessThan(-1);
  });

  it('with no stick input the quad holds attitude and heading in a hover', () => {
    const q = airborneQuad(cfg, HOVER);
    run(q, 1, inp({ throttle: HOVER }));
    for (const a of ['roll', 'pitch', 'yaw'] as const) expect(Math.abs(fcRate(q, a))).toBeLessThan(2);
    expect(bodyToWorld(q, 0, 1, 0)[1]).toBeGreaterThan(0.9999);
    expect(RAD2DEG * Math.acos(Math.min(1, bodyToWorld(q, 0, 1, 0)[1]))).toBeLessThan(1);
  });
});
