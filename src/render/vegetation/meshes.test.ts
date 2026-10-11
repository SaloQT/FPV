import { describe, expect, it } from 'vitest';
import { BARK_RADIUS_MAX, KIND, type MeshData } from './meshBuilder';
import { ROCK_FREQUENCY, ROCK_SHAPES, rockAssets } from './rockGen';
import { DRAW_COUNT, LOD_COUNT, VARIANT_COUNT, VARIANT_DEFS, buildVariantAssets, buildVariantAssetsSliced, isRockVariant, variantPlan, type VariantAsset } from './variants';

const VALID_KINDS = new Set<number>(Object.values(KIND));
const isLeafKind = (k: number): boolean => k >= KIND.leaf;
const tris = (m: MeshData): number => m.idx.length / 3;

const SLOW = 60000;
let built: VariantAsset[] | null = null;
const assets = (): VariantAsset[] => (built ??= buildVariantAssets());

describe('variant meshes', () => {
  it('builds every variant at three LODs with the counts the draw table expects', () => {
    const a = assets();
    expect(a.length).toBe(VARIANT_COUNT);
    expect(VARIANT_COUNT * LOD_COUNT).toBe(DRAW_COUNT);
    a.forEach((v, i) => {
      expect(v.def).toBe(VARIANT_DEFS[i]);
      expect(v.lods.length).toBe(LOD_COUNT);
      expect(v.def.group === 'rock').toBe(isRockVariant(i));
    });
  // The first test builds every variant's meshes, which takes minutes when the whole suite runs in parallel.
  }, 180000);

  it('cuts the triangle count at every LOD, down to crossed cards for trees and 20 faces for rocks', () => {
    for (const v of assets()) {
      const [t0, t1, t2] = v.lods.map(tris);
      expect(t0).toBeGreaterThan(t1);
      expect(t1).toBeGreaterThan(t2);
      if (v.def.group === 'rock') {
        expect([t0, t1, t2]).toEqual([500, 80, 20]);
      } else if (v.def.group === 'tree') {
        // A bare snag is only its trunk and broken limbs.
        expect(t0).toBeGreaterThan(v.def.name.startsWith('snag') ? 800 : 1500);
        // The ultra near-LOD budget: 32k for an oak (about 800 leaf clusters of small sprigs make its broad dome a continuous mass), 28k for
        // the other broadleaves, whose crowns are hundreds of separate clusters, 24k for a spruce (its sprays are short half-shoots either side
        // of each branch, carried on toward the trunk, so they follow the wind and clothe the branch) and for a Scots pine (many small needle clumps
        // on the outer metre of every branch and fork, treePlan.ts pineSecondaries), 16k for the rest. Only trees within the
        // near-LOD distance draw it; the mid LOD keeps the cluster count it had before.
        const plan = variantPlan(VARIANT_DEFS.indexOf(v.def));
        const cap = plan?.species === 'oak' ? 32000 : plan?.foliage === KIND.leaf ? 28000 : plan?.species === 'spruce' || plan?.species === 'pine' ? 24000 : 16000;
        expect(t0, v.def.name).toBeLessThan(cap);
        expect(t2).toBeLessThanOrEqual(60);
      } else {
        expect(t0).toBeGreaterThan(150);
        expect(t2).toBeLessThanOrEqual(30);
      }
    }
  }, SLOW);

  it('produces finite geometry with unit normals and in-range indices', () => {
    for (const v of assets()) {
      for (const m of v.lods) {
        expect(m.pos.length).toBe(m.vertexCount * 3);
        expect(m.nrm.length).toBe(m.vertexCount * 3);
        expect(m.uv.length).toBe(m.vertexCount * 2);
        expect(m.attr.length).toBe(m.vertexCount * 4);
        expect(m.idx.length % 3).toBe(0);
        let bad = 0;
        for (let i = 0; i < m.vertexCount; i++) {
          const n = Math.hypot(m.nrm[i * 3], m.nrm[i * 3 + 1], m.nrm[i * 3 + 2]);
          if (!Number.isFinite(m.pos[i * 3] + m.pos[i * 3 + 1] + m.pos[i * 3 + 2]) || Math.abs(n - 1) > 1e-3) bad++;
          if (m.uv[i * 2] < 0 || m.uv[i * 2] > 1 || m.uv[i * 2 + 1] < 0 || m.uv[i * 2 + 1] > 1) bad++;
        }
        let max = 0;
        for (const ix of m.idx) max = Math.max(max, ix);
        expect(bad).toBe(0);
        expect(max).toBeLessThan(m.vertexCount);
      }
    }
  });

  it('tags plant vertices with bark and leaf kinds and rocks with plain stone', () => {
    for (const v of assets()) {
      for (let l = 0; l < LOD_COUNT; l++) {
        const m = v.lods[l];
        let bark = 0, leaf = 0;
        for (let i = 0; i < m.vertexCount; i++) {
          const k = m.attr[i * 4 + 2];
          expect(VALID_KINDS.has(k)).toBe(true);
          if (isLeafKind(k)) leaf++; else bark++;
        }
        if (v.def.group === 'rock') expect(leaf).toBe(0);
        else if (variantPlan(VARIANT_DEFS.indexOf(v.def))?.species === 'snag') expect(leaf).toBe(0);
        else {
          expect(leaf).toBeGreaterThan(0);
          if (l === 0) expect(bark).toBeGreaterThan(0);
        }
      }
    }
  });

  it('uses its own bark tag per species: pine, birch, beech and spruce bark differ from the oak default, and snags are dead wood', () => {
    const barkOf = (v: VariantAsset): Set<number> => {
      const set = new Set<number>();
      for (let i = 0; i < v.lods[0].vertexCount; i++) if (!isLeafKind(v.lods[0].attr[i * 4 + 2])) set.add(v.lods[0].attr[i * 4 + 2]);
      return set;
    };
    const named = (n: string): VariantAsset => assets().find((v) => v.def.name === n) as VariantAsset;
    expect([...barkOf(named('pine forest'))]).toContain(KIND.pineBark);
    expect([...barkOf(named('birch'))]).toContain(KIND.birchBark);
    expect([...barkOf(named('oak open'))]).toContain(KIND.bark);
    expect([...barkOf(named('beech forest'))]).toContain(KIND.beechBark);
    expect([...barkOf(named('spruce open'))]).toContain(KIND.spruceBark);
    expect([...barkOf(named('snag conifer'))]).toEqual([KIND.deadWood]);
    // The forest pine's bare bole keeps the stubs of the limbs it shed.
    expect([...barkOf(named('pine forest'))]).toContain(KIND.deadWood);
    // Forest-grown spruces carry dead twigs below their live crown.
    expect([...barkOf(named('spruce forest'))]).toContain(KIND.deadWood);
  });

  it('builds plants near their nominal height and lets rocks rest on y = 0', () => {
    for (const v of assets()) {
      if (v.def.group === 'rock') {
        let min = Infinity;
        for (let i = 0; i < v.lods[0].vertexCount; i++) min = Math.min(min, v.lods[0].pos[i * 3 + 1]);
        expect(min).toBeCloseTo(0, 5);
        expect(v.height).toBeGreaterThan(0.3);
        expect(v.height).toBeLessThan(2);
      } else {
        expect(v.height).toBeGreaterThan(v.def.height * 0.7);
        expect(v.height).toBeLessThan(v.def.height * 1.25);
      }
      expect(v.radius).toBeGreaterThan(0);
      for (const m of v.lods) {
        for (let i = 0; i < m.vertexCount; i++) {
          expect(Math.hypot(m.pos[i * 3], m.pos[i * 3 + 1] - v.centreY, m.pos[i * 3 + 2])).toBeLessThanOrEqual(v.radius + 1e-4);
        }
      }
    }
  });

  it('weights sway by height: the trunk base is anchored and the crown moves most', () => {
    for (const v of assets().filter((a) => a.def.group !== 'rock')) {
      const m = v.lods[0];
      let base = 0, top = 0, nBase = 0, nTop = 0;
      for (let i = 0; i < m.vertexCount; i++) {
        const y = m.pos[i * 3 + 1], sway = m.attr[i * 4 + 1];
        if (y < 0.1 * v.height) { base += sway; nBase++; }
        if (y > 0.7 * v.height) { top += sway; nTop++; }
      }
      expect(nBase).toBeGreaterThan(0);
      expect(nTop).toBeGreaterThan(0);
      expect(base / nBase, v.def.name).toBeLessThan(0.1 * (top / nTop));
      // Every card's root vertex sits still on its twig (sway 0), so a crown of many small clumps (Scots pine) averages a little lower.
      expect(top / nTop, v.def.name).toBeGreaterThan(90);
    }
  });

  it('gives every leaf a wind phase and every bark vertex the radius of its limb', () => {
    for (const [index, v] of assets().entries()) {
      if (v.def.group !== 'tree') continue;
      const m = v.lods[0], plan = variantPlan(index)!;
      let trunkVerts = 0, leaves = 0, phased = 0, footRadius = 0;
      for (let i = 0; i < m.vertexCount; i++) {
        const code = m.attr[i * 4 + 3] / 255;
        if (isLeafKind(m.attr[i * 4 + 2])) { leaves++; if (code > 0) phased++; continue; }
        const radius = code * code * BARK_RADIUS_MAX;
        expect(radius).toBeLessThanOrEqual(BARK_RADIUS_MAX);
        // Bark at the foot of the trunk carries the trunk's radius (the root flare swells around it; surface roots there are thinner).
        if (m.pos[i * 3 + 1] > 0.2 && m.pos[i * 3 + 1] < 0.5 && Math.hypot(m.pos[i * 3], m.pos[i * 3 + 2]) < 2 * plan.trunkRadius) { trunkVerts++; footRadius = Math.max(footRadius, radius); }
      }
      expect(trunkVerts).toBeGreaterThan(0);
      expect(footRadius).toBeGreaterThan(0.8 * plan.trunkRadius);
      if (leaves) expect(phased).toBeGreaterThan(leaves * 0.3);
    }
  });

  it('is deterministic: rebuilding gives byte-identical meshes', { timeout: SLOW }, () => {
    const again = buildVariantAssets();
    again.forEach((v, i) => {
      v.lods.forEach((m, l) => {
        const ref = assets()[i].lods[l];
        expect(m.pos).toEqual(ref.pos);
        expect(m.idx).toEqual(ref.idx);
        expect(m.attr).toEqual(ref.attr);
      });
    });
  });
});

describe('time-sliced variant build', () => {
  it('yields between variants and gives byte-identical meshes', { timeout: SLOW }, async () => {
    let hops = 0;
    const sliced = await buildVariantAssetsSliced(0, async () => { hops++; });
    expect(hops).toBeGreaterThanOrEqual(VARIANT_COUNT);
    sliced.forEach((v, i) => v.lods.forEach((m, l) => {
      const ref = assets()[i].lods[l];
      expect(m.pos).toEqual(ref.pos);
      expect(m.idx).toEqual(ref.idx);
      expect(m.attr).toEqual(ref.attr);
    }));
  });
});

describe('rock meshes', () => {
  it('has four shapes with distinct silhouettes at the 20 n^2 face counts', () => {
    const rocks = rockAssets();
    expect(rocks.length).toBe(ROCK_SHAPES);
    ROCK_FREQUENCY.forEach((n, l) => rocks.forEach((r) => expect(tris(r.lods[l])).toBe(20 * n * n)));
    const heights = rocks.map((r) => r.height);
    expect(new Set(heights.map((h) => h.toFixed(3))).size).toBe(ROCK_SHAPES);
  });

  it('keeps the farthest surface point of every shape at unit radius from its centre of displacement', () => {
    for (const r of rockAssets()) {
      let far = 0;
      for (let i = 0; i < r.lods[0].vertexCount; i++) far = Math.max(far, Math.hypot(r.lods[0].pos[i * 3], r.lods[0].pos[i * 3 + 1] - r.centreY, r.lods[0].pos[i * 3 + 2]));
      expect(far).toBeGreaterThan(0.5);
      expect(far).toBeLessThanOrEqual(r.radius + 1e-6);
    }
  });
});
