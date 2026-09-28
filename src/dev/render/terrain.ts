import type { TerrainData, TerrainSampler, Vec3 } from '../../contracts';
import type { SceneData } from '../../render/contracts';

export const TERRAIN_N = 256;
export const TERRAIN_CELL = 8;
const ORIGIN = -(TERRAIN_N * TERRAIN_CELL) / 2;

/** Analytic ground height (m): a few overlapping sines, gentle enough that the dev props can sit on it. */
export function groundHeight(x: number, z: number): number {
  return 5 * Math.sin(x * 0.004 + 1) * Math.cos(z * 0.005) + 2.5 * Math.sin(x * 0.011 + z * 0.007) + 0.8 * Math.sin(z * 0.023 - x * 0.017);
}

function unit01(v: number): number { return 0.5 + 0.5 * v; }

function makeTerrainData(): TerrainData {
  const n = TERRAIN_N, count = n * n;
  const height = new Float32Array(count);
  const soil = new Float32Array(count), flow = new Float32Array(count), deposit = new Float32Array(count), wetness = new Float32Array(count);
  let lo = Infinity, hi = -Infinity;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = ORIGIN + i * TERRAIN_CELL, z = ORIGIN + j * TERRAIN_CELL, k = j * n + i;
      const h = groundHeight(x, z);
      height[k] = h;
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
      soil[k] = unit01(Math.sin(x * 0.009) * Math.cos(z * 0.007));
      flow[k] = unit01(Math.sin(z * 0.013 + x * 0.002));
      deposit[k] = unit01(Math.cos(x * 0.006 - z * 0.011));
      wetness[k] = unit01(Math.sin(x * 0.005 + z * 0.005));
    }
  }
  return { seed: 1, resolution: n, cellSize: TERRAIN_CELL, origin: [ORIGIN, ORIGIN], height, maps: { soil, flow, deposit, wetness }, minHeight: lo, maxHeight: hi, waterLevel: -Infinity };
}

function makeSampler(data: TerrainData): TerrainSampler {
  const n = data.resolution, cs = data.cellSize, hs = data.height;
  const heightAt = (x: number, z: number): number => {
    const tx = Math.min(Math.max((x - data.origin[0]) / cs, 0), n - 1.001), tz = Math.min(Math.max((z - data.origin[1]) / cs, 0), n - 1.001);
    const i = Math.floor(tx), j = Math.floor(tz), fx = tx - i, fz = tz - j;
    const h00 = hs[j * n + i], h10 = hs[j * n + i + 1], h01 = hs[(j + 1) * n + i], h11 = hs[(j + 1) * n + i + 1];
    return fx >= fz ? h00 + (h10 - h00) * fx + (h11 - h10) * fz : h00 + (h11 - h01) * fx + (h01 - h00) * fz;
  };
  const normalAt = (x: number, z: number, out: Vec3 = [0, 1, 0]): Vec3 => {
    const dx = heightAt(x + cs, z) - heightAt(x - cs, z), dz = heightAt(x, z + cs) - heightAt(x, z - cs);
    const l = Math.hypot(dx, 2 * cs, dz);
    out[0] = -dx / l; out[1] = (2 * cs) / l; out[2] = -dz / l;
    return out;
  };
  return {
    data,
    heightAt,
    normalAt,
    slopeAt: (x, z) => Math.acos(Math.min(1, normalAt(x, z)[1])),
    raycast(origin, dir, maxDist) {
      const len = Math.hypot(dir[0], dir[1], dir[2]);
      const step = cs * 0.5;
      let prevT = 0;
      for (let t = step; t <= maxDist; t += step) {
        const x = origin[0] + (dir[0] / len) * t, y = origin[1] + (dir[1] / len) * t, z = origin[2] + (dir[2] / len) * t;
        if (y < heightAt(x, z)) {
          let a = prevT, b = t;
          for (let it = 0; it < 12; it++) {
            const m = (a + b) / 2;
            const below = origin[1] + (dir[1] / len) * m < heightAt(origin[0] + (dir[0] / len) * m, origin[2] + (dir[2] / len) * m);
            if (below) b = m; else a = m;
          }
          const px = origin[0] + (dir[0] / len) * b, pz = origin[2] + (dir[2] / len) * b;
          return { t: b / len, point: [px, heightAt(px, pz), pz], normal: normalAt(px, pz) };
        }
        prevT = t;
      }
      return null;
    },
  };
}

export function makeSyntheticScene(): SceneData {
  const terrain = makeTerrainData();
  return { terrain, sampler: makeSampler(terrain), track: null };
}
