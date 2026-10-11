import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../contracts';
import { partDistance } from './collision';
import { inverseRotate } from './math';
import { Parts } from './parts';
import { pavementArea, pavementCircle, pavementTriangle, PAVING_CHORD_ERROR, unionPublicPaving } from './pavingUnion';
import { defaultParkRecipe } from './recipe';
import { PAVING_TOP, surfaceBox } from './surfaces';
import type { ParkData, ParkPart } from './types';

const scene = (): ParkData => ({ recipe: defaultParkRecipe(), layout: 'hub', bounds: { min: [-10, 12, -10], max: [10, 30, 10] }, entrance: 0,
  launch: { pos: [0, 12, 0], yaw: 0 }, rides: [], parts: [], bodies: [], lights: [], rooms: [], routes: [], nodes: [], paths: [] });
const at = (part: ParkPart, x: number, z: number) => partDistance(part, inverseRotate(part.rot, [x - part.pos[0], PAVING_TOP - 0.04 - part.pos[1], z - part.pos[2]]), [0, 1, 0]);
const area = (parts: ParkPart[]) => parts.reduce((sum, p) => sum + (p.shape === 'box' ? 4 * p.half[0] * p.half[2] : 2 * p.half[0] * p.half[1]), 0);
const disk = (park: ParkData, x: number, radius: number) => new Parts(park, [x, 12, 0], 0, -1, 'ride').part('cylinder', [0, 0.1, 0], [radius, 0.1, radius], [0.42, 0.31, 0.23], { surface: 'paving' });

describe('shared circular apron and path geometry', () => {
  it('bounds circumscription while retaining every authored circle point', () => {
    for (const radius of [0.5, 3, 15, 27, 80]) {
      const p = disk(scene(), 73, radius), polygon = pavementCircle(p), n = polygon.length;
      expect(n % 4).toBe(0);
      for (let i = 0; i < n; i++) {
        const a = polygon[i], b = polygon[(i + 1) % n];
        expect(Math.hypot(a[0] - 73, a[1]) - radius).toBeLessThanOrEqual(PAVING_CHORD_ERROR + 1e-12);
        expect(Math.hypot((a[0] + b[0]) / 2 - 73, (a[1] + b[1]) / 2)).toBeCloseTo(radius, 10);
      }
      expect(pavementArea(polygon)).toBeCloseTo(n * radius * radius * Math.tan(Math.PI / n), 8);
    }
  });

  it('joins a differently coloured path and apron with analytic area bounds and one solid covering each interior point', () => {
    const park = scene(), apron = disk(park, 0, 3), path = surfaceBox(new Parts(park, [0, 0, 0], 0, -1, 'path'), [0, 0], [5, 1]);
    const polygon = pavementCircle(apron), originalArea = Math.PI * 9;
    const stripIntersection = 2 * (Math.sqrt(8) + 9 * Math.asin(1 / 3)), analyticUnion = originalArea + 20 - stripIntersection;
    unionPublicPaving(park); const active = park.parts.filter(p => p.solid && p.render !== false);
    expect(apron.render).toBe(false); expect(apron.solid).toBe(false); expect(path.render).toBe(false); expect(path.solid).toBe(false);
    expect(area(active)).toBeGreaterThanOrEqual(analyticUnion - 1e-8);
    expect(area(active)).toBeLessThanOrEqual(analyticUnion + pavementArea(polygon) - originalArea + 1e-8);
    for (const p of active) {
      const local = inverseRotate(p.rot, [0, PAVING_TOP - p.pos[1], 0]);
      expect(Math.abs(partDistance(p, local, [0, 1, 0]))).toBeLessThan(1e-8);
    }
    for (let z = -3.107; z < 3.12; z += 0.173) for (let x = -5.071; x < 5.08; x += 0.179) {
      const insideDisk = Math.hypot(x, z) < 3, insidePath = Math.abs(x) < 5 && Math.abs(z) < 1;
      const count = active.filter(p => at(p, x, z) < -1e-8).length;
      expect(count, `overlap at ${x},${z}`).toBeLessThanOrEqual(1);
      if (insideDisk || insidePath) expect(count, `hole at ${x},${z}`).toBe(1);
      if (Math.hypot(x, z) > 3 + PAVING_CHORD_ERROR && !insidePath) expect(count).toBe(0);
    }
    // Radial sector seams share complete physical edges, without coverage gaps or duplicate interior area.
    for (const vertex of polygon) for (const t of [0.1, 0.5, 0.95]) expect(Math.min(...active.map(p => Math.abs(at(p, vertex[0] * t, vertex[1] * t))))).toBeLessThan(1e-8);
  });

  it('partitions two overlapping non-path apron finishes instead of leaving competing coplanar disks', () => {
    const park = scene(), first = disk(park, 0, 4), second = disk(park, 4, 4); second.color = [0.2, 0.23, 0.25];
    const polygonSurplus = pavementArea(pavementCircle(first)) + pavementArea(pavementCircle(second)) - 2 * Math.PI * 16;
    const lens = 32 * Math.acos(0.5) - 2 * Math.sqrt(48), expected = 2 * Math.PI * 16 - lens;
    unionPublicPaving(park); const active = park.parts.filter(p => p.solid && p.render !== false);
    expect(area(active)).toBeGreaterThanOrEqual(expected - 1e-8); expect(area(active)).toBeLessThanOrEqual(expected + polygonSurplus + 1e-8);
    for (let z = -3.9; z < 4; z += 0.213) for (let x = -3.97; x < 8; x += 0.227) {
      const count = active.filter(p => at(p, x, z) < -1e-8).length; expect(count).toBeLessThanOrEqual(1);
      if (Math.hypot(x, z) < 4 || Math.hypot(x - 4, z) < 4) expect(count).toBe(1);
    }
  });

  it('represents a right triangle by two exact prisms without a second altitude subdivision', () => {
    const park = scene(), b = new Parts(park), style = surfaceBox(b, [0, 0], [1, 1]);
    const parts = pavementTriangle(b, [[0, 0], [8, 0], [0, 3]], style);
    expect(parts).toHaveLength(2); expect(area(parts)).toBeCloseTo(12, 10);
    for (const p of parts) expect(p.pos[1]).toBeCloseTo(12.1, 10);
  });
});
