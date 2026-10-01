import { Rng } from '../../world/track/rng';
import { birchPainter, blobPainter, newSample, sat, shrubPainter, sprigPainter, type Painter } from './treeLeafShapes';
import { conifer, sprayPainter } from './treeNeedleShapes';

export const TILE_SIZE = 256;
export const TILES_X = 3;
export const TILES_Y = 2;
export const ATLAS_W = TILE_SIZE * TILES_X;
export const ATLAS_H = TILE_SIZE * TILES_Y;
/** Mips are kept down to 4 x 4 texels per tile so bilinear taps never reach a neighbouring tile's shape. */
export const ATLAS_MIPS = 7;
/** Tile indices: 3 x 2 tiles, tile = column + 3 * row from the top-left. */
export const TILE = { sprig: 0, needles: 1, blob: 2, conifer: 3, birch: 4, shrub: 5 } as const;
export const TILE_COUNT = 6;
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

/** The procedural leaf atlas: two RGBA8 pyramids of ATLAS_MIPS levels (level l is (ATLAS_W >> l) x (ATLAS_H >> l) texels). */
export interface LeafAtlas {
  colour: Uint8Array[];
  data: Uint8Array[];
}

/** Painted channels per sample: colour rgb, tilt u and v, translucency, openness. */
const CHANNELS = 7;
const STRIDE = CHANNELS + 1;
const byte = (x: number): number => Math.round(sat(x) * 255);

function rasterise(paint: Painter, tile: number, out: Level): void {
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
function downsample(src: Level, w: number, h: number, target: readonly number[]): Level {
  const hw = w >> 1, hh = h >> 1;
  const dst: Level = { colour: new Uint8Array(hw * hh * 4), data: new Uint8Array(hw * hh * 4) };
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < hw; x++) {
      let a = 0, weight = 0;
      const acc = [0, 0, 0, 0, 0, 0, 0];
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
  }
  for (let tile = 0; tile < TILE_COUNT; tile++) {
    let lo = 1, hi = 8;
    for (let it = 0; it < 14; it++) {
      const mid = 0.5 * (lo + hi);
      if (tileCoverage(dst.colour, hw, hh, tile, mid) < target[tile]) lo = mid; else hi = mid;
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
function painters(): Painter[] {
  const rng = (k: number): Rng => new Rng(0x1eaf + k * 7919);
  return [sprigPainter(rng(0)), sprayPainter(rng(1)), blobPainter(rng(2)), conifer(23), birchPainter(rng(4)), shrubPainter(rng(5))];
}

/** The deterministic leaf atlas; level 0 is ATLAS_W x ATLAS_H. */
export function buildLeafAtlas(): LeafAtlas {
  const base: Level = { colour: new Uint8Array(ATLAS_W * ATLAS_H * 4), data: new Uint8Array(ATLAS_W * ATLAS_H * 4) };
  painters().forEach((p, tile) => rasterise(p, tile, base));
  const target = Array.from({ length: TILE_COUNT }, (_, t) => tileCoverage(base.colour, ATLAS_W, ATLAS_H, t));
  const levels: Level[] = [base];
  let w = ATLAS_W, h = ATLAS_H;
  for (let l = 1; l < ATLAS_MIPS; l++) {
    levels.push(downsample(levels[l - 1], w, h, target));
    w >>= 1; h >>= 1;
  }
  return { colour: levels.map((l) => l.colour), data: levels.map((l) => l.data) };
}
