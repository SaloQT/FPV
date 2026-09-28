import { describe, expect, it } from 'vitest';
import type { Quat, Vec3 } from '../contracts';
import { G0, quatRotate } from './math3d';
import { QUAD_5IN_6S, type QuadConfig } from './presets';
import { QuadPhysics } from './quad';
import { DT, airborneQuad, inp, run } from './testkit';

const cfg = QUAD_5IN_6S;
const NO_DAMPING: QuadConfig = { ...cfg, aero: { ...cfg.aero, angularDamping: [0, 0, 0], angularDampingQuad: 0, linearDrag: 0 } };

function vacuumQuad(c: QuadConfig, pos: Vec3, vel: Vec3, w: Vec3): QuadPhysics {
  const q = new QuadPhysics(c);
  q.setAtmosphere(50000, -50);
  q.setWind({ meanSpeed: 0, turbulence: 0, gustsPerMinute: 0 });
  q.reset(pos, 0);
  q.setAttitude([0, 0, 0, 1]);
  for (let i = 0; i < 3; i++) {
    q.state.vel[i] = vel[i];
    q.state.angVel[i] = w[i];
  }
  return q;
}

function rotEnergy(q: QuadPhysics, c: QuadConfig): number {
  const w = q.state.angVel, I = c.inertia;
  return 0.5 * (I[0] * w[0] ** 2 + I[1] * w[1] ** 2 + I[2] * w[2] ** 2);
}

function energy(q: QuadPhysics, c: QuadConfig): number {
  const v = q.state.vel;
  return 0.5 * c.mass * (v[0] ** 2 + v[1] ** 2 + v[2] ** 2) + rotEnergy(q, c) + c.mass * G0 * q.state.pos[1];
}

function worldMomentum(q: QuadPhysics, c: QuadConfig): Vec3 {
  const w = q.state.angVel, I = c.inertia;
  const out: Vec3 = [0, 0, 0];
  quatRotate(q.state.quat, I[0] * w[0], I[1] * w[1], I[2] * w[2], out);
  return out;
}

function quatError(a: Quat, b: Quat): number {
  const d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return 2 * Math.acos(Math.min(1, d));
}

describe('vacuum conservation laws', () => {
  it('the air is thin enough at 50 km that drag is negligible', () => {
    const q = vacuumQuad(cfg, [0, 0, 0], [0, 0, 0], [0, 0, 0]);
    expect(q.state.pos[1]).toBe(0);
    q.step(DT, inp({ armed: false }));
    expect(q['rho']).toBeLessThan(1e-5);
  });

  it('a tumbling body with no damping conserves energy and angular momentum (world vector and magnitude)', () => {
    const q = vacuumQuad(NO_DAMPING, [0, 1000, 0], [1.5, 6, -2], [7, 3, -9]);
    const e0 = energy(q, NO_DAMPING), r0 = rotEnergy(q, NO_DAMPING);
    const l0 = worldMomentum(q, NO_DAMPING);
    const n0 = Math.hypot(...l0);
    let worstR = 0, worstL = 0, worstN = 0;
    for (let k = 0; k < 12; k++) {
      run(q, 0.25, inp({ armed: false }));
      const l = worldMomentum(q, NO_DAMPING);
      worstR = Math.max(worstR, Math.abs(rotEnergy(q, NO_DAMPING) - r0) / r0);
      worstL = Math.max(worstL, Math.hypot(l[0] - l0[0], l[1] - l0[1], l[2] - l0[2]) / n0);
      worstN = Math.max(worstN, Math.abs(Math.hypot(...l) - n0) / n0);
    }
    const semiImplicit = 0.5 * NO_DAMPING.mass * G0 * G0 * DT * DT * 12000;
    const total = Math.abs(energy(q, NO_DAMPING) - e0);
    console.log(`[vacuum] rot energy drift ${worstR.toExponential(2)}, |L| ${worstN.toExponential(2)}, L vector ${worstL.toExponential(2)}, total ${total.toExponential(2)} J vs Euler bound ${semiImplicit.toExponential(2)} J`);
    expect(worstR).toBeLessThan(1e-3);
    expect(worstN).toBeLessThan(1e-3);
    expect(worstL).toBeLessThan(1e-3);
    expect(total).toBeLessThan(1.5 * semiImplicit);
    expect(Math.hypot(...q.state.quat)).toBeCloseTo(1, 10);
  });

  it('the centre of mass follows the ballistic parabola to within 2 cm over 3 s', () => {
    const q = vacuumQuad(NO_DAMPING, [0, 500, 0], [4, 12, -3], [0, 0, 0]);
    run(q, 3, inp({ armed: false }));
    const t = 3;
    expect(Math.abs(q.state.pos[0] - 4 * t)).toBeLessThan(0.02);
    expect(Math.abs(q.state.pos[1] - (500 + 12 * t - 0.5 * G0 * t * t))).toBeLessThan(0.02);
    expect(Math.abs(q.state.pos[2] + 3 * t)).toBeLessThan(0.02);
    expect(Math.abs(q.state.vel[1] - (12 - G0 * t))).toBeLessThan(0.01);
  });

  it('a constant yaw rate about a principal axis rotates exactly (10 rad/s for 2 s)', () => {
    const q = vacuumQuad(NO_DAMPING, [0, 1000, 0], [0, 0, 0], [0, 10, 0]);
    run(q, 2, inp({ armed: false }));
    const half = 10;
    const exact: Quat = [0, Math.sin(half), 0, Math.cos(half)];
    expect(quatError(q.state.quat, exact)).toBeLessThan(1e-6);
    expect(q.state.angVel[1]).toBeCloseTo(10, 9);
  });

  it('spin about the intermediate axis is unstable but still conserves energy', () => {
    const I = NO_DAMPING.inertia;
    const order = [0, 1, 2].sort((a, b) => I[a] - I[b]);
    const mid = order[1];
    const w: Vec3 = [0.05, 0.05, 0.05];
    w[mid] = 12;
    const q = vacuumQuad(NO_DAMPING, [0, 1000, 0], [0, 0, 0], w);
    const e0 = rotEnergy(q, NO_DAMPING);
    let flipped = false;
    for (let k = 0; k < 40; k++) {
      run(q, 0.1, inp({ armed: false }));
      if (q.state.angVel[mid] < 0) flipped = true;
    }
    expect(flipped).toBe(true);
    expect(Math.abs(rotEnergy(q, NO_DAMPING) - e0) / e0).toBeLessThan(1e-3);
  });
});
