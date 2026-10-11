import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../contracts';
import { createTerrainSampler } from '../terrain/sampler';
import { testTerrainData } from '../track/testTerrain';
import { ParkCollision } from './collision';
import { SweptBodyBounds } from './collisionMotion';
import { generatePark, gradeParkTerrain } from './generator';
import { add, axisAngle, clamp, pose, rotate } from './math';
import { defaultParkRecipe } from './recipe';
import { PARK_DT } from './ridePhysics';
import { ParkRuntime } from './runtime';
import type { BodyPose, EnvironmentContact, ParkPart } from './types';

const contact = (): EnvironmentContact => ({ normal: [0, 0, 0], velocity: [0, 0, 0], penetration: 0, friction: 0, restitution: 0 });
/** Previous exhaustive primitive-by-primitive CCD, used as an independent oracle for the new nearest-union path. */
function primitiveSweep(collision: ParkCollision, from: Vec3, to: Vec3, radius: number, dt: number): number {
  const delta = to.map((v, k) => v - from[k]), length = Math.hypot(...delta); let earliest = 1;
  for (const p of collision.dynamics) {
    const b = collision.runtime.bodies[p.body], speed = length + (Math.hypot(...b.vel) + Math.hypot(...b.omega) * (Math.hypot(...p.pos) + Math.hypot(...p.half))) * dt;
    let t = 0;
    for (let iteration = 0; iteration < 48 && t < earliest; iteration++) {
      const d = collision['distance'](p, from[0] + delta[0] * t, from[1] + delta[1] * t, from[2] + delta[2] * t, collision.runtime.elapsed - dt * (1 - t)) - radius;
      if (d < 0.00005) { if (t >= 1e-6) earliest = t; break; }
      t += Math.max(0.00001, d / Math.max(speed, 1e-9) * 0.9);
    }
  }
  return earliest;
}
function brute(collision: ParkCollision): void {
  collision['queryMoving'] = (_x, _y, _z, _radius, visit) => { for (const p of collision.dynamics) visit(p); };
}
describe('rigid-body hierarchy collision parity', () => {
  it('preserves thin translated/rotated primitive sphere and ray contacts without an authored ride-radius cutoff', () => {
    const at = (body: number, alpha: number): BodyPose => ({ pos: [800 + body * 13 + alpha * 0.02, 120 + alpha * 0.01, -600 + body * 7],
      rot: axisAngle([0, 1, 0], body * 0.3 + alpha * 0.03), vel: [5, 2.5, 0], omega: [0, 7.5, 0] });
    const bodies = [0, 1, 2].map(i => at(i, 1)), previousBodies = [0, 1, 2].map(i => at(i, 0));
    const parts: ParkPart[] = Array.from({ length: 48 }, (_, i) => ({ shape: (['box', 'cylinder', 'sphere', 'cone'] as const)[i % 4], body: i % 3,
      pos: [Math.floor(i / 3) * 0.8, (i % 2) * 0.3, 0], half: [0.006, 0.12, 0.006], rot: axisAngle([0, 0, 1], i * 0.17),
      color: [0, 0, 0], roughness: 1, metalness: 0.5, emissive: 0, detail: 0, solid: true }));
    const runtime = { park: { parts, rides: [{ pos: [0, 12, 0], radius: 10, height: 10 }] }, bodies, previousBodies, tick: 1, elapsed: 0,
      crowd: { avoidObstacles: undefined, neighbors() {} }, bodyPose(index: number, time: number, out: BodyPose) { Object.assign(out, at(index, clamp(time / PARK_DT, 0, 1))); return out; },
    } as unknown as ParkRuntime;
    const indexed = new ParkCollision(runtime), exhaustive = new ParkCollision(runtime); brute(exhaustive);
    for (const alpha of [0, 0.23, 0.67, 1]) {
      runtime.elapsed = alpha * PARK_DT;
      for (const p of parts) {
        const b = at(p.body, alpha), center = add(b.pos, rotate(b.rot, p.pos));
        for (const offset of [0, 0.01, 0.07]) {
          const q = add(center, rotate(b.rot, rotate(p.rot, [p.half[0] + offset, 0, 0]))), actual = contact(), expected = contact();
          expect(indexed.contact(...q, 0.012, actual)).toBe(exhaustive.contact(...q, 0.012, expected));
          expect(actual.penetration).toBeCloseTo(expected.penetration, 11);
          if (actual.penetration) { for (let k = 0; k < 3; k++) { expect(actual.normal[k]).toBeCloseTo(expected.normal[k], 10); expect(actual.velocity[k]).toBeCloseTo(expected.velocity[k], 10); } }
        }
        const direction = rotate(b.rot, rotate(p.rot, [0.2, 0, 0])), from = center.map((v, k) => v - direction[k]) as Vec3, to = add(center, direction);
        for (const radius of [0, 0.003]) {
          indexed.setStep(0.001); exhaustive.setStep(0.001);
          const actual = indexed.sweep(from, to, radius, contact()), expected = primitiveSweep(exhaustive, from, to, radius, 0.001);
          expect(actual < 1).toBe(expected < 1);
          expect(Math.abs(actual - expected) * 0.4).toBeLessThan(0.0001); // Each CCD path uses the same50µm surface threshold.
        }
      }
    }
    expect(indexed['diagnosticTree'], 'Production queries must never materialize the per-primitive world tree').toBeUndefined();
  });

  it('ignores only initially overlapping shapes and retains later hits after grazing advancement stalls', () => {
    const body = pose(); body.pos = [800, 120, -600];
    const makePart = (pos: Vec3, half: Vec3): ParkPart => ({ shape: 'box', pos, half, body: 0, rot: [0, 0, 0, 1], color: [0, 0, 0], roughness: 1, metalness: 0, emissive: 0, solid: true, detail: 0 });
    const runtime = { park: { parts: [makePart([0, 0, 0], [0.2, 0.2, 0.2]), makePart([1, 0, 0], [0.1, 1, 1])], rides: [] }, bodies: [body], previousBodies: [body], tick: 1, elapsed: PARK_DT,
      crowd: { avoidObstacles: undefined, neighbors() {} }, bodyPose(_index: number, _time: number, out: BodyPose) { Object.assign(out, body); return out; },
    } as unknown as ParkRuntime;
    let collision = new ParkCollision(runtime); collision.setStep(0.001);
    const from = body.pos, to = add(from, [2, 0, 0]);
    expect(collision.sweep(from, to, 0.05, contact())).toBeCloseTo(0.425, 4);
    runtime.park.parts = [makePart([0, -1.10007, 0], [20, 1, 2]), makePart([1, 0, 0], [0.1, 1, 1])];
    collision = new ParkCollision(runtime); collision.setStep(0.001);
    expect(collision.sweep(from, to, 0.1, contact())).toBeCloseTo(0.4, 4);
    expect(primitiveSweep(collision, from, to, 0.1, 0.001)).toBeCloseTo(0.4, 4);
  });

  it('encloses nonlinear FK over complete angle intervals, nested hinges and every coaster family', () => {
    const recipe = { ...defaultParkRecipe(1337), guests: 0 };
    const park = generatePark(recipe, createTerrainSampler(gradeParkTerrain(testTerrainData({ resolution: 64, cellSize: 32 }), recipe)));
    const runtime = new ParkRuntime(park); runtime.tick = 1;
    // Multiple quarter-turn extrema and generous non-physical increments make endpoint-only bounds fail conspicuously.
    for (const ride of park.rides) {
      const s = runtime.rides[ride.id]; s.previousTheta = -2.1; s.theta = 3.7; s.previousPhi = -0.7; s.phi = 1.3;
      s.previousY = 2; s.y = ride.height; s.previousHinges.fill(-1.2); s.hinges.fill(1.1); s.previousRestraints.fill(0);
      for (const train of s.trains) { train.restraint = 1; if (ride.curve) { train.previousS = ride.curve.length - 3; train.s = ride.curve.length + 5; } }
    }
    const bounds = new SweptBodyBounds(runtime), boxes = new Float64Array(park.bodies.length * 6), p = pose(); bounds.begin();
    for (let i = 0; i < park.bodies.length; i++) bounds.bounds(i, 0.75, boxes, i * 6);
    for (const alpha of [0, 0.001, 0.17, 0.37, 0.5, 0.73, 0.91, 0.999, 1]) for (let i = 0; i < park.bodies.length; i++) {
      runtime.bodyPose(i, alpha * PARK_DT, p);
      for (let k = 0; k < 3; k++) {
        expect(p.pos[k] - 0.75, `${park.rides[park.bodies[i].ride].family}/${park.bodies[i].role}/${i}/${alpha}`).toBeGreaterThanOrEqual(boxes[i * 6 + k]);
        expect(p.pos[k] + 0.75).toBeLessThanOrEqual(boxes[i * 6 + k + 3]);
      }
    }
    // Use the same real articulated bodies for a sparse exact-geometry candidate parity check at an interior pose.
    const moving = park.parts.filter(p => p.body >= 0 && p.solid), indexed = new ParkCollision(runtime);
    runtime.elapsed = 0.37 * PARK_DT; indexed['sync']();
    for (let i = 0; i < moving.length; i += 137) {
      const part = moving[i], b = runtime.bodyPose(part.body, runtime.elapsed, pose()), point = add(b.pos, rotate(b.rot, part.pos)), found: ParkPart[] = [];
      indexed['queryMoving'](...point, 0.0001, p => found.push(p));
      expect(found, `${park.rides[park.bodies[part.body].ride].family} omitted its actual primitive centre`).toContain(part);
    }
  }, 30000);
});
