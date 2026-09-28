/** Uniform-grid spatial index over a path's samples: nearest sample and radius queries without scanning the whole path. */
import type { TrackData, Vec3 } from '../../contracts';

export class PathIndex {
  /** Distance (3D for `nearest`, horizontal for `nearestXZ`) of the sample the last query returned. */
  lastDist = 0;
  private readonly cell: number;
  private readonly minX: number;
  private readonly minZ: number;
  private readonly nx: number;
  private readonly nz: number;
  private readonly start: Int32Array;
  private readonly items: Int32Array;

  constructor(readonly path: Vec3[], minCell = 8) {
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (const p of path) {
      if (p[0] < x0) x0 = p[0];
      if (p[0] > x1) x1 = p[0];
      if (p[2] < z0) z0 = p[2];
      if (p[2] > z1) z1 = p[2];
    }
    const area = Math.max((x1 - x0) * (z1 - z0), 1);
    this.cell = Math.max(minCell, Math.sqrt(area / (2 * path.length)));
    this.minX = x0;
    this.minZ = z0;
    this.nx = Math.floor((x1 - x0) / this.cell) + 1;
    this.nz = Math.floor((z1 - z0) / this.cell) + 1;
    this.start = new Int32Array(this.nx * this.nz + 1);
    const cellOf = new Int32Array(path.length);
    for (let i = 0; i < path.length; i++) {
      const c = this.cellIndex(path[i][0], path[i][2]);
      cellOf[i] = c;
      this.start[c + 1]++;
    }
    for (let c = 0; c < this.nx * this.nz; c++) this.start[c + 1] += this.start[c];
    this.items = new Int32Array(path.length);
    const fill = this.start.slice(0, this.nx * this.nz);
    for (let i = 0; i < path.length; i++) this.items[fill[cellOf[i]]++] = i;
  }

  private cellIndex(x: number, z: number): number {
    const cx = Math.min(Math.max(Math.floor((x - this.minX) / this.cell), 0), this.nx - 1);
    const cz = Math.min(Math.max(Math.floor((z - this.minZ) / this.cell), 0), this.nz - 1);
    return cz * this.nx + cx;
  }

  /** Index of the sample nearest to (x, y, z) in 3D. */
  nearest(x: number, y: number, z: number): number {
    return this.search(x, y, z, true);
  }

  /** Index of the sample nearest to (x, z) ignoring height. */
  nearestXZ(x: number, z: number): number {
    return this.search(x, 0, z, false);
  }

  private search(x: number, y: number, z: number, use3d: boolean): number {
    const p = this.path;
    let best = -1;
    let bestD = Infinity;
    const cx = Math.floor((x - this.minX) / this.cell);
    const cz = Math.floor((z - this.minZ) / this.cell);
    const inside = cx >= 0 && cz >= 0 && cx < this.nx && cz < this.nz;
    if (inside) {
      const maxRing = Math.max(this.nx, this.nz);
      for (let r = 0; r <= maxRing; r++) {
        if (best >= 0 && bestD <= (r - 1) * this.cell) break;
        for (let j = cz - r; j <= cz + r; j++) {
          if (j < 0 || j >= this.nz) continue;
          const edge = j === cz - r || j === cz + r;
          for (let i = cx - r; i <= cx + r; i += edge ? 1 : Math.max(2 * r, 1)) {
            if (i < 0 || i >= this.nx) continue;
            const c = j * this.nx + i;
            for (let k = this.start[c]; k < this.start[c + 1]; k++) {
              const q = p[this.items[k]];
              const dy = use3d ? q[1] - y : 0;
              const d = Math.hypot(q[0] - x, dy, q[2] - z);
              if (d < bestD) {
                bestD = d;
                best = this.items[k];
              }
            }
          }
        }
      }
    } else {
      for (let i = 0; i < p.length; i++) {
        const d = Math.hypot(p[i][0] - x, use3d ? p[i][1] - y : 0, p[i][2] - z);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }
    this.lastDist = bestD;
    return best;
  }

  /** Appends to `out` every sample whose horizontal distance to (x, z) is <= r. */
  collectXZ(x: number, z: number, r: number, out: number[]): void {
    const c0 = Math.max(Math.floor((x - r - this.minX) / this.cell), 0);
    const c1 = Math.min(Math.floor((x + r - this.minX) / this.cell), this.nx - 1);
    const r0 = Math.max(Math.floor((z - r - this.minZ) / this.cell), 0);
    const r1 = Math.min(Math.floor((z + r - this.minZ) / this.cell), this.nz - 1);
    const r2 = r * r;
    for (let j = r0; j <= r1; j++) {
      for (let i = c0; i <= c1; i++) {
        const c = j * this.nx + i;
        for (let k = this.start[c]; k < this.start[c + 1]; k++) {
          const q = this.path[this.items[k]];
          const dx = q[0] - x;
          const dz = q[2] - z;
          if (dx * dx + dz * dz <= r2) out.push(this.items[k]);
        }
      }
    }
  }
}

const cache = new WeakMap<Vec3[], PathIndex>();

function indexOf(track: TrackData): PathIndex {
  let idx = cache.get(track.path);
  if (!idx) {
    idx = new PathIndex(track.path);
    cache.set(track.path, idx);
  }
  return idx;
}

/**
 * Index of the path sample nearest to `pos`. Pass the previous result as `hint` while flying along the track: a window of
 * +-30 samples around it is tried first, and only a miss (> 5 m) falls back to the spatial index.
 */
export function nearestPathIndex(track: TrackData, pos: Vec3, hint?: number): number {
  const p = track.path;
  const n = p.length;
  if (hint !== undefined && n > 0) {
    let best = -1;
    let bestD = Infinity;
    for (let o = -30; o <= 30; o++) {
      const raw = hint + o;
      if (!track.closed && (raw < 0 || raw >= n)) continue;
      const i = ((raw % n) + n) % n;
      const d = Math.hypot(p[i][0] - pos[0], p[i][1] - pos[1], p[i][2] - pos[2]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0 && bestD <= 5) return best;
  }
  return indexOf(track).nearest(pos[0], pos[1], pos[2]);
}

function segDist(a: Vec3, b: Vec3, x: number, y: number, z: number): number {
  const ex = b[0] - a[0];
  const ey = b[1] - a[1];
  const ez = b[2] - a[2];
  const l2 = ex * ex + ey * ey + ez * ez;
  let t = l2 > 1e-12 ? ((x - a[0]) * ex + (y - a[1]) * ey + (z - a[2]) * ez) / l2 : 0;
  t = Math.min(Math.max(t, 0), 1);
  return Math.hypot(a[0] + ex * t - x, a[1] + ey * t - y, a[2] + ez * t - z);
}

/** Shortest 3D distance from `pos` to the centreline polyline. */
export function distanceToPath(track: TrackData, pos: Vec3): number {
  const p = track.path;
  const n = p.length;
  if (n === 0) return Infinity;
  const i = indexOf(track).nearest(pos[0], pos[1], pos[2]);
  const prev = track.closed ? (i + n - 1) % n : Math.max(i - 1, 0);
  const next = track.closed ? (i + 1) % n : Math.min(i + 1, n - 1);
  return Math.min(segDist(p[prev], p[i], pos[0], pos[1], pos[2]), segDist(p[i], p[next], pos[0], pos[1], pos[2]));
}
