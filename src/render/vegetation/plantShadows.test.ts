import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../contracts';
import { yawPoint } from '../../world/park/math';
import type { ParkPlanting } from '../../world/park/types';
import type { RTPrimitive } from '../contracts';
import { buildRtProxies } from './colliders';
import { KIND } from './meshBuilder';
import type { InstanceSet } from './placement';
import { parkCanopyProxies, parkWoodProxies } from './parkPlanting';
import { MAX_CANOPY_SPHERES, MAX_WOOD_CAPSULES } from './plantShadows';
import { buildTreeLods } from './treeGen';
import type { Limb } from './treePlan';
import { VARIANT_DEFS, variantPlan } from './variants';

/**
 * A tree's ray-traced shadow must be the shadow of the tree that is drawn: the wood proxies lie along the drawn trunk and limbs at about their
 * thickness, and the canopy spheres fill about the volume the drawn leaves fill. The same checks run on the park's planted trees and on the natural forest.
 */

const at = { pos: [5, 12, -3] as Vec3, yaw: 1.1, scale: 0.7 };
const planting = (variant: number): ParkPlanting => ({ ...at, variant, tint: [1, 1, 1] });
const world = (p: Vec3): Vec3 => yawPoint(at.pos, at.yaw, [p[0] * at.scale, p[1] * at.scale, p[2] * at.scale]);

function oneInstance(variant: number): InstanceSet {
  return { count: 1, pos: Float32Array.from(at.pos), scale: Float32Array.of(at.scale), yaw: Float32Array.of(at.yaw), variant: Uint8Array.of(variant), tint: Uint32Array.of(0), nrm: Uint32Array.of(0), pathDist: Float32Array.of(0) };
}
const noRocks = (): InstanceSet => ({ ...oneInstance(0), count: 0 });

/** The shadow primitives a variant gets from each of the two places that draw tree shadows. */
const parkShadows = (variant: number): RTPrimitive[] => [...parkCanopyProxies([planting(variant)]), ...parkWoodProxies([planting(variant)])];
const forestShadows = (variant: number): RTPrimitive[] => buildRtProxies({ plants: oneInstance(variant), rocks: noRocks(), trees: 1, bushes: 0, obstacleTrees: 0, plantRing: new Float32Array(1) }, at.pos);

/** Voxels (side `cell`) holding a sample of any leaf or needle card of the drawn mesh, with the cards sampled finely enough that a big flat frond counts for its area. */
function drawnLeafVoxels(variant: number, cell: number): Set<string> {
  const mesh = buildTreeLods(variantPlan(variant)!, VARIANT_DEFS[variant].seed)[0], voxels = new Set<string>();
  for (let t = 0; t < mesh.idx.length; t += 3) {
    const ids = [mesh.idx[t], mesh.idx[t + 1], mesh.idx[t + 2]];
    if (mesh.attr[ids[0] * 4 + 2] < KIND.leaf) continue;
    const c = ids.map((i): Vec3 => [mesh.pos[i * 3], mesh.pos[i * 3 + 1], mesh.pos[i * 3 + 2]]);
    const longest = Math.max(...[[0, 1], [1, 2], [2, 0]].map(([a, b]) => Math.hypot(c[a][0] - c[b][0], c[a][1] - c[b][1], c[a][2] - c[b][2])));
    const n = Math.max(1, Math.min(40, Math.ceil(longest * at.scale / (cell / 3))));
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
      const p = world([0, 1, 2].map(k => c[0][k] + (c[1][k] - c[0][k]) * i / n + (c[2][k] - c[0][k]) * j / n) as Vec3);
      voxels.add(`${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)},${Math.floor(p[2] / cell)}`);
    }
  }
  return voxels;
}

/** Intersection over union of the drawn leaf voxels and the voxels whose centres lie inside any of the spheres. */
function canopyOverlap(variant: number, prims: readonly RTPrimitive[]): number {
  const cell = Math.max(...variantPlan(variant)!.crownR) * at.scale / 11, drawn = drawnLeafVoxels(variant, cell), filled = new Set<string>();
  for (const p of prims) {
    if (p.type !== 'sphere') continue;
    const r = Math.ceil(p.radius / cell) + 1, cx = Math.floor(p.center[0] / cell), cy = Math.floor(p.center[1] / cell), cz = Math.floor(p.center[2] / cell);
    for (let x = cx - r; x <= cx + r; x++) for (let y = cy - r; y <= cy + r; y++) for (let z = cz - r; z <= cz + r; z++) {
      if (Math.hypot((x + 0.5) * cell - p.center[0], (y + 0.5) * cell - p.center[1], (z + 0.5) * cell - p.center[2]) <= p.radius) filled.add(`${x},${y},${z}`);
    }
  }
  let both = 0;
  for (const key of filled) if (drawn.has(key)) both++;
  return both / (filled.size + drawn.size - both);
}

type Capsule = Extract<RTPrimitive, { type: 'capsule' }>;
const capsules = (prims: readonly RTPrimitive[]): Capsule[] => prims.filter((p): p is Capsule => p.type === 'capsule');

/** Distance from point p to segment ab. */
function segmentDistance(p: Vec3, a: Vec3, b: Vec3): { d: number; t: number } {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2] || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / l2));
  return { d: Math.hypot(p[0] - a[0] - ab[0] * t, p[1] - a[1] - ab[1] * t, p[2] - a[2] - ab[2] * t), t };
}

/** The drawn wood: points along a limb's centreline every ~0.1 m with the bark radius there, in world space. */
function centreline(limb: Limb): { p: Vec3; radius: number }[] {
  const out: { p: Vec3; radius: number }[] = [];
  for (let i = 0; i + 1 < limb.pts.length; i++) {
    const a = limb.pts[i], b = limb.pts[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * at.scale / 0.1));
    for (let k = 0; k < n; k++) {
      const f = k / n;
      out.push({ p: world([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]), radius: (limb.radii[i] + (limb.radii[i + 1] - limb.radii[i]) * f) * at.scale });
    }
  }
  return out;
}

/** How much of the drawn wood a set of capsules lies inside of, and the thinnest a capsule is against the bark it stands for. */
function woodFit(limbs: readonly Limb[], prims: readonly RTPrimitive[]): { covered: number; thinnest: number } {
  const caps = capsules(prims), samples = limbs.flatMap(centreline);
  let covered = 0, thinnest = Infinity;
  for (const s of samples) {
    let best = Infinity, radius = 0;
    for (const c of caps) { const { d } = segmentDistance(s.p, c.a, c.b); if (d - c.radius < best) { best = d - c.radius; radius = c.radius; } }
    if (best <= 0) { covered++; thinnest = Math.min(thinnest, radius / s.radius); }
  }
  return { covered: covered / samples.length, thinnest };
}

/** The thick wood the proxies claim to stand for: the trunk, and the roots of the thickest primary limbs (the first half metre, while the bark is still over half its base width). Surface roots lie in the ground and are left out. */
function thickLimbs(variant: number, limbCount: number): Limb[] {
  // Stems from just under the ground up: the foot below it is buried and casts nothing.
  const plan = variantPlan(variant)!, out: Limb[] = plan.limbs.filter(l => l.order === 0).map(l => { const k = Math.max(0, l.pts.findIndex(p => p[1] >= -0.2)); return { ...l, pts: l.pts.slice(k), radii: l.radii.slice(k) }; });
  const limbs = plan.limbs.filter(l => l.order === 1 && !l.root && l.radii[0] * at.scale >= 0.07).sort((a, b) => b.radii[0] - a.radii[0]).slice(0, limbCount);
  for (const limb of limbs) { let end = 1; let along = 0;
    while (end + 1 < limb.pts.length && limb.radii[end + 1] >= 0.5 * limb.radii[0] && along < 0.5) { along += Math.hypot(limb.pts[end + 1][0] - limb.pts[end][0], limb.pts[end + 1][1] - limb.pts[end][1], limb.pts[end + 1][2] - limb.pts[end][2]); end++; } out.push({ ...limb, pts: limb.pts.slice(0, end + 1), radii: limb.radii.slice(0, end + 1) }); }
  return out;
}

const TREES = [0, 1, 2, 3, 4, 5];
const ALL = [0, 1, 2, 3, 4, 5, 6, 7];

describe('a tree\'s ray-traced shadow is the shadow of the tree that is drawn', () => {
  for (const [name, shadows] of [['park', parkShadows], ['forest', forestShadows]] as const) {
    it(`${name}: the canopy spheres fill about the volume the drawn leaves fill, for every plant`, () => {
      for (const variant of ALL) {
        const prims = shadows(variant), spheres = prims.filter(p => p.type === 'sphere');
        expect(spheres.length, VARIANT_DEFS[variant].name).toBeGreaterThanOrEqual(1);
        expect(spheres.length).toBeLessThanOrEqual(MAX_CANOPY_SPHERES);
        // 0.3: an open-grown oak's crown is a dome of leaf masses round open air, which a few solid spheres cover less tightly than a
        // conifer's cone (the oak scores 0.32).
        expect(canopyOverlap(variant, prims), VARIANT_DEFS[variant].name).toBeGreaterThanOrEqual(0.3);
      }
    // Voxelising every plant's drawn leaves takes a few seconds, minutes when the whole suite runs in parallel.
    }, 180000);
  }

  it('park: the wood capsules lie inside the drawn trunk and thick limbs and are about as thick as them', () => {
    for (const variant of TREES) {
      const prims = parkWoodProxies([planting(variant)]), fit = woodFit(thickLimbs(variant, 2), prims);
      expect(prims.length, VARIANT_DEFS[variant].name).toBeLessThanOrEqual(MAX_WOOD_CAPSULES);
      expect(fit.covered, `${VARIANT_DEFS[variant].name}: share of the drawn trunk and thick limbs inside a capsule`).toBeGreaterThanOrEqual(0.9);
      expect(fit.thinnest, `${VARIANT_DEFS[variant].name}: thinnest capsule against the bark it covers`).toBeGreaterThanOrEqual(0.5);
    }
  });

  it('forest: the trunk capsules follow the leaning drawn trunk', () => {
    for (const variant of TREES) {
      const fit = woodFit(thickLimbs(variant, 0), forestShadows(variant));
      expect(fit.covered, VARIANT_DEFS[variant].name).toBeGreaterThanOrEqual(0.9);
      expect(fit.thinnest, VARIANT_DEFS[variant].name).toBeGreaterThanOrEqual(0.5);
    }
  });

  it('every wood capsule is centred on drawn wood and never floats off it', () => {
    for (const variant of TREES) {
      const plan = variantPlan(variant)!, skeleton = plan.limbs.filter(l => l.order <= 1).flatMap(centreline);
      for (const c of [...capsules(parkWoodProxies([planting(variant)])), ...capsules(forestShadows(variant))]) {
        for (const f of [0, 0.25, 0.5, 0.75, 1]) {
          const p: Vec3 = [c.a[0] + (c.b[0] - c.a[0]) * f, c.a[1] + (c.b[1] - c.a[1]) * f, c.a[2] + (c.b[2] - c.a[2]) * f];
          const near = skeleton.reduce((best, s) => { const d = Math.hypot(p[0] - s.p[0], p[1] - s.p[1], p[2] - s.p[2]); return d < best.d ? { d, radius: s.radius } : best; }, { d: Infinity, radius: 0 });
          expect(near.d, `${VARIANT_DEFS[variant].name} capsule at ${f}`).toBeLessThanOrEqual(near.radius + 0.1);
        }
      }
    }
  });
});
