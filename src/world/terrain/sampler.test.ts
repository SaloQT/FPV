import { describe, expect, it } from 'vitest';
import type { TerrainData, Vec3 } from '../../contracts';
import { Rng } from './noise';
import { createTerrainSampler } from './sampler';

const N = 16;
const CELL = 2;
const ORIGIN = -(N * CELL) / 2;
/** World extent covered by samples: the last vertex sits at ORIGIN + (N - 1) * CELL. */
const FAR = ORIGIN + (N - 1) * CELL;

function makeData(height: Float32Array, n = N, cell = CELL): TerrainData {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of height) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  const zero = () => new Float32Array(n * n);
  const half = -(n * cell) / 2;
  return {
    seed: 0,
    resolution: n,
    cellSize: cell,
    origin: [half, half],
    height,
    maps: { soil: zero(), flow: zero(), deposit: zero(), wetness: zero() },
    minHeight: lo,
    maxHeight: hi,
    waterLevel: -Infinity,
  };
}

function sampleField(fn: (x: number, z: number) => number, n = N, cell = CELL): TerrainData {
  const half = -(n * cell) / 2;
  const h = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) h[j * n + i] = fn(half + i * cell, half + j * cell);
  return makeData(h, n, cell);
}

const plane = (x: number, z: number): number => 3 + 0.5 * x - 0.25 * z;
const ridge = (x: number): number => Math.max(0, 24 - 4 * Math.abs(x));

function ridgeData(): TerrainData {
  return sampleField((x) => ridge(x));
}

function noisyData(seed: number): TerrainData {
  const rng = new Rng(seed);
  const h = new Float32Array(N * N);
  for (let k = 0; k < h.length; k++) h[k] = rng.range(0, 12);
  return makeData(h);
}

describe('normal cell cache', () => {
  it('is bit-exact with fresh uncached queries across repeats, cell transitions, borders and slopes', () => {
    const data = noisyData(938);
    const cached = createTerrainSampler(data);
    const rng = new Rng(712);
    const out: Vec3 = [0, 0, 0];
    for (let k = 0; k < 800; k++) {
      const x = rng.range(ORIGIN - CELL, FAR + CELL);
      const z = rng.range(ORIGIN - CELL, FAR + CELL);
      for (const delta of [0, 0.001, -0.001, CELL, 0]) {
        const fresh = createTerrainSampler(data);
        expect(cached.normalAt(x + delta, z, out)).toEqual(fresh.normalAt(x + delta, z));
        expect(cached.slopeAt(x + delta, z)).toBe(fresh.slopeAt(x + delta, z));
      }
    }
    for (const x of [ORIGIN - 100, ORIGIN, FAR, FAR + 100]) {
      for (const z of [ORIGIN - 100, ORIGIN, FAR, FAR + 100]) {
        expect(cached.normalAt(x, z, out)).toEqual(createTerrainSampler(data).normalAt(x, z));
      }
    }
  });
});

describe('heightAt', () => {
  it('reproduces a plane exactly, since the triangulation is planar on planes', () => {
    const s = createTerrainSampler(sampleField(plane));
    const rng = new Rng(3);
    for (let k = 0; k < 200; k++) {
      const x = rng.range(ORIGIN, FAR);
      const z = rng.range(ORIGIN, FAR);
      expect(s.heightAt(x, z)).toBeCloseTo(plane(x, z), 3);
    }
  });

  it('approximates a paraboloid to within the bilinear interpolation error and is exact at vertices', () => {
    const a = 0.01;
    const s = createTerrainSampler(sampleField((x, z) => a * (x * x + z * z)));
    const rng = new Rng(5);
    for (let k = 0; k < 200; k++) {
      const x = rng.range(ORIGIN, FAR);
      const z = rng.range(ORIGIN, FAR);
      expect(Math.abs(s.heightAt(x, z) - a * (x * x + z * z))).toBeLessThan(0.03);
    }
    expect(s.heightAt(ORIGIN + 3 * CELL, ORIGIN + 5 * CELL)).toBeCloseTo(a * ((ORIGIN + 6) ** 2 + (ORIGIN + 10) ** 2), 4);
  });

  it('returns the stored height at every cell corner', () => {
    const data = noisyData(11);
    const s = createTerrainSampler(data);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) expect(s.heightAt(ORIGIN + i * CELL, ORIGIN + j * CELL)).toBeCloseTo(data.height[j * N + i], 5);
    }
  });

  it('splits cells along the (i, j)-(i+1, j+1) diagonal: the cell centre is the mean of h00 and h11', () => {
    const data = noisyData(12);
    const s = createTerrainSampler(data);
    for (let j = 0; j < N - 1; j++) {
      for (let i = 0; i < N - 1; i++) {
        const h00 = data.height[j * N + i];
        const h11 = data.height[(j + 1) * N + i + 1];
        expect(s.heightAt(ORIGIN + (i + 0.5) * CELL, ORIGIN + (j + 0.5) * CELL)).toBeCloseTo((h00 + h11) / 2, 4);
      }
    }
  });

  it('is linear along each triangle: a quarter of the way from h00 toward h10 on the lower edge', () => {
    const data = noisyData(13);
    const s = createTerrainSampler(data);
    const h00 = data.height[2 * N + 3];
    const h10 = data.height[2 * N + 4];
    const h01 = data.height[3 * N + 3];
    expect(s.heightAt(ORIGIN + 3.25 * CELL, ORIGIN + 2 * CELL)).toBeCloseTo(h00 + 0.25 * (h10 - h00), 4);
    expect(s.heightAt(ORIGIN + 3 * CELL, ORIGIN + 2.25 * CELL)).toBeCloseTo(h00 + 0.25 * (h01 - h00), 4);
  });

  it('clamps queries outside the map to the border', () => {
    const data = noisyData(14);
    const s = createTerrainSampler(data);
    expect(s.heightAt(-1e6, 0)).toBe(s.heightAt(ORIGIN, 0));
    expect(s.heightAt(0, 1e6)).toBe(s.heightAt(0, FAR));
    expect(s.heightAt(-1e6, -1e6)).toBeCloseTo(data.height[0], 5);
    expect(s.heightAt(1e6, 1e6)).toBeCloseTo(data.height[N * N - 1], 5);
    expect(s.heightAt(1e6, -1e6)).toBeCloseTo(data.height[N - 1], 5);
  });
});

describe('normalAt and slopeAt', () => {
  it('matches the analytic normal of a plane everywhere, borders included', () => {
    const s = createTerrainSampler(sampleField(plane));
    const len = Math.hypot(0.5, 1, 0.25);
    const expected: Vec3 = [-0.5 / len, 1 / len, 0.25 / len];
    for (const [x, z] of [
      [0, 0],
      [ORIGIN, ORIGIN],
      [FAR, FAR],
      [ORIGIN, 7.3],
      [-3.3, FAR],
      [1e5, -1e5],
    ]) {
      const n = s.normalAt(x, z);
      expect(n[0]).toBeCloseTo(expected[0], 5);
      expect(n[1]).toBeCloseTo(expected[1], 5);
      expect(n[2]).toBeCloseTo(expected[2], 5);
    }
  });

  it('writes into and returns the supplied array, and returns unit vectors', () => {
    const s = createTerrainSampler(noisyData(21));
    const out: Vec3 = [9, 9, 9];
    expect(s.normalAt(1.5, -2.5, out)).toBe(out);
    expect(Math.hypot(out[0], out[1], out[2])).toBeCloseTo(1, 6);
    expect(out[1]).toBeGreaterThan(0);
  });

  it('approximates the analytic paraboloid normal (exact at vertices) with +Z pointing south', () => {
    const a = 0.01;
    const s = createTerrainSampler(sampleField((x, z) => a * (x * x + z * z)));
    const vx = ORIGIN + 8 * CELL;
    const vz = ORIGIN + 4 * CELL;
    const at = s.normalAt(vx, vz);
    const len = Math.hypot(2 * a * vx, 1, 2 * a * vz);
    expect(at[0]).toBeCloseTo((-2 * a * vx) / len, 5);
    expect(at[2]).toBeCloseTo((-2 * a * vz) / len, 5);
    const between = s.normalAt(vx + 0.7, vz + 1.1);
    const lb = Math.hypot(2 * a * (vx + 0.7), 1, 2 * a * (vz + 1.1));
    expect(between[0]).toBeCloseTo((-2 * a * (vx + 0.7)) / lb, 2);
    expect(between[2]).toBeCloseTo((-2 * a * (vz + 1.1)) / lb, 2);
  });

  it('reports slope in radians: zero on flat ground, atan(gradient) on a plane', () => {
    expect(createTerrainSampler(sampleField(() => 5)).slopeAt(1, 1)).toBe(0);
    const s = createTerrainSampler(sampleField(plane));
    expect(s.slopeAt(-4.2, 3.7)).toBeCloseTo(Math.atan(Math.hypot(0.5, 0.25)), 5);
    const steep = createTerrainSampler(sampleField((x) => 10 * x));
    expect(steep.slopeAt(0, 0)).toBeCloseTo(Math.atan(10), 5);
    expect(steep.slopeAt(0, 0)).toBeLessThan(Math.PI / 2);
  });
});

function unit(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Reference intersection by dense marching, with the same solid-slab semantics as the sampler. */
function marchHit(data: TerrainData, o: Vec3, d: Vec3, maxDist: number): number | null {
  const s = createTerrainSampler(data);
  const lo = data.origin[0];
  const hi = lo + (data.resolution - 1) * data.cellSize;
  const step = 0.005;
  for (let t = 0; t <= maxDist; t += step) {
    const x = o[0] + d[0] * t;
    const z = o[2] + d[2] * t;
    if (x < lo || x > hi || z < lo || z > hi) continue;
    if (o[1] + d[1] * t <= s.heightAt(x, z)) return t;
  }
  return null;
}

describe('raycast', () => {
  it('hits a plane at the analytic distance and returns a consistent point and normal', () => {
    const s = createTerrainSampler(sampleField(plane));
    const dir: Vec3 = [-0.3, -1, 0.2];
    const hit = s.raycast([10, 50, -12], dir, 100);
    expect(hit).not.toBeNull();
    expect(hit!.t).toBeCloseTo(48.75, 3);
    expect(hit!.point[0]).toBeCloseTo(10 - 0.3 * 48.75, 3);
    expect(hit!.point[1]).toBeCloseTo(50 - 48.75, 3);
    expect(hit!.point[2]).toBeCloseTo(-12 + 0.2 * 48.75, 3);
    expect(hit!.point[1]).toBeCloseTo(s.heightAt(hit!.point[0], hit!.point[2]), 3);
    const len = Math.hypot(0.5, 1, 0.25);
    expect(hit!.normal[0]).toBeCloseTo(-0.5 / len, 5);
    expect(hit!.normal[1]).toBeCloseTo(1 / len, 5);
  });

  it('treats t as the ray parameter: a longer direction vector gives a proportionally smaller t and the same point', () => {
    const s = createTerrainSampler(sampleField(plane));
    const a = s.raycast([10, 50, -12], [-0.3, -1, 0.2], 100)!;
    const b = s.raycast([10, 50, -12], [-0.9, -3, 0.6], 100)!;
    expect(b.t).toBeCloseTo(a.t / 3, 4);
    expect(b.point[0]).toBeCloseTo(a.point[0], 3);
    expect(b.point[2]).toBeCloseTo(a.point[2], 3);
  });

  it('honours maxDist', () => {
    const s = createTerrainSampler(sampleField(plane));
    expect(s.raycast([10, 50, -12], [-0.3, -1, 0.2], 40)).toBeNull();
    expect(s.raycast([10, 50, -12], [-0.3, -1, 0.2], 50)).not.toBeNull();
    expect(s.raycast([10, 50, -12], [-0.3, -1, 0.2], 0)).toBeNull();
  });

  it('hits the flank of a known ridge at the analytic point and the normal faces the ray', () => {
    const s = createTerrainSampler(ridgeData());
    const dir = unit([1, -1, 0]);
    const hit = s.raycast([-20, 40, 3], dir, 200)!;
    expect(hit).not.toBeNull();
    expect(hit.t).toBeCloseTo(19.2 * Math.SQRT2, 3);
    expect(hit.point[0]).toBeCloseTo(-0.8, 3);
    expect(hit.point[1]).toBeCloseTo(20.8, 3);
    expect(hit.point[2]).toBeCloseTo(3, 4);
    expect(hit.normal[0]).toBeLessThan(0);
    expect(hit.normal[1]).toBeGreaterThan(0);
    expect(hit.normal[0] * dir[0] + hit.normal[1] * dir[1] + hit.normal[2] * dir[2]).toBeLessThan(0);
    expect(Math.hypot(...hit.normal)).toBeCloseTo(1, 6);
  });

  it('hits the ridge from a horizontal ray that enters the map below the crest', () => {
    const s = createTerrainSampler(ridgeData());
    const hit = s.raycast([-40, 10, 0], [1, 0, 0], 200)!;
    expect(hit.t).toBeCloseTo(36.5, 3);
    expect(hit.point[1]).toBeCloseTo(10, 6);
  });

  it('finds the far flank when the ray comes from the other side and travels along z as well', () => {
    const s = createTerrainSampler(ridgeData());
    const hit = s.raycast([25, 12, -10], unit([-1, 0, 0.3]), 200)!;
    expect(hit.point[0]).toBeCloseTo(3, 2);
    expect(hit.point[1]).toBeCloseTo(12, 2);
    expect(hit.normal[0]).toBeGreaterThan(0);
  });

  it('returns null for a ray parallel to the ground above every sample', () => {
    const s = createTerrainSampler(ridgeData());
    expect(s.raycast([-30, 100, 0], [1, 0, 0], 500)).toBeNull();
    expect(s.raycast([0, 30, -40], [0, 0, 1], 500)).toBeNull();
  });

  it('returns null for a parallel ray inside the height range that clears the terrain along its whole path', () => {
    const s = createTerrainSampler(ridgeData());
    expect(s.raycast([-12, 10, -40], [0, 0, 1], 500)).toBeNull();
    expect(s.raycast([-12, 10, -40], [0, 0, -1], 500)).toBeNull();
  });

  it('returns null for rays that cannot reach the map: moving away, beside it, or climbing out of it', () => {
    const s = createTerrainSampler(ridgeData());
    expect(s.raycast([100, 50, 0], [1, -0.1, 0], 500)).toBeNull();
    expect(s.raycast([-100, 30, 100], [1, -0.1, 0], 500)).toBeNull();
    expect(s.raycast([-100, 30, 0], [1, 0.5, 0], 500)).toBeNull();
    expect(s.raycast([0, 50, 0], [0, 0, 0], 500)).toBeNull();
  });

  it('treats a ray that starts below the surface as a hit at its origin, even under the lowest sample', () => {
    const s = createTerrainSampler(ridgeData());
    const inside = s.raycast([-3, 5, 0], [0, 0, 1], 100)!;
    expect(inside.t).toBe(0);
    expect(inside.point).toEqual([-3, 5, 0]);
    const under = s.raycast([0, -5, 0], [0, -1, 0], 100)!;
    expect(under.t).toBe(0);
  });

  it('hits straight-down rays at the surface height', () => {
    const data = noisyData(31);
    const s = createTerrainSampler(data);
    const hit = s.raycast([1.3, 100, -4.1], [0, -1, 0], 500)!;
    expect(hit.point[1]).toBeCloseTo(s.heightAt(1.3, -4.1), 4);
    expect(hit.t).toBeCloseTo(100 - hit.point[1], 4);
  });

  it('agrees with dense marching over rough terrain for many random rays', () => {
    const data = noisyData(41);
    const s = createTerrainSampler(data);
    const rng = new Rng(43);
    let hits = 0;
    for (let k = 0; k < 400; k++) {
      const dir = unit([rng.range(-1, 1), rng.range(-0.9, 0.3), rng.range(-1, 1)]);
      const back = rng.range(3, 45);
      const origin: Vec3 = [rng.range(-14, 12) - dir[0] * back, rng.range(2, 14) - dir[1] * back, rng.range(-14, 12) - dir[2] * back];
      const expected = marchHit(data, origin, dir, 120);
      const actual = s.raycast(origin, dir, 120);
      if (expected === null) {
        expect(actual).toBeNull();
        continue;
      }
      hits++;
      expect(actual).not.toBeNull();
      expect(Math.abs(actual!.t - expected)).toBeLessThan(0.02);
    }
    expect(hits).toBeGreaterThan(150);
  });
});
