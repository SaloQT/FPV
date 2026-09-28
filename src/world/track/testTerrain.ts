/**
 * Synthetic terrain for tests and dev tools only: analytic hills, a rim of mountains and optional water, sampled to a
 * TerrainData with the same triangulation rule as the real sampler (cell split along the (i, j)-(i+1, j+1) diagonal).
 */
import type { TerrainData, TerrainSampler, Vec3 } from '../../contracts';

export interface TestTerrainOptions {
  seed?: number;
  resolution?: number;
  cellSize?: number;
  /** Rim mountain relief in metres. */
  relief?: number;
  /** Amplitude scale of the central rolling ground (1 = gentle, 3 = rugged). */
  roughness?: number;
  /** Water level as a fraction of the height range, or undefined for no water. */
  waterFraction?: number;
}

function hash2(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

function fbm(x: number, z: number, seed: number, octaves: number): number {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * (valueNoise(x * f, z * f, seed + o * 101) * 2 - 1);
    amp *= 0.5;
    f *= 2;
  }
  return sum;
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

export function testTerrainData(opt: TestTerrainOptions = {}): TerrainData {
  const seed = opt.seed ?? 1;
  const n = opt.resolution ?? 256;
  const cell = opt.cellSize ?? 8;
  const relief = opt.relief ?? 180;
  const rough = opt.roughness ?? 1;
  const extent = n * cell;
  const ox = -extent / 2;
  const height = new Float32Array(n * n);
  let lo = Infinity;
  let hi = -Infinity;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = ox + i * cell;
      const z = ox + j * cell;
      const r = Math.hypot(x, z) / (extent * 0.5);
      const rim = smooth(0.42, 0.95, r);
      const rolling = fbm(x / 350, z / 350, seed, 4) * 14 * rough;
      const ridges = (1 - Math.abs(fbm(x / 800, z / 800, seed + 7, 4) * 2)) * relief * rim;
      const bowl = -22 * Math.exp(-(((x - 0.12 * extent) / 160) ** 2 + ((z + 0.08 * extent) / 160) ** 2));
      const hill = 30 * Math.exp(-(((x + 0.1 * extent) / 120) ** 2 + ((z - 0.1 * extent) / 150) ** 2));
      const h = 40 + rolling + ridges + bowl + hill;
      height[j * n + i] = h;
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
  }
  for (let k = 0; k < height.length; k++) height[k] -= lo;
  const zeros = new Float32Array(n * n);
  return {
    seed,
    resolution: n,
    cellSize: cell,
    origin: [ox, ox],
    height,
    maps: { soil: zeros, flow: zeros, deposit: zeros, wetness: zeros },
    minHeight: 0,
    maxHeight: hi - lo,
    waterLevel: opt.waterFraction === undefined ? -Infinity : (hi - lo) * opt.waterFraction,
  };
}

export function testSampler(data: TerrainData): TerrainSampler {
  const n = data.resolution;
  const last = n - 1;
  const inv = 1 / data.cellSize;
  const h = data.height;
  const heightAt = (x: number, z: number): number => {
    const tx = Math.min(Math.max((x - data.origin[0]) * inv, 0), last);
    const tz = Math.min(Math.max((z - data.origin[1]) * inv, 0), last);
    const i = tx < last ? Math.floor(tx) : last - 1;
    const j = tz < last ? Math.floor(tz) : last - 1;
    const fx = tx - i;
    const fz = tz - j;
    const b = j * n + i;
    if (fx >= fz) return h[b] + (h[b + 1] - h[b]) * fx + (h[b + n + 1] - h[b + 1]) * fz;
    return h[b] + (h[b + n + 1] - h[b + n]) * fx + (h[b + n] - h[b]) * fz;
  };
  const normalAt = (x: number, z: number, out: Vec3 = [0, 0, 0]): Vec3 => {
    const e = data.cellSize;
    const dx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e);
    const dz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
    const l = Math.sqrt(dx * dx + 1 + dz * dz);
    out[0] = -dx / l;
    out[1] = 1 / l;
    out[2] = -dz / l;
    return out;
  };
  return {
    data,
    heightAt,
    normalAt,
    slopeAt(x, z) {
      const nn = normalAt(x, z);
      return Math.atan2(Math.hypot(nn[0], nn[2]), nn[1]);
    },
    raycast(origin, dir, maxDist) {
      const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
      const step = data.cellSize * 0.5;
      let prev = 0;
      for (let t = 0; t <= maxDist; t += step) {
        const y = origin[1] + (dir[1] / len) * t - heightAt(origin[0] + (dir[0] / len) * t, origin[2] + (dir[2] / len) * t);
        if (y <= 0) {
          let a = prev;
          let b = t;
          for (let k = 0; k < 24; k++) {
            const m = 0.5 * (a + b);
            const ym = origin[1] + (dir[1] / len) * m - heightAt(origin[0] + (dir[0] / len) * m, origin[2] + (dir[2] / len) * m);
            if (ym <= 0) b = m;
            else a = m;
          }
          const point: Vec3 = [origin[0] + (dir[0] / len) * b, origin[1] + (dir[1] / len) * b, origin[2] + (dir[2] / len) * b];
          return { t: b / len, point, normal: normalAt(point[0], point[2]) };
        }
        prev = t;
      }
      return null;
    },
  };
}

export function makeTestSampler(opt: TestTerrainOptions = {}): TerrainSampler {
  return testSampler(testTerrainData(opt));
}
