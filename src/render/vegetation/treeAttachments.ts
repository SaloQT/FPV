import type { Vec3 } from '../../contracts';
import { add, dot, mul, norm, sub } from './meshBuilder';
import type { Limb } from './treePlan';

export interface WoodAttachment { point: Vec3; tangent: Vec3; radius: number; distance: number; limb: Limb | null }

/** Attach foliage to the emitted woody centreline, including its retained LOD vertices. */
export function nearestWood(limbs: readonly Limb[], point: Vec3): WoodAttachment {
  let best: WoodAttachment = { point: [0, 0, 0], tangent: [0, 1, 0], radius: 0.002, distance: Infinity, limb: null };
  for (const limb of limbs) for (let i = 1; i < limb.pts.length; i++) {
    const a = limb.pts[i - 1], edge = sub(limb.pts[i], a), t = Math.max(0, Math.min(1, dot(sub(point, a), edge) / Math.max(dot(edge, edge), 1e-12)));
    const p = add(a, mul(edge, t)), distance = Math.hypot(...sub(point, p));
    if (distance < best.distance) best = { point: p, tangent: norm(edge), radius: limb.radii[i - 1] + (limb.radii[i] - limb.radii[i - 1]) * t, distance, limb };
  }
  return best;
}
