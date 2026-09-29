import { Rng } from '../../world/track/rng';
import { hash2, valueNoise2 } from './noise';

export const ATLAS_SIZE = 256;
export const TILE_SIZE = 128;
/** Mips are kept down to 4x4 (2x2 per tile) so bilinear taps never reach a neighbouring tile's shape. */
export const ATLAS_MIPS = 7;
/** Tile indices: 2 x 2 tiles, tile = column + 2 * row from the top-left. */
export const TILE = { sprig: 0, needles: 1, blob: 2, conifer: 3 } as const;

const SS = 3;
const ALPHA_CUT = 128;

/** Atlas rectangle of a tile: u0, v0 (top edge), u1, v1 (bottom edge). */
export function tileRect(tile: number): [number, number, number, number] {
  const u0 = (tile & 1) * 0.5, v0 = (tile >> 1) * 0.5;
  return [u0, v0, u0 + 0.5, v0 + 0.5];
}

/** Returns the greyscale shade at tile coordinates (u right, v down, both 0..1) or a negative number where the tile is empty. */
type Shape = (u: number, v: number) => number;

interface Seg { ax: number; ay: number; bx: number; by: number; r: number; shade: number }

function segDist(s: Seg, u: number, v: number): number {
  const dx = s.bx - s.ax, dy = s.by - s.ay;
  const t = Math.min(Math.max(((u - s.ax) * dx + (v - s.ay) * dy) / (dx * dx + dy * dy + 1e-12), 0), 1);
  return Math.hypot(u - (s.ax + dx * t), v - (s.ay + dy * t));
}

function segmentShape(segs: readonly Seg[]): Shape {
  return (u, v) => {
    for (let i = segs.length - 1; i >= 0; i--) {
      const s = segs[i];
      if (u < Math.min(s.ax, s.bx) - s.r || u > Math.max(s.ax, s.bx) + s.r || v < Math.min(s.ay, s.by) - s.r || v > Math.max(s.ay, s.by) + s.r) continue;
      if (segDist(s, u, v) < s.r) return s.shade;
    }
    return -1;
  };
}

/** A twig with alternating pointed leaves (veins, midrib, petioles) and a terminal leaf. */
function sprigShape(rng: Rng): Shape {
  interface Leaf { bx: number; by: number; dx: number; dy: number; len: number; w: number; shade: number }
  const stemX = (y: number): number => 0.5 + 0.03 * Math.sin(((0.96 - y) / 0.6) * 3.1);
  const leaves: Leaf[] = [];
  const count = 7;
  for (let i = 0; i < count; i++) {
    const t = 0.1 + 0.75 * (i / (count - 1));
    const y = 0.96 - 0.6 * t;
    const ang = (i % 2 === 0 ? 1 : -1) * rng.range(0.7, 1.0);
    leaves.push({ bx: stemX(y), by: y, dx: Math.sin(ang), dy: -Math.cos(ang), len: 0.4 * (1 - 0.25 * t) * rng.range(0.92, 1.08), w: 0.11 * rng.range(0.9, 1.1), shade: rng.range(0.72, 1) });
  }
  leaves.push({ bx: stemX(0.36), by: 0.36, dx: 0, dy: -1, len: 0.3, w: 0.1, shade: 0.95 });
  return (u, v) => {
    for (let i = leaves.length - 1; i >= 0; i--) {
      const l = leaves[i];
      const px = u - l.bx, py = v - l.by;
      const s = (px * l.dx + py * l.dy) / l.len;
      const lat = -px * l.dy + py * l.dx;
      if (s > -0.08 && s <= 0) {
        if (Math.abs(lat) < 0.007) return 0.45;
        continue;
      }
      if (s <= 0 || s >= 1) continue;
      const hw = l.w * Math.sin(Math.PI * Math.pow(s, 0.7));
      const a = Math.abs(lat);
      if (a >= hw) continue;
      const f = s * 6 - (a / hw) * 1.2;
      const vein = Math.min(Math.max((Math.abs(f - Math.floor(f) - 0.5) - 0.38) / 0.12, 0), 1);
      const rib = a < 0.005 ? 1.14 : 1;
      return Math.min(l.shade * (1 - 0.24 * vein) * (0.9 + 0.1 * (1 - a / hw)) * rib, 1);
    }
    if (v > 0.36 && v < 0.96 && Math.abs(u - stemX(v)) < 0.011) return 0.4;
    return -1;
  };
}

/** A conifer spray: a curved stem with paired needle rows that shorten toward the tip. */
function needleShape(rng: Rng): Shape {
  const segs: Seg[] = [];
  const pairs = 30;
  const stem = (t: number): [number, number] => [0.5 + 0.04 * Math.sin(t * 2.6), 0.96 - 0.9 * t];
  for (let i = 0; i < 12; i++) {
    const [ax, ay] = stem(i / 12), [bx, by] = stem((i + 1) / 12);
    segs.push({ ax, ay, bx, by, r: 0.011, shade: 0.4 });
  }
  for (let i = 0; i < pairs; i++) {
    const t = 0.04 + 0.94 * (i / (pairs - 1));
    const [sx, sy] = stem(t);
    const len = 0.31 * (1 - 0.6 * t) * rng.range(0.85, 1.1);
    for (const side of [-1, 1]) {
      const ang = side * (1.15 - 0.45 * t + rng.range(-0.1, 0.1));
      const ex = sx + Math.sin(ang) * len, ey = sy - Math.cos(ang) * len * 0.75 + 0.02;
      segs.push({ ax: sx, ay: sy, bx: ex, by: ey, r: 0.0125, shade: 0.55 + 0.45 * t * rng.range(0.7, 1) + 0.15 * rng.next() });
    }
  }
  segs.push({ ax: stem(1)[0], ay: stem(1)[1], bx: stem(1)[0], by: 0.05, r: 0.012, shade: 0.95 });
  return segmentShape(segs);
}

/** A canopy blob: overlapping lit leaf discs filling an ellipse with a ragged rim and a few sky gaps. */
function blobShape(rng: Rng, seed: number): Shape {
  interface Disc { x: number; y: number; r: number; shade: number }
  const discs: Disc[] = [];
  for (let i = 0; i < 260; i++) {
    const a = rng.range(0, Math.PI * 2), rad = Math.sqrt(rng.next());
    const x = 0.5 + Math.cos(a) * rad * 0.4, y = 0.5 + Math.sin(a) * rad * 0.36;
    const edge = rad;
    if (edge > 0.7 && rng.next() < (edge - 0.7) * 2.2) continue;
    const r = rng.range(0.035, 0.07) * (1 - 0.3 * edge);
    discs.push({ x, y, r, shade: (0.5 + 0.5 * (1 - (y - 0.14) / 0.72)) * rng.range(0.78, 1) });
  }
  const holes: Disc[] = [];
  for (let i = 0; i < 14; i++) holes.push({ x: rng.range(0.32, 0.68), y: rng.range(0.32, 0.68), r: rng.range(0.018, 0.035), shade: 0 });
  const GRID = 8;
  const cells: Disc[][] = Array.from({ length: GRID * GRID }, () => []);
  const cellOf = (x: number): number => Math.min(Math.max(Math.floor(x * GRID), 0), GRID - 1);
  for (const d of discs) {
    for (let cy = cellOf(d.y - d.r * 1.4); cy <= cellOf(d.y + d.r * 1.4); cy++) for (let cx = cellOf(d.x - d.r * 1.4); cx <= cellOf(d.x + d.r * 1.4); cx++) cells[cy * GRID + cx].push(d);
  }
  return (u, v) => {
    for (const h of holes) if (Math.hypot(u - h.x, v - h.y) < h.r) return -1;
    const list = cells[cellOf(v) * GRID + cellOf(u)];
    const warp = 1 + 0.35 * (valueNoise2(u * 40, v * 40, seed) - 0.5);
    for (let i = list.length - 1; i >= 0; i--) {
      const d = list[i];
      const dx = u - d.x, dy = v - d.y;
      if (Math.hypot(dx, dy) * warp < d.r) return Math.min(d.shade * (0.82 + 0.18 * (-dy / d.r)), 1);
    }
    return -1;
  };
}

/** A conifer silhouette: tiered whorls widening downward with ragged drooping tips, and a trunk stub. */
function coniferShape(seed: number): Shape {
  const tiers = 9;
  return (u, v) => {
    if (v < 0.03) return -1;
    const t = (v - 0.03) / 0.87;
    if (t > 1) return v < 0.985 && Math.abs(u - 0.5) < 0.022 ? 0.25 : -1;
    const tier = t * tiers;
    const local = tier - Math.floor(tier);
    const w = 0.4 * Math.pow(t, 0.85) * (0.55 + 0.45 * Math.pow(local, 0.7)) * (0.9 + 0.2 * valueNoise2(u * 14, v * 30, seed));
    const dx = Math.abs(u - 0.5);
    if (dx > w) return -1;
    const rim = dx / Math.max(w, 1e-3);
    if (rim > 0.55 && hash2(Math.floor(u * 46), Math.floor(v * 46), seed) < (rim - 0.55) * 1.5) return -1;
    return Math.min((0.42 + 0.5 * Math.sqrt(rim)) * (0.7 + 0.3 * (1 - local)), 1);
  };
}

function rasterise(shape: Shape, out: Uint8Array, tile: number): void {
  const ox = (tile & 1) * TILE_SIZE, oy = (tile >> 1) * TILE_SIZE;
  let meanSum = 0, meanCount = 0;
  const shades = new Float32Array(TILE_SIZE * TILE_SIZE);
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      let cover = 0, shade = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const s = shape((x + (sx + 0.5) / SS) / TILE_SIZE, (y + (sy + 0.5) / SS) / TILE_SIZE);
          if (s >= 0) { cover++; shade += s; }
        }
      }
      const o = ((oy + y) * ATLAS_SIZE + ox + x) * 4;
      const s = cover > 0 ? shade / cover : -1;
      shades[y * TILE_SIZE + x] = s;
      out[o + 3] = Math.round((cover / (SS * SS)) * 255);
      if (s >= 0) { meanSum += s; meanCount++; }
    }
  }
  const fill = meanCount > 0 ? meanSum / meanCount : 0.7;
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const s = shades[y * TILE_SIZE + x];
      const g = Math.round(Math.min(Math.max(s >= 0 ? s : fill, 0), 1) * 255);
      const o = ((oy + y) * ATLAS_SIZE + ox + x) * 4;
      out[o] = g; out[o + 1] = g; out[o + 2] = g;
    }
  }
}

/** Fraction of a tile's texels at or above the alpha cut. */
function tileCoverage(data: Uint8Array, size: number, tile: number, scale: number): number {
  const side = size / 2, ox = (tile & 1) * side, oy = (tile >> 1) * side;
  let n = 0;
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) if (data[((oy + y) * size + ox + x) * 4 + 3] * scale >= ALPHA_CUT) n++;
  return n / (side * side);
}

/** Box-filtered next mip: rgb weighted by alpha, then alpha rescaled per tile so the alpha-tested coverage matches level 0 (leaves keep their mass at distance). */
function downsample(src: Uint8Array, size: number, target: readonly number[]): Uint8Array {
  const half = size / 2;
  const dst = new Uint8Array(half * half * 4);
  for (let y = 0; y < half; y++) {
    for (let x = 0; x < half; x++) {
      let a = 0, c = 0, plain = 0;
      for (let k = 0; k < 4; k++) {
        const o = ((2 * y + (k >> 1)) * size + 2 * x + (k & 1)) * 4;
        a += src[o + 3];
        c += src[o] * src[o + 3];
        plain += src[o];
      }
      const o = (y * half + x) * 4;
      const g = a > 0 ? c / a : plain / 4;
      dst[o] = dst[o + 1] = dst[o + 2] = Math.round(g);
      dst[o + 3] = Math.round(a / 4);
    }
  }
  for (let tile = 0; tile < 4; tile++) {
    let lo = 1, hi = 8;
    for (let it = 0; it < 14; it++) {
      const mid = 0.5 * (lo + hi);
      if (tileCoverage(dst, half, tile, mid) < target[tile]) lo = mid; else hi = mid;
    }
    const scale = hi;
    const side = half / 2, ox = (tile & 1) * side, oy = (tile >> 1) * side;
    for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
      const o = ((oy + y) * half + ox + x) * 4 + 3;
      dst[o] = Math.min(255, Math.round(dst[o] * scale));
    }
  }
  return dst;
}

/** The procedural 256 x 256 leaf atlas, deterministic, as ATLAS_MIPS RGBA8 mip levels (rgb = shade, a = mask). */
export function buildLeafAtlas(): Uint8Array[] {
  const rng = new Rng(0x1eaf);
  const base = new Uint8Array(ATLAS_SIZE * ATLAS_SIZE * 4);
  rasterise(sprigShape(rng), base, TILE.sprig);
  rasterise(needleShape(rng), base, TILE.needles);
  rasterise(blobShape(rng, 11), base, TILE.blob);
  rasterise(coniferShape(23), base, TILE.conifer);
  const target = [0, 1, 2, 3].map((t) => tileCoverage(base, ATLAS_SIZE, t, 1));
  const levels: Uint8Array[] = [base];
  let size = ATLAS_SIZE;
  for (let l = 1; l < ATLAS_MIPS; l++) {
    levels.push(downsample(levels[l - 1], size, target));
    size /= 2;
  }
  return levels;
}
