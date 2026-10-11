import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../contracts';
import { axisAngle, pose, rotate } from './math';
import { ParkCollision, PartBVH } from './collision';
import type { ParkRuntime } from './runtime';
import type { BodyPose, ParkPart } from './types';

const part = (index: number): ParkPart => ({ shape: 'box', pos: [index % 5 - 2, (index % 7) * 0.2, Math.floor(index / 5) - 6], half: [0.1 + index % 3, 0.2, 0.4], rot: axisAngle([0, 1, 0], index * 0.37), color: [0, 0, 0], roughness: 1, metalness: 0, emissive: 0, solid: true, detail: 0, body: index % 2 });
const copyPose = (to: BodyPose, from: BodyPose) => { to.pos = [...from.pos]; to.rot = [...from.rot]; to.vel = [...from.vel]; to.omega = [...from.omega]; };
const expectedBounds = (p: ParkPart, current: BodyPose, previous: BodyPose): number[] => {
  const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const body of [current, previous]) {
    const margin = 0.01 + 0.5 * body.omega.reduce((sum, n) => sum + n * n, 0) * (Math.hypot(...p.pos) + Math.hypot(...p.half)) * 0.004 ** 2;
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
      const local = rotate(p.rot, [x * p.half[0], y * p.half[1], z * p.half[2]]);
      for (let k = 0; k < 3; k++) local[k] += p.pos[k]; const point = rotate(body.rot, local);
      for (let k = 0; k < 3; k++) { point[k] += body.pos[k]; box[k] = Math.min(box[k], point[k] - margin); box[k + 3] = Math.max(box[k + 3], point[k] + margin); }
    }
  }
  return box;
};

describe('exact cached rigid-body collision broad phase', () => {
  it('updates dirty BVH ancestors without missing a moved leaf or changing untouched leaf bounds', () => {
    const items = Array.from({ length: 64 }, (_, i) => part(i)), boxes = Float64Array.from(items.flatMap((_, i) => [i * 3, 0, 0, i * 3 + 1, 1, 1]));
    const sparse = new PartBVH(items, boxes), full = new PartBVH(items, boxes);
    boxes.set([-12, -2, -1, -11, 3, 2], 31 * 6); boxes.set([240, -5, -5, 250, 5, 5], 1 * 6);
    sparse.refit(new Int32Array([31, 1]), 2); full.refit(); expect(sparse.bounds).toEqual(full.bounds);
    const before = sparse.bounds.slice(); sparse.refit(new Int32Array(0)); expect(sparse.bounds).toEqual(before);
    const hits: number[] = []; sparse.query(-11.5, 0, 0, 0.01, i => hits.push(i)); expect(hits).toEqual([31]);
  });
  it('matches brute-force endpoint corners through motion, stops, angular-margin changes and skipped ticks', () => {
    const parts = Array.from({ length: 48 }, (_, i) => part(i)), bodies = [pose(), pose()], previousBodies = [pose(), pose()];
    for (const body of [...bodies, ...previousBodies]) body.pos[1] = 20;
    const runtime = { park: { parts, rides: [{ pos: [0, 12, 0], radius: 100, height: 100 }] }, bodies, previousBodies, tick: 0, elapsed: 0,
      crowd: { avoidObstacles: undefined, neighbors() {} }, bodyPose(index: number, _time: number, out: BodyPose) { copyPose(out, bodies[index]); return out; },
    } as unknown as ParkRuntime;
    const collision = new ParkCollision(runtime), result = { normal: [0, 0, 0] as Vec3, velocity: [0, 0, 0] as Vec3, penetration: 0, friction: 0, restitution: 0 };
    const check = () => {
      collision.contact(0, 20, 0, 0.02, result);
      const expected = parts.map(p => expectedBounds(p, bodies[p.body], previousBodies[p.body]));
      for (let node = 0; node < collision.dynamicTree.leaves.length; node++) {
        const item = collision.dynamicTree.leaves[node]; if (item < 0) continue;
        for (let k = 0; k < 6; k++) expect(collision.dynamicTree.bounds[node * 6 + k]).toBeCloseTo(expected[item][k], 10);
      }
      for (let i = 0; i < 24; i++) {
        const q: Vec3 = [i % 7 - 3, 17 + i % 6, i % 13 - 6], radius = 0.7, actual: number[] = [];
        collision.dynamicTree.query(...q, radius, id => actual.push(id));
        const wanted = expected.flatMap((box, id) => q.every((v, k) => v + radius >= box[k] && v - radius <= box[k + 3]) ? [id] : []);
        expect(actual.sort((a, b) => a - b)).toEqual(wanted);
      }
    };
    check();
    for (let step = 1; step <= 4; step++) {
      for (let i = 0; i < bodies.length; i++) { copyPose(previousBodies[i], bodies[i]); bodies[i].rot = axisAngle([0, 0, 1], step * 0.3 * (i + 1)); bodies[i].pos[0] = step * 0.4; bodies[i].omega = [0, 0, 75 * (i + 1)]; }
      runtime.tick++; check();
    }
    for (let i = 0; i < bodies.length; i++) { copyPose(previousBodies[i], bodies[i]); bodies[i].omega = [0, 0, 0]; }
    runtime.tick++; check();
    for (let i = 0; i < bodies.length; i++) copyPose(previousBodies[i], bodies[i]); runtime.tick++; check();
    const paused = collision.dynamicTree.bounds.slice(); runtime.tick++; check(); expect(collision.dynamicTree.bounds).toEqual(paused);
    previousBodies[0].pos = [-20, 18, 1]; bodies[0].pos = [12, 25, 3]; bodies[0].rot = axisAngle([1, 0, 0], 1.1); runtime.tick += 20; check();
  });
});
