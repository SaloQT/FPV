import type { TerrainData } from '../../contracts';

/**
 * Where the forest floor is: a canopy-cover grid over the whole terrain, published by the vegetation module from the trees it actually
 * placed and uploaded by the terrain module into its own bind group, so the ground shows leaf litter and needle duff under real crowns.
 * It lives outside the shared world bindings because those already reach the 16 sampled textures a pass may bind.
 *
 * Texels cover the terrain maps' own uv space ((terrainTexel(xz) + 0.5) / N), whatever the terrain resolution:
 * r = canopy cover 0..1, g = share of that cover from conifers (needles rather than leaves), b = forest-ness: the mean cover over about
 * 35 m around (high in a stand, near 0 under a lone tree), a = horizontal distance to the racing line over TRACK_WEAR_RANGE_M
 * (0 on the line, 1 at that distance or farther, and everywhere without a track; see bakeTrackDistance).
 */
export const GROUND_COVER_SIZE = 1024;
/** Farthest distance from the racing line the cover's alpha resolves (metres); the worn path and its trampled margin lie well inside it. */
export const TRACK_WEAR_RANGE_M = 25.5;

/** One crown to splat: centre (x, z) in metres, crown radius in metres, strength 0..1 and whether it sheds needles. */
export interface CoverCrown {
  x: number;
  z: number;
  radius: number;
  strength: number;
  conifer: boolean;
}

const published = new WeakMap<TerrainData, Uint8Array>();

export function publishGroundCover(terrain: TerrainData, data: Uint8Array): void {
  published.set(terrain, data);
}

export function groundCoverFor(terrain: TerrainData): Uint8Array | undefined {
  return published.get(terrain);
}

/**
 * Rasterises crowns into the cover grid. One crown alone reaches at most half cover: it is flat out to half its radius and fades out
 * by 1.25 radii (litter spreads a little beyond the drip line). Crowns combine as independent coverage, 1 - (1 - a)(1 - b), so the
 * cover only closes toward 1 where several overlap, which is where a forest floor forms. A 3 x 3 blur removes the texel steps.
 */
export function rasterGroundCover(terrain: TerrainData, crowns: Iterable<CoverCrown>, size = GROUND_COVER_SIZE): Uint8Array {
  const n = terrain.resolution, cell = terrain.cellSize, [ox, oz] = terrain.origin;
  // Texel centre (i + 0.5) / size in uv is terrain texel (i + 0.5) / size * n - 0.5, i.e. world ox + that * cell.
  const metresPerTexel = (n / size) * cell;
  const toTexel = (w: number, o: number): number => ((w - o) / cell + 0.5) / n * size - 0.5;
  const keep = new Float32Array(size * size).fill(1);
  const coniferW = new Float32Array(size * size);
  const totalW = new Float32Array(size * size);
  for (const c of crowns) {
    const outer = 1.25 * c.radius, inner = 0.5 * c.radius;
    const cx = toTexel(c.x, ox), cz = toTexel(c.z, oz), r = outer / metresPerTexel;
    const i0 = Math.max(0, Math.floor(cx - r)), i1 = Math.min(size - 1, Math.ceil(cx + r));
    const j0 = Math.max(0, Math.floor(cz - r)), j1 = Math.min(size - 1, Math.ceil(cz + r));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(i - cx, j - cz) * metresPerTexel;
        if (d >= outer) continue;
        const t = Math.min(Math.max((outer - d) / (outer - inner), 0), 1);
        const w = c.strength * t * t * (3 - 2 * t);
        const k = j * size + i;
        keep[k] *= 1 - 0.5 * w;
        totalW[k] += w;
        if (c.conifer) coniferW[k] += w;
      }
    }
  }
  // Neighbourhood cover: a separable box mean of 1 - keep over FOREST_RADIUS texels each way.
  const cov = new Float32Array(size * size), row = new Float32Array(size * size), hood = new Float32Array(size * size);
  for (let k = 0; k < size * size; k++) cov[k] = 1 - keep[k];
  const R = Math.max(1, Math.round(17.5 / metresPerTexel));
  for (let j = 0; j < size; j++) {
    let sum = 0;
    for (let i = -R; i <= R; i++) sum += cov[j * size + Math.min(Math.max(i, 0), size - 1)];
    for (let i = 0; i < size; i++) {
      row[j * size + i] = sum / (2 * R + 1);
      sum += cov[j * size + Math.min(i + R + 1, size - 1)] - cov[j * size + Math.max(i - R, 0)];
    }
  }
  for (let i = 0; i < size; i++) {
    let sum = 0;
    for (let j = -R; j <= R; j++) sum += row[Math.min(Math.max(j, 0), size - 1) * size + i];
    for (let j = 0; j < size; j++) {
      hood[j * size + i] = sum / (2 * R + 1);
      sum += row[Math.min(j + R + 1, size - 1) * size + i] - row[Math.max(j - R, 0) * size + i];
    }
  }
  const out = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let cover = 0, con = 0, tw = 0, taps = 0;
      for (let dj = -1; dj <= 1; dj++) {
        const y = Math.min(Math.max(j + dj, 0), size - 1);
        for (let di = -1; di <= 1; di++) {
          const k = y * size + Math.min(Math.max(i + di, 0), size - 1);
          cover += 1 - keep[k]; con += coniferW[k]; tw += totalW[k]; taps++;
        }
      }
      const o = (j * size + i) * 4;
      out[o] = Math.round((cover / taps) * 255);
      out[o + 1] = tw > 1e-6 ? Math.round((con / tw) * 255) : 0;
      out[o + 2] = Math.round(Math.min(hood[j * size + i] * 2, 1) * 255);
      out[o + 3] = 255;
    }
  }
  return out;
}

/**
 * Writes the horizontal distance from each texel centre to the polyline `path` (world x, y, z; y ignored) into the alpha channel of a
 * cover grid made by rasterGroundCover, as min(d / TRACK_WEAR_RANGE_M, 1) * 255. The terrain shader turns it into the worn ground of
 * the race course. The texture is filtered linearly, and a distance varies linearly between texels, so a 3 m texel still places a
 * 2 m path to within centimetres on a straight. Only texels within the range of some segment are visited.
 */
export function bakeTrackDistance(terrain: TerrainData, path: readonly (readonly number[])[], closed: boolean, out: Uint8Array, size = GROUND_COVER_SIZE): Uint8Array {
  const n = terrain.resolution, cell = terrain.cellSize, [ox, oz] = terrain.origin;
  const metresPerTexel = (n / size) * cell;
  const toTexel = (w: number, o: number): number => ((w - o) / cell + 0.5) / n * size - 0.5;
  const toWorld = (i: number, o: number): number => o + ((i + 0.5) / size * n - 0.5) * cell;
  const R = TRACK_WEAR_RANGE_M, r = R / metresPerTexel;
  const best = new Float32Array(size * size).fill(R);
  const segments = closed ? path.length : path.length - 1;
  for (let s = 0; s < segments; s++) {
    const a = path[s], b = path[(s + 1) % path.length];
    const ax = a[0], az = a[2], dx = b[0] - ax, dz = b[2] - az, len2 = dx * dx + dz * dz;
    const ti = [toTexel(ax, ox), toTexel(b[0], ox)], tj = [toTexel(az, oz), toTexel(b[2], oz)];
    const i0 = Math.max(0, Math.floor(Math.min(ti[0], ti[1]) - r)), i1 = Math.min(size - 1, Math.ceil(Math.max(ti[0], ti[1]) + r));
    const j0 = Math.max(0, Math.floor(Math.min(tj[0], tj[1]) - r)), j1 = Math.min(size - 1, Math.ceil(Math.max(tj[0], tj[1]) + r));
    for (let j = j0; j <= j1; j++) {
      const pz = toWorld(j, oz) - az;
      for (let i = i0; i <= i1; i++) {
        const px = toWorld(i, ox) - ax;
        const t = len2 > 0 ? Math.min(Math.max((px * dx + pz * dz) / len2, 0), 1) : 0;
        const d = Math.hypot(px - t * dx, pz - t * dz), k = j * size + i;
        if (d < best[k]) best[k] = d;
      }
    }
  }
  for (let k = 0; k < size * size; k++) out[k * 4 + 3] = Math.round(Math.min(best[k] / R, 1) * 255);
  return out;
}
