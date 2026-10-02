import { Rng } from '../../world/track/rng';
import { hash2 } from './noise';
import { Grid, sat, type Painter, type Sample } from './treeLeafShapes';

const TAU = Math.PI * 2;

/** One needle (or scale-leaf run): a capsule from (ax, ay) to (bx, by) in tile coordinates. */
interface Needle { ax: number; ay: number; bx: number; by: number; r: number; shade: number; hue: number; open: number; tu: number; tv: number }

function needleDist(n: Needle, u: number, v: number): number {
  const dx = n.bx - n.ax, dy = n.by - n.ay;
  const t = sat(((u - n.ax) * dx + (v - n.ay) * dy) / (dx * dx + dy * dy + 1e-12));
  return Math.hypot(u - (n.ax + dx * t), v - (n.ay + dy * t));
}

/** Texels per tile side of the splat raster: the leaf atlas tile size, so each texel centre the atlas samples reads exactly one needle. */
export const NEEDLE_RES = 512;

/** Painter over capsules, later ones on top: each capsule is splatted once into an id raster, so a spray of 100000 needles costs about as much as one of 1000. */
function needlePainter(needles: readonly Needle[], extra: Painter | null): Painter {
  const ids = new Int32Array(NEEDLE_RES * NEEDLE_RES).fill(-1);
  needles.forEach((n, id) => {
    const x0 = Math.max(Math.floor((Math.min(n.ax, n.bx) - n.r) * NEEDLE_RES), 0), x1 = Math.min(Math.ceil((Math.max(n.ax, n.bx) + n.r) * NEEDLE_RES), NEEDLE_RES - 1);
    const y0 = Math.max(Math.floor((Math.min(n.ay, n.by) - n.r) * NEEDLE_RES), 0), y1 = Math.min(Math.ceil((Math.max(n.ay, n.by) + n.r) * NEEDLE_RES), NEEDLE_RES - 1);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (needleDist(n, (x + 0.5) / NEEDLE_RES, (y + 0.5) / NEEDLE_RES) < n.r) ids[y * NEEDLE_RES + x] = id;
  });
  return (u, v, o) => {
    const id = ids[Math.min(Math.max(Math.floor(v * NEEDLE_RES), 0), NEEDLE_RES - 1) * NEEDLE_RES + Math.min(Math.max(Math.floor(u * NEEDLE_RES), 0), NEEDLE_RES - 1)];
    if (id < 0) return extra ? extra(u, v, o) : false;
    const n = needles[id];
    o.shade = n.shade; o.hue = n.hue; o.thin = 0.55; o.tu = n.tu; o.tv = n.tv; o.open = n.open;
    return true;
  };
}

const WOOD_SHADE = 0.32;
/** Needle radius in tile units: about 1.3 texels across at 512 texels per tile, so a needle on a 1.5 m spray is about 4 mm wide where a real one is 1.5. */
export const NEEDLE_R = 0.0013;
/** Spacing of needles along a shoot: a real spruce shoot carries one every 1.5-2 mm all round, about 1 mm per side on a 1.5 m card. */
const NEEDLE_STEP = 0.0013;
/** Distance between secondary branchlets along a side shoot: about 3 cm on a 1.5 m spray. */
const SUB_STEP = 0.02;

/**
 * Bottle-brush shoot from (sx, sy) along `ang` (clockwise from up), drooping by `sag` and turning its tip up again: a thin stem with
 * forward-swept needles on both flanks and along the top, paler at the new-growth tip. Returns the tip position.
 */
function shoot(rng: Rng, out: Needle[], sx: number, sy: number, ang: number, reach: number, needle: number, open: number, sag: number): [number, number] {
  const side = ang < 0 ? -1 : 1;
  const steps = Math.max(8, Math.round(reach / NEEDLE_STEP));
  let x = sx, y = sy;
  let prevX = x, prevY = y;
  for (let k = 1; k <= steps; k++) {
    const f = k / steps;
    const a = ang + side * sag * (f - 1.6 * f * f);
    x += Math.sin(a) * reach / steps;
    y -= Math.cos(a) * 0.9 * reach / steps;
    if (k % 6 === 0 || k === steps) {
      out.push({ ax: prevX, ay: prevY, bx: x, by: y, r: 0.0011, shade: 0.42, hue: 0, open, tu: 0, tv: 0 });
      prevX = x; prevY = y;
    }
    if (f < 0.04) continue;
    const len = needle * (0.65 + 0.35 * Math.sin(Math.PI * Math.min(f * 0.9 + 0.1, 1))) * rng.range(0.8, 1.2);
    const fresh = sat((f - 0.72) / 0.28);
    const count = rng.next() < 0.5 ? 4 : 3;
    for (let j = 0; j < count; j++) {
      const flank = j % 2 === 0 ? -1 : 1;
      const spread = j >= 2 ? rng.range(-0.45, 0.45) : flank * rng.range(0.4, 1.2);
      const na = a + spread;
      out.push({
        ax: x, ay: y, bx: x + Math.sin(na) * len, by: y - Math.cos(na) * len * 0.9, r: NEEDLE_R,
        shade: (0.5 + 0.45 * rng.next()) * (0.85 + 0.25 * fresh), hue: fresh > 0.4 && rng.next() < 0.5 ? 0.3 + 0.12 * rng.next() : 0.05 * rng.next(),
        open: open * (0.75 + 0.25 * f), tu: flank * 0.4 + rng.range(-0.15, 0.15), tv: rng.range(-0.3, 0.3),
      });
    }
  }
  return [x, y];
}

/**
 * A spruce or fir spray: a gently curved leader with irregular, drooping side shoots that shorten toward the tip and carry short secondary
 * shoots, every one a fine bottle-brush of forward-swept needles. Older needles near the base are darker; the new growth at the tips is a
 * paler yellow-green.
 */
export function sprayPainter(rng: Rng): Painter {
  const needles: Needle[] = [];
  const leader = (t: number): [number, number] => [0.5 + 0.03 * Math.sin(t * 2.6), 0.97 - 0.85 * t];
  for (let i = 0; i < 14; i++) {
    const [ax, ay] = leader(i / 14), [bx, by] = leader((i + 1) / 14);
    needles.push({ ax, ay, bx, by, r: 0.0026, shade: WOOD_SHADE, hue: 0, open: 0.8, tu: 0, tv: 0 });
  }
  const shoots = 17;
  for (let s = 0; s < shoots; s++) {
    const t = Math.min(0.03 + 0.9 * ((s + rng.range(-0.3, 0.3)) / (shoots - 1)), 0.93);
    const [sx, sy] = leader(t);
    for (const side of [-1, 1]) {
      if (rng.next() < 0.1) continue;
      const reach = 0.4 * (1 - 0.6 * t) * rng.range(0.65, 1.12);
      const ang = side * (1.1 - 0.35 * t + rng.range(-0.18, 0.18));
      const [ex, ey] = shoot(rng, needles, sx, sy, ang, reach, 0.0135, 0.8, rng.range(0.15, 0.5));
      const subs = Math.round(reach / SUB_STEP);
      for (let k = 0; k < subs; k++) {
        if (rng.next() < 0.12) continue;
        const f = 0.12 + 0.82 * ((k + rng.range(-0.3, 0.3)) / Math.max(subs - 1, 1));
        const side2 = k % 2 === 0 ? 1 : -1;
        shoot(rng, needles, sx + (ex - sx) * f, sy + (ey - sy) * f, ang + side2 * rng.range(0.7, 1.1), 0.2 * reach * (1 - 0.65 * f) * rng.range(0.7, 1.25), 0.0105, 0.6, rng.range(0.1, 0.4));
      }
    }
  }
  const [tx, ty] = leader(1);
  shoot(rng, needles, tx, ty + 0.02, 0, 0.07, 0.011, 1, 0);
  return needlePainter(needles, null);
}

/** A drooping branch seen from the side: a tapered capsule from the trunk (ax, ay) to the tip (bx, by), radius r0 at the trunk and r1 at the tip. */
interface Skirt { ax: number; ay: number; bx: number; by: number; r0: number; r1: number; shade: number; hue: number }

/** Position along the skirt (0 at the trunk, 1 at the tip) when (u, v) is inside it, else -1. */
function skirtHit(k: Skirt, u: number, v: number): number {
  const dx = k.bx - k.ax, dy = k.by - k.ay;
  const t = sat(((u - k.ax) * dx + (v - k.ay) * dy) / (dx * dx + dy * dy + 1e-12));
  const r = k.r0 + (k.r1 - k.r0) * t;
  const d = Math.hypot(u - (k.ax + dx * t), v - (k.ay + dy * t)) / r;
  return d < 1 ? t : -1;
}

/**
 * A far spruce silhouette seen from the side: whorls of drooping branches (the ones pointing at the viewer fold into a dense core, the ones
 * pointing sideways make the ragged outline), thick at the trunk and thinning to needle-clump tips, dark deep inside and paler at the tips.
 */
export function conifer(seed: number): Painter {
  const rng = new Rng(seed);
  const skirts: Skirt[] = [];
  const whorls = 24;
  for (let k = 0; k < whorls; k++) {
    const t = (k + rng.range(0.15, 0.85)) / whorls, y = 0.045 + 0.865 * Math.pow(t, 0.95);
    const reach = 0.05 + 0.43 * Math.pow(t, 0.85);
    const count = 13;
    for (let b = 0; b < count; b++) {
      const az = (b / count) * TAU + k * 1.9 + rng.range(-0.25, 0.25);
      const side = Math.sin(az), len = reach * Math.abs(side) * rng.range(0.6, 1.08);
      const droop = (0.016 + 0.085 * t) * (0.35 + Math.abs(side)) * rng.range(0.7, 1.3);
      skirts.push({
        ax: 0.5, ay: y, bx: 0.5 + Math.sign(side) * len, by: y + droop, r0: 0.02 + 0.026 * t, r1: 0.011 + 0.012 * t,
        shade: 0.55 + 0.4 * rng.next(), hue: rng.next() < 0.3 ? 0.3 + 0.1 * rng.next() : 0.06 * rng.next(),
      });
    }
  }
  skirts.push({ ax: 0.5, ay: 0.18, bx: 0.5, by: 0.025, r0: 0.014, r1: 0.003, shade: 0.8, hue: 0.32 });
  const grid = new Grid<Skirt>(20);
  for (const k of skirts) {
    const m = k.r0 + 0.004;
    grid.add(k, Math.min(k.ax, k.bx) - m, Math.min(k.ay, k.by) - m, Math.max(k.ax, k.bx) + m, Math.max(k.ay, k.by) + m);
  }
  return (u, v, o) => {
    if (v > 0.93) {
      if (v < 0.985 && Math.abs(u - 0.5) < 0.02) { o.shade = 0.28; o.hue = 0; o.thin = 0; o.tu = 0; o.tv = 0; o.open = 0.4; return true; }
      return false;
    }
    const list = grid.at(u, v);
    for (let i = list.length - 1; i >= 0; i--) {
      const k = list[i], t = skirtHit(k, u, v);
      if (t < 0) continue;
      const along = sat(t), fray = hash2(Math.floor(u * 230), Math.floor(v * 230), seed);
      if (along > 0.55 && fray < (along - 0.55) * 1.1) continue;
      const lat = Math.sign(k.bx - k.ax), up = Math.sign(v - (k.ay + (k.by - k.ay) * along));
      o.shade = Math.min(k.shade * (0.62 + 0.5 * along) * (0.85 + 0.3 * fray), 1);
      o.hue = along > 0.8 ? Math.max(k.hue, 0.28) : k.hue;
      o.thin = 0.5;
      o.tu = lat * 0.45 * along;
      o.tv = 0.2 * up;
      o.open = 0.22 + 0.78 * along;
      return true;
    }
    return false;
  };
}
