/**
 * CPU linear BVH (Morton order) over analytic RT primitives, packed for the GPU.
 *
 * Node (32 B, 8 words): bmin.xyz, a, bmax.xyz, b. Internal: b = 0 and a = index of the left child (the right child is a + 1).
 * Leaf: b = primitive count (>= 1), a = index of its first primitive. Primitive records are stored in leaf order. Node and primitive
 * indices are absolute in the shared buffers, so a static tree and a dynamic tree can live side by side (`nodeBase`/`primBase`).
 * Splits follow the highest differing Morton bit for the first RADIX_LEVELS levels, then the median, which bounds the depth at
 * RADIX_LEVELS + log2(n) <= 31 for n <= 2^17 and keeps the 32-entry shader stack safe (both roots share it, see rt_bvh.wgsl).
 * Builders own their scratch arrays, so rebuilding a small dynamic set every frame allocates nothing.
 */
import type { RTPrimitive } from '../contracts';
import { PRIM_WORDS, packPrim, primBounds } from './prims';

export const NODE_WORDS = 8;
export const NODE_BYTES = NODE_WORDS * 4;
export const NO_ROOT = 0xffffffff;
export const MAX_PRIMS = 1 << 17;
const LEAF_SIZE = 2;
const RADIX_LEVELS = 14;

export interface BvhTarget {
  nodesF: Float32Array;
  nodesU: Uint32Array;
  primsF: Float32Array;
  primsU: Uint32Array;
}

export interface BvhResult {
  /** Absolute index of the root node, or NO_ROOT for an empty set. */
  root: number;
  nodeCount: number;
  primCount: number;
}

function expandBits(v: number): number {
  v = (v * 0x00010001) & 0xff0000ff;
  v = (v * 0x00000101) & 0x0f00f00f;
  v = (v * 0x00000011) & 0xc30c30c3;
  v = (v * 0x00000005) & 0x49249249;
  return v >>> 0;
}

export function morton3(x: number, y: number, z: number): number {
  return ((expandBits(x) << 2) | (expandBits(y) << 1) | expandBits(z)) >>> 0;
}

export class BvhBuilder {
  private capacity = 0;
  private bounds = new Float32Array(0);
  private codes = new Uint32Array(0);
  private order = new Uint32Array(0);
  private tmpBounds = new Float32Array(6);
  private target!: BvhTarget;
  private prims: readonly RTPrimitive[] = [];
  private nodeBase = 0;
  private primBase = 0;
  private nextNode = 0;

  /** Sorted position -> index into the input array of the last build (valid for `primCount` entries). */
  get sortedOrder(): Uint32Array { return this.order; }

  private reserve(n: number): void {
    if (n <= this.capacity) return;
    this.capacity = Math.max(n, this.capacity * 2, 64);
    this.bounds = new Float32Array(this.capacity * 6);
    this.codes = new Uint32Array(this.capacity);
    this.order = new Uint32Array(this.capacity);
  }

  build(prims: readonly RTPrimitive[], target: BvhTarget, nodeBase: number, primBase: number): BvhResult {
    const n = Math.min(prims.length, MAX_PRIMS);
    if (n === 0) return { root: NO_ROOT, nodeCount: 0, primCount: 0 };
    this.reserve(n);
    this.target = target;
    this.prims = prims;
    this.nodeBase = nodeBase;
    this.primBase = primBase;
    const b = this.bounds, tb = this.tmpBounds;
    let lox = Infinity, loy = Infinity, loz = Infinity, hix = -Infinity, hiy = -Infinity, hiz = -Infinity;
    for (let i = 0; i < n; i++) {
      primBounds(prims[i], tb);
      for (let k = 0; k < 6; k++) b[i * 6 + k] = tb[k];
      const cx = 0.5 * (tb[0] + tb[3]), cy = 0.5 * (tb[1] + tb[4]), cz = 0.5 * (tb[2] + tb[5]);
      lox = Math.min(lox, cx); hix = Math.max(hix, cx);
      loy = Math.min(loy, cy); hiy = Math.max(hiy, cy);
      loz = Math.min(loz, cz); hiz = Math.max(hiz, cz);
    }
    const sx = 1023 / Math.max(hix - lox, 1e-6), sy = 1023 / Math.max(hiy - loy, 1e-6), sz = 1023 / Math.max(hiz - loz, 1e-6);
    for (let i = 0; i < n; i++) {
      const cx = 0.5 * (b[i * 6] + b[i * 6 + 3]), cy = 0.5 * (b[i * 6 + 1] + b[i * 6 + 4]), cz = 0.5 * (b[i * 6 + 2] + b[i * 6 + 5]);
      this.codes[i] = morton3(Math.round((cx - lox) * sx), Math.round((cy - loy) * sy), Math.round((cz - loz) * sz));
      this.order[i] = i;
    }
    this.sortOrder(n);
    for (let i = 0; i < n; i++) packPrim(target.primsF, target.primsU, (primBase + i) * PRIM_WORDS, prims[this.order[i]]);
    this.nextNode = nodeBase + 1;
    this.split(0, n, nodeBase, 0);
    return { root: nodeBase, nodeCount: this.nextNode - nodeBase, primCount: n };
  }

  private sortOrder(n: number): void {
    const codes = this.codes, order = this.order;
    if (n <= 96) {
      for (let i = 1; i < n; i++) {
        const o = order[i], c = codes[o];
        let j = i - 1;
        while (j >= 0 && codes[order[j]] > c) { order[j + 1] = order[j]; j--; }
        order[j + 1] = o;
      }
      return;
    }
    order.subarray(0, n).sort((p, q) => codes[p] - codes[q] || p - q);
  }

  private split(lo: number, hi: number, node: number, depth: number): void {
    const { nodesF, nodesU } = this.target;
    const b = this.bounds, order = this.order;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = lo; i < hi; i++) {
      const o = order[i] * 6;
      x0 = Math.min(x0, b[o]); y0 = Math.min(y0, b[o + 1]); z0 = Math.min(z0, b[o + 2]);
      x1 = Math.max(x1, b[o + 3]); y1 = Math.max(y1, b[o + 4]); z1 = Math.max(z1, b[o + 5]);
    }
    const w = node * NODE_WORDS;
    nodesF[w] = x0; nodesF[w + 1] = y0; nodesF[w + 2] = z0;
    nodesF[w + 4] = x1; nodesF[w + 5] = y1; nodesF[w + 6] = z1;
    if (hi - lo <= LEAF_SIZE) {
      nodesU[w + 3] = this.primBase + lo;
      nodesU[w + 7] = hi - lo;
      return;
    }
    let mid = (lo + hi) >> 1;
    const first = this.codes[order[lo]], last = this.codes[order[hi - 1]];
    if (first !== last && depth < RADIX_LEVELS) {
      const bit = 31 - Math.clz32(first ^ last);
      let l = lo, h = hi - 1;
      while (h - l > 1) {
        const m = (l + h) >> 1;
        if (((this.codes[order[m]] >>> bit) & 1) === 0) l = m; else h = m;
      }
      mid = h;
    }
    const child = this.nextNode;
    this.nextNode += 2;
    nodesU[w + 3] = child;
    nodesU[w + 7] = 0;
    this.split(lo, mid, child, depth + 1);
    this.split(mid, hi, child + 1, depth + 1);
  }
}
