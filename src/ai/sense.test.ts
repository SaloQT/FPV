import { describe, expect, it } from 'vitest';
import type { ObstacleCollider, Vec3 } from '../contracts';
import { quatToMat3 } from '../sim/math3d';
import { gateColliders } from '../world/track/colliders';
import { groundHit, marchAt, rayBox, sense, senseDirs, senseWorld, sideOf, SENSE_MARCH } from './sense';
import { NEAR_RANGE, OBS, OBS_SIZE, SENSE_COLS, SENSE_RANGE, SENSE_RAYS, SENSE_ROWS } from './spec';

const box = (center: Vec3, half: Vec3, yaw = 0): ObstacleCollider => ({ kind: 'box', center, half, yaw });
const level = (): Float64Array => {
  const m = new Float64Array(9);
  quatToMat3([0, 0, 0, 1], m);
  return m;
};
const yawed = (deg: number): Float64Array => {
  const m = new Float64Array(9), h = (deg * Math.PI) / 360;
  quatToMat3([0, Math.sin(h), 0, Math.cos(h)], m);
  return m;
};
/** The middle ray: straight along the camera axis. */
const MID = ((SENSE_ROWS - 1) / 2) * SENSE_COLS + (SENSE_COLS - 1) / 2;
const flat = (h: number) => (): number => h;

describe('range ray directions', () => {
  const d = senseDirs();
  const ray = (k: number): number[] => [d[k * 3], d[k * 3 + 1], d[k * 3 + 2]];

  it('are unit vectors, the middle one the FPV camera axis 30 degrees up from the nose', () => {
    for (let k = 0; k < SENSE_RAYS; k++) expect(Math.hypot(...ray(k))).toBeCloseTo(1, 12);
    const [x, y, z] = ray(MID);
    expect(x).toBeCloseTo(0, 12);
    expect(Math.atan2(y, -z) * (180 / Math.PI)).toBeCloseTo(30, 10);
  });

  it('run rows from the top and each row from the left', () => {
    expect(ray(0)[1]).toBeGreaterThan(ray((SENSE_ROWS - 1) * SENSE_COLS)[1]);
    expect(ray(0)[0]).toBeLessThan(0);
    expect(ray(SENSE_COLS - 1)[0]).toBeGreaterThan(0);
  });
});

describe('rayBox', () => {
  const pack = (c: ObstacleCollider): Float64Array => senseWorld([c], flat(-100)).boxes;

  it('meets a box face at its distance, misses beside it, and reads 0 from inside', () => {
    const b = pack(box([0, 0, -10], [1, 1, 1]));
    expect(rayBox(b, 0, 0, 0, 0, 0, 0, -1, SENSE_RANGE)).toBeCloseTo(9, 12);
    expect(rayBox(b, 0, 0, 0, 0, 1, 0, 0, SENSE_RANGE)).toBe(SENSE_RANGE);
    expect(rayBox(b, 0, 0, 0, -10, 0, 0, -1, SENSE_RANGE)).toBe(0);
    expect(rayBox(b, 0, 0, 0, 0, 0, 0, -1, 5)).toBe(5);
  });

  it('turns with the box yaw the way the physics does', () => {
    // A 4 m x 0.2 m wall yawed 90 degrees runs along z: a ray along z meets it at once, one along x at 0.1 m short of its middle
    const b = pack(box([5, 0, 0], [2, 1, 0.1], Math.PI / 2));
    expect(rayBox(b, 0, 0, 0, 0, 1, 0, 0, SENSE_RANGE)).toBeCloseTo(4.9, 9);
    expect(rayBox(b, 0, 5, 0, -5, 0, 0, 1, SENSE_RANGE)).toBeCloseTo(3, 9);
  });
});

describe('groundHit', () => {
  it('finds flat ground where a falling ray meets it, and reads 0 underground', () => {
    const s = Math.SQRT1_2;
    expect(groundHit(flat(0), 0, 5, 0, s, -s, 0)).toBeCloseTo(5 * Math.SQRT2, 9);
    expect(groundHit(flat(0), 0, 5, 0, 0, 1, 0)).toBe(SENSE_RANGE);
    expect(groundHit(flat(0), 0, -1, 0, 0, -1, 0)).toBe(0);
  });

  it('samples from 1 m to the full range', () => {
    expect(marchAt(1)).toBeCloseTo(SENSE_RANGE * 17 / 512, 12);
    expect(marchAt(SENSE_MARCH)).toBe(SENSE_RANGE);
  });
});

describe('sense', () => {
  it('sees a wall ahead in the middle ray and on the front side, and nothing elsewhere', () => {
    const w = senseWorld([box([0, 10, -6], [10, 10, 0.5])], flat(-1000));
    const o = new Float64Array(OBS_SIZE);
    // Pitched 30 degrees nose down, the camera axis points level along -z
    const m = new Float64Array(9), h = (-30 * Math.PI) / 360;
    quatToMat3([Math.sin(h), 0, 0, Math.cos(h)], m);
    sense(w, [0, 10, 0], m, o);
    expect(o[OBS.rays + MID]).toBeCloseTo(1 - 5.5 / SENSE_RANGE, 9);
    const front = OBS.near + 5 * 4;
    expect(o[front + 3]).toBeCloseTo(1 - 5.5 / NEAR_RANGE, 9);
    // The direction is in body axes: level ahead is 30 degrees above the pitched-down nose
    expect(o[front + 1]).toBeCloseTo(Math.sin(Math.PI / 6), 9);
    for (let s = 0; s < 5; s++) expect(o.slice(OBS.near + s * 4, OBS.near + s * 4 + 4)).toEqual(new Float64Array(4));
  });

  it('keeps the nearer of two hits on a ray, ground or box', () => {
    const o = new Float64Array(OBS_SIZE);
    const w = senseWorld([box([0, 2, -20], [3, 3, 0.5]), box([0, 2, -8], [3, 3, 0.5])], flat(0));
    sense(w, [0, 2, 0], yawed(0), o);
    // The level ray two rows down from the middle looks 10 degrees under the nose and meets the near box, not the ground
    const k = (SENSE_ROWS - 1) * SENSE_COLS + (SENSE_COLS - 1) / 2;
    expect(o[OBS.rays + k]).toBeCloseTo(1 - 7.5 / Math.cos((10 * Math.PI) / 180) / SENSE_RANGE, 6);
  });

  it('puts something to the world east on the left of a quad yawed to face south', () => {
    const o = new Float64Array(OBS_SIZE);
    sense(senseWorld([box([3, 0, 0], [0.5, 0.5, 0.5])], flat(-1000)), [0, 0, 0], yawed(180), o);
    expect(o[OBS.near + 1 * 4]).toBeCloseTo(-1, 9);
    expect(o[OBS.near + 1 * 4 + 3]).toBeCloseTo(1 - 2.5 / NEAR_RANGE, 9);
  });

  it('puts a gate\'s posts and bars on their own sides as the quad flies through', () => {
    const gate = { index: 0, kind: 'square' as const, pos: [0, 3, -10] as Vec3, yaw: 0, roll: 0, pitch: 0, width: 4, height: 4 };
    const o = new Float64Array(OBS_SIZE);
    sense(senseWorld(gateColliders(gate), flat(-1000)), [0, 3, -10], level(), o);
    const side = (s: number): number[] => Array.from(o.slice(OBS.near + s * 4, OBS.near + s * 4 + 4));
    for (const [s, axis, sign] of [[0, 0, 1], [1, 0, -1], [2, 1, 1], [3, 1, -1]] as const) {
      expect(side(s)[axis]).toBeCloseTo(sign, 6);
      expect(side(s)[3]).toBeCloseTo(1 - 2 / NEAR_RANGE, 1);
    }
  });

  it('picks the lower collider index among colliders as near as each other on one side', () => {
    const pair = [box([1, 0, -5], [0.2, 0.2, 0.2]), box([-1, 0, -5], [0.2, 0.2, 0.2])];
    const o = new Float64Array(OBS_SIZE), back = new Float64Array(OBS_SIZE);
    sense(senseWorld(pair, flat(-1000)), [0, 0, 0], level(), o);
    sense(senseWorld([...pair].reverse(), flat(-1000)), [0, 0, 0], level(), back);
    const front = OBS.near + 5 * 4;
    expect(o[front + 3]).toBeGreaterThan(0);
    // Reversing the list reverses which one wins: the choice follows collider order, not rounding
    expect(o[front + 3]).toBeCloseTo(back[front + 3], 12);
    expect(o[front]).toBeGreaterThan(0);
    expect(back[front]).toBeLessThan(0);
  });
});

describe('sideOf', () => {
  it('names the axis a direction leans along most', () => {
    expect([sideOf(1, 0, 0), sideOf(-1, 0, 0), sideOf(0, 1, 0), sideOf(0, -1, 0), sideOf(0, 0, 1), sideOf(0, 0, -1)]).toEqual([0, 1, 2, 3, 4, 5]);
    expect(sideOf(0.6, 0.5, -0.62)).toBe(5);
    expect(sideOf(0.5, 0.5, 0.5)).toBe(0);
  });
});
