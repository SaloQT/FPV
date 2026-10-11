import { describe, expect, it } from 'vitest';
import { Rng } from '../../world/track/rng';
import { resolveShader } from '../shaderLib';
import { KIND } from './meshBuilder';
import { nearestWood } from './treeAttachments';
import { buildTreeLods, type TreeContactAudit } from './treeGen';
import { birchPainter, newSample, shrubPainter, sprigPainter } from './treeLeafShapes';
import { sprayPainter } from './treeNeedleShapes';
import type { Limb, TreePlan } from './treePlan';
import { VARIANT_DEFS, variantPlan } from './variants';

describe('tree geometry attachments', () => {
  it('puts every near foliage stem on an emitted woody segment with a stationary attachment vertex', () => {
    let checked = 0;
    for (let variant = 0; variant < 8; variant++) {
      const audit: TreeContactAudit = { wood: [], foliage: [] }, mesh = buildTreeLods(variantPlan(variant)!, VARIANT_DEFS[variant].seed, audit)[0], wood = new Set(audit.wood);
      let foliage = 0, roots = 0, next = audit.foliage[0]?.span ?? 5;
      for (let i = 0; i < mesh.vertexCount; i++) {
        if (mesh.attr[i * 4 + 2] < KIND.leaf) continue;
        foliage++;
        if (foliage < next) continue;
        const attachment = audit.foliage[roots++];
        next += audit.foliage[roots]?.span ?? 5;
        expect(wood.has(attachment.limb)).toBe(true);
        expect(nearestWood([attachment.limb], attachment.point).distance).toBeLessThan(1e-8);
        expect(mesh.attr[i * 4 + 1]).toBe(0);
        for (let k = 0; k < 3; k++) expect(mesh.pos[i * 3 + k]).toBe(Math.fround(attachment.point[k]));
      }
      expect(foliage).toBe(audit.foliage.reduce((n, f) => n + (f.span ?? 5), 0)); expect(roots).toBe(audit.foliage.length);
      expect(roots).toBeGreaterThan(0); checked += roots;
      if (VARIANT_DEFS[variant].group === 'tree') {
        const trunk = audit.wood[0]; expect(trunk.pts[0][1]).toBeLessThan(0); expect(trunk.pts.some(p => p[1] > 0)).toBe(true);
      }
    }
    expect(checked).toBeGreaterThan(7000);
  }, 60000);

  it('retains a curved parent and its real terminal radius where a child forks near its tip', () => {
    const trunk: Limb = { pts: [[0, -0.3, 0], [0, 1, 0]], radii: [0.15, 0.1], order: 0 };
    const parent: Limb = { pts: [[0, 1, 0], [0.2, 1.2, 0.2], [0.4, 1.45, 0], [0.6, 1.6, 0.2], [0.8, 1.8, 0]], radii: [0.03, 0.026, 0.022, 0.018, 0.014], order: 3, parent: trunk };
    const child: Limb = { pts: [[0.7, 1.7, 0.1], [0.85, 1.9, 0.25]], radii: [0.008, 0.004], order: 4, parent };
    const plan: TreePlan = { species: 'oak', height: 2, crownC: [0, 1.5, 0], crownR: [1, 1, 1], trunkRadius: 0.15, bark: KIND.bark,
      limbs: [trunk, parent, child], clusters: [], fronds: [], cardsPerCluster: 0, cardSize: 0.2, radial: false, foliage: KIND.leaf, trunkSides: [8, 6, 4] };
    const audit: TreeContactAudit = { wood: [], foliage: [] }, mesh = buildTreeLods(plan, 13, audit)[0];
    expect(audit.wood[1].pts).toEqual(parent.pts);
    expect(nearestWood([audit.wood[1]], child.pts[0]).distance).toBeLessThan(1e-10);
    // Actual parent tube begins after the two nine-vertex trunk rings; its four-sided last ring stays finite.
    const first = 18 + 4 * 5, center = parent.pts[4];
    for (let j = 0; j < 4; j++) expect(Math.hypot(...center.map((x, k) => mesh.pos[(first + j) * 3 + k] - x))).toBeCloseTo(parent.radii[4], 6);
  });

  it('keeps the painted leaf and needle silhouettes within the economical anchored-card polygon', () => {
    for (const [make, stemV] of [[sprigPainter, 0.96], [birchPainter, 0.96], [shrubPainter, 0.96], [sprayPainter, 0.97]] as const) {
      const paint = make(new Rng(1337)), sample = newSample(); let opaque = 0, clipped = 0;
      for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
        const u = (x + 0.5) / 128, v = (y + 0.5) / 128;
        if (!paint(u, v, sample)) continue; opaque++;
        const half = v <= 0.92 ? 0.5 : 0.5 * (stemV - v) / (stemV - 0.92);
        if (Math.abs(u - 0.5) > half) clipped++;
      }
      expect(clipped / opaque).toBeLessThan(0.001);
    }
  });

  it('uses a common structural wind field and zero flexible displacement at park foliage roots', () => {
    const shader = resolveShader('vegetation/tree.wgsl');
    expect(shader).toContain('let structural = select(');
    expect(shader).toContain('0.0, anchored)');
    // Flutter weighs a vertex by where it is in the crown, the same for wood and leaves; on park plants (rigid wood) by the sway weight, 0 at the roots.
    expect(shader).toContain('v.shape.w * calm * scale * select(outer, sway, anchored)');
    expect(shader).not.toContain('sin(bp)');
    expect(shader).toContain('inst.nrm == PARK_PLANT_NORMAL, idPhase, time');
  });
});
