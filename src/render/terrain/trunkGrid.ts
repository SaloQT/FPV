import type { TerrainData } from '../../contracts';

/**
 * Where the tree trunks stand, for the ground right at their feet: a grid over the terrain maps' uv space ((terrainTexel(xz) + 0.5) / N),
 * TRUNK_GRID_SIZE cells a side, each holding at most one trunk (the thickest whose axis falls in it). The terrain shader reads the 3 x 3
 * cells round a pixel and darkens the soil where the trunk hides the sky, and lays litter or moss in a ring round the foot.
 * The ground-cover grid (groundCover.ts) is a few metres a texel, far too coarse for a ring a trunk's width across.
 *
 * Texel: r, g = where the axis is inside the cell (0..1 of the cell in x and z), b = trunk radius / TRUNK_RADIUS_MAX_M, a = 0 for an empty
 * cell, 0.5 for a broadleaf and 1 for a conifer.
 */
export const TRUNK_GRID_SIZE = 1024;
export const TRUNK_RADIUS_MAX_M = 2;

/** One trunk: axis position (x, z) in metres, radius at breast height in metres, and whether the tree sheds needles. */
export interface Trunk {
  x: number;
  z: number;
  radius: number;
  conifer: boolean;
}

const published = new WeakMap<TerrainData, Uint8Array>();

export function publishTrunkGrid(terrain: TerrainData, data: Uint8Array): void {
  published.set(terrain, data);
}

export function trunkGridFor(terrain: TerrainData): Uint8Array | undefined {
  return published.get(terrain);
}

export function rasterTrunkGrid(terrain: TerrainData, trunks: Iterable<Trunk>, size = TRUNK_GRID_SIZE): Uint8Array {
  const n = terrain.resolution, cell = terrain.cellSize, [ox, oz] = terrain.origin;
  // Grid uv u covers world x = ox + (u * n - 0.5) * cell, so cell i spans u in [i, i + 1) / size.
  const toCell = (w: number, o: number): number => ((w - o) / cell + 0.5) / n * size;
  const out = new Uint8Array(size * size * 4);
  for (const t of trunks) {
    const cx = toCell(t.x, ox), cz = toCell(t.z, oz);
    const i = Math.floor(cx), j = Math.floor(cz);
    if (i < 0 || j < 0 || i >= size || j >= size || t.radius <= 0) continue;
    const o = (j * size + i) * 4;
    const r = Math.min(Math.round((t.radius / TRUNK_RADIUS_MAX_M) * 255), 255);
    if (out[o + 3] !== 0 && out[o + 2] >= r) continue;
    out[o] = Math.min(Math.round((cx - i) * 255), 255);
    out[o + 1] = Math.min(Math.round((cz - j) * 255), 255);
    out[o + 2] = Math.max(r, 1);
    out[o + 3] = t.conifer ? 255 : 128;
  }
  return out;
}
