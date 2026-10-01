import type { Vec3 } from '../../contracts';
import type { Rng } from '../../world/track/rng';
import { add, cross, mul, norm } from './meshBuilder';
import { pointAt, tangentAt, type Limb } from './treePlan';

const TAU = Math.PI * 2;
const UP: Vec3 = [0, 1, 0];
const GOLDEN = 2.399963;
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** The end of a branch: a foliage cluster goes here. `order` is the branching order of the limb that ends in it. */
export interface Tip { p: Vec3; r: number; order: number }

/** How the branches of one order sprout from their parent. */
export interface Level {
  /** Children per parent branch. */
  count: number;
  /** Children start this far along the parent (0..1) and are spread to `end`. */
  start: number;
  end: number;
  /** Angle between child and parent tangent (rad). */
  angle: [number, number];
  /** Child length as a fraction of the parent's length. */
  length: [number, number];
  segs: number;
  /** Upward (+) or drooping (-) growth bias, in radians of turn over the child's length. */
  bend: number;
  wobble: number;
  /** Child base radius as a fraction of the parent's radius at the fork, and its tip radius (m). */
  radius: number;
  tipRadius: number;
}

/** Integrates a branch centreline: the direction is nudged by `bend` (a turn toward +up spread over the length; a function of progress 0..1 for arching limbs) and random wobble at every step. */
export function growPath(rng: Rng, base: Vec3, dir0: Vec3, length: number, segs: number, bend: number | ((s: number) => number), wobble: number): Vec3[] {
  const pts: Vec3[] = [base];
  let d = norm(dir0), p = base;
  for (let i = 1; i <= segs; i++) {
    const rd = norm([rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)]);
    const b = typeof bend === 'number' ? bend : bend(i / segs);
    d = norm(add(add(d, mul(UP, b / segs)), mul(rd, wobble / segs)));
    p = add(p, mul(d, length / segs));
    pts.push(p);
  }
  return pts;
}

export function taperRadii(r0: number, r1: number, n: number, power = 1): number[] {
  return Array.from({ length: n }, (_, i) => lerp(r0, r1, Math.pow(i / (n - 1), power)));
}

export function limbLength(l: Limb): number {
  let s = 0;
  for (let i = 1; i < l.pts.length; i++) s += Math.hypot(l.pts[i][0] - l.pts[i - 1][0], l.pts[i][1] - l.pts[i - 1][1], l.pts[i][2] - l.pts[i - 1][2]);
  return s;
}

function radiusAt(l: Limb, s: number): number {
  const f = Math.min(Math.max(s, 0), 1) * (l.radii.length - 1), i = Math.min(Math.floor(f), l.radii.length - 2);
  return lerp(l.radii[i], l.radii[i + 1], f - i);
}

export interface SproutOptions {
  /** levels[i] describes the children of a limb of order `order0 + i`. */
  levels: readonly Level[];
  order0: number;
  /** Cluster radius (m) by limb order; the end of every limb of order >= `tipFrom` becomes a foliage tip. */
  tipRadius: Readonly<Record<number, number>>;
  tipFrom: number;
  limbs: Limb[];
  tips: Tip[];
}

/**
 * Grows the branches below `parent` recursively, level by level, with children spiralling around the parent at the golden angle.
 * Every limb is appended to `o.limbs`; the end of every limb of order >= `o.tipFrom` is appended to `o.tips`.
 */
export function sprout(rng: Rng, parent: Limb, o: SproutOptions): void {
  const lv = o.levels[parent.order - o.order0];
  if (parent.order >= o.tipFrom) o.tips.push({ p: parent.pts[parent.pts.length - 1], r: o.tipRadius[parent.order] ?? 0.5, order: parent.order });
  if (!lv) return;
  const len = limbLength(parent);
  const az0 = rng.range(0, TAU);
  for (let k = 0; k < lv.count; k++) {
    const s = lerp(lv.start, lv.end, (k + rng.range(0.15, 0.85)) / lv.count);
    const base = pointAt(parent.pts, s), tg = tangentAt(parent.pts, s);
    const ref: Vec3 = Math.abs(tg[1]) < 0.9 ? UP : [1, 0, 0];
    const p1 = norm(cross(tg, ref)), p2 = cross(tg, p1);
    const az = az0 + k * GOLDEN + rng.range(-0.35, 0.35), el = rng.range(lv.angle[0], lv.angle[1]);
    const perp = add(mul(p1, Math.cos(az)), mul(p2, Math.sin(az)));
    const dir = norm(add(mul(tg, Math.cos(el)), mul(perp, Math.sin(el))));
    const length = Math.max(0.25, len * rng.range(lv.length[0], lv.length[1]) * (1 - 0.35 * s));
    const pts = growPath(rng, base, dir, length, lv.segs, lv.bend, lv.wobble);
    const limb: Limb = { pts, radii: taperRadii(Math.max(radiusAt(parent, s) * lv.radius, lv.tipRadius), lv.tipRadius, pts.length, 0.85), order: parent.order + 1 };
    o.limbs.push(limb);
    sprout(rng, limb, o);
  }
}
