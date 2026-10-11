import type { TerrainData } from '../../contracts';
import { toHalf } from '../half';

/**
 * Where the tree crowns block the sun: a top-down map over the terrain maps' uv space ((terrainTexel(xz) + 0.5) / N) of the foliage the
 * placed trees hold, published by the vegetation module and read by the ray-traced sun shadow (rt/shadow.wgsl). Every placed tree is in
 * it, not only the few hundred near the scene focus that have ray-tracing proxies.
 *
 * rgba16float texels: r = vertical optical depth of the foliage over the texel (leaf area density times the crown's vertical chord, summed
 * over the crowns), g and b = lowest crown bottom and highest crown top over it (absolute world y, metres), a = horizontal radius of the
 * widest crown over it (metres; the shadow march skips a leaf's own crown out to it).
 */
export const CANOPY_SHADOW_SIZE = 2048;

/**
 * One crown: base of the tree (x, ground y, z), crown centre offset from the base, crown radii, and its leaf area density (1/m). `cone`
 * makes it a cone standing on the bottom of that box (a spruce: widest at its lowest whorl, narrowing to the top) instead of an ellipsoid.
 */
export interface ShadowCrown {
  x: number;
  y: number;
  z: number;
  cx: number;
  cy: number;
  cz: number;
  rx: number;
  ry: number;
  rz: number;
  density: number;
  cone?: boolean;
}

const published = new WeakMap<TerrainData, Uint16Array>();

export function publishCanopyShadow(terrain: TerrainData, data: Uint16Array): void {
  published.set(terrain, data);
}

export function canopyShadowFor(terrain: TerrainData): Uint16Array | undefined {
  return published.get(terrain);
}

/**
 * Rasterises crown ellipsoids and cones into the map: each texel inside a crown's footprint gains density x the vertical chord through the
 * crown. A cone's chord falls off linearly toward its rim (an ellipsoid's stays near full depth to 0.8 of its radius), so a spruce stand
 * keeps the thin crown edges and the gaps between crowns that the sun dapples the floor through.
 */
export function rasterCanopyShadow(terrain: TerrainData, crowns: Iterable<ShadowCrown>, size = CANOPY_SHADOW_SIZE): Uint16Array {
  const n = terrain.resolution, cell = terrain.cellSize, [ox, oz] = terrain.origin;
  const metresPerTexel = (n / size) * cell;
  const toTexel = (w: number, o: number): number => ((w - o) / cell + 0.5) / n * size - 0.5;
  const tau = new Float32Array(size * size);
  const lo = new Float32Array(size * size).fill(Infinity);
  const hi = new Float32Array(size * size).fill(-Infinity);
  const reach = new Float32Array(size * size);
  for (const c of crowns) {
    const wx = c.x + c.cx, wz = c.z + c.cz, cy = c.y + c.cy;
    const tx = toTexel(wx, ox), tz = toTexel(wz, oz), rx = c.rx / metresPerTexel, rz = c.rz / metresPerTexel;
    const i0 = Math.max(0, Math.floor(tx - rx)), i1 = Math.min(size - 1, Math.ceil(tx + rx));
    const j0 = Math.max(0, Math.floor(tz - rz)), j1 = Math.min(size - 1, Math.ceil(tz + rz));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const u = (i - tx) / rx, v = (j - tz) / rz, e = 1 - u * u - v * v;
        if (e <= 0) continue;
        // 1 - e is the squared share of the radius out from the axis; a cone's chord rises from its base, an ellipsoid's is centred.
        const chord = 2 * c.ry * (c.cone ? 1 - Math.sqrt(1 - e) : Math.sqrt(e));
        const bottom = c.cone ? cy - c.ry : cy - chord / 2, k = j * size + i;
        tau[k] += c.density * chord;
        lo[k] = Math.min(lo[k], bottom);
        hi[k] = Math.max(hi[k], bottom + chord);
        reach[k] = Math.max(reach[k], c.rx, c.rz);
      }
    }
  }
  const out = new Uint16Array(size * size * 4);
  for (let k = 0; k < size * size; k++) {
    const o = k * 4;
    if (tau[k] > 0) {
      out[o] = toHalf(tau[k]);
      out[o + 1] = toHalf(lo[k]);
      out[o + 2] = toHalf(hi[k]);
      out[o + 3] = toHalf(reach[k]);
    }
  }
  return out;
}
