import { describe, expect, it } from 'vitest';
import { KIND, type MeshData } from './meshBuilder';
import { ROCK_FREQUENCY, ROCK_SHAPES, rockAssets } from './rockGen';
import { DRAW_COUNT, FIRST_ROCK, LOD_COUNT, VARIANT_COUNT, VARIANT_DEFS, buildVariantAssets, type VariantAsset } from './variants';

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
      expect(v.def.group === 'rock').toBe(i >= FIRST_ROCK);
    });
  });

  it('cuts the triangle count at every LOD, down to crossed cards for trees and 20 faces for rocks', () => {
    for (const v of assets()) {
      const [t0, t1, t2] = v.lods.map(tris);
      expect(t0).toBeGreaterThan(t1);
      expect(t1).toBeGreaterThan(t2);
      if (v.def.group === 'rock') {
        expect([t0, t1, t2]).toEqual([500, 80, 20]);
      } else if (v.def.group === 'tree') {
        expect(t0).toBeGreaterThan(1500);
        expect(t0).toBeLessThan(16000);
        expect(t2).toBeLessThanOrEqual(60);
      } else {
        expect(t0).toBeGreaterThan(150);
        expect(t2).toBeLessThanOrEqual(30);
      }
    }
  });

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
        else {
          expect(leaf).toBeGreaterThan(0);
          if (l === 0) expect(bark).toBeGreaterThan(0);
        }
      }
    }
  });

  it('uses brown bark tags per species: pine and birch bark differ from the oak default', () => {
    const barkOf = (v: VariantAsset): Set<number> => {
      const set = new Set<number>();
      for (let i = 0; i < v.lods[0].vertexCount; i++) if (!isLeafKind(v.lods[0].attr[i * 4 + 2])) set.add(v.lods[0].attr[i * 4 + 2]);
      return set;
    };
    const named = (n: string): VariantAsset => assets().find((v) => v.def.name === n) as VariantAsset;
    expect([...barkOf(named('pine'))]).toContain(KIND.pineBark);
    expect([...barkOf(named('birch'))]).toContain(KIND.birchBark);
    expect([...barkOf(named('oak A'))]).toContain(KIND.bark);
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
      expect(base / nBase).toBeLessThan(0.1 * (top / nTop));
      expect(top / nTop).toBeGreaterThan(100);
    }
  });

  it('gives every branch and leaf a wind phase but keeps the main trunk in phase 0', () => {
    for (const v of assets().filter((a) => a.def.group === 'tree')) {
      const m = v.lods[0];
      let trunkVerts = 0, phased = 0;
      for (let i = 0; i < m.vertexCount; i++) {
        const phase = m.attr[i * 4 + 3];
        if (m.pos[i * 3 + 1] < 0.5 && !isLeafKind(m.attr[i * 4 + 2])) { trunkVerts++; expect(phase).toBe(0); }
        else if (phase > 0) phased++;
      }
      expect(trunkVerts).toBeGreaterThan(0);
      expect(phased).toBeGreaterThan(m.vertexCount * 0.3);
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
