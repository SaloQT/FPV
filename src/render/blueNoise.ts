/**
 * Void-and-cluster blue noise (Ulichney 1993) on a torus. Phases 2 and 3 of the original paper are the same operation on the
 * "energy of ones" field (largest void == tightest cluster of zeros), so ranks are assigned by one insertion loop after the
 * initial-pattern relaxation and the descending removal pass.
 */

export const BLUE_NOISE_SIZE = 128;
const SIGMA = 1.5;
const RADIUS = 6;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296);
  };
}

/** Returns a permutation of 0..size^2-1 (the rank of each pixel); ranks are spatially well distributed (blue). */
export function voidAndClusterRanks(size: number, seed: number): Uint16Array {
  const n = size * size, mask = size - 1, shift = Math.log2(size);
  const bin = new Uint8Array(n);
  const energy = new Float64Array(n);
  const ranks = new Uint16Array(n);
  const width = 2 * RADIUS + 1;
  const kernel = new Float64Array(width * width);
  for (let dy = -RADIUS; dy <= RADIUS; dy++) for (let dx = -RADIUS; dx <= RADIUS; dx++) kernel[(dy + RADIUS) * width + dx + RADIUS] = Math.exp(-(dx * dx + dy * dy) / (2 * SIGMA * SIGMA));

  // Per-row best candidates: a splat only changes 2 * RADIUS + 1 rows, so only those are rescanned (same first-index tie-break as a full scan).
  const rowOneVal = new Float64Array(size), rowVoidVal = new Float64Array(size);
  const rowOneIdx = new Int32Array(size), rowVoidIdx = new Int32Array(size);
  const dirty = new Uint8Array(size).fill(1);

  const splat = (idx: number, sign: number): void => {
    const x = idx & mask, y = idx >> shift;
    for (let dy = -RADIUS; dy <= RADIUS; dy++) {
      const r = (y + dy) & mask, row = r * size;
      const krow = (dy + RADIUS) * width + RADIUS;
      for (let dx = -RADIUS; dx <= RADIUS; dx++) energy[row + ((x + dx) & mask)] += sign * kernel[krow + dx];
      dirty[r] = 1;
    }
  };
  const refresh = (): void => {
    for (let r = 0; r < size; r++) {
      if (!dirty[r]) continue;
      dirty[r] = 0;
      let ov = -Infinity, oi = -1, vv = Infinity, vi = -1;
      for (let i = r * size, end = i + size; i < end; i++) {
        const e = energy[i];
        if (bin[i]) { if (e > ov) { ov = e; oi = i; } } else if (e < vv) { vv = e; vi = i; }
      }
      rowOneVal[r] = ov; rowOneIdx[r] = oi; rowVoidVal[r] = vv; rowVoidIdx[r] = vi;
    }
  };
  const tightestOne = (): number => {
    refresh();
    let best = -1, bv = -Infinity;
    for (let r = 0; r < size; r++) if (rowOneVal[r] > bv) { bv = rowOneVal[r]; best = rowOneIdx[r]; }
    return best;
  };
  const largestVoid = (): number => {
    refresh();
    let best = -1, bv = Infinity;
    for (let r = 0; r < size; r++) if (rowVoidVal[r] < bv) { bv = rowVoidVal[r]; best = rowVoidIdx[r]; }
    return best;
  };

  const rand = mulberry32(seed);
  const ones = Math.round(n * 0.1);
  for (let placed = 0; placed < ones;) {
    const i = Math.floor(rand() * n);
    if (!bin[i]) { bin[i] = 1; splat(i, 1); placed++; }
  }
  for (let guard = 0; guard < n; guard++) {
    const c = tightestOne();
    bin[c] = 0; splat(c, -1);
    const v = largestVoid();
    bin[v] = 1; splat(v, 1);
    if (v === c) break;
  }

  const initBin = bin.slice();
  let rank = ones;
  while (rank > 0) {
    const c = tightestOne();
    ranks[c] = --rank;
    bin[c] = 0; splat(c, -1);
  }
  bin.set(initBin);
  energy.fill(0);
  dirty.fill(1);
  for (let i = 0; i < n; i++) if (bin[i]) splat(i, 1);
  for (rank = ones; rank < n; rank++) {
    const v = largestVoid();
    ranks[v] = rank;
    bin[v] = 1; splat(v, 1);
  }
  return ranks;
}

let cached: Uint8Array | null = null;

/** 128x128 rg8: two independent blue-noise channels (different seeds), each quantised from its rank so every level occurs equally often. */
export function generateBlueNoiseRG8(): Uint8Array {
  if (cached) return cached;
  const n = BLUE_NOISE_SIZE * BLUE_NOISE_SIZE;
  const a = voidAndClusterRanks(BLUE_NOISE_SIZE, 0x51ed270b);
  const b = voidAndClusterRanks(BLUE_NOISE_SIZE, 0x9e3779b9);
  const out = new Uint8Array(n * 2);
  for (let i = 0; i < n; i++) {
    out[i * 2] = Math.min(255, Math.floor(((a[i] + 0.5) / n) * 256));
    out[i * 2 + 1] = Math.min(255, Math.floor(((b[i] + 0.5) / n) * 256));
  }
  cached = out;
  return out;
}
