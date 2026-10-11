import type { Vec3 } from '../../contracts';
import { ROOT_DEPTH, plantSurface } from '../../render/vegetation/plantSurfaces';
import { VARIANT_DEFS, variantPlan } from '../../render/vegetation/variants';
import { PartBVH, partDistance } from './collision';
import { clamp, distance, inverseRotate, mul, yawPoint } from './math';
import { Parts } from './parts';
import type { ParkData, ParkPart, ParkPlanting } from './types';
import { remapConstructionJoints } from './construction';

/** A generation cap, never a graphics-tier cap. Even Low retains this complete prefix. */
export const MAX_PARK_PLANTINGS = 4096;
export const MAX_PLANT_WOOD_SEGMENTS = 24;
/** A tree whose drawn leaves have this many sampled points inside a built solid is growing through it (roof, wall, sign, ride scenery). */
export const LEAF_CONTACT_LIMIT = 6;const made = new WeakMap<ParkData, Map<ParkPlanting, ParkPart[]>>();
const matureBounds = new Map<number, { radius: number; height: number }>();

export interface PlantingOptions { variant: number; scale: number; yaw?: number; tint?: Vec3 }

export function plantingBounds(plant: ParkPlanting): { center: Vec3; radius: number; height: number } {
  const plan = variantPlan(plant.variant)!;
  let bounds = matureBounds.get(plant.variant);
  if (!bounds) {
    // Root-centred footprint covers leaning crowns and every supported foliage LOD.
    // Card half-size and low-LOD enlargement are material: an ellipsoid alone underestimates them.
    let radius = Math.hypot(plan.crownC[0], plan.crownC[2]) + Math.max(Math.max(plan.crownR[0], plan.crownR[2]), 0.85 * Math.hypot(plan.crownR[0], plan.crownR[2]));
    let height = Math.max(plan.height, plan.crownC[1] + plan.crownR[1]);
    const cover = (center: Vec3, reach: number) => { radius = Math.max(radius, Math.hypot(center[0], center[2]) + reach); height = Math.max(height, center[1] + reach); };
    for (const limb of plan.limbs) limb.pts.forEach((p, i) => cover(p, limb.radii[i] * (limb.order === 0 ? 1.22 : 1)));
    for (const frond of plan.fronds) cover(frond.c, 0.5 * Math.hypot(frond.len, frond.width) * (plan.fronds.length > 60 ? 1.9 : 1.4));
    for (const cluster of plan.clusters) cover(cluster.c, plan.radial ? plan.cardSize * cluster.r * 1.3 * Math.hypot(1.85, 0.55) : Math.max(cluster.r + Math.SQRT2 * plan.cardSize * 1.25, cluster.r * 1.05 * Math.SQRT2));
    bounds = { radius, height }; matureBounds.set(plant.variant, bounds);
  }
  const center: Vec3 = [plant.pos[0], plant.pos[1] + plan.crownC[1] * plant.scale, plant.pos[2]];
  return { center, radius: bounds.radius * plant.scale, height: bounds.height * plant.scale };
}

/** Land-use footprint of the planned foliage crown, separate from conservative collision clearance. */
export function plantingCanopyFootprint(plant: ParkPlanting): { center: Vec3; radii: [number, number]; yaw: number } {
  const plan = variantPlan(plant.variant)!;
  return { center: yawPoint(plant.pos, plant.yaw, mul(plan.crownC, plant.scale)), radii: [plan.crownR[0] * plant.scale, plan.crownR[2] * plant.scale], yaw: plant.yaw };
}

/** Register a detailed tree and inscribed woody proxies from its identical engine skeleton. */
export function plantParkTree(park: ParkData, position: Vec3, options: PlantingOptions): ParkPlanting | null {
  const plantings = park.plantings ?? (park.plantings = []);
  if (plantings.length >= MAX_PARK_PLANTINGS) return null;
  if (!Number.isInteger(options.variant) || options.variant < 0 || options.variant >= 8) throw new Error('Park planting requires an engine plant variant (0–7)');
  if (![...position, options.scale, options.yaw ?? 0, ...(options.tint ?? [1, 1, 1])].every(Number.isFinite) || !(options.scale > 0)) throw new Error('Park planting transform must be finite and have positive scale');
  const plant: ParkPlanting = { pos: position.map(Math.fround) as Vec3, yaw: Math.fround(options.yaw ?? 0), variant: options.variant,
    scale: Math.fround(clamp(options.scale, 0.08, 2)), tint: (options.tint ?? [1, 1, 1]).map(x => clamp(x, 0.3, 1.8)) as Vec3 };
  plantings.push(plant);
  const plan = variantPlan(plant.variant)!, builder = new Parts(park, plant.pos, plant.yaw, -1, 'landscape');
  const proxies: ParkPart[] = [], segments: { a: Vec3; b: Vec3; radius: number; order: number }[] = [];
  if (VARIANT_DEFS[plant.variant].group === 'tree') for (const limb of plan.limbs) {
    if (limb.order > 1) continue;
    for (let i = 1; i < limb.pts.length; i++) {
      const radius = Math.min(limb.radii[i - 1], limb.radii[i]) * plant.scale;
      if (radius < (limb.order === 0 ? 0.025 : 0.065)) continue;
      segments.push({ a: mul(limb.pts[i - 1], plant.scale), b: mul(limb.pts[i], plant.scale), radius: radius * (limb.order === 0 ? 0.92 : 0.85), order: limb.order });
    }
  }
  segments.sort((a, b) => a.order - b.order || b.radius - a.radius);
  for (const segment of segments.slice(0, MAX_PLANT_WOOD_SEGMENTS)) proxies.push(builder.rod(segment.a, segment.b, segment.radius, [0.13, 0.085, 0.05], { render: false, rayTrace: false, surface: 'timber', metalness: 0, roughness: 0.95 }));
  let records = made.get(park); if (!records) { records = new Map(); made.set(park, records); }
  records.set(plant, proxies);
  return plant;
}

/** The woody collision stand-ins of every tree planted so far; the final planting pass may still remove some of them. */
export function plantingProxies(park: ParkData): Set<ParkPart> {
  const out = new Set<ParkPart>();
  for (const proxies of made.get(park)?.values() ?? []) for (const part of proxies) out.add(part);
  return out;
}

/** Boxes round every part, for the part tree that finds what stands near a planting. */
function partBounds(parts: readonly ParkPart[]): Float64Array {
  const out = new Float64Array(parts.length * 6);
  parts.forEach((p, i) => {
    const [x, y, z, w] = p.rot, h = p.half, m = [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y), 2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x), 2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)];
    for (let k = 0; k < 3; k++) { const extent = Math.abs(m[k * 3]) * h[0] + Math.abs(m[k * 3 + 1]) * h[1] + Math.abs(m[k * 3 + 2]) * h[2]; out[i * 6 + k] = p.pos[k] - extent; out[i * 6 + k + 3] = p.pos[k] + extent; }
  });
  return out;
}

/**
 * Plantings whose drawn tree grows through something built: the bark of the trunk or a thick limb inside a solid (a trunk through paving,
 * a kerb, a wall or a sign), or the leaf cards pushed through a roof, a wall or ride scenery. Planting runs before most of the park's
 * buildings, paths and scenery exist, so this is the one place that can see them all. Moving ride parts are measured in their own frame,
 * and the plant's own wood proxies are landscape, so only fixed, non-landscape solids count.
 */
export function plantingsThroughBuiltGeometry(park: ParkData): Set<ParkPlanting> {
  const hit = new Set<ParkPlanting>(), solids = park.parts.filter(p => p.solid && p.body < 0 && p.category !== 'landscape');
  if (!park.plantings?.length || !solids.length) return hit;
  const boxes = partBounds(solids), tree = new PartBVH(solids, boxes), local: Vec3 = [0, 0, 0], normal: Vec3 = [0, 1, 0];
  for (const plant of park.plantings) {
    const bounds = plantingBounds(plant), reach = Math.hypot(bounds.radius, bounds.height / 2), near: number[] = [];
    tree.query(plant.pos[0], plant.pos[1] + bounds.height / 2, plant.pos[2], reach, i => near.push(i));
    if (!near.length) continue;
    const surface = plantSurface(plant.variant), cos = Math.cos(plant.yaw), sin = Math.sin(plant.yaw), s = plant.scale;
    // Each point is measured exactly only against the solids whose box holds it; a point inside a solid is always inside its box.
    let hitPoint = false;
    const inside = (points: Float32Array, i: number): boolean => {
      const lx = points[i] * s, ly = points[i + 1] * s, lz = points[i + 2] * s;
      const x = plant.pos[0] + cos * lx + sin * lz, y = plant.pos[1] + ly, z = plant.pos[2] - sin * lx + cos * lz;
      hitPoint = false;
      tree.query(x, y, z, 0, k => {
        if (hitPoint) return;
        const part = solids[k];
        local[0] = x - part.pos[0]; local[1] = y - part.pos[1]; local[2] = z - part.pos[2];
        inverseRotate(part.rot, local, local);
        if (partDistance(part, local, normal) < 0) hitPoint = true;
      });
      return hitPoint;
    };
    let touching = false;
    for (let i = 0; i < surface.wood.length && !touching; i += 3) if (surface.wood[i + 1] * s >= ROOT_DEPTH && inside(surface.wood, i)) touching = true;
    for (let i = 0, count = 0; i < surface.leaves.length && !touching; i += 3) if (inside(surface.leaves, i) && ++count >= LEAF_CONTACT_LIMIT) touching = true;
    if (touching) hit.add(plant);
  }
  return hit;
}

/** Final layout pass: reserve a mature-tree envelope around every advertised flight guide, and drop trees that grow through the built park. */
export function finalizeParkPlantings(park: ParkData): void {
  if (!park.plantings?.length) return;
  const cells = new Map<string, [Vec3, Vec3][]>(), cell = 16;
  const visit = (min: Vec3, max: Vec3, run: (key: string) => void): void => {
    for (let x = Math.floor(min[0] / cell); x <= Math.floor(max[0] / cell); x++) for (let y = Math.floor(min[1] / cell); y <= Math.floor(max[1] / cell); y++) for (let z = Math.floor(min[2] / cell); z <= Math.floor(max[2] / cell); z++) run(`${x},${y},${z}`);
  };
  for (const route of park.routes) for (let i = 1; i < route.path.length; i++) {
    const a = route.path[i - 1], b = route.path[i];
    visit(a.map((v, k) => Math.min(v, b[k])) as Vec3, a.map((v, k) => Math.max(v, b[k])) as Vec3, key => { const list = cells.get(key) ?? []; list.push([a, b]); cells.set(key, list); });
  }
  const rejected = new Set<ParkPart>(), records = made.get(park);
  park.plantings = park.plantings.filter(plant => {
    const bounds = plantingBounds(plant), center: Vec3 = [plant.pos[0], plant.pos[1] + bounds.height / 2, plant.pos[2]];
    const radius = Math.hypot(bounds.radius, bounds.height / 2) + 0.8;
    let clear = true;
    visit(center.map(v => v - radius) as Vec3, center.map(v => v + radius) as Vec3, key => {
      if (!clear) return;
      for (const [a, b] of cells.get(key) ?? []) {
        const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
        const f = clamp(((center[0] - a[0]) * dx + (center[1] - a[1]) * dy + (center[2] - a[2]) * dz) / (dx * dx + dy * dy + dz * dz || 1), 0, 1);
        if (distance(center, [a[0] + dx * f, a[1] + dy * f, a[2] + dz * f]) < radius) { clear = false; break; }
      }
    });
    if (!clear) for (const proxy of records?.get(plant) ?? []) rejected.add(proxy);
    return clear;
  });
  const through = plantingsThroughBuiltGeometry(park);
  if (through.size) {
    park.plantings = park.plantings.filter(plant => {
      if (!through.has(plant)) return true;
      for (const proxy of records?.get(plant) ?? []) rejected.add(proxy);
      return false;
    });
  }
  if (rejected.size) { const oldParts = park.parts; park.parts = park.parts.filter(part => !rejected.has(part)); remapConstructionJoints(park, oldParts); }
}
