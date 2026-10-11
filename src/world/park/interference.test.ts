import { describe, expect, it } from 'vitest';
import type { Quat, Vec3 } from '../../contracts';
import { axisAngle, basisQuat, cross, distance, sub, unit } from './math';
import { containment, cylinderCaps, gjk, intrusion, maxOnCircle, signedDistance, solidBounds, solidOf, support, truncate, type Solid } from './interference';
import type { ParkPart, PartShape } from './types';

const part = (shape: PartShape, pos: Vec3, half: Vec3, rot: Quat = [0, 0, 0, 1]): ParkPart => ({ shape, pos, half, rot, color: [1, 1, 1], roughness: 1, metalness: 0, emissive: 0, solid: true, detail: 0, body: -1 });
const solid = (shape: PartShape, pos: Vec3, half: Vec3, rot?: Quat): Solid => solidOf(part(shape, pos, half, rot), 0);
/** A capped cylinder between two points, built the way Parts.rod builds it. */
function rod(a: Vec3, b: Vec3, radius: number): Solid {
  const up = unit(sub(b, a)), right = unit(cross(up, Math.abs(up[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0])), back = cross(right, up);
  return solid('cylinder', [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], [radius, distance(a, b) / 2, radius], basisQuat(right, up, back));
}

describe('convex interference primitives', () => {
  it('support points agree with exact signed distance on every primitive', () => {
    const shapes: [PartShape, Vec3][] = [['box', [0.4, 0.7, 1.1]], ['cylinder', [0.5, 1.2, 0.5]], ['cone', [0.6, 0.9, 0.6]], ['sphere', [0.3, 0.8, 0.5]], ['gable', [1.2, 0.5, 2]]];
    for (const [shape, half] of shapes) for (const q of [[0, 0, 0, 1], axisAngle(unit([1, 2, 3]), 0.9)] as Quat[]) {
      const s = solid(shape, [1, -2, 3], half, q);
      for (let i = 0; i < 64; i++) {
        const d = unit([Math.sin(i * 1.3), Math.cos(i * 0.7), Math.sin(i * 2.1 + 0.4)]), p = support(s, d);
        // The support point lies on the surface, and no surface point lies further along d.
        expect(Math.abs(signedDistance(s, p))).toBeLessThan(1e-9);
        const beyond: Vec3 = [p[0] + d[0] * 1e-4, p[1] + d[1] * 1e-4, p[2] + d[2] * 1e-4];
        expect(signedDistance(s, beyond)).toBeGreaterThan(0);
      }
    }
  });
  it('exact bounds enclose the solid', () => {
    const b = solidBounds(rod([0, 0, 0], [3, 4, 0], 0.5));
    expect(b[0]).toBeCloseTo(-0.4, 9); expect(b[3]).toBeCloseTo(3.4, 9); expect(b[2]).toBeCloseTo(-0.5, 9);
  });
  it('GJK reports exact separation and overlap', () => {
    const a = solid('sphere', [0, 0, 0], [1, 1, 1]), b = solid('sphere', [3, 0, 0], [1, 1, 1]);
    expect(gjk(a, b).distance).toBeCloseTo(1, 6);
    expect(gjk(a, solid('sphere', [1.99, 0, 0], [1, 1, 1])).intersect).toBe(true);
    const boxA = solid('box', [0, 0, 0], [1, 1, 1]), boxB = solid('box', [2.5, 0.3, 0], [1, 1, 1], axisAngle([0, 1, 0], Math.PI / 4));
    expect(gjk(boxA, boxB).distance).toBeCloseTo(1.5 - Math.SQRT2 + 0, 6);
    // Two crossing rods in parallel planes 0.21 m apart, radii 0.1: separated by 1 cm.
    expect(gjk(rod([-2, 0, 0], [2, 0, 0], 0.1), rod([0, -2, 0.21], [0, 2, 0.21], 0.1)).distance).toBeCloseTo(0.01, 6);
    expect(gjk(rod([-2, 0, 0], [2, 0, 0], 0.1), rod([0, -2, 0.19], [0, 2, 0.19], 0.1)).intersect).toBe(true);
  });
  it('intrusion depth is certified for a rod entering a slab', () => {
    const slab = solid('box', [0, 0, 0], [2, 0.5, 2]), post = rod([0, -0.2, 0], [0, 3, 0], 0.1);
    const r = intrusion(slab, post);
    // The deepest point is the slab mid-plane; a single supergradient at that kink certifies only 0.7.
    expect(r.lower).toBeCloseTo(0.5, 4); expect(r.upper).toBeGreaterThanOrEqual(r.lower); expect(r.upper).toBeLessThanOrEqual(0.7 + 1e-6);
    const apart = intrusion(slab, rod([0, 0.6, 0], [0, 3, 0], 0.1));
    expect(apart.upper).toBeLessThan(0);
  });
  it('circle maximum is bounded by branch and bound', () => {
    const box = solid('box', [0, 0, 0], [1, 1, 1]);
    const r = maxOnCircle(p => signedDistance(box, p), [0, 0, 0], [1, 0, 0], [0, 0, 1], 1.2);
    expect(r.max).toBeCloseTo(0.2, 3); expect(r.upper).toBeGreaterThanOrEqual(r.max); expect(r.upper - r.max).toBeLessThan(1e-3);
  });
  it('detects a rod cap protruding from a thinner receiving tube', () => {
    // A 0.55 m leg ending on the axis of a 0.45 m axle: its end disc pokes out of the axle.
    const axle = rod([0, 10, -0.85], [0, 10, 0.85], 0.45), leg = rod([5, 0, 3], [0, 10, 0], 0.55);
    const cap = cylinderCaps(leg)[1], r = maxOnCircle(p => signedDistance(axle, p), cap.center, cap.u, cap.w, cap.radius);
    expect(r.max).toBeGreaterThan(0.05);
    // The same leg inside a 1.2 m bearing housing is fully received.
    const housing = rod([0, 10, -1.3], [0, 10, 1.3], 1.2), held = maxOnCircle(p => signedDistance(housing, p), cap.center, cap.u, cap.w, cap.radius);
    expect(held.upper).toBeLessThan(0);
  });
  it('containment and truncation isolate an end insertion from a pass-through', () => {
    const column = rod([0, 0, 0], [0, 6, 0], 0.3), brace = rod([2, 1, 0], [0, 3, 0], 0.09);
    expect(containment(column, truncate(brace, 1, 1, 0)!).max).toBeGreaterThan(0);
    // The brace axis meets the column surface 0.42 m from its end, its lower edge 0.51 m from it; beyond 0.6 m the brace is clear.
    const rest = truncate(brace, 1, 1, 0.6)!;
    expect(gjk(column, rest).intersect).toBe(false);
    // A brace running through the column centre and out the far side is caught.
    const through = rod([2, 1, 0], [-1, 4, 0], 0.09), restThrough = truncate(through, 1, 1, 0.6)!;
    expect(gjk(column, restThrough).intersect).toBe(true);
  });
  it('vertex containment is exact for boxes and prisms', () => {
    const outer = solid('box', [0, 0, 0], [1, 1, 1]);
    expect(containment(outer, solid('box', [0, 0, 0], [0.5, 0.5, 0.5], axisAngle([0, 0, 1], 0.7))).max).toBeLessThan(0);
    expect(containment(outer, solid('box', [0, 0, 0], [0.8, 0.8, 0.5], axisAngle([0, 0, 1], 0.7))).max).toBeGreaterThan(0);
    expect(containment(outer, solid('gable', [0, 0, 0], [0.9, 0.9, 0.9])).max).toBeLessThan(0);
  });
});
