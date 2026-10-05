import type { TerrainData } from '../contracts';

/** CPU-side derivation of the terrain textures held in WorldBindings (max pyramid, normal + horizon AO, packed material maps). */

export const HORIZON_DIRECTIONS = 8;
export const HORIZON_MAX_DISTANCE_M = 96;

/** Full max-mip chain over an n x n grid: level m has max(1, n >> m)^2 texels, each the max of a 2^m x 2^m block of level 0. */
export function buildMaxPyramid(height: Float32Array, n: number): Float32Array[] {
  const levels: Float32Array[] = [height];
  for (let size = n >> 1, prev = n; size >= 1; prev = size, size >>= 1) {
    const src = levels[levels.length - 1];
    const dst = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      const r0 = 2 * y * prev, r1 = r0 + prev;
      for (let x = 0; x < size; x++) {
        const a = src[r0 + 2 * x], b = src[r0 + 2 * x + 1], c = src[r1 + 2 * x], d = src[r1 + 2 * x + 1];
        dst[y * size + x] = Math.max(Math.max(a, b), Math.max(c, d));
      }
    }
    levels.push(dst);
  }
  return levels;
}

/** Integer texel step lengths used for the horizon march (roughly geometric, out to HORIZON_MAX_DISTANCE_M). */
export function horizonSteps(cellSize: number): number[] {
  const maxTexels = Math.max(1, Math.floor(HORIZON_MAX_DISTANCE_M / cellSize));
  const steps: number[] = [];
  for (let s = 1; s <= maxTexels; s = s < 4 ? s + 1 : Math.ceil(s * 1.5)) steps.push(s);
  return steps;
}

/**
 * rgba8 texels: rgb = world normal*0.5+0.5 (central differences at cellSize spacing, +X east, +Z south),
 * a = terrain horizon AO = 1 - mean over 8 azimuths of sin^2(max horizon elevation within ~96 m).
 */
export function buildNormalHorizon(height: Float32Array, n: number, cellSize: number): Uint8Array {
  const out = new Uint8Array(n * n * 4);
  const inv2c = 1 / (2 * cellSize);
  for (let j = 0; j < n; j++) {
    const jm = (j > 0 ? j - 1 : 0) * n, jp = (j < n - 1 ? j + 1 : n - 1) * n;
    for (let i = 0; i < n; i++) {
      const im = i > 0 ? i - 1 : 0, ip = i < n - 1 ? i + 1 : n - 1;
      const dx = (height[j * n + ip] - height[j * n + im]) * inv2c * (i > 0 && i < n - 1 ? 1 : 2);
      const dz = (height[jp + i] - height[jm + i]) * inv2c * (j > 0 && j < n - 1 ? 1 : 2);
      const il = 1 / Math.sqrt(dx * dx + 1 + dz * dz);
      const o = (j * n + i) * 4;
      out[o] = Math.round((-dx * il * 0.5 + 0.5) * 255);
      out[o + 1] = Math.round((il * 0.5 + 0.5) * 255);
      out[o + 2] = Math.round((-dz * il * 0.5 + 0.5) * 255);
    }
  }
  fillHorizonAO(out, height, n, cellSize);
  return out;
}

function fillHorizonAO(out: Uint8Array, height: Float32Array, n: number, cellSize: number): void {
  const steps = horizonSteps(cellSize);
  const ns = steps.length;
  const dirX = new Int32Array(HORIZON_DIRECTIONS), dirY = new Int32Array(HORIZON_DIRECTIONS);
  const dirs: [number, number][] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  dirs.forEach(([x, y], k) => { dirX[k] = x; dirY[k] = y; });
  const off = new Int32Array(HORIZON_DIRECTIONS * ns);
  const invDist = new Float64Array(HORIZON_DIRECTIONS * ns);
  for (let d = 0; d < HORIZON_DIRECTIONS; d++) {
    for (let s = 0; s < ns; s++) {
      off[d * ns + s] = dirY[d] * steps[s] * n + dirX[d] * steps[s];
      invDist[d * ns + s] = 1 / (Math.hypot(dirX[d], dirY[d]) * steps[s] * cellSize);
    }
  }
  const margin = steps[ns - 1];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const idx = j * n + i, h0 = height[idx];
      let occ = 0;
      const interior = i >= margin && j >= margin && i < n - margin && j < n - margin;
      for (let d = 0; d < HORIZON_DIRECTIONS; d++) {
        let maxT = 0;
        if (interior) {
          for (let k = d * ns, e = k + ns; k < e; k++) {
            const t = (height[idx + off[k]] - h0) * invDist[k];
            if (t > maxT) maxT = t;
          }
        } else {
          for (let s = 0; s < ns; s++) {
            const ii = Math.min(n - 1, Math.max(0, i + dirX[d] * steps[s])), jj = Math.min(n - 1, Math.max(0, j + dirY[d] * steps[s]));
            const t = (height[jj * n + ii] - h0) * invDist[d * ns + s];
            if (t > maxT) maxT = t;
          }
        }
        occ += (maxT * maxT) / (1 + maxT * maxT);
      }
      out[idx * 4 + 3] = Math.round(Math.min(1, Math.max(0, 1 - occ / HORIZON_DIRECTIONS)) * 255);
    }
  }
}

/** Packs soil, flow, deposit, wetness (each 0..1) into rgba8. */
export function packTerrainMaps(maps: TerrainData['maps'], n: number): Uint8Array {
  const out = new Uint8Array(n * n * 4);
  const q = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  for (let i = 0; i < n * n; i++) {
    out[i * 4] = q(maps.soil[i]); out[i * 4 + 1] = q(maps.flow[i]); out[i * 4 + 2] = q(maps.deposit[i]); out[i * 4 + 3] = q(maps.wetness[i]);
  }
  return out;
}

/** Precompute the tracer's original clamped 2x2 max at every mip. These are the
 * same conservative bounds as four shader fetches, with one fetch per node. */
export function buildTraceBoundsPyramid(height: Float32Array, n: number): Float32Array[] {
  return buildMaxPyramid(height, n).map((src, mip) => {
    const size = Math.max(1, n >> mip), dst = new Float32Array(src.length);
    for (let y = 0; y < size; y++) {
      const row = y * size, next = Math.min(y + 1, size - 1) * size;
      for (let x = 0; x < size; x++) {
        const nx = Math.min(x + 1, size - 1);
        dst[row + x] = Math.max(Math.max(src[row + x], src[row + nx]), Math.max(src[next + x], src[next + nx]));
      }
    }
    return dst;
  });
}
