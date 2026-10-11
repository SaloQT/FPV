import { runSliced, runSync, type Steps } from './slices';

/**
 * The bark shader's noise, baked once into a tileable 3D texture so a bark pixel costs a few filtered texture reads instead of dozens of
 * hashes. BARK_NOISE_SIZE texels a side and CELLS noise cells across (8 texels a cell, so the hardware's linear filter between texels follows
 * the smooth noise closely). Four channels, mirrored by tree_bark.wgsl:
 *   r, g, b: three independent gradient noises, stored as 0.5 + 0.4 * n (n in about [-1.25, 1.25]);
 *   a:       cellular noise: the gap between the nearest and second-nearest feature point (0 on a cell border), stored as gap / CELL_GAP_RANGE.
 * Every channel wraps at the texture edge, so the shader samples it with a repeating sampler.
 */
export const BARK_NOISE_SIZE = 128;
export const CELLS = 16;
const CELL_GAP_RANGE = 0.7;

/** Integer hash to [0, 1). */
function hash(x: number, y: number, z: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647 + seed * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
const wrap = (i: number, n: number): number => ((i % n) + n) % n;
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Three hashes in [0, 1) per cell of a period of `cells` cells a side: a gradient (as 2h - 1) or a feature point's jitter. */
function lattice(cells: number, seed: number): Float32Array {
  const out = new Float32Array(cells * cells * cells * 3);
  for (let z = 0; z < cells; z++) for (let y = 0; y < cells; y++) for (let x = 0; x < cells; x++) {
    const o = ((z * cells + y) * cells + x) * 3;
    for (let k = 0; k < 3; k++) out[o + k] = hash(x, y, z, seed + k);
  }
  return out;
}

/** Tileable 3D gradient noise over the gradient lattice `g`, at (x, y, z) in cells. */
function gradient(g: Float32Array, cells: number, x: number, y: number, z: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz;
  const corner = (dx: number, dy: number, dz: number): number => {
    const o = ((wrap(iz + dz, cells) * cells + wrap(iy + dy, cells)) * cells + wrap(ix + dx, cells)) * 3;
    return (g[o] * 2 - 1) * (fx - dx) + (g[o + 1] * 2 - 1) * (fy - dy) + (g[o + 2] * 2 - 1) * (fz - dz);
  };
  const u = fade(fx), v = fade(fy), w = fade(fz);
  const x00 = lerp(corner(0, 0, 0), corner(1, 0, 0), u), x10 = lerp(corner(0, 1, 0), corner(1, 1, 0), u);
  const x01 = lerp(corner(0, 0, 1), corner(1, 0, 1), u), x11 = lerp(corner(0, 1, 1), corner(1, 1, 1), u);
  return 1.6 * lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
}

/** Tileable cellular noise over the jitter lattice `j`: the gap between the two nearest feature points, at (x, y, z) in cells. */
function cellGap(j: Float32Array, cells: number, x: number, y: number, z: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let f1 = Infinity, f2 = Infinity;
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const o = ((wrap(iz + dz, cells) * cells + wrap(iy + dy, cells)) * cells + wrap(ix + dx, cells)) * 3;
    const px = ix + dx + 0.15 + 0.7 * j[o] - x, py = iy + dy + 0.15 + 0.7 * j[o + 1] - y, pz = iz + dz + 0.15 + 0.7 * j[o + 2] - z;
    const d = px * px + py * py + pz * pz;
    if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
  }
  return Math.sqrt(f2) - Math.sqrt(f1);
}

const byte = (v: number): number => Math.round(Math.min(Math.max(v, 0), 1) * 255);

function* noiseSteps(): Steps<Uint8Array> {
  const n = BARK_NOISE_SIZE, c = CELLS, out = new Uint8Array(n * n * n * 4);
  const ga = lattice(c, 11), gb = lattice(c, 23), gc = lattice(c, 37), cj = lattice(c, 53);
  for (let z = 0; z < n; z++) {
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const o = ((z * n + y) * n + x) * 4, u = ((x + 0.5) / n) * c, v = ((y + 0.5) / n) * c, w = ((z + 0.5) / n) * c;
      out[o] = byte(0.5 + 0.4 * gradient(ga, c, u, v, w));
      out[o + 1] = byte(0.5 + 0.4 * gradient(gb, c, u, v, w));
      out[o + 2] = byte(0.5 + 0.4 * gradient(gc, c, u, v, w));
      out[o + 3] = byte(cellGap(cj, c, u, v, w) / CELL_GAP_RANGE);
    }
    yield;
  }
  return out;
}

/** The texture's texels, rgba8 in x-fastest order (BARK_NOISE_SIZE^3 x 4 bytes, 8 MiB). */
export function buildBarkNoise(): Uint8Array {
  return runSync(noiseSteps());
}

/** The same texels built in slices with an event-loop yield between them (see slices.ts). */
export function buildBarkNoiseSliced(budgetMs = 8): Promise<Uint8Array> {
  return runSliced(noiseSteps(), budgetMs);
}
