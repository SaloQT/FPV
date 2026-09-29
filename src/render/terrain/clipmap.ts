/**
 * Geometry clipmap layout (Losasso and Hoppe). Level l is a 64x64-quad square with vertex spacing s_l = cellSize * 2^l,
 * centred on the camera and snapped to 2 * s_l (= s_{l+1}, so its grid is a subset of the next level's). Levels l >= 1 have the
 * finer level's square cut out as a hole, one quad smaller on every side: the ring tucks under the finer border so the T-junction
 * pinholes there reveal the same surface instead of the sky. Because snapping differs per level the hole sits 0 or +-1 quad off the
 * ring centre, so the ring is decomposed into four axis-aligned rectangles (bottom, top, left, right) that are split into tiles of
 * at most 16x16 quads. Every tile is one instance of a shared 16x16 index buffer; smaller tiles collapse their surplus quads in the vertex shader.
 */

export const RING_QUADS = 64;
export const TILE_QUADS = 16;
export const MAX_LEVELS = 10;
/** Floats per tile in the GPU tile buffer: gx0, gz0, w, h (level grid units), spacing, level, pad, pad. */
export const TILE_FLOATS = 8;
export const TILE_BYTES = TILE_FLOATS * 4;
export const MAX_TILES = 16 + (MAX_LEVELS - 1) * 24;

const HALF = RING_QUADS / 2;
const HOLE_TUCK = 1;

export function levelSpacing(cellSize: number, level: number): number {
  return cellSize * 2 ** level;
}

/** Number of levels so that the outermost square's half-width reaches `viewDistance`. */
export function levelCount(cellSize: number, viewDistance: number): number {
  let n = 1;
  while (n < MAX_LEVELS && HALF * levelSpacing(cellSize, n - 1) < viewDistance) n++;
  return n;
}

/** Level centres in level grid units relative to the terrain origin, always even. Writes (x, z) pairs into `out`. */
export function snapLevels(camX: number, camZ: number, originX: number, originZ: number, cellSize: number, levels: number, out: Int32Array): void {
  for (let l = 0; l < levels; l++) {
    const step = 2 * levelSpacing(cellSize, l);
    out[2 * l] = 2 * Math.round((camX - originX) / step);
    out[2 * l + 1] = 2 * Math.round((camZ - originZ) / step);
  }
}

/** Four side planes of a symmetric perspective frustum (infinite far plane), stored as unnormalised inward normals. */
export class Frustum {
  private readonly n = new Float64Array(12);
  private cx = 0;
  private cy = 0;
  private cz = 0;
  private active = false;

  disable(): void { this.active = false; }

  /** `quat` maps body to world with the camera looking along body -Z, +Y up, +X right. */
  setFromCamera(pos: ArrayLike<number>, quat: ArrayLike<number>, fovY: number, aspect: number, slack = 1.05): void {
    const qx = quat[0], qy = quat[1], qz = quat[2], qw = quat[3];
    const rx = 1 - 2 * (qy * qy + qz * qz), ry = 2 * (qx * qy + qw * qz), rz = 2 * (qx * qz - qw * qy);
    const ux = 2 * (qx * qy - qw * qz), uy = 1 - 2 * (qx * qx + qz * qz), uz = 2 * (qy * qz + qw * qx);
    const fx = -2 * (qx * qz + qw * qy), fy = -2 * (qy * qz - qw * qx), fz = -(1 - 2 * (qx * qx + qy * qy));
    const ty = Math.tan(fovY * 0.5) * slack, tx = ty * aspect;
    const n = this.n;
    n[0] = fx * tx + rx; n[1] = fy * tx + ry; n[2] = fz * tx + rz;
    n[3] = fx * tx - rx; n[4] = fy * tx - ry; n[5] = fz * tx - rz;
    n[6] = fx * ty + ux; n[7] = fy * ty + uy; n[8] = fz * ty + uz;
    n[9] = fx * ty - ux; n[10] = fy * ty - uy; n[11] = fz * ty - uz;
    this.cx = pos[0]; this.cy = pos[1]; this.cz = pos[2];
    this.active = true;
  }

  intersectsBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean {
    if (!this.active) return true;
    const n = this.n;
    for (let p = 0; p < 12; p += 3) {
      const nx = n[p], ny = n[p + 1], nz = n[p + 2];
      const px = (nx >= 0 ? x1 : x0) - this.cx, py = (ny >= 0 ? y1 : y0) - this.cy, pz = (nz >= 0 ? z1 : z0) - this.cz;
      if (nx * px + ny * py + nz * pz < 0) return false;
    }
    return true;
  }
}

export interface ClipmapStats {
  tiles: number;
  quads: number;
  culledTiles: number;
  levels: number;
}

/** Builds the per-frame tile list into a reused Float32Array (TILE_FLOATS per tile); allocates nothing after construction. */
export class Clipmap {
  readonly tiles = new Float32Array(MAX_TILES * TILE_FLOATS);
  readonly stats: ClipmapStats = { tiles: 0, quads: 0, culledTiles: 0, levels: 0 };
  private readonly centres = new Int32Array(MAX_LEVELS * 2);
  private count = 0;
  private culled = 0;
  private quads = 0;
  private originX = 0;
  private originZ = 0;
  private yMin = 0;
  private yMax = 0;
  private frustum: Frustum | null = null;

  build(camX: number, camZ: number, originX: number, originZ: number, cellSize: number, levels: number, yMin: number, yMax: number, frustum: Frustum | null): number {
    snapLevels(camX, camZ, originX, originZ, cellSize, levels, this.centres);
    this.count = 0; this.culled = 0; this.quads = 0;
    this.originX = originX; this.originZ = originZ; this.yMin = yMin; this.yMax = yMax; this.frustum = frustum;
    for (let l = 0; l < levels; l++) this.buildLevel(l, cellSize);
    this.stats.tiles = this.count; this.stats.quads = this.quads; this.stats.culledTiles = this.culled; this.stats.levels = levels;
    return this.count;
  }

  private buildLevel(l: number, cellSize: number): void {
    const cx = this.centres[2 * l], cz = this.centres[2 * l + 1];
    const ox0 = cx - HALF, oz0 = cz - HALF, ox1 = cx + HALF, oz1 = cz + HALF;
    const spacing = levelSpacing(cellSize, l);
    if (l === 0) {
      this.rect(l, spacing, ox0, oz0, ox1, oz1);
      return;
    }
    const hx0 = this.centres[2 * (l - 1)] / 2 - HALF / 2 + HOLE_TUCK, hz0 = this.centres[2 * (l - 1) + 1] / 2 - HALF / 2 + HOLE_TUCK;
    const hx1 = hx0 + HALF - 2 * HOLE_TUCK, hz1 = hz0 + HALF - 2 * HOLE_TUCK;
    this.rect(l, spacing, ox0, oz0, ox1, hz0);
    this.rect(l, spacing, ox0, hz1, ox1, oz1);
    this.rect(l, spacing, ox0, hz0, hx0, hz1);
    this.rect(l, spacing, hx1, hz0, ox1, hz1);
  }

  /** Splits [x0,x1) x [z0,z1) (level grid units) into near-equal tiles of at most TILE_QUADS per side. */
  private rect(l: number, spacing: number, x0: number, z0: number, x1: number, z1: number): void {
    const w = x1 - x0, h = z1 - z0;
    if (w <= 0 || h <= 0) return;
    const nx = Math.ceil(w / TILE_QUADS), nz = Math.ceil(h / TILE_QUADS);
    let z = z0;
    for (let j = 0; j < nz; j++) {
      const th = Math.floor((h * (j + 1)) / nz) - Math.floor((h * j) / nz);
      let x = x0;
      for (let i = 0; i < nx; i++) {
        const tw = Math.floor((w * (i + 1)) / nx) - Math.floor((w * i) / nx);
        this.tile(l, spacing, x, z, tw, th);
        x += tw;
      }
      z += th;
    }
  }

  private tile(l: number, spacing: number, gx: number, gz: number, w: number, h: number): void {
    const wx0 = this.originX + gx * spacing, wz0 = this.originZ + gz * spacing;
    if (this.frustum && !this.frustum.intersectsBox(wx0, this.yMin, wz0, wx0 + w * spacing, this.yMax, wz0 + h * spacing)) { this.culled++; return; }
    const o = this.count++ * TILE_FLOATS, t = this.tiles;
    t[o] = gx; t[o + 1] = gz; t[o + 2] = w; t[o + 3] = h; t[o + 4] = spacing; t[o + 5] = l; t[o + 6] = 0; t[o + 7] = 0;
    this.quads += w * h;
  }
}

/** Shared index buffer for one 16x16-quad tile over a 17x17 vertex grid; the vertex id is the index value (vertex shader decodes it). */
export function buildTileIndices(): Uint16Array {
  const v = TILE_QUADS + 1;
  const out = new Uint16Array(TILE_QUADS * TILE_QUADS * 6);
  let k = 0;
  for (let z = 0; z < TILE_QUADS; z++) {
    for (let x = 0; x < TILE_QUADS; x++) {
      const a = z * v + x, b = a + 1, d = a + v, c = d + 1;
      out[k++] = a; out[k++] = b; out[k++] = c;
      out[k++] = a; out[k++] = c; out[k++] = d;
    }
  }
  return out;
}
