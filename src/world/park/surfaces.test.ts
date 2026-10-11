import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../contracts';
import { partDistance } from './collision';
import { inverseRotate, yawPoint } from './math';
import { Parts } from './parts';
import { defaultParkRecipe } from './recipe';
import { buildPublicKerbs, KERB_RISE, pavedInterval, PAVING_TOP, surfaceBox, surfaceStrip, uncoveredIntervals } from './surfaces';
import { pavementArea, pavementTriangle, subtractPavement, unionPublicPaving } from './pavingUnion';
import type { ParkData, ParkPart } from './types';

function scene(): ParkData { return { recipe: defaultParkRecipe(), layout: 'hub', bounds: { min: [-1000, 12, -1000], max: [1000, 100, 1000] }, entrance: 0,
  launch: { pos: [0, 12, 0], yaw: 0 }, rides: [], parts: [], bodies: [], lights: [], rooms: [], routes: [], nodes: [], paths: [] }; }
const at = (part: ParkPart, point: Vec3) => partDistance(part, inverseRotate(part.rot, point.map((v, k) => v - part.pos[k]) as Vec3), [0, 1, 0]);

describe('shared public surface construction', () => {
  it('uses one contact plane even when queue/building builders have different local origins', () => {
    const park = scene();
    for (const y of [0, 12, 12.2, 18]) for (const yaw of [0, 0.37, 1.8]) {
      const b = new Parts(park, [11, y, -7], yaw), p = surfaceBox(b, [2, 3], [4, 5]);
      const center = yawPoint(b.origin, yaw, [2, 0, 3]);
      expect(at(p, [center[0], PAVING_TOP, center[2]])).toBeCloseTo(0, 10);
      expect(p.pos[1] - p.half[1]).toBeCloseTo(12, 10);
    }
  });
  it('clips a diagonal crossing analytically, including intervals shorter than the old1.5m samples', () => {
    const park = scene(), b = new Parts(park), slab = surfaceBox(b, [0, 0], [0.07, 6]);
    expect(pavedInterval([-5, 12.2, 0], [5, 12.2, 0], slab)).toEqual([0.493, 0.507]);
    expect(uncoveredIntervals([[0.2, 0.4], [0.3, 0.7], [0.85, 1]])).toEqual([[0, 0.2], [0.7, 0.85]]);
  });
  it('composes strip orientation with builder yaw and seals every rotated endpoint and slab seam', () => {
    for (const yaw of [0.37, -1.2, 2.8]) {
      const park = scene(), b = new Parts(park, [43, 12, -71], yaw), a: Vec3 = [-8, 0, 3], c: Vec3 = [11, 0, 27];
      const slabs = surfaceStrip(b, a, c, 3.4), length = Math.hypot(c[0] - a[0], c[2] - a[2]);
      for (let i = 0; i <= slabs.length; i++) for (const side of [-1, 0, 1]) {
        const t = i / slabs.length, local: Vec3 = [a[0] + (c[0] - a[0]) * t + side * 1.7 * (c[2] - a[2]) / length, 0.2, a[2] + (c[2] - a[2]) * t - side * 1.7 * (c[0] - a[0]) / length];
        const point = yawPoint(b.origin, yaw, local);
        for (const index of [i - 1, i]) if (slabs[index]) expect(Math.abs(at(slabs[index], point))).toBeLessThan(1e-10);
      }
    }
  });
  it('leaves no raised kerb across a late-added terrace approach', () => {
    const park = scene(), b = new Parts(park, [0, 0, 0], 0, -1, 'path');
    park.nodes = [{ pos: [0, 12.2, -20], links: [1], kind: 'path' }, { pos: [0, 12.2, 20], links: [0], kind: 'path' }]; park.paths = [{ a: 0, b: 1, width: 8 }];
    surfaceStrip(b, park.nodes[0].pos, park.nodes[1].pos, 8); surfaceStrip(b, [0, 12.2, 0], [12, 12.2, 0], 2.4);
    buildPublicKerbs(park);
    const kerbs = park.parts.filter(p => p.surface === 'concrete'); expect(kerbs.length).toBeGreaterThan(0);
    for (let x = 0; x <= 12; x += 0.1) for (const kerb of kerbs) expect(at(kerb, [x, PAVING_TOP + KERB_RISE / 2, 0])).toBeGreaterThan(0);
  });
  it('preserves exact area when subtracting rotated convex pavement intersections', () => {
    const square: [number, number][] = [[-2, -2], [2, -2], [2, 2], [-2, 2]], diamond: [number, number][] = [[0, -3], [3, 0], [0, 3], [-3, 0]];
    const fragments = subtractPavement(square, diamond);
    expect(fragments).toHaveLength(4); expect(fragments.reduce((sum, p) => sum + pavementArea(p), 0)).toBeCloseTo(2, 10);
  });
  it('tessellates arbitrary triangles into exact physical prisms with no area loss or contact-height drift', () => {
    const park = scene(), b = new Parts(park), style = surfaceBox(b, [0, 0], [1, 1]);
    for (const points of [[[0, 0], [7, 1], [1, 4]], [[0, 0], [8, 0], [0, 3]], [[0, 0], [2, 0], [-4, 0.2]]] as [number, number][][]) {
      const parts = pavementTriangle(b, points as [[number, number], [number, number], [number, number]], style);
      expect(parts.reduce((sum, p) => sum + 2 * p.half[0] * p.half[1], 0)).toBeCloseTo(pavementArea(points), 8);
      for (const p of parts) expect(at(p, [p.pos[0], PAVING_TOP, p.pos[2]])).toBeCloseTo(0, 8);
    }
  });
  it('removes coplanar road overlap while preserving the covered footprint', () => {
    const park = scene(), b = new Parts(park, [0, 0, 0], 0, -1, 'path');
    surfaceStrip(b, [-10, 12.2, 0], [10, 12.2, 0], 4); surfaceStrip(b, [0, 12.2, -10], [0, 12.2, 10], 4);
    unionPublicPaving(park); const visible = park.parts.filter(p => p.solid && p.render !== false);
    const area = visible.reduce((sum, p) => sum + (p.shape === 'box' ? 4 * p.half[0] * p.half[2] : 2 * p.half[0] * p.half[1]), 0);
    expect(area).toBeCloseTo(144, 8);
    for (let z = -9.9; z <= 10; z += 0.37) for (let x = -9.9; x <= 10; x += 0.37) {
      const expected = Math.abs(x) <= 2 || Math.abs(z) <= 2, covered = visible.some(p => at(p, [x, PAVING_TOP - 0.01, z]) <= 1e-8);
      expect(covered, `${x},${z}`).toBe(expected);
    }
  });
});
