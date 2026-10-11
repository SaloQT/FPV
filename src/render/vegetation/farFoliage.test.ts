import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../contracts';
import { KIND, type MeshData } from './meshBuilder';
import { buildTreeLods } from './treeGen';
import { VARIANT_DEFS, variantPlan } from './variants';

/**
 * The mid-distance and far levels of detail stand a few flat cards in for a crown. Whatever the plan, those cards must keep a leafy outline from
 * every side (not a thin cross that turns edge-on), and the far level's trunk must reach up into the crown it carries.
 */

const isLeaf = (mesh: MeshData, tri: number): boolean => mesh.attr[mesh.idx[tri * 3] * 4 + 2] >= KIND.leaf;

/** Area and unit normal of each leaf-card triangle of a mesh. */
function leafFaces(mesh: MeshData): { area: number; n: Vec3 }[] {
  const out: { area: number; n: Vec3 }[] = [];
  for (let t = 0; t < mesh.idx.length / 3; t++) {
    if (!isLeaf(mesh, t)) continue;
    const p = [0, 1, 2].map(k => [0, 1, 2].map(a => mesh.pos[mesh.idx[t * 3 + k] * 3 + a]) as Vec3);
    const u = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]], v = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
    const c = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], len = Math.hypot(c[0], c[1], c[2]);
    if (len > 1e-12) out.push({ area: len / 2, n: [c[0] / len, c[1] / len, c[2] / len] });
  }
  return out;
}

/** Fibonacci spiral of unit directions over the whole sphere. */
function directions(count: number): Vec3[] {
  return Array.from({ length: count }, (_, i): Vec3 => {
    const y = 1 - (2 * (i + 0.5)) / count, r = Math.sqrt(1 - y * y), a = i * Math.PI * (3 - Math.sqrt(5));
    return [r * Math.cos(a), y, r * Math.sin(a)];
  });
}

/** Least over all view directions of the area of cards a viewer sees (each card counted by how face-on it is), divided by the most. 1 is the same from every side. */
function viewEvenness(faces: { area: number; n: Vec3 }[]): number {
  let least = Infinity, most = 0;
  for (const d of directions(400)) {
    const seen = faces.reduce((sum, f) => sum + f.area * Math.abs(f.n[0] * d[0] + f.n[1] * d[1] + f.n[2] * d[2]), 0);
    least = Math.min(least, seen); most = Math.max(most, seen);
  }
  return least / most;
}

describe('mid-distance and far foliage cards', () => {
  it('a mid-distance leaf cluster keeps its outline from every direction, from above as well as the side', () => {
    for (const variant of [3, 4, 5]) {
      const plan = variantPlan(variant)!;
      // One cluster on its own: the trunk limb stays so the mesh builds, and its bark triangles are not leaf cards.
      const alone = { ...plan, clusters: [plan.clusters[0]], limbs: plan.limbs.filter(l => l.order === 0) };
      const faces = leafFaces(buildTreeLods(alone, VARIANT_DEFS[variant].seed)[1]);
      expect(faces.length, VARIANT_DEFS[variant].name).toBeGreaterThanOrEqual(6);
      expect(viewEvenness(faces), VARIANT_DEFS[variant].name).toBeGreaterThanOrEqual(0.68);
    }
  });

  it('the far level of every tree has wood from the ground up into its crown, not a stub with the leaves floating above', () => {
    for (let variant = 0; variant < 6; variant++) {
      const plan = variantPlan(variant)!, mesh = buildTreeLods(plan, VARIANT_DEFS[variant].seed)[2];
      let wood = 0;
      for (let v = 0; v < mesh.vertexCount; v++) if (mesh.attr[v * 4 + 2] < KIND.leaf) wood = Math.max(wood, mesh.pos[v * 3 + 1]);
      expect(wood, VARIANT_DEFS[variant].name).toBeGreaterThanOrEqual(Math.min(plan.crownC[1], 0.55 * plan.height));
    }
  }, 60000);
});
