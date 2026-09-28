import { describe, expect, it } from 'vitest';
import { erodibilityGrid, hardnessGrid, upliftGrid } from './detail';
import { FloodWorkspace } from './flood';
import { generateTerrain } from './generate';
import { accumulateFlow } from './hydrology';
import { createShape, fillMacroHeight } from './shape';
import { streamPowerErode } from './stream';
import { TUNING } from './tuning';

const N = 128;
const CELL = 12;
const RELIEF = 220;

function drain(gen: Generator<void>): void {
  while (gen.next().done !== true) {
    // run to completion
  }
}

/**
 * Carve the shared macro shape with the stream-power law. With erodibility 0 nothing can be cut, which gives the baseline
 * that shows how much of the channel relief is genuinely eroded rather than inherited from the macro shape.
 */
function carve(seed: number, erodible: boolean): { height: Float32Array; area: Float32Array } {
  const extent = N * CELL;
  const shape = createShape(seed, extent, RELIEF);
  const height = new Float32Array(N * N);
  fillMacroHeight(height, N, CELL, shape, 4 * CELL);
  const hard = hardnessGrid(N, CELL, shape);
  const uplift = upliftGrid(height, RELIEF, TUNING.spl.uplift, TUNING.spl.upliftFloor);
  const erodibility = erodibilityGrid(hard, erodible ? TUNING.spl.softErodibility : 0, erodible ? TUNING.spl.hardErodibility : 0);
  const params = { iterations: 40, k: TUNING.spl.k, diffusion: TUNING.spl.diffusion, edgeDrop: TUNING.spl.edgeSlope * CELL };
  drain(streamPowerErode(height, N, uplift, erodibility, params, () => {}));
  const ws = new FloodWorkspace(N);
  ws.fill(height);
  const area = new Float32Array(N * N);
  drain(accumulateFlow(ws, area, () => {}));
  return { height, area };
}

/** How far the main drainage lines sit below the ground around them, as a fraction of the total relief. */
function channelIncision(height: Float32Array, area: Float32Array): number {
  const ranked = Array.from(area.keys()).sort((a, b) => area[b] - area[a]);
  const channels = ranked.slice(0, Math.floor(N * N * 0.03));
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of height) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  let total = 0;
  for (const k of channels) {
    const ci = k % N;
    const cj = Math.floor(k / N);
    let sum = 0;
    let count = 0;
    for (let dj = -3; dj <= 3; dj++) {
      for (let di = -3; di <= 3; di++) {
        const i = ci + di;
        const j = cj + dj;
        if (i < 0 || j < 0 || i >= N || j >= N) continue;
        sum += height[j * N + i];
        count++;
      }
    }
    total += sum / count - height[k];
  }
  return total / channels.length / (hi - lo);
}

function pearson(a: Float32Array, b: Float32Array): number {
  const n = a.length;
  let ma = 0;
  let mb = 0;
  for (let k = 0; k < n; k++) {
    ma += a[k];
    mb += b[k];
  }
  ma /= n;
  mb /= n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let k = 0; k < n; k++) {
    const x = a[k] - ma;
    const y = b[k] - mb;
    sab += x * y;
    saa += x * x;
    sbb += y * y;
  }
  return sab / Math.sqrt(saa * sbb);
}

function ranks(a: Float32Array): Float32Array {
  const order = Array.from(a.keys()).sort((p, q) => a[p] - a[q]);
  const out = new Float32Array(a.length);
  order.forEach((k, r) => {
    out[k] = r;
  });
  return out;
}

/** Discrete Laplacian at the given radius over interior cells, divided by r^2 so it is a curvature in 1/m. */
function laplacian(h: Float32Array, r: number): Float32Array {
  const out = new Float32Array(N * N);
  for (let j = r; j < N - r; j++) {
    for (let i = r; i < N - r; i++) {
      const k = j * N + i;
      out[k] = (h[k - r] + h[k + r] + h[k - r * N] + h[k + r * N] - 4 * h[k]) / (r * r * CELL * CELL);
    }
  }
  return out;
}

/** Correlation of drainage with concavity: positive Laplacian means the ground curves up around a cell, as in a valley. */
function flowConcavity(seed: number, r: number, rank: boolean): number {
  const d = generateTerrain({ seed, quality: 'low', resolution: N, cellSize: CELL });
  const lap = laplacian(d.height, r);
  const flow = new Float32Array(N * N);
  const curve = new Float32Array(N * N);
  let count = 0;
  for (let j = r; j < N - r; j++) {
    for (let i = r; i < N - r; i++) {
      flow[count] = d.maps.flow[j * N + i];
      curve[count] = lap[j * N + i];
      count++;
    }
  }
  const f = flow.subarray(0, count);
  const c = curve.subarray(0, count);
  return rank ? pearson(ranks(f), ranks(c)) : pearson(f, c);
}

describe('fluvial erosion', () => {
  it('cuts valleys far deeper than an unerodable baseline over the same macro shape', () => {
    for (const seed of [1, 1337]) {
      const eroded = carve(seed, true);
      const baseline = carve(seed, false);
      const cut = channelIncision(eroded.height, eroded.area);
      const inherited = channelIncision(baseline.height, baseline.area);
      expect(cut).toBeGreaterThan(0.015);
      expect(cut).toBeGreaterThan(3 * inherited);
    }
  });

  it('lowers the ground where water gathers relative to where it does not', () => {
    const { height, area } = carve(7, true);
    const ranked = Array.from(area.keys()).sort((a, b) => area[b] - area[a]);
    const wet = ranked.slice(0, Math.floor(N * N * 0.03));
    const dry = ranked.slice(Math.floor(N * N * 0.5));
    let wetSum = 0;
    let drySum = 0;
    for (const k of wet) wetSum += height[k];
    for (const k of dry) drySum += height[k];
    expect(wetSum / wet.length).toBeLessThan(drySum / dry.length);
  });

  it('keeps every carved height finite', () => {
    const { height } = carve(3, true);
    for (const v of height) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('flow follows concavity', () => {
  it('correlates positively with valley curvature at the scale of a valley (r = 6 cells)', () => {
    for (const seed of [1, 7, 1337]) expect(flowConcavity(seed, 6, false)).toBeGreaterThan(0.2);
  });

  it('correlates in rank order too, which is insensitive to a few extreme cells (r = 2 cells)', () => {
    for (const seed of [1, 7, 1337]) expect(flowConcavity(seed, 2, true)).toBeGreaterThan(0.25);
  });
});
