import type { TrackData } from '../../contracts';
import { hash2 } from './noise';

/** Side of a placement cell in metres; cells are anchored to world coordinates so candidates never depend on the region. */
export const COARSE = 24;
const DIAG = COARSE * Math.SQRT2;

export interface Region {
  /** Cell (i, j) covers x in [(i0 + i) * COARSE, (i0 + i + 1) * COARSE) and likewise for z. */
  i0: number;
  j0: number;
  nx: number;
  nz: number;
  /** Approximate distance from each cell centre to the racing line (or to the region centre), in metres. */
  dist: Float32Array;
  /** Indices j * nx + i of the cells within the radius, closest first (a jittered rank so the outline is not a clean contour). */
  order: Int32Array;
}

/** Chamfer distance transform of the cells touched by the path. */
function pathDistances(path: readonly (readonly number[])[], i0: number, j0: number, nx: number, nz: number): Float32Array {
  const d = new Float32Array(nx * nz).fill(Infinity);
  for (const p of path) {
    const i = Math.floor(p[0] / COARSE) - i0, j = Math.floor(p[2] / COARSE) - j0;
    if (i >= 0 && j >= 0 && i < nx && j < nz) d[j * nx + i] = 0;
  }
  const relax = (c: number, i: number, j: number, di: number, dj: number, w: number): number => {
    const a = i + di, b = j + dj;
    return a >= 0 && b >= 0 && a < nx && b < nz ? Math.min(d[c], d[b * nx + a] + w) : d[c];
  };
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const c = j * nx + i;
      d[c] = relax(c, i, j, -1, 0, COARSE);
      d[c] = relax(c, i, j, -1, -1, DIAG);
      d[c] = relax(c, i, j, 0, -1, COARSE);
      d[c] = relax(c, i, j, 1, -1, DIAG);
    }
  }
  for (let j = nz - 1; j >= 0; j--) {
    for (let i = nx - 1; i >= 0; i--) {
      const c = j * nx + i;
      d[c] = relax(c, i, j, 1, 0, COARSE);
      d[c] = relax(c, i, j, 1, 1, DIAG);
      d[c] = relax(c, i, j, 0, 1, COARSE);
      d[c] = relax(c, i, j, -1, 1, DIAG);
    }
  }
  return d;
}

/**
 * Cells within `radius` of the racing line (or of `centre` without a track) inside `bounds` = [minX, minZ, maxX, maxZ], nearest first.
 * Placement walks them in this order, so a cap on the instance count keeps the ground nearest the track.
 */
export function buildRegion(track: TrackData | null, centre: readonly [number, number], radius: number, bounds: readonly [number, number, number, number], seed: number): Region {
  const path = track && track.path.length > 0 ? track.path : null;
  let x0 = centre[0], z0 = centre[1], x1 = centre[0], z1 = centre[1];
  if (path) {
    x0 = Infinity; z0 = Infinity; x1 = -Infinity; z1 = -Infinity;
    for (const p of path) {
      x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
      z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]);
    }
  }
  const i0 = Math.floor(Math.max(x0 - radius, bounds[0]) / COARSE), j0 = Math.floor(Math.max(z0 - radius, bounds[1]) / COARSE);
  const nx = Math.max(Math.floor(Math.min(x1 + radius, bounds[2]) / COARSE) - i0 + 1, 1);
  const nz = Math.max(Math.floor(Math.min(z1 + radius, bounds[3]) / COARSE) - j0 + 1, 1);
  let dist: Float32Array;
  if (path) dist = pathDistances(path, i0, j0, nx, nz);
  else {
    dist = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) dist[j * nx + i] = Math.hypot((i0 + i + 0.5) * COARSE - centre[0], (j0 + j + 0.5) * COARSE - centre[1]);
    }
  }
  const key = new Float32Array(nx * nz);
  let n = 0;
  const keep = new Int32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const c = j * nx + i;
      if (dist[c] > radius) continue;
      key[c] = dist[c] + COARSE * hash2(i0 + i, j0 + j, seed);
      keep[n++] = c;
    }
  }
  const order = keep.slice(0, n).sort((a, b) => key[a] - key[b] || a - b);
  return { i0, j0, nx, nz, dist, order };
}
