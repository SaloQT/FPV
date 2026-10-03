import { describe, expect, it } from 'vitest';
import type { ObstacleCollider, Quat, Vec3 } from '../contracts';
import { CollisionWorld, type CollisionParams } from './collision';
import { flatTerrain } from './testkit';
// Frozen pre-optimization solver: a full-resolve oracle, not a second cache implementation.
import { CollisionWorld as LinearWorld } from './fixtures/collisionLinear';

const params: CollisionParams = {
  spheres: Array.from({ length: 5 }, (_, i) => ({ x: (i % 2 ? -1 : 1) * .12, y: 0, z: (i < 2 ? -1 : 1) * .12, r: .05, motor: i < 4 ? i : -1 })),
  terrainFriction: .6, terrainRestitution: .1, obstacleFriction: .5, obstacleRestitution: .2, crashSpeed: 4, propStrikeTorque: .02,
};
function rng(seed = 47291) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}
function boxes(n: number, seed = 13): ObstacleCollider[] {
  const r = rng(seed);
  return Array.from({ length: n }, () => ({ kind: 'box', center: [(r() - .5) * 200, r() * 20, (r() - .5) * 200], half: [.1 + r() * 2, .1 + r() * 3, .1 + r() * 2], yaw: r() * 7 }));
}
function compare(a: CollisionWorld, b: LinearWorld, pos: Vec3, vel: Vec3, q: Quat, w: Vec3) {
  const p0: Vec3 = [...pos], v0: Vec3 = [...vel], w0: Vec3 = [...w];
  a.resolve(.00025, 1.4, [250, 180, 200], pos, vel, q, w);
  b.resolve(.00025, 1.4, [250, 180, 200], p0, v0, q, w0);
  expect([pos, vel, w, a.impactSpeed, a.onGround, a.contactCount, [...a.motorLoad]])
    .toEqual([p0, v0, w0, b.impactSpeed, b.onGround, b.contactCount, [...b.motorLoad]]);
}
function pair(list: ObstacleCollider[]) {
  const a = new CollisionWorld(params), b = new LinearWorld(params);
  a.setColliders(list); b.setColliders(list);
  return { a, b };
}

describe('exact conservative collision broadphase', () => {
  it('matches full linear resolve through seeded trajectories, impacts and cache changes', () => {
    const r = rng(), list = boxes(1000);
    const { a, b } = pair(list);
    const terrain = { ...flatTerrain(0), heightAt: (x: number, z: number) => .1 * Math.sin(x) * Math.cos(z), normalAt: () => [0, 1, 0] as Vec3 };
    a.terrain = b.terrain = terrain;
    for (let trajectory = 0; trajectory < 120; trajectory++) {
      const center = list[trajectory].center;
      const pos: Vec3 = [...center], vel: Vec3 = [(r() - .5) * 20, -r() * 10, (r() - .5) * 20], w: Vec3 = [r(), r(), r()];
      const q: Quat = [r() - .5, r() - .5, r() - .5, r() - .5];
      const norm = Math.hypot(...q); for (let i = 0; i < 4; i++) q[i] /= norm;
      for (let step = 0; step < 60; step++) {
        for (let i = 0; i < 3; i++) pos[i] += vel[i] * .01;
        vel[1] -= .0981;
        compare(a, b, pos, vel, q, w);
      }
    }
  });

  it('preserves first-32 ordering, contact cap, large boxes and exact boundaries', () => {
    const list = boxes(200);
    for (let i = 0; i < 50; i++) list.splice(i * 2, 0, { kind: 'box', center: [-8 + i * .001, 8, -16], half: [.15, .2, .15], yaw: i * .1 });
    list.push({ kind: 'box', center: [500, 500, 500], half: [1000, 1000, 1000], yaw: 0 });
    const { a, b } = pair(list);
    for (const edge of [-16, -8, 0, 8, 16]) for (const epsilon of [-1e-12, 0, 1e-12]) {
      compare(a, b, [edge + epsilon, 8, -16], [1, -2, 3], [0, 0, 0, 1], [.1, .2, .3]);
    }
    compare(a, b, [-8, 8, -16], [1, -2, 3], [0, 0, 0, 1], [.1, .2, .3]);
    expect(a.contactCount).toBe(64);
  });

  it('selects precisely the linear first-32 IDs across scales and reach/cell boundaries', () => {
    const r = rng(32);
    for (const scale of [1e-10, 1, 8, 100, 1e6, 1e12]) {
      const list: ObstacleCollider[] = Array.from({ length: 500 }, () => ({ kind: 'box', center: [(r() - .5) * scale, (r() - .5) * scale, (r() - .5) * scale], half: [r() * scale * .02, r() * scale * .02, r() * scale * .02], yaw: r() }));
      const world = new CollisionWorld(params);
      world.setColliders(list);
      const cache = world as unknown as { gatherNearBoxes(pos: Vec3): number; nearBox: Int32Array };
      for (let step = 0; step < 600; step++) {
        const c = list[step % list.length];
        const reach = Math.hypot(...c.half) + .2;
        const pos: Vec3 = step % 2 ? [c.center[0] + reach * (1 + (step % 3 - 1) * Number.EPSILON), c.center[1], c.center[2]] : [(r() - .5) * scale, (r() - .5) * scale, (r() - .5) * scale];
        const expected: number[] = [];
        for (let b = 0; b < list.length && expected.length < 32; b++) {
          const box = list[b], dx = pos[0] - box.center[0], dy = pos[1] - box.center[1], dz = pos[2] - box.center[2];
          const reach = Math.hypot(...box.half) + .2;
          if (dx * dx + dy * dy + dz * dz < reach * reach) expected.push(b);
        }
        const n = cache.gatherNearBoxes(pos);
        expect([...cache.nearBox.slice(0, n)]).toEqual(expected);
      }
    }
  });

  it('invalidates cached candidates on same-cell replacement and empty/small lists', () => {
    const { a, b } = pair(boxes(100));
    for (const n of [100, 300, 0, 1, 63, 64, 200]) {
      const list = boxes(n, n);
      if (n) list[n - 1] = { kind: 'box', center: [0, 4, 0], half: [.2, .2, .2], yaw: .4 };
      a.setColliders(list); b.setColliders(list);
      compare(a, b, [0, 4, 0], [1, -2, 3], [0, 0, 0, 1], [0, 0, 0]);
    }
  });

  it('falls back for highly overlapping sets and resets on collider replacement', () => {
    const dense: ObstacleCollider[] = Array.from({ length: 6000 }, () => ({ kind: 'box', center: [0, 0, 0], half: [1000, 1000, 1000], yaw: 0 }));
    const { a, b } = pair(dense);
    const state = a as unknown as { boxCacheDisabled: boolean };
    for (let i = 0; i < 100; i++) compare(a, b, [i % 2 ? 7.99999 : 8.00001, 10, 0], [0, 0, 0], [0, 0, 0, 1], [0, 0, 0]);
    expect(state.boxCacheDisabled).toBe(true);
    const sparse = boxes(6000);
    a.setColliders(sparse); b.setColliders(sparse);
    expect(state.boxCacheDisabled).toBe(false);
    compare(a, b, [0, 30, 0], [0, 0, 0], [0, 0, 0, 1], [0, 0, 0]);
    expect(state.boxCacheDisabled).toBe(false);
  });

  it('keeps original nonfinite and extreme-coordinate behavior', () => {
    const list = boxes(100);
    for (const n of [NaN, Infinity, -Infinity, 1e200, -1e200]) {
      list.push({ kind: 'box', center: [n, 4, 0], half: [.2, .2, .2], yaw: 0 });
      list.push({ kind: 'box', center: [0, 4, 0], half: [n, .2, .2], yaw: 0 });
    }
    const { a, b } = pair(list);
    for (const x of [0, NaN, Infinity, -Infinity, 1e12, -1e12, 1e12 + 1, 1e200, -1e200, 0]) {
      compare(a, b, [x, 4, 0], [0, -1, 0], [0, 0, 0, 1], [0, 0, 0]);
    }
  });
});

it('reports dense-scene full-resolve A/B timing without a flaky timing assertion', () => {
  const list = boxes(6000), { a, b } = pair(list);
  const q: Quat = [0, 0, 0, 1], inv: Vec3 = [250, 180, 200];
  function run(world: CollisionWorld | LinearWorld, count: number) {
    const pos: Vec3 = [0, 30, 0], vel: Vec3 = [0, 0, 0], w: Vec3 = [0, 0, 0];
    const start = performance.now();
    for (let i = 0; i < count; i++) {
      pos[0] = Math.sin(i * .0001) * 80; pos[2] = Math.cos(i * .0001) * 80;
      world.resolve(.00025, 1.4, inv, pos, vel, q, w);
    }
    return performance.now() - start;
  }
  run(a, 10000); run(b, 10000);
  const cached: number[] = [], linear: number[] = [];
  for (let i = 0; i < 5; i++) { if (i % 2) { linear.push(run(b, 40000)); cached.push(run(a, 40000)); } else { cached.push(run(a, 40000)); linear.push(run(b, 40000)); } }
  console.log('dense collision full resolve 40k steps (ms)', { cached, linear });
});
