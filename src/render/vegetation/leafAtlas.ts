import { Rng } from '../../world/track/rng';
import {
  beechPainter, birchPainter, blobPainter, hawthornPainter, newSample, sat, sheetPainter, shrubPainter, sprigPainter, type LaidOutPainter, type Painter, type ShootLayout,
} from './treeLeafShapes';
import { runSliced, runSync, type Steps } from './slices';
import { brushPainter, conifer, pinePainter, sprayPainter, type SprayLayout } from './treeNeedleShapes';

export const TILE_SIZE = 512;
export const TILES_X = 4;
export const TILES_Y = 5;
export const ATLAS_W = TILE_SIZE * TILES_X;
export const ATLAS_H = TILE_SIZE * TILES_Y;
/** Mips are kept down to 4 x 4 texels per tile so bilinear taps never reach a neighbouring tile's shape. */
export const ATLAS_MIPS = 8;
/** Tile size of the extreme tier's atlas: twice the texels each way, so a leaf a metre from the camera stays sharp. */
export const EXTREME_TILE_SIZE = 1024;

/** Mip levels of an atlas with `tileSize` texels per tile side (down to 4 x 4 per tile). */
export const atlasMips = (tileSize: number): number => Math.round(Math.log2(tileSize / 4)) + 1;
/**
 * Tile indices: 4 x 5 tiles, tile = column + 4 * row from the top-left. Oak, birch and beech have two shoots each (`sprig` and `oak2`,
 * `birch` and `birch2`, `beech` and `beech2`) so neighbouring cards of one crown differ, and bushes mix hazel (`shrub`) and `hawthorn`;
 * `pine` is a Scots pine branch end of three or four needle brushes and `pine2` a single one (the near LOD's pine shoots), `needles` and `needles2` flat spruce sprays, and `brush` and `brush2` the hanging
 * bottle-brush branchlets of a spruce. The last row holds single-leaf sheets of oak, birch, beech and hazel, which the extreme tier cuts its
 * per-leaf geometry from (treeLeafShapes.ts sheetPainter).
 */
export const TILE = { sprig: 0, needles: 1, blob: 2, conifer: 3, birch: 4, shrub: 5, oak2: 6, birch2: 7, pine: 8, beech: 9, beech2: 10, hawthorn: 11,
  brush: 12, brush2: 13, pine2: 14, needles2: 15, oakSheet: 16, birchSheet: 17, beechSheet: 18, hazelSheet: 19 } as const;
export const TILE_COUNT = 20;
/** The colour texture stores the leaf colour multiplier divided by this; the tree shader multiplies it back. */
export const COLOUR_RANGE = 3;

/** One painter sample per texel: the alpha cut of the bilinear-filtered mask already gives smooth leaf edges. */
const SS = 1;
const ALPHA_CUT = 128;

/** Atlas rectangle of a tile: u0, v0 (top edge), u1, v1 (bottom edge). */
export function tileRect(tile: number): [number, number, number, number] {
  const col = tile % TILES_X, row = Math.floor(tile / TILES_X);
  return [col / TILES_X, row / TILES_Y, (col + 1) / TILES_X, (row + 1) / TILES_Y];
}

/**
 * Colour multiplier relative to the species' green leaf tone for a painter hue (0 deep green, 0.35 yellow-green, 0.7 yellow-orange,
 * 1 dead brown) and shade. Real leaf reflectance has red about half of green and blue under a third; the ramp keeps those ratios.
 */
const RAMP: readonly (readonly [number, number, number, number])[] = [
  [0, 0.9, 0.9, 1], [0.35, 1.55, 1.1, 0.75], [0.7, 2.3, 1, 0.6], [1, 2.4, 0.78, 0.9],
];

export function leafColour(hue: number, shade: number, out: [number, number, number]): void {
  let i = 0;
  while (i < RAMP.length - 2 && hue > RAMP[i + 1][0]) i++;
  const a = RAMP[i], b = RAMP[i + 1], t = sat((hue - a[0]) / (b[0] - a[0]));
  const dead = 1 - 0.3 * sat((hue - 0.8) / 0.2);
  for (let k = 0; k < 3; k++) out[k] = (a[k + 1] + (b[k + 1] - a[k + 1]) * t) * shade * dead;
}

interface Level {
  /** rgb = colour multiplier / COLOUR_RANGE, a = coverage mask. */
  colour: Uint8Array;
  /** r, g = surface tilt along the tile's u and v (0.5 flat), b = translucency (thin lamina 1, veins 0), a = cavity openness. */
  data: Uint8Array;
}

/** The procedural leaf atlas: two RGBA8 pyramids of atlasMips(tileSize) levels (level l is (tileSize * TILES_X >> l) x (tileSize * TILES_Y >> l) texels). */
export interface LeafAtlas {
  tileSize: number;
  colour: Uint8Array[];
  data: Uint8Array[];
}

/** Painted channels per sample: colour rgb, tilt u and v, translucency, openness. */
const CHANNELS = 7;
const STRIDE = CHANNELS + 1;
/** A rasterise or downsample generator yields every ROWS_PER_STEP + 1 rows (a power of two minus one mask). */
const ROWS_PER_STEP = 3;
const byte = (x: number): number => Math.round(sat(x) * 255);

function* rasterise(paint: Painter, tile: number, out: Level, TILE_SIZE: number): Steps<void> {
  const ATLAS_W = TILE_SIZE * TILES_X;
  const ox = (tile % TILES_X) * TILE_SIZE, oy = Math.floor(tile / TILES_X) * TILE_SIZE;
  const s = newSample(), c: [number, number, number] = [0, 0, 0];
  const sum = new Float64Array(CHANNELS), mean = new Float64Array(CHANNELS);
  let covered = 0;
  const texel = new Float32Array(TILE_SIZE * TILE_SIZE * STRIDE);
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      sum.fill(0);
      let cover = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          if (!paint((x + (sx + 0.5) / SS) / TILE_SIZE, (y + (sy + 0.5) / SS) / TILE_SIZE, s)) continue;
          leafColour(s.hue, s.shade, c);
          cover++;
          sum[0] += c[0]; sum[1] += c[1]; sum[2] += c[2]; sum[3] += s.tu; sum[4] += s.tv; sum[5] += s.thin; sum[6] += s.open;
        }
      }
      const o = (y * TILE_SIZE + x) * STRIDE;
      texel[o] = cover / (SS * SS);
      if (cover === 0) continue;
      covered++;
      for (let k = 0; k < CHANNELS; k++) { texel[o + 1 + k] = sum[k] / cover; mean[k] += texel[o + 1 + k]; }
    }
    if ((y & ROWS_PER_STEP) === ROWS_PER_STEP) yield;
  }
  // Empty texels take the tile's mean so bilinear taps and mips at a leaf edge never blend toward black.
  const fill = Array.from(mean, (m) => (covered > 0 ? m / covered : 0));
  if (covered === 0) { fill[0] = fill[1] = fill[2] = 0.7; fill[5] = 1; fill[6] = 1; }
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const t = (y * TILE_SIZE + x) * STRIDE, a = texel[t];
      const v = (k: number): number => (a > 0 ? texel[t + 1 + k] : fill[k]);
      const o = ((oy + y) * ATLAS_W + ox + x) * 4;
      out.colour[o] = byte(v(0) / COLOUR_RANGE); out.colour[o + 1] = byte(v(1) / COLOUR_RANGE); out.colour[o + 2] = byte(v(2) / COLOUR_RANGE);
      out.colour[o + 3] = Math.round(a * 255);
      out.data[o] = byte(0.5 + 0.5 * v(3)); out.data[o + 1] = byte(0.5 + 0.5 * v(4)); out.data[o + 2] = byte(v(5)); out.data[o + 3] = byte(v(6));
    }
    if ((y & ROWS_PER_STEP) === ROWS_PER_STEP) yield;
  }
}

/** Fraction of a tile's texels at or above the alpha cut, after scaling alpha by `scale`. */
export function tileCoverage(colour: Uint8Array, width: number, height: number, tile: number, scale = 1): number {
  const tw = width / TILES_X, th = height / TILES_Y, ox = (tile % TILES_X) * tw, oy = Math.floor(tile / TILES_X) * th;
  let n = 0;
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) if (colour[((oy + y) * width + ox + x) * 4 + 3] * scale >= ALPHA_CUT) n++;
  return n / (tw * th);
}

/** Box-filtered next mip: every channel weighted by alpha, then alpha rescaled per tile so alpha-tested coverage matches level 0 (leaves keep their mass at distance). */
function* downsample(src: Level, w: number, h: number, target: readonly number[]): Steps<Level> {
  const hw = w >> 1, hh = h >> 1;
  const dst: Level = { colour: new Uint8Array(hw * hh * 4), data: new Uint8Array(hw * hh * 4) };
  const acc = new Float64Array(7);
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < hw; x++) {
      let a = 0, weight = 0;
      acc.fill(0);
      for (let k = 0; k < 4; k++) {
        const o = ((2 * y + (k >> 1)) * w + 2 * x + (k & 1)) * 4;
        const al = src.colour[o + 3] + 0.5;
        a += src.colour[o + 3];
        weight += al;
        for (let c = 0; c < 3; c++) { acc[c] += src.colour[o + c] * al; acc[3 + c] += src.data[o + c] * al; }
        acc[6] += src.data[o + 3] * al;
      }
      const o = (y * hw + x) * 4;
      for (let c = 0; c < 3; c++) { dst.colour[o + c] = Math.round(acc[c] / weight); dst.data[o + c] = Math.round(acc[3 + c] / weight); }
      dst.data[o + 3] = Math.round(acc[6] / weight);
      dst.colour[o + 3] = Math.round(a / 4);
    }
    if ((y & 15) === 15) yield;
  }
  for (let tile = 0; tile < TILE_COUNT; tile++) {
    let lo = 1, hi = 8;
    for (let it = 0; it < 14; it++) {
      const mid = 0.5 * (lo + hi);
      if (tileCoverage(dst.colour, hw, hh, tile, mid) < target[tile]) lo = mid; else hi = mid;
      yield;
    }
    const tw = hw / TILES_X, th = hh / TILES_Y, ox = (tile % TILES_X) * tw, oy = Math.floor(tile / TILES_X) * th;
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      const o = ((oy + y) * hw + ox + x) * 4 + 3;
      dst.colour[o] = Math.min(255, Math.round(dst.colour[o] * hi));
    }
  }
  return dst;
}

/** The painters in tile order; each tile gets its own sub-stream so changing one leaf shape leaves the others untouched. */
function painters(tileSize: number): Painter[] {
  return Array.from({ length: TILE_COUNT }, (_, tile) => painterFor(tile, tileSize));
}

/** The painter of one tile, built alone. */
function painterFor(tile: number, tileSize: number): LaidOutPainter {
  const rng = (k: number): Rng => new Rng(0x1eaf + k * 7919);
  const make: (() => LaidOutPainter)[] = [
    () => sprigPainter(rng(0)), () => sprayPainter(rng(1), tileSize), () => blobPainter(rng(2)), () => conifer(23), () => birchPainter(rng(4)),
    () => shrubPainter(rng(5)), () => sprigPainter(rng(6)), () => birchPainter(rng(7)), () => pinePainter(rng(8), tileSize), () => beechPainter(rng(9)),
    () => beechPainter(rng(10)), () => hawthornPainter(rng(11)), () => brushPainter(rng(12), tileSize), () => brushPainter(rng(13), tileSize),
    () => pinePainter(rng(14), tileSize, true), () => sprayPainter(rng(15), tileSize),
    () => sheetPainter(rng(16), 'oak'), () => sheetPainter(rng(17), 'birch'), () => sheetPainter(rng(18), 'beech'), () => sheetPainter(rng(19), 'hazel'),
  ];
  return make[tile]();
}

const BROADLEAF_SHOOTS = new Set<number>([TILE.sprig, TILE.oak2, TILE.birch, TILE.birch2, TILE.beech, TILE.beech2, TILE.shrub, TILE.hawthorn]);
const layouts = new Map<number, ShootLayout | null>();

/** Leaves and twigs of a broadleaf shoot tile in tile coordinates (the same at every tile size), null for other tiles. Deterministic. */
export function shootLayout(tile: number): ShootLayout | null {
  if (!layouts.has(tile)) layouts.set(tile, BROADLEAF_SHOOTS.has(tile) ? painterFor(tile, TILE_SIZE).layout ?? null : null);
  return layouts.get(tile) ?? null;
}

const opacity = new Map<string, (u: number, v: number) => boolean>();
const OPACITY_RES = 128;
/**
 * Whether a tile paints anything at an atlas uv inside it (the same shapes at every tile size), or with `grow` > 0 whether it paints anything
 * within that many cells (1/128 of the tile) of it. Used to keep foliage from crossing itself.
 */
export function tileOpacity(tile: number, grow = 0): (u: number, v: number) => boolean {
  const key = `${tile}:${grow}`;
  let f = opacity.get(key);
  if (!f) {
    // Painted once into a coarse mask (a few millimetres per cell on a shoot card); painting per lookup would dominate the tree build.
    const paint = painterFor(tile, TILE_SIZE), s = newSample(), [u0, v0, u1, v1] = tileRect(tile), N = OPACITY_RES;
    let mask = new Uint8Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) mask[y * N + x] = paint((x + 0.5) / N, (y + 0.5) / N, s) ? 1 : 0;
    // Grown by a square of cells, one axis at a time.
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      if (grow <= 0) break;
      const out = new Uint8Array(N * N);
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        for (let k = -grow; k <= grow && !out[y * N + x]; k++) {
          const xx = x + k * dx, yy = y + k * dy;
          if (xx >= 0 && xx < N && yy >= 0 && yy < N && mask[yy * N + xx]) out[y * N + x] = 1;
        }
      }
      mask = out;
    }
    const cell = (t: number): number => Math.min(N - 1, Math.max(0, Math.floor(t * N)));
    const m = mask;
    f = (u, v) => m[cell((v - v0) / (v1 - v0)) * N + cell((u - u0) / (u1 - u0))] === 1;
    opacity.set(key, f);
  }
  return f;
}

const sprays = new Map<number, SprayLayout>();
/** Leader and side shoots of a spruce spray tile (`needles` or `needles2`) in tile coordinates. Deterministic. */
export function sprayLayout(tile: typeof TILE.needles | typeof TILE.needles2): SprayLayout {
  if (!sprays.has(tile)) sprays.set(tile, sprayPainter(new Rng(0x1eaf + tile * 7919), 64).spray);
  return sprays.get(tile)!;
}

/** Single-leaf sheet a broadleaf shoot tile's leaves are cut from at the extreme tier (hawthorn borrows the lobed oak leaf), null for others. */
export function sheetFor(tile: number): number | null {
  if (tile === TILE.sprig || tile === TILE.oak2 || tile === TILE.hawthorn) return TILE.oakSheet;
  if (tile === TILE.birch || tile === TILE.birch2) return TILE.birchSheet;
  if (tile === TILE.beech || tile === TILE.beech2) return TILE.beechSheet;
  if (tile === TILE.shrub) return TILE.hazelSheet;
  return null;
}

function* atlasSteps(tileSize: number): Steps<LeafAtlas> {
  const W = tileSize * TILES_X, H = tileSize * TILES_Y;
  const base: Level = { colour: new Uint8Array(W * H * 4), data: new Uint8Array(W * H * 4) };
  const paint = painters(tileSize);
  for (let tile = 0; tile < paint.length; tile++) yield* rasterise(paint[tile], tile, base, tileSize);
  const target = Array.from({ length: TILE_COUNT }, (_, t) => tileCoverage(base.colour, W, H, t));
  const levels: Level[] = [base];
  let w = W, h = H;
  for (let l = 1; l < atlasMips(tileSize); l++) {
    levels.push(yield* downsample(levels[l - 1], w, h, target));
    w >>= 1; h >>= 1;
  }
  return { tileSize, colour: levels.map((l) => l.colour), data: levels.map((l) => l.data) };
}

/** The deterministic leaf atlas; level 0 is ATLAS_W x ATLAS_H at the default tile size. */
export function buildLeafAtlas(tileSize = TILE_SIZE): LeafAtlas {
  return runSync(atlasSteps(tileSize));
}

/** The same atlas built in slices of about `budgetMs` with an event-loop yield between them, so the loading screen keeps painting. */
export function buildLeafAtlasSliced(budgetMs = 8, yieldFn?: () => Promise<void>, tileSize = TILE_SIZE): Promise<LeafAtlas> {
  return runSliced(atlasSteps(tileSize), budgetMs, yieldFn);
}
