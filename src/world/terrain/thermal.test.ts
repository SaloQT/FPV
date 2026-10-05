import { describe, expect, it } from 'vitest';
import { erodeDroplets, makeBrush, type DropletParams } from './erosion';
import { Noise2D, Rng } from './noise';
import { creepSmooth, thermalErode } from './thermal';

const N = 64;
const CELL = 4;

function drain(gen: Generator<void>): void {
  while (gen.next().done !== true) {
    // run to completion
  }
}

function craggy(seed: number): Float32Array {
  const noise = new Noise2D(seed);
  const h = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const ridged = 1 - Math.abs(noise.simplex(i * 0.06, j * 0.06));
      h[j * N + i] = 60 * ridged * ridged + 3 * noise.simplex(i * 0.7, j * 0.7);
    }
  }
  return h;
}

/** Steepest step between neighbouring interior cells; the outermost ring only receives material and is never relaxed. */
function maxSlope(h: Float32Array): number {
  let worst = 0;
  for (let j = 1; j < N - 1; j++) {
    for (let i = 1; i < N - 1; i++) {
      if (i + 2 < N) worst = Math.max(worst, Math.abs(h[j * N + i + 1] - h[j * N + i]) / CELL);
      if (j + 2 < N) worst = Math.max(worst, Math.abs(h[(j + 1) * N + i] - h[j * N + i]) / CELL);
    }
  }
  return worst;
}

function total(h: Float32Array): number {
  let sum = 0;
  for (const v of h) sum += v;
  return sum;
}

function roughness(h: Float32Array): number {
  let sum = 0;
  for (let j = 1; j < N - 1; j++) {
    for (let i = 1; i < N - 1; i++) {
      const k = j * N + i;
      const lap = h[k - 1] + h[k + 1] + h[k - N] + h[k + N] - 4 * h[k];
      sum += lap * lap;
    }
  }
  return sum;
}

describe('thermalErode', () => {
  it('reduces the steepest slope toward the angle of repose', () => {
    const h = craggy(1);
    const before = maxSlope(h);
    drain(thermalErode(h, N, CELL, null, 0.7, 40, 0.5, () => {}));
    const after = maxSlope(h);
    expect(before).toBeGreaterThan(1.5);
    expect(after).toBeLessThan(before * 0.6);
    expect(after).toBeLessThan(1.3);
  });

  it('only moves material: total height is conserved', () => {
    const h = craggy(2);
    const before = total(h);
    drain(thermalErode(h, N, CELL, null, 0.7, 25, 0.5, () => {}));
    expect(Math.abs(total(h) - before) / Math.abs(before)).toBeLessThan(1e-4);
  });

  it('lets a per-cell talus keep hard rock steeper than loose soil', () => {
    const steepStep = (): Float32Array => {
      const h = new Float32Array(N * N);
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) h[j * N + i] = i < N / 2 ? 0 : 40;
      return h;
    };
    const soil = steepStep();
    drain(thermalErode(soil, N, CELL, null, 0.7, 30, 0.5, () => {}));
    const rock = steepStep();
    drain(thermalErode(rock, N, CELL, new Float32Array(N * N).fill(2.5), 0.7, 30, 0.5, () => {}));
    expect(maxSlope(rock)).toBeGreaterThan(maxSlope(soil));
  });

  it('leaves ground already below the repose angle untouched, and reports progress up to 1', () => {
    const h = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) h[j * N + i] = 0.3 * CELL * i;
    const copy = Float32Array.from(h);
    const seen: number[] = [];
    drain(thermalErode(h, N, CELL, null, 0.7, 4, 0.5, (f) => seen.push(f)));
    expect(Array.from(h)).toEqual(Array.from(copy));
    expect(seen).toEqual([0.25, 0.5, 0.75, 1]);
  });

  it('is deterministic', () => {
    const a = craggy(3);
    const b = craggy(3);
    drain(thermalErode(a, N, CELL, null, 0.7, 10, 0.5, () => {}));
    drain(thermalErode(b, N, CELL, null, 0.7, 10, 0.5, () => {}));
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});

describe('creepSmooth', () => {
  it('smooths pock marks on gentle ground', () => {
    const rng = new Rng(4);
    const h = new Float32Array(N * N);
    for (let k = 0; k < h.length; k++) h[k] = 20 + rng.range(-0.3, 0.3);
    const before = roughness(h);
    drain(creepSmooth(h, N, CELL, null, 0.25, 0.5, 3, () => {}));
    expect(roughness(h)).toBeLessThan(before * 0.3);
  });

  it('leaves steep faces alone', () => {
    const h = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) h[j * N + i] = 3 * CELL * i + ((i + j) & 1);
    const copy = Float32Array.from(h);
    drain(creepSmooth(h, N, CELL, null, 0.25, 0.5, 3, () => {}));
    expect(Array.from(h)).toEqual(Array.from(copy));
  });

  it('a zero weight map disables it', () => {
    const rng = new Rng(5);
    const h = new Float32Array(N * N);
    for (let k = 0; k < h.length; k++) h[k] = rng.range(0, 0.3);
    const copy = Float32Array.from(h);
    drain(creepSmooth(h, N, CELL, new Float32Array(N * N), 0.25, 0.5, 2, () => {}));
    expect(Array.from(h)).toEqual(Array.from(copy));
  });
});

describe('erodeDroplets', () => {
  const params: DropletParams = {
    droplets: 6000,
    lifetime: 40,
    inertia: 0.05,
    capacity: 4,
    minSlope: 0.01,
    erodeSpeed: 0.3,
    depositSpeed: 0.3,
    evaporation: 0.01,
    gravity: 4,
    radius: 3,
  };

  /** Heights in cell units, the space the pipeline runs droplets in. */
  const slopeField = (): Float32Array => {
    const noise = new Noise2D(9);
    const h = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) h[j * N + i] = 14 * (1 - j / N) + 3 * noise.simplex(i * 0.15, j * 0.15);
    return h;
  };

  it('is deterministic for a given generator and changes the terrain', () => {
    const a = slopeField();
    const b = slopeField();
    const original = Float32Array.from(a);
    drain(erodeDroplets(a, N, params, new Rng(1), null, () => {}));
    drain(erodeDroplets(b, N, params, new Rng(1), null, () => {}));
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).not.toEqual(Array.from(original));
    for (const v of a) expect(Number.isFinite(v)).toBe(true);
  });

  it('accumulates the water carried through cells and reports progress ending at 1', () => {
    const h = slopeField();
    const visits = new Float32Array(N * N);
    const seen: number[] = [];
    drain(erodeDroplets(h, N, params, new Rng(2), visits, (f) => seen.push(f)));
    expect(total(visits)).toBeGreaterThan(params.droplets);
    for (const v of visits) expect(v).toBeGreaterThanOrEqual(0);
    expect(seen.length).toBeGreaterThan(10);
    expect(seen[seen.length - 1]).toBe(1);
    for (let k = 1; k < seen.length; k++) expect(seen[k]).toBeGreaterThanOrEqual(seen[k - 1]);
  });

  it('roughly conserves material: what it carves it deposits downhill', () => {
    const h = slopeField();
    const before = total(h);
    drain(erodeDroplets(h, N, params, new Rng(3), null, () => {}));
    expect(Math.abs(total(h) - before) / before).toBeLessThan(0.05);
  });

  it('builds a unit-weight brush limited to its radius', () => {
    const brush = makeBrush(3, N);
    let sum = 0;
    for (const w of brush.weight) sum += w;
    expect(sum).toBeCloseTo(1, 5);
    for (let k = 0; k < brush.dx.length; k++) expect(Math.hypot(brush.dx[k], brush.dy[k])).toBeLessThan(3);
    expect(brush.offset[0]).toBe(brush.dy[0] * N + brush.dx[0]);
  });

  it('keeps recording water but does not write heights when erosion capacity is zero', () => {
    const source = slopeField();
    let writes = 0;
    const h = new Proxy(source, {
      set(target, key, value) { writes++; return Reflect.set(target, key, value); },
    });
    const visits = new Float32Array(N * N);
    drain(erodeDroplets(h, N, { ...params, capacity: 0, droplets: 100 }, new Rng(2), visits, () => {}));
    expect(writes).toBe(0);
    expect(total(visits)).toBeGreaterThan(100);
  });
});
