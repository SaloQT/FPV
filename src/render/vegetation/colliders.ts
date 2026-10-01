import type { ObstacleCollider, Vec3 } from '../../contracts';
import type { RTMaterial, RTPrimitive } from '../contracts';
import type { InstanceSet, VegPlacement } from './placement';
import { rockAssets } from './rockGen';
import type { TreePlan } from './treePlan';
import { VARIANT_DEFS, variantPlan } from './variants';

/** The brief keeps the collider count below 2500; the nearest ones win when a track is very wooded. */
export const MAX_COLLIDERS = 2400;
/** Trees closer than this to the racing line get a trunk box. */
export const TREE_COLLIDER_RANGE = 60;
export const ROCK_COLLIDER_RANGE = 40;
/** Rocks smaller than this radius are not worth a collider. */
export const MIN_BOULDER_RADIUS = 0.6;
export const TRUNK_HALF_MIN = 0.15;
export const TRUNK_HALF_MAX = 0.4;
/** Trunk boxes stop a little below the tip, where the stem is too thin to matter. */
const TRUNK_HEIGHT_FRACTION = 0.9;
/** A boulder's box covers this fraction of its radius on each side of the centre. */
const BOULDER_HALF = 0.7;

export const RT_PRIM_CAP = 600;
export const RT_TREE_COUNT = RT_PRIM_CAP / 2;
/** Bulk canopy reflectance (leaves, gaps and bark averaged), lower than a single leaf's 0.1 to 0.15 green. */
export const RT_FOLIAGE: RTMaterial = { albedo: [0.045, 0.09, 0.025], roughness: 1, metalness: 0 };

interface Candidate {
  dist: number;
  key: number;
  box: ObstacleCollider;
}

/** Box around the solid part of a tree: from the ground up to the crown's top, but never into the whisker-thin tip. */
function trunkBox(place: InstanceSet, i: number): ObstacleCollider {
  const s = place.scale[i], plan = variantPlan(place.variant[i]) as TreePlan;
  const half = Math.min(Math.max(plan.trunkRadius * s, TRUNK_HALF_MIN), TRUNK_HALF_MAX);
  const h = 0.5 * Math.min(plan.height * TRUNK_HEIGHT_FRACTION, plan.crownC[1] + plan.crownR[1]) * s;
  return { kind: 'box', center: [place.pos[i * 3], place.pos[i * 3 + 1] + h, place.pos[i * 3 + 2]], half: [half, h, half], yaw: place.yaw[i] };
}

function boulderBox(place: InstanceSet, i: number): ObstacleCollider {
  const s = place.scale[i], rock = rockAssets()[VARIANT_DEFS[place.variant[i]].rock];
  const h = 0.5 * rock.height * s;
  return { kind: 'box', center: [place.pos[i * 3], place.pos[i * 3 + 1] + h, place.pos[i * 3 + 2]], half: [BOULDER_HALF * s, h, BOULDER_HALF * s], yaw: place.yaw[i] };
}

/**
 * Trunk boxes for the trees along the racing line and boxes for the boulders next to it, nearest first, at most MAX_COLLIDERS.
 * The order is a pure function of the placement, so equal seeds give identical lists.
 */
export function buildColliders(place: VegPlacement): ObstacleCollider[] {
  const out: Candidate[] = [];
  const { plants, rocks } = place;
  for (let i = 0; i < plants.count; i++) {
    if (VARIANT_DEFS[plants.variant[i]].group !== 'tree' || !(plants.pathDist[i] <= TREE_COLLIDER_RANGE)) continue;
    out.push({ dist: plants.pathDist[i], key: i, box: trunkBox(plants, i) });
  }
  for (let i = 0; i < rocks.count; i++) {
    if (rocks.scale[i] < MIN_BOULDER_RADIUS || !(rocks.pathDist[i] <= ROCK_COLLIDER_RANGE)) continue;
    out.push({ dist: rocks.pathDist[i], key: plants.count + i, box: boulderBox(rocks, i) });
  }
  out.sort((a, b) => a.dist - b.dist || a.key - b.key);
  if (out.length > MAX_COLLIDERS) out.length = MAX_COLLIDERS;
  return out.map((c) => c.box);
}

/** Static ray-tracing proxies: capsule trunk plus a volume-equivalent sphere canopy for the trees nearest `focus`, RT_PRIM_CAP primitives at most. */
export function buildRtProxies(place: VegPlacement, focus: Vec3): RTPrimitive[] {
  const { plants } = place;
  const near: { d: number; i: number }[] = [];
  for (let i = 0; i < plants.count; i++) {
    if (VARIANT_DEFS[plants.variant[i]].group !== 'tree') continue;
    near.push({ d: Math.hypot(plants.pos[i * 3] - focus[0], plants.pos[i * 3 + 2] - focus[2]), i });
  }
  near.sort((a, b) => a.d - b.d || a.i - b.i);
  const prims: RTPrimitive[] = [];
  for (let k = 0; k < Math.min(near.length, RT_TREE_COUNT); k++) {
    const i = near[k].i, s = plants.scale[i], plan = variantPlan(plants.variant[i]);
    if (!plan) continue;
    const x = plants.pos[i * 3], y = plants.pos[i * 3 + 1], z = plants.pos[i * 3 + 2];
    const cos = Math.cos(plants.yaw[i]), sin = Math.sin(plants.yaw[i]);
    const cx = plan.crownC[0], cz = plan.crownC[2];
    const canopy: Vec3 = [x + (cos * cx + sin * cz) * s, y + plan.crownC[1] * s, z + (-sin * cx + cos * cz) * s];
    const r = Math.cbrt(plan.crownR[0] * plan.crownR[1] * plan.crownR[2]) * s;
    prims.push({ type: 'capsule', a: [x, y, z], b: [x, Math.max(canopy[1] - 0.5 * r, y + 1), z], radius: Math.max(plan.trunkRadius * s, 0.12), material: RT_FOLIAGE });
    prims.push({ type: 'sphere', center: canopy, radius: r, material: RT_FOLIAGE });
  }
  return prims;
}
