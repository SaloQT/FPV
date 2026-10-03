import { describe, expect, it } from 'vitest';
import type { ObstacleCollider, Quat, TerrainSampler, Vec3 } from '../contracts';
import { CollisionWorld, type CollisionParams } from './collision';
import { CollisionWorld as OriginalWorld } from './fixtures/collisionLinear';
import { flatTerrain } from './testkit';

const params: CollisionParams = {
  spheres: Array.from({ length: 16 }, (_, i) => ({ x: (i % 4 - 1.5) * .08, y: (i % 3 - 1) * .03, z: (Math.floor(i / 4) - 1.5) * .08, r: .06, motor: i % 5 - 1 })),
  terrainFriction: .6, terrainRestitution: .1, obstacleFriction: .5, obstacleRestitution: .2, crashSpeed: 4, propStrikeTorque: .02,
};
type GatherState = {
  gather(pos: Vec3, q: Quat): void;
  nc: number;
  cSphere: Int32Array;
  nB: Float64Array;
  nW: Float64Array;
  arm: Float64Array;
  cPen: Float64Array;
  cMu: Float64Array;
  cBounce: Float64Array;
};
function contacts(world: CollisionWorld | OriginalWorld, pos: Vec3, q: Quat) {
  const state = world as unknown as GatherState;
  state.gather(pos, q);
  return {
    nc: state.nc,
    ids: [...state.cSphere.slice(0, state.nc)],
    vectors: [state.nB, state.nW, state.arm].map(a => [...a.slice(0, state.nc * 3)]),
    scalars: [state.cPen, state.cMu, state.cBounce].map(a => [...a.slice(0, state.nc)]),
  };
}
function statefulTerrain(log: unknown[], ownVector: boolean): TerrainSampler {
  let calls = 0;
  return {
    ...flatTerrain(0),
    heightAt(x, z) { log.push(['height', x, z]); return Math.sin(x + z) * .005; },
    normalAt(x, z, out) {
      log.push(['normal', x, z]);
      const normal: Vec3 = [.01 * Math.sin(++calls), 1, .01 * Math.cos(calls)];
      if (ownVector) return normal;
      out![0] = normal[0]; out![1] = normal[1]; out![2] = normal[2];
      return out!;
    },
  };
}

describe('contact capacity short-circuit', () => {
  it('keeps exact ordered contacts, sampler calls and complete solver outputs around saturation', () => {
    let seed = 219811;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (const sphereCount of [1, 2, 3, 5, 16]) {
      for (const boxCount of [0, 1, 3, 4, 5, 16, 21, 22, 31, 32, 63, 1000]) {
        for (const terrainMode of ['none', 'out', 'own'] as const) {
          const a = new CollisionWorld({ ...params, spheres: params.spheres.slice(0, sphereCount) });
          const b = new OriginalWorld({ ...params, spheres: params.spheres.slice(0, sphereCount) });
          const boxes: ObstacleCollider[] = Array.from({ length: boxCount }, (_, i) => ({
            kind: 'box', center: [(random() - .5) * .2, (random() - .5) * .1, (random() - .5) * .2],
            half: i % 3 ? [.3, .2, .3] : [.015, .03, .015], yaw: random() * 6.28,
          }));
          a.setColliders(boxes); b.setColliders(boxes);
          const aLog: unknown[] = [], bLog: unknown[] = [];
          if (terrainMode !== 'none') {
            a.terrain = statefulTerrain(aLog, terrainMode === 'own');
            b.terrain = statefulTerrain(bLog, terrainMode === 'own');
          }
          for (let step = 0; step < 12; step++) {
            const pos: Vec3 = [(random() - .5) * .2, (random() - .5) * .1, (random() - .5) * .2];
            const q: Quat = [random() - .5, random() - .5, random() - .5, random() - .5];
            const length = Math.hypot(...q); for (let j = 0; j < 4; j++) q[j] /= length;
            expect(contacts(a, pos, q)).toEqual(contacts(b, pos, q));
            const aPos: Vec3 = [...pos], bPos: Vec3 = [...pos];
            const aVel: Vec3 = [random() * 4, -random() * 4, random() * 4], bVel: Vec3 = [...aVel];
            const aW: Vec3 = [random(), random(), random()], bW: Vec3 = [...aW];
            a.resolve(.00025, 1.4, [250, 180, 200], aPos, aVel, q, aW);
            b.resolve(.00025, 1.4, [250, 180, 200], bPos, bVel, q, bW);
            expect([aPos, aVel, aW, a.impactSpeed, a.onGround, a.contactCount, [...a.motorLoad]])
              .toEqual([bPos, bVel, bW, b.impactSpeed, b.onGround, b.contactCount, [...b.motorLoad]]);
            expect(aLog).toEqual(bLog);
            aLog.length = bLog.length = 0;
          }
        }
      }
    }
  });

  it('preserves the exact 63, 64 and overflowing 65-contact boundaries', () => {
    for (const [spheres, boxes, uncapped] of [[3, 20, 63], [2, 31, 64], [5, 12, 65]]) {
      const p = { ...params, spheres: Array.from({ length: spheres }, () => ({ x: 0, y: 0, z: 0, r: .06, motor: -1 })) };
      const a = new CollisionWorld(p), b = new OriginalWorld(p);
      const list: ObstacleCollider[] = Array.from({ length: boxes }, (_, i) => ({ kind: 'box', center: [0, 0, 0], half: [1, 1, 1], yaw: i * .1 }));
      a.setColliders(list); b.setColliders(list);
      const actual = contacts(a, [0, .02, 0], [0, 0, 0, 1]);
      expect(actual).toEqual(contacts(b, [0, .02, 0], [0, 0, 0, 1]));
      expect(actual.nc).toBe(Math.min(uncapped, 64));
    }
  });

  it('stops obstacle tests at 64 while retaining terrain sampling for all proxy spheres', () => {
    const world = new CollisionWorld(params);
    world.setColliders(Array.from({ length: 32 }, () => ({ kind: 'box', center: [0, 0, 0], half: [1, 1, 1], yaw: 0 })));
    const log: unknown[] = [];
    world.terrain = statefulTerrain(log, true);
    const state = world as unknown as GatherState & { sphereBox: (...args: unknown[]) => void };
    const original = state.sphereBox.bind(world);
    let narrowphaseCalls = 0;
    state.sphereBox = (...args) => { narrowphaseCalls++; original(...args); };
    expect(contacts(world, [0, 0, 0], [0, 0, 0, 1]).nc).toBe(64);
    expect(narrowphaseCalls).toBe(62);
    expect(log.filter(entry => (entry as unknown[])[0] === 'height')).toHaveLength(17);
    expect(log.filter(entry => (entry as unknown[])[0] === 'normal')).toHaveLength(16);
  });
});
