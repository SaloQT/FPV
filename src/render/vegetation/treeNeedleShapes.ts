import type { Rng } from '../../world/track/rng';
import { hash2, valueNoise2 } from './noise';
import { Grid, sat, type Painter, type Sample } from './treeLeafShapes';

const TAU = Math.PI * 2;

/** One needle (or scale-leaf run): a capsule from (ax, ay) to (bx, by) in tile coordinates. */
interface Needle { ax: number; ay: number; bx: number; by: number; r: number; shade: number; hue: number; open: number; tu: number; tv: number }

function needleDist(n: Needle, u: number, v: number): number {
  const dx = n.bx - n.ax, dy = n.by - n.ay;
  const t = sat(((u - n.ax) * dx + (v - n.ay) * dy) / (dx * dx + dy * dy + 1e-12));
  return Math.hypot(u - (n.ax + dx * t), v - (n.ay + dy * t));
}

/** Painter over capsules, later ones on top, with a grid so each sample tests a handful. */
function needlePainter(needles: readonly Needle[], extra: Painter | null): Painter {
  const grid = new Grid<Needle>(16);
  for (const n of needles) {
    grid.add(n, Math.min(n.ax, n.bx) - n.r, Math.min(n.ay, n.by) - n.r, Math.max(n.ax, n.bx) + n.r, Math.max(n.ay, n.by) + n.r);
  }
  return (u, v, o) => {
    const list = grid.at(u, v);
    for (let i = list.length - 1; i >= 0; i--) {
      const n = list[i];
      if (needleDist(n, u, v) >= n.r) continue;
      o.shade = n.shade; o.hue = n.hue; o.thin = 0.55; o.tu = n.tu; o.tv = n.tv; o.open = n.open;
      return true;
    }
    return extra ? extra(u, v, o) : false;
  };
}

const WOOD_SHADE = 0.32;
const NEEDLE_R = 0.0024;

/** Bottle-brush shoot from (sx, sy) along `ang` (clockwise from up): a thin stem with forward-swept needles all round, paler at the new-growth tip. */
function shoot(rng: Rng, out: Needle[], sx: number, sy: number, ang: number, reach: number, needle: number, open: number): [number, number] {
  const dx = Math.sin(ang), dy = -Math.cos(ang) * 0.9;
  const ex = sx + dx * reach, ey = sy + dy * reach;
  out.push({ ax: sx, ay: sy, bx: ex, by: ey, r: 0.004, shade: WOOD_SHADE, hue: 0, open, tu: 0, tv: 0 });
  const count = Math.max(8, Math.round(reach / 0.0042));
  for (let k = 0; k < count; k++) {
    const f = 0.06 + 0.94 * (k / (count - 1));
    const px = sx + dx * reach * f, py = sy + dy * reach * f;
    const len = needle * (0.65 + 0.35 * Math.sin(Math.PI * Math.min(f * 0.9 + 0.1, 1))) * rng.range(0.8, 1.2);
    const fresh = sat((f - 0.72) / 0.28);
    for (const flank of [-1, 1]) {
      const a = ang + flank * rng.range(0.45, 1.05);
      out.push({
        ax: px, ay: py, bx: px + Math.sin(a) * len, by: py - Math.cos(a) * len * 0.9, r: NEEDLE_R,
        shade: (0.5 + 0.45 * rng.next()) * (0.85 + 0.25 * fresh), hue: fresh > 0.4 ? 0.3 + 0.12 * rng.next() : 0.05 * rng.next(),
        open: open * (0.75 + 0.25 * f), tu: flank * 0.4 + rng.range(-0.15, 0.15), tv: rng.range(-0.3, 0.3),
      });
    }
  }
  return [ex, ey];
}

/**
 * A spruce or fir spray: a curved leader with alternating side shoots that shorten toward the tip and carry short secondary shoots, every
 * one a fine bottle-brush of forward-swept needles. Older needles near the base are darker; the new growth at the tips is a paler yellow-green.
 */
export function sprayPainter(rng: Rng): Painter {
  const needles: Needle[] = [];
  const leader = (t: number): [number, number] => [0.5 + 0.03 * Math.sin(t * 2.6), 0.97 - 0.85 * t];
  for (let i = 0; i < 14; i++) {
    const [ax, ay] = leader(i / 14), [bx, by] = leader((i + 1) / 14);
    needles.push({ ax, ay, bx, by, r: 0.005, shade: WOOD_SHADE, hue: 0, open: 0.8, tu: 0, tv: 0 });
  }
  const shoots = 15;
  for (let s = 0; s < shoots; s++) {
    const t = 0.04 + 0.9 * (s / (shoots - 1));
    const [sx, sy] = leader(t);
    for (const side of [-1, 1]) {
      const reach = 0.4 * (1 - 0.6 * t) * rng.range(0.85, 1.1);
      const ang = side * (1.1 - 0.35 * t + rng.range(-0.08, 0.08));
      const [ex, ey] = shoot(rng, needles, sx, sy, ang, reach, 0.026, 0.8);
      const subs = Math.round(reach * 12);
      for (let k = 0; k < subs; k++) {
        const f = 0.2 + 0.7 * (k / Math.max(subs - 1, 1));
        const side2 = k % 2 === 0 ? 1 : -1;
        shoot(rng, needles, sx + (ex - sx) * f, sy + (ey - sy) * f, ang + side2 * rng.range(0.7, 1.1), reach * 0.3 * (1 - 0.5 * f), 0.02, 0.6);
      }
    }
  }
  const [tx, ty] = leader(1);
  shoot(rng, needles, tx, ty + 0.02, 0, 0.07, 0.022, 1);
  return needlePainter(needles, null);
}

/** A conifer silhouette for the far billboards: tiers of drooping branch skirts, clumpy needle edge, darker toward the trunk. */
export function conifer(seed: number): Painter {
  const tiers = 9;
  return (u, v, o) => {
    if (v < 0.03) return false;
    const t = (v - 0.03) / 0.87;
    if (t > 1) {
      if (v < 0.985 && Math.abs(u - 0.5) < 0.022) { o.shade = 0.28; o.hue = 0; o.thin = 0; o.tu = 0; o.tv = 0; o.open = 0.4; return true; }
      return false;
    }
    const tier = t * tiers, local = tier - Math.floor(tier);
    const w = 0.4 * Math.pow(t, 0.85) * (0.55 + 0.45 * Math.pow(local, 0.7)) * (0.9 + 0.2 * valueNoise2(u * 14, v * 30, seed));
    const dx = u - 0.5, rim = Math.abs(dx) / Math.max(w, 1e-3);
    if (rim > 1) return false;
    if (rim > 0.55 && hash2(Math.floor(u * 110), Math.floor(v * 110), seed) < (rim - 0.55) * 1.5) return false;
    const clump = valueNoise2(u * 60, v * 60, seed + 5);
    o.shade = Math.min((0.45 + 0.5 * Math.sqrt(rim)) * (0.7 + 0.3 * (1 - local)) * (0.8 + 0.4 * clump), 1);
    o.hue = 0.05 * clump; o.thin = 0.5;
    o.tu = Math.sign(dx) * 0.5 * rim; o.tv = 0.25 - 0.5 * local;
    o.open = 0.35 + 0.65 * sat(rim * 1.1) * (0.6 + 0.4 * local);
    return true;
  };
}
