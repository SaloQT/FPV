/**
 * CPU queries against a TerrainData that agree with what the renderer draws.
 *
 * Height is bilinear over the triangulated grid: every cell is split along the diagonal from vertex (i, j) to (i+1, j+1), the
 * same rule as `terrainHeightAt` in world_bindings.wgsl. (The GPU clamps the texel coordinate to N - 1.001; here it clamps to
 * N - 1 so the far corner is exact, which differs by less than a millimetre.) Outside the map the coordinate clamps to the
 * border. The normal is smoothed: a bilinear blend of the four surrounding vertex normals, each a central difference at cellSize
 * spacing (one-sided on the border, +X east, +Z south), which is what the renderer's normal texture holds. The data must not
 * change after the sampler is created.
 */
import type { TerrainData, TerrainSampler, Vec3 } from '../../contracts';

export function createTerrainSampler(data: TerrainData): TerrainSampler {
  return new GridSampler(data);
}

/** Margin below the lowest sample where a descending ray is certain to be under the ground. */
const FLOOR_MARGIN = 1e-4;

class GridSampler implements TerrainSampler {
  private readonly n: number;
  private readonly h: Float32Array;
  private readonly ox: number;
  private readonly oz: number;
  private readonly cell: number;
  private readonly inv: number;
  private readonly vertex = new Float64Array(12);
  private normalCellX = -1;
  private normalCellZ = -1;
  private readonly slopeScratch: Vec3 = [0, 0, 0];
  private cellMax: Float32Array | null = null;

  constructor(readonly data: TerrainData) {
    this.n = data.resolution;
    this.h = data.height;
    this.ox = data.origin[0];
    this.oz = data.origin[1];
    this.cell = data.cellSize;
    this.inv = 1 / data.cellSize;
  }

  heightAt(x: number, z: number): number {
    const n = this.n;
    const last = n - 1;
    let tx = (x - this.ox) * this.inv;
    let tz = (z - this.oz) * this.inv;
    tx = tx < 0 ? 0 : tx > last ? last : tx;
    tz = tz < 0 ? 0 : tz > last ? last : tz;
    const i = tx < last ? Math.floor(tx) : last - 1;
    const j = tz < last ? Math.floor(tz) : last - 1;
    const fx = tx - i;
    const fz = tz - j;
    const h = this.h;
    const b = j * n + i;
    const h00 = h[b];
    if (fx >= fz) return h00 + (h[b + 1] - h00) * fx + (h[b + n + 1] - h[b + 1]) * fz;
    return h00 + (h[b + n + 1] - h[b + n]) * fx + (h[b + n] - h00) * fz;
  }

  normalAt(x: number, z: number, out: Vec3 = [0, 0, 0]): Vec3 {
    const n = this.n;
    const last = n - 1;
    let tx = (x - this.ox) * this.inv;
    let tz = (z - this.oz) * this.inv;
    tx = tx < 0 ? 0 : tx > last ? last : tx;
    tz = tz < 0 ? 0 : tz > last ? last : tz;
    const i = tx < last ? Math.floor(tx) : last - 1;
    const j = tz < last ? Math.floor(tz) : last - 1;
    const fx = tx - i;
    const fz = tz - j;
    const v = this.vertex;
    // Terrain is immutable. Nearby physics contacts reuse these exact Float64
    // vertex normals; interpolation still runs at each query's own coordinates.
    if (i !== this.normalCellX || j !== this.normalCellZ) {
      this.vertexNormal(i, j, 0);
      this.vertexNormal(i + 1, j, 3);
      this.vertexNormal(i, j + 1, 6);
      this.vertexNormal(i + 1, j + 1, 9);
      this.normalCellX = i;
      this.normalCellZ = j;
    }
    const w00 = (1 - fx) * (1 - fz);
    const w10 = fx * (1 - fz);
    const w01 = (1 - fx) * fz;
    const w11 = fx * fz;
    const nx = w00 * v[0] + w10 * v[3] + w01 * v[6] + w11 * v[9];
    const ny = w00 * v[1] + w10 * v[4] + w01 * v[7] + w11 * v[10];
    const nz = w00 * v[2] + w10 * v[5] + w01 * v[8] + w11 * v[11];
    const il = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
    out[0] = nx * il;
    out[1] = ny * il;
    out[2] = nz * il;
    return out;
  }

  slopeAt(x: number, z: number): number {
    const n = this.normalAt(x, z, this.slopeScratch);
    return Math.atan2(Math.hypot(n[0], n[2]), n[1]);
  }

  /** Writes the unit vertex normal of grid vertex (i, j) at `vertex[o..o+2]`. */
  private vertexNormal(i: number, j: number, o: number): void {
    const n = this.n;
    const h = this.h;
    const last = n - 1;
    const im = i > 0 ? i - 1 : 0;
    const ip = i < last ? i + 1 : last;
    const jm = j > 0 ? j - 1 : 0;
    const jp = j < last ? j + 1 : last;
    const dx = (h[j * n + ip] - h[j * n + im]) / ((ip - im) * this.cell);
    const dz = (h[jp * n + i] - h[jm * n + i]) / ((jp - jm) * this.cell);
    const il = 1 / Math.sqrt(dx * dx + 1 + dz * dz);
    this.vertex[o] = -dx * il;
    this.vertex[o + 1] = il;
    this.vertex[o + 2] = -dz * il;
  }

  /**
   * First place the ray `origin + t * dir` goes from above the surface to on/below it, with 0 <= t <= maxDist (for a unit `dir`
   * t is the distance). The terrain is a solid slab under the map footprint: a ray that starts below the surface, or that
   * enters the footprint below it, hits where it starts or enters. Beyond the map border there is nothing to hit. The normal is
   * the smoothed `normalAt` at the hit.
   */
  raycast(origin: Vec3, dir: Vec3, maxDist: number): { t: number; point: Vec3; normal: Vec3 } | null {
    const { n, inv } = this;
    const last = n - 1;
    const [px, py, pz] = origin;
    const [dx, dy, dz] = dir;
    const gxo = (px - this.ox) * inv;
    const gzo = (pz - this.oz) * inv;
    const dgx = dx * inv;
    const dgz = dz * inv;
    if (!(maxDist > 0) || (dx === 0 && dy === 0 && dz === 0)) return null;

    let tEnter = 0;
    let tExit = maxDist;
    if (dgx !== 0) {
      const a = -gxo / dgx;
      const b = (last - gxo) / dgx;
      tEnter = Math.max(tEnter, Math.min(a, b));
      tExit = Math.min(tExit, Math.max(a, b));
    } else if (gxo < 0 || gxo > last) return null;
    if (dgz !== 0) {
      const a = -gzo / dgz;
      const b = (last - gzo) / dgz;
      tEnter = Math.max(tEnter, Math.min(a, b));
      tExit = Math.min(tExit, Math.max(a, b));
    } else if (gzo < 0 || gzo > last) return null;
    const top = this.data.maxHeight;
    if (py > top) {
      if (dy >= 0) return null;
      tEnter = Math.max(tEnter, (top - py) / dy);
    }
    if (dy > 0) tExit = Math.min(tExit, (top - py) / dy);
    else if (dy < 0) {
      // Entering the footprint already under the lowest sample is a hit at the entry, so only a later floor crossing ends the ray.
      const tFloor = (this.data.minHeight - FLOOR_MARGIN - py) / dy;
      if (tFloor > tEnter) tExit = Math.min(tExit, tFloor);
    }
    if (!(tEnter <= tExit)) return null;

    const cellMax = this.cellMax ?? (this.cellMax = buildCellMax(this.h, n));
    const gx = gxo + dgx * tEnter;
    const gz = gzo + dgz * tEnter;
    let ci = Math.min(Math.max(Math.floor(gx), 0), last - 1);
    let cj = Math.min(Math.max(Math.floor(gz), 0), last - 1);
    const stepX = dgx > 0 ? 1 : -1;
    const stepZ = dgz > 0 ? 1 : -1;
    const tDeltaX = dgx === 0 ? Infinity : 1 / Math.abs(dgx);
    const tDeltaZ = dgz === 0 ? Infinity : 1 / Math.abs(dgz);
    let tNextX = dgx === 0 ? Infinity : ((dgx > 0 ? ci + 1 : ci) - gxo) / dgx;
    let tNextZ = dgz === 0 ? Infinity : ((dgz > 0 ? cj + 1 : cj) - gzo) / dgz;

    let t = tEnter;
    for (;;) {
      const stepInX = tNextX < tNextZ;
      const tCell = Math.min(stepInX ? tNextX : tNextZ, tExit);
      const yA = py + dy * t;
      const yB = py + dy * tCell;
      if ((yA < yB ? yA : yB) <= cellMax[cj * last + ci]) {
        const hit = cellCrossing(this.h, n, ci, cj, gxo, gzo, dgx, dgz, py, dy, t, tCell);
        if (hit >= 0) {
          const point: Vec3 = [px + dx * hit, py + dy * hit, pz + dz * hit];
          return { t: hit, point, normal: this.normalAt(point[0], point[2]) };
        }
      }
      if (tCell >= tExit) return null;
      if (stepInX) {
        ci += stepX;
        tNextX += tDeltaX;
      } else {
        cj += stepZ;
        tNextZ += tDeltaZ;
      }
      if (ci < 0 || cj < 0 || ci >= last || cj >= last) return null;
      t = tCell;
    }
  }
}

/** Highest of the four corner heights of every cell, (N-1)^2 entries: a ray wholly above this cannot touch the cell. */
function buildCellMax(h: Float32Array, n: number): Float32Array {
  const m = n - 1;
  const out = new Float32Array(m * m);
  for (let j = 0; j < m; j++) {
    for (let i = 0; i < m; i++) {
      const b = j * n + i;
      out[j * m + i] = Math.max(h[b], h[b + 1], h[b + n], h[b + n + 1]);
    }
  }
  return out;
}

/**
 * Where, within ray parameters [ta, tb] inside cell (ci, cj), the ray first reaches the surface; -1 if it stays above. The height
 * over a cell is piecewise planar with a break where fx === fz, so the gap between ray and surface is piecewise linear in t and
 * the root of each piece is exact.
 */
function cellCrossing(
  h: Float32Array,
  n: number,
  ci: number,
  cj: number,
  gxo: number,
  gzo: number,
  dgx: number,
  dgz: number,
  py: number,
  dy: number,
  ta: number,
  tb: number,
): number {
  const b = cj * n + ci;
  const h00 = h[b];
  const h10 = h[b + 1];
  const h01 = h[b + n];
  const h11 = h[b + n + 1];
  const dd = dgx - dgz;
  let tm = tb;
  if (dd !== 0) {
    const tk = (ci - cj - gxo + gzo) / dd;
    if (tk > ta && tk < tb) tm = tk;
  }
  let s0 = ta;
  for (let piece = 0; piece < 2; piece++) {
    const s1 = piece === 0 ? tm : tb;
    if (piece === 1 && tm === tb) break;
    const mid = 0.5 * (s0 + s1);
    const upper = gxo + dgx * mid - ci >= gzo + dgz * mid - cj;
    const cx = upper ? h10 - h00 : h11 - h01;
    const cz = upper ? h11 - h10 : h01 - h00;
    const c0 = py - h00 - cx * (gxo - ci) - cz * (gzo - cj);
    const slope = dy - cx * dgx - cz * dgz;
    const g0 = c0 + slope * s0;
    const g1 = c0 + slope * s1;
    if (g0 <= 0) return s0;
    if (g1 < 0) return s0 + ((s1 - s0) * g0) / (g0 - g1);
    s0 = s1;
  }
  return -1;
}
