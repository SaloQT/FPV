import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../contracts';
import type { RTMaterial, RTPrimitive } from '../contracts';
import { fromHalf } from '../half';
import { BvhBuilder, NODE_WORDS, NO_ROOT, morton3, type BvhTarget } from './bvh';
import { bruteForce, intersectPrim, randomUnit, traverseBvh } from './cpuReference';
import { PRIM_WORDS, PrimKind, primBounds } from './prims';

const mat: RTMaterial = { albedo: [0.2, 0.4, 0.8], emissive: [0.5, 0.25, 2], roughness: 0.5, metalness: 1 };

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296);
  };
}

function scene(n: number, rand: () => number): RTPrimitive[] {
  const out: RTPrimitive[] = [];
  const pos = (): Vec3 => [rand() * 100 - 50, rand() * 20, rand() * 100 - 50];
  for (let i = 0; i < n; i++) {
    const k = i % 4;
    const c = pos();
    if (k === 0) out.push({ type: 'sphere', center: c, radius: 0.5 + rand() * 2, material: mat });
    else if (k === 1) out.push({ type: 'capsule', a: c, b: [c[0] + rand() * 4 - 2, c[1] + rand() * 4, c[2] + rand() * 4 - 2], radius: 0.2 + rand(), material: mat });
    else if (k === 2) {
      const q = [rand() - 0.5, rand() - 0.5, rand() - 0.5, rand() + 0.2];
      const l = Math.hypot(q[0], q[1], q[2], q[3]);
      out.push({ type: 'obb', center: c, half: [0.5 + rand() * 2, 0.5 + rand() * 2, 0.2 + rand()], rot: [q[0] / l, q[1] / l, q[2] / l, q[3] / l], material: mat });
    } else out.push({ type: 'torus', center: c, rot: [0, 0, 0, 1], major: 1 + rand() * 2, minor: 0.15 + rand() * 0.3, material: mat });
  }
  return out;
}

function target(n: number): BvhTarget {
  const nodes = new ArrayBuffer(2 * n * NODE_WORDS * 4 + 64), prims = new ArrayBuffer(n * PRIM_WORDS * 4 + 64);
  return { nodesF: new Float32Array(nodes), nodesU: new Uint32Array(nodes), primsF: new Float32Array(prims), primsU: new Uint32Array(prims) };
}

describe('morton3', () => {
  it('interleaves 10-bit axes with x in the highest position', () => {
    expect(morton3(1, 0, 0)).toBe(4);
    expect(morton3(0, 1, 0)).toBe(2);
    expect(morton3(0, 0, 1)).toBe(1);
    expect(morton3(1023, 1023, 1023)).toBe(0x3fffffff);
  });
});

describe('BvhBuilder', () => {
  it('returns an empty result for no primitives', () => {
    expect(new BvhBuilder().build([], target(1), 0, 0)).toEqual({ root: NO_ROOT, nodeCount: 0, primCount: 0 });
  });

  it('gives every leaf a valid slot range, contained bounds and each primitive exactly once', () => {
    const prims = scene(300, rng(1));
    const t = target(prims.length);
    const b = new BvhBuilder();
    const r = b.build(prims, t, 0, 0);
    expect(r.primCount).toBe(300);
    expect(r.nodeCount).toBeLessThanOrEqual(2 * 300);
    const seen = new Uint8Array(300);
    const bounds = new Float32Array(6);
    let maxDepth = 0;
    const walk = (n: number, depth: number, parent: Float32Array | null): void => {
      maxDepth = Math.max(maxDepth, depth);
      const w = n * NODE_WORDS;
      const box = new Float32Array([t.nodesF[w], t.nodesF[w + 1], t.nodesF[w + 2], t.nodesF[w + 4], t.nodesF[w + 5], t.nodesF[w + 6]]);
      if (parent) for (let k = 0; k < 3; k++) { expect(box[k]).toBeGreaterThanOrEqual(parent[k]); expect(box[k + 3]).toBeLessThanOrEqual(parent[k + 3]); }
      const count = t.nodesU[w + 7];
      if (count === 0) {
        walk(t.nodesU[w + 3], depth + 1, box);
        walk(t.nodesU[w + 3] + 1, depth + 1, box);
        return;
      }
      for (let i = 0; i < count; i++) {
        const slot = t.nodesU[w + 3] + i;
        const idx = b.sortedOrder[slot];
        seen[idx]++;
        primBounds(prims[idx], bounds);
        for (let k = 0; k < 3; k++) { expect(bounds[k]).toBeGreaterThanOrEqual(box[k] - 1e-4); expect(bounds[k + 3]).toBeLessThanOrEqual(box[k + 3] + 1e-4); }
      }
    };
    walk(r.root, 0, null);
    expect(Array.from(seen).every((v) => v === 1)).toBe(true);
    expect(maxDepth).toBeLessThan(31);
  });

  it('keeps depth bounded when many primitives share one Morton code', () => {
    const prims: RTPrimitive[] = Array.from({ length: 1000 }, () => ({ type: 'sphere', center: [1, 2, 3], radius: 0.5, material: mat }));
    const t = target(prims.length);
    const r = new BvhBuilder().build(prims, t, 0, 0);
    let maxDepth = 0;
    const walk = (n: number, depth: number): void => {
      maxDepth = Math.max(maxDepth, depth);
      if (t.nodesU[n * NODE_WORDS + 7] === 0) { walk(t.nodesU[n * NODE_WORDS + 3], depth + 1); walk(t.nodesU[n * NODE_WORDS + 3] + 1, depth + 1); }
    };
    walk(r.root, 0);
    expect(maxDepth).toBeLessThanOrEqual(12);
  });

  it('uses absolute node and primitive indices so two trees can share buffers', () => {
    const rand = rng(3);
    const a = scene(40, rand), b = scene(9, rand);
    const t = target(60);
    const ra = new BvhBuilder().build(a, t, 0, 0);
    const bb = new BvhBuilder();
    const rb = bb.build(b, t, ra.nodeCount, ra.primCount);
    expect(rb.root).toBe(ra.nodeCount);
    const o: Vec3 = [-80, 5, -80];
    for (let i = 0; i < 200; i++) {
      const d = randomUnit(rand);
      const ref = bruteForce(b, o, d, 1e4);
      const got = traverseBvh(t.nodesF, t.nodesU, rb.root, b, bb.sortedOrder, ra.primCount, o, d, 1e4);
      expect(got.index).toBe(ref.index);
    }
  });

  it('traversal matches brute force on random rays', () => {
    const rand = rng(7);
    const prims = scene(400, rand);
    const t = target(prims.length);
    const b = new BvhBuilder();
    const r = b.build(prims, t, 0, 0);
    let hits = 0;
    for (let i = 0; i < 500; i++) {
      const o: Vec3 = [rand() * 120 - 60, rand() * 30, rand() * 120 - 60];
      const d = randomUnit(rand);
      const ref = bruteForce(prims, o, d, 500);
      const got = traverseBvh(t.nodesF, t.nodesU, r.root, prims, b.sortedOrder, 0, o, d, 500);
      if (ref.index >= 0) hits++;
      expect(got.index).toBe(ref.index);
      if (ref.index >= 0) expect(got.t).toBeCloseTo(ref.t, 9);
    }
    expect(hits).toBeGreaterThan(50);
  });

  it('packs kind, radius and material into the 64-byte record', () => {
    const t = target(2);
    new BvhBuilder().build([{ type: 'torus', center: [1, 2, 3], rot: [0, 0, 0, 1], major: 2, minor: 0.25, material: mat }], t, 0, 0);
    expect(t.primsU[3]).toBe(PrimKind.Torus);
    expect(Array.from(t.primsF.slice(0, 3))).toEqual([1, 2, 3]);
    expect(t.primsF[4]).toBe(2);
    expect(t.primsF[7]).toBe(0.25);
    expect(t.primsU[12] & 0xff).toBe(51);
    expect(t.primsU[12] >>> 24).toBe(128);
    expect(fromHalf(t.primsU[13] & 0xffff)).toBe(0.5);
    expect(fromHalf(t.primsU[13] >>> 16)).toBe(0.25);
    expect(fromHalf(t.primsU[14] & 0xffff)).toBe(2);
    expect(fromHalf(t.primsU[14] >>> 16)).toBe(1);
  });
});

describe('cpu intersections', () => {
  const d: Vec3 = [0, 0, 1];
  it('sphere, capsule and obb report the entry distance and ignore rays starting inside', () => {
    expect(intersectPrim({ type: 'sphere', center: [0, 0, 10], radius: 2, material: mat }, [0, 0, 0], d, 100)).toBeCloseTo(8, 9);
    expect(intersectPrim({ type: 'sphere', center: [0, 0, 0], radius: 2, material: mat }, [0, 0, 0], d, 100)).toBe(Infinity);
    expect(intersectPrim({ type: 'capsule', a: [-3, 0, 10], b: [3, 0, 10], radius: 1, material: mat }, [0, 0, 0], d, 100)).toBeCloseTo(9, 9);
    expect(intersectPrim({ type: 'capsule', a: [0, 0, 10], b: [0, 0, 14], radius: 1, material: mat }, [0, 0, 0], d, 100)).toBeCloseTo(9, 9);
    expect(intersectPrim({ type: 'obb', center: [0, 0, 10], half: [1, 1, 2], rot: [0, 0, 0, 1], material: mat }, [0, 0, 0], d, 100)).toBeCloseTo(8, 9);
    const s = Math.SQRT1_2;
    expect(intersectPrim({ type: 'obb', center: [0, 0, 10], half: [1, 1, 2], rot: [0, s, 0, s], material: mat }, [0, 0, 0], d, 100)).toBeCloseTo(9, 6);
  });

  it('torus lies in the local XZ plane and is hit at the outer wall from the side', () => {
    const torus: RTPrimitive = { type: 'torus', center: [0, 0, 10], rot: [0, 0, 0, 1], major: 2, minor: 0.5, material: mat };
    expect(intersectPrim(torus, [0, 0, 0], d, 100)).toBeCloseTo(7.5, 3);
    expect(intersectPrim(torus, [2, 5, 10], [0, -1, 0], 100)).toBeCloseTo(4.5, 3);
    expect(intersectPrim(torus, [0, 5, 10], [0, -1, 0], 100)).toBe(Infinity);
    expect(intersectPrim(torus, [0, 5, 10], [1, 0, 0], 100)).toBe(Infinity);
  });
});
