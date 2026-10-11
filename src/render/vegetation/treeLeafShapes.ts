import type { Rng } from '../../world/track/rng';
import { valueNoise2 } from './noise';

const TAU = Math.PI * 2;
export const sat = (x: number): number => Math.min(Math.max(x, 0), 1);

/** One painted point of a leaf tile. */
export interface Sample {
  /** Albedo multiplier, 0..1. */
  shade: number;
  /** Colour shift: 0 deep green, about 0.4 yellow-green, 1 dead yellow-brown. */
  hue: number;
  /** 1 for thin lamina that lets light through, 0 for veins and stems. */
  thin: number;
  /** Surface tilt along the tile's u (right) and v (down) axes, -1..1. */
  tu: number;
  tv: number;
  /** Cavity openness: 1 exposed, small deep inside the canopy. */
  open: number;
}

/** Fills `out` and returns true where the tile is opaque at (u, v), both 0..1 with v down. */
export type Painter = (u: number, v: number, out: Sample) => boolean;

export const newSample = (): Sample => ({ shade: 0, hue: 0, thin: 1, tu: 0, tv: 0, open: 1 });

/** Uniform grid of bounded items so a painter only tests the few that overlap a sample; insertion order is paint order. */
export class Grid<T> {
  private readonly cells: T[][];
  constructor(private readonly n: number) {
    this.cells = Array.from({ length: n * n }, () => []);
  }

  private cell(x: number): number {
    return Math.min(Math.max(Math.floor(x * this.n), 0), this.n - 1);
  }

  add(item: T, x0: number, y0: number, x1: number, y1: number): void {
    for (let cy = this.cell(y0); cy <= this.cell(y1); cy++) for (let cx = this.cell(x0); cx <= this.cell(x1); cx++) this.cells[cy * this.n + cx].push(item);
  }

  at(u: number, v: number): readonly T[] {
    return this.cells[this.cell(v) * this.n + this.cell(u)];
  }
}

/** A pointed leaf: base point, unit axis (tile coordinates), length and half width, with veins, midrib and a lobed or toothed margin. */
export interface Leaf {
  bx: number; by: number; dx: number; dy: number; len: number; w: number;
  shade: number; hue: number; open: number;
  lobes: number; lobeAmp: number; lobePhase: number;
  /** Per-leaf tilt along the axis and across it, so neighbouring leaves catch the light differently. */
  bias: number; roll: number;
  /** Slope of each half of the blade up from the midrib (the V of the fold, rising toward the edges) and how far the tip droops. */
  fold: number; curl: number;
  petiole: number;
  /** Outline exponent: the widest point sits where s^widest = 0.5, so below 1 is ovate (birch, widest near the base) and above 1 obovate (oak). */
  widest: number;
  /** Forward-pointing marginal teeth over the blade length and their depth as a fraction of the half width (0 for an entire margin). */
  teeth: number; toothAmp: number;
  /** Fungal or insect spots: [s along the blade, offset across as a fraction of the half width, radius as a fraction of the length] each. */
  spots: [number, number, number][];
  /** Dry, browned margin as a fraction of the half width (0 for none), and a chewed hole [s, across, radius] (radius 0 for none). */
  burn: number;
  hole: [number, number, number];
  /** Seed of the leaf's own mottling. */
  seed: number;
}

export function leafShade(rng: Rng): number {
  return 0.62 + 0.38 * rng.next();
}

/** Mostly deep green, some sun-bleached yellow-green, a few dead yellow-brown leaves. */
export function leafHue(rng: Rng): number {
  const r = rng.next();
  return r < 0.015 ? 0.85 + 0.15 * rng.next() : r < 0.1 ? 0.28 + 0.22 * rng.next() : 0.12 * rng.next();
}

export function makeLeaf(rng: Rng, bx: number, by: number, angle: number, len: number, w: number, lobes: number, lobeAmp: number, open = 1): Leaf {
  const hue = leafHue(rng);
  // About one summer leaf in seven carries a few spots (leaf spot, mildew, mines), one in sixteen a browned edge or a chewed hole.
  const spots: [number, number, number][] = [];
  if (rng.next() < 0.14) for (let k = rng.int(1, 3); k > 0; k--) spots.push([rng.range(0.2, 0.85), rng.range(-0.7, 0.7), rng.range(0.02, 0.05)]);
  const burn = rng.next() < 0.06 ? rng.range(0.08, 0.22) : 0;
  const hole: [number, number, number] = rng.next() < 0.06 ? [rng.range(0.35, 0.8), rng.range(-0.5, 0.5), rng.range(0.05, 0.11)] : [0, 0, 0];
  return {
    bx, by, dx: Math.sin(angle), dy: -Math.cos(angle), len, w, shade: leafShade(rng) * (hue > 0.8 ? 0.78 : 1), hue, open,
    lobes, lobeAmp, lobePhase: rng.range(0, TAU), bias: rng.range(-0.5, 0.5), roll: rng.range(-0.4, 0.4), petiole: 0.06,
    widest: 0.72, teeth: 0, toothAmp: 0, spots, burn, hole, seed: (rng.next() * 0x7fffffff) | 0, fold: rng.range(0.3, 0.75), curl: rng.range(0.3, 0.9),
  };
}

/** Petioles and twigs are pale yellow-green and grey-brown, never black. */
const PETIOLE_SHADE = 0.7;
const PETIOLE_HUE = 0.42;
const TWIG_SHADE = 0.5;
const TWIG_HUE = 0.92;

/** The blade only: true and the sample filled where (u, v) is on the lamina of `l`. */
export function paintBlade(l: Leaf, u: number, v: number, o: Sample): boolean {
  const px = u - l.bx, py = v - l.by;
  const s = (px * l.dx + py * l.dy) / l.len;
  if (s <= 0 || s >= 1) return false;
  const lat = -px * l.dy + py * l.dx;
  const a = Math.abs(lat);
  // Deep amplitudes give rounded lobes with narrow sinuses (oak); shallow ones a smooth serrated edge.
  let edge = l.lobeAmp > 0.2
    ? 1 - l.lobeAmp * (1 - Math.pow(Math.abs(Math.sin(s * l.lobes * Math.PI + l.lobePhase)), 0.5))
    : 1 + l.lobeAmp * Math.sin(s * l.lobes * TAU + l.lobePhase);
  if (l.teeth > 0) {
    // Doubly serrate: big forward-pointing teeth, each cut again by three small ones.
    const f = s * l.teeth + (lat >= 0 ? 0 : 0.5), g = f * 3;
    edge *= 1 - l.toothAmp * (f - Math.floor(f)) - 0.35 * l.toothAmp * (g - Math.floor(g));
  }
  const hw = l.w * Math.sin(Math.PI * Math.pow(s, l.widest)) * edge;
  if (a >= hw) return false;
  if (l.hole[2] > 0 && Math.hypot((s - l.hole[0]) * l.len, lat - l.hole[1] * l.w) < l.hole[2] * l.len) return false;
  const r = a / hw;
  const f = s * 7 - r * 1.5;
  const vein = sat(1 - Math.abs(f - Math.floor(f) - 0.5) / 0.09);
  const rib = sat(1 - a / (0.004 + 0.012 * l.w * (1 - s) * 10));
  // Mottling of the lamina at about a tenth of the leaf, so even a single leaf is not one flat colour.
  const mottle = valueNoise2((s * l.len) * 120, lat * 120, l.seed);
  let shade = l.shade * (0.84 + 0.16 * vein + 0.22 * rib) * (1 - 0.14 * r) * (0.9 + 0.2 * mottle);
  let hue = Math.min(l.hue + 0.12 * vein + 0.25 * rib + 0.1 * Math.pow(r, 6), 1);
  let thin = 1 - 0.7 * Math.max(0.6 * vein, rib);
  for (const [ss, sr, rad] of l.spots) {
    const d = Math.hypot((s - ss) * l.len, lat - sr * l.w * 0.6) / (rad * l.len);
    if (d < 1) { hue = Math.max(hue, 0.82 + 0.18 * (1 - d)); shade *= 0.62 + 0.3 * d; thin *= 0.6; }
    else if (d < 1.7) hue = Math.max(hue, Math.min(hue + 0.4 * (1.7 - d), 0.6));
  }
  if (l.burn > 0 && r > 1 - l.burn * (0.6 + 0.8 * mottle)) { hue = 0.93 + 0.07 * mottle; shade *= 0.72; thin *= 0.5; }
  o.shade = shade;
  o.hue = hue;
  o.thin = thin;
  // Across: the V fold rising from the midrib, steepest at the cupped edges, plus the leaf's own roll on its petiole. Along: its own pitch, and
  // the tip drooping more and more toward the end. Each leaf points its own way, so neighbours catch the light differently.
  const across = (lat >= 0 ? 1 : -1) * (l.fold * Math.pow(r, 0.8) + 0.25 * Math.pow(r, 4)) + l.roll, along = l.bias - l.curl * (s * s - 0.33);
  o.tu = across * -l.dy + along * l.dx;
  o.tv = across * l.dx + along * l.dy;
  o.open = l.open;
  return true;
}

/** The petiole only: a thin pale stalk behind the blade's base. */
export function paintPetiole(l: Leaf, u: number, v: number, o: Sample): boolean {
  const px = u - l.bx, py = v - l.by;
  const along = px * l.dx + py * l.dy;
  if (along > 0.02 * l.len || along < -l.petiole) return false;
  if (Math.abs(-px * l.dy + py * l.dx) >= 0.0045) return false;
  o.shade = PETIOLE_SHADE; o.hue = PETIOLE_HUE; o.thin = 0.3; o.tu = 0; o.tv = 0; o.open = l.open;
  return true;
}

export function paintLeaf(l: Leaf, u: number, v: number, o: Sample): boolean {
  return paintBlade(l, u, v, o) || paintPetiole(l, u, v, o);
}

function leafBox(l: Leaf): [number, number, number, number] {
  const tx = l.bx + l.dx * l.len, ty = l.by + l.dy * l.len, e = l.w * (1 + l.lobeAmp) + 0.006;
  const px = -l.dy * e, py = l.dx * e;
  return [Math.min(l.bx, tx) - Math.abs(px), Math.min(l.by, ty) - Math.abs(py), Math.max(l.bx, tx) + Math.abs(px), Math.max(l.by, ty) + Math.abs(py)];
}

/** A woody twig segment from (ax, ay) to (bx, by), radius r0 at a and r1 at b. */
export interface Twig { ax: number; ay: number; bx: number; by: number; r0: number; r1: number }

/** Where a shoot tile's leaves and twigs are (tile coordinates), so the tree can build the same shoot as real geometry. */
export interface ShootLayout { leaves: readonly Leaf[]; twigs: readonly Twig[] }
/** A painter that also reports the layout it paints. */
export type LaidOutPainter = Painter & { layout?: ShootLayout };

function twigHit(t: Twig, u: number, v: number): boolean {
  const dx = t.bx - t.ax, dy = t.by - t.ay;
  const k = sat(((u - t.ax) * dx + (v - t.ay) * dy) / (dx * dx + dy * dy + 1e-12));
  return Math.hypot(u - (t.ax + dx * k), v - (t.ay + dy * k)) < t.r0 + (t.r1 - t.r0) * k;
}

/** Offsets (tile units) toward the light at which an overlying leaf casts its contact shadow, and how dark the full shadow is. */
const SHADOW_TAPS: readonly (readonly [number, number])[] = [[-0.006, -0.01], [-0.012, -0.02], [-0.02, -0.032]];
const SHADOW_DEPTH = 0.5;

/** Painter over leaves (later ones on top) and the twigs that carry them: every blade first, then petioles and twigs behind them. */
function leafPainter(leaves: readonly Leaf[], twigs: readonly Twig[], extra: Painter | null = null): LaidOutPainter {
  const grid = new Grid<Leaf>(12), wood = new Grid<Twig>(12);
  for (const l of leaves) {
    const [x0, y0, x1, y1] = leafBox(l);
    grid.add(l, x0 - l.petiole, y0 - l.petiole, x1 + l.petiole, y1 + l.petiole);
  }
  for (const t of twigs) {
    const m = Math.max(t.r0, t.r1);
    wood.add(t, Math.min(t.ax, t.bx) - m, Math.min(t.ay, t.by) - m, Math.max(t.ax, t.bx) + m, Math.max(t.ay, t.by) + m);
  }
  const order = new Map(leaves.map((l, i) => [l, i]));
  const probe = newSample();
  /** Number of the SHADOW_TAPS offsets toward the light at which a leaf painted later (on top) covers this point of leaf `l`. */
  const shadowed = (l: Leaf, u: number, v: number): number => {
    const k = order.get(l) as number;
    let n = 0;
    for (const [dx, dy] of SHADOW_TAPS) {
      const list = grid.at(u + dx, v + dy);
      for (let i = list.length - 1; i >= 0 && order.get(list[i]) as number > k; i--) if (paintBlade(list[i], u + dx, v + dy, probe)) { n++; break; }
    }
    return n;
  };
  const painter: LaidOutPainter = (u, v, o) => {
    const list = grid.at(u, v);
    for (let i = list.length - 1; i >= 0; i--) {
      if (!paintBlade(list[i], u, v, o)) continue;
      // Leaves lying on top of this one shade it: a soft contact shadow just inside their edge, so overlapping leaves read as separate layers.
      const s = shadowed(list[i], u, v);
      // It is lighting, not colour, so it goes into the openness (ambient occlusion) the shader darkens by, not the painted albedo.
      if (s > 0) o.open *= 1 - 1.4 * SHADOW_DEPTH * s / SHADOW_TAPS.length;
      return true;
    }
    for (let i = list.length - 1; i >= 0; i--) if (paintPetiole(list[i], u, v, o)) return true;
    for (const t of wood.at(u, v)) {
      if (!twigHit(t, u, v)) continue;
      o.shade = TWIG_SHADE; o.hue = TWIG_HUE; o.thin = 0; o.tu = 0; o.tv = 0; o.open = 0.7;
      return true;
    }
    return extra ? extra(u, v, o) : false;
  };
  painter.layout = { leaves, twigs };
  return painter;
}

/** Shrinks a leaf so its blade (with lobes) stays inside the tile and above the stem-only strip at the bottom of an anchored card. */
function fit(l: Leaf, margin = 0.02, bottom = 0.9): Leaf {
  for (let it = 0; it < 12; it++) {
    const [x0, y0, x1, y1] = leafBox(l);
    if (x0 >= margin && y0 >= margin && x1 <= 1 - margin && y1 <= bottom) break;
    l.len *= 0.88; l.w *= 0.88;
  }
  return l;
}

/** Point and unit direction of a twig at fraction t of a bent path. */
interface Path { pts: [number, number][] }

function bentPath(x: number, y: number, ang: number, len: number, curl: number, steps: number): Path {
  const pts: [number, number][] = [[x, y]];
  for (let i = 1; i <= steps; i++) {
    const a = ang + curl * (i / steps);
    x += Math.sin(a) * len / steps; y -= Math.cos(a) * len / steps;
    pts.push([x, y]);
  }
  return { pts };
}

function pathAt(p: Path, t: number): [number, number, number] {
  const f = sat(t) * (p.pts.length - 1), i = Math.min(Math.floor(f), p.pts.length - 2), k = f - i;
  const a = p.pts[i], b = p.pts[i + 1];
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, Math.atan2(b[0] - a[0], -(b[1] - a[1]))];
}

function pathTwigs(p: Path, r0: number, r1: number, out: Twig[]): void {
  const n = p.pts.length - 1;
  for (let i = 0; i < n; i++) out.push({ ax: p.pts[i][0], ay: p.pts[i][1], bx: p.pts[i + 1][0], by: p.pts[i + 1][1], r0: r0 + (r1 - r0) * (i / n), r1: r0 + (r1 - r0) * ((i + 1) / n) });
}

/**
 * Oak shoot: a short zigzag twig that forks into four or five shoots, each ending in a crowded rosette of six to eight obovate, deeply lobed
 * leaves (oak leaves bunch at the shoot tips, they do not line a stem like a fern), plus a few single leaves lower down. The leaves at the
 * back of a rosette are drawn first and read as more enclosed. Young leaves near the tips are paler.
 */
export function sprigPainter(rng: Rng): Painter {
  const leaves: Leaf[] = [], twigs: Twig[] = [];
  const oak = (x: number, y: number, ang: number, len: number, open: number): void => {
    const l = makeLeaf(rng, x, y, ang, len, len * rng.range(0.27, 0.33), rng.range(3.6, 5), rng.range(0.42, 0.58), open);
    l.widest = rng.range(1.25, 1.6); l.petiole = 0.012; l.bias = rng.range(-0.35, 0.35); l.roll = rng.range(-0.3, 0.3);
    leaves.push(fit(l));
  };
  const fork: [number, number] = [0.5 + rng.range(-0.03, 0.03), rng.range(0.74, 0.8)];
  const stem = bentPath(0.5, 0.965, rng.range(-0.08, 0.08), 0.965 - fork[1], rng.range(-0.15, 0.15), 4);
  pathTwigs(stem, 0.008, 0.0055, twigs);
  const n = rng.int(4, 5);
  const base = pathAt(stem, 1);
  // Lower single leaves on the main twig, behind everything else.
  for (let k = 0; k < 3; k++) {
    const [x, y, a] = pathAt(stem, rng.range(0.25, 0.6));
    oak(x, y, a + (k === 0 ? -1 : 1) * rng.range(0.9, 1.4), rng.range(0.16, 0.21), 0.6);
  }
  const shoots: Path[] = [];
  for (let i = 0; i < n; i++) {
    const spread = n === 1 ? 0 : -0.75 + 1.5 * (i / (n - 1));
    const p = bentPath(base[0], base[1], spread + rng.range(-0.15, 0.15), rng.range(0.26, 0.38) * (1 - 0.2 * Math.abs(spread)), rng.range(-0.3, 0.3), 3);
    pathTwigs(p, 0.005, 0.0035, twigs);
    shoots.push(p);
  }
  for (const p of shoots) {
    const [x, y, a] = pathAt(p, 0.5);
    oak(x, y, a + (rng.next() < 0.5 ? -1 : 1) * rng.range(0.9, 1.3), rng.range(0.13, 0.18), 0.7);
  }
  for (const p of shoots) {
    const [tx, ty, ta] = pathAt(p, 1);
    const m = rng.int(6, 8);
    // Side leaves of the rosette first (shorter, more enclosed), the leading ones last and on top.
    const order = Array.from({ length: m }, (_, k) => -1.45 + 2.9 * (k + rng.range(-0.25, 0.25)) / (m - 1)).sort((x, y) => Math.abs(y) - Math.abs(x));
    for (const off of order) {
      const lead = 1 - Math.abs(off) / 1.6;
      const l0 = rng.range(0.16, 0.2) + 0.06 * lead;
      oak(tx, ty, ta + off, l0, 0.78 + 0.22 * lead);
      if (lead > 0.6 && rng.next() < 0.35) leaves[leaves.length - 1].hue = Math.min(leaves[leaves.length - 1].hue + 0.1, 0.45);
    }
  }
  return leafPainter(leaves, twigs);
}

/**
 * Silver birch spray: a thin pendulous twig with alternate leaves and short spur shoots of two or three leaves each. The leaves are small,
 * ovate to triangular with a drawn-out tip, doubly serrate, on long stalks, so they hang at many angles and flicker.
 */
export function birchPainter(rng: Rng): Painter {
  const leaves: Leaf[] = [], twigs: Twig[] = [];
  const birch = (x: number, y: number, ang: number, len: number, open: number): void => {
    const l = makeLeaf(rng, x, y, ang, len, len * rng.range(0.34, 0.4), 0, 0, open);
    l.widest = rng.range(0.55, 0.7); l.teeth = rng.range(7, 9); l.toothAmp = rng.range(0.08, 0.13); l.petiole = len * rng.range(0.25, 0.4);
    // Birch leaves sit on stalks: the blade starts a stalk length out from the twig.
    l.bx += l.dx * l.petiole; l.by += l.dy * l.petiole;
    leaves.push(fit(l));
  };
  const side = rng.next() < 0.5 ? -1 : 1;
  const main = bentPath(0.5, 0.965, side * rng.range(0.05, 0.2), rng.range(0.78, 0.86), -side * rng.range(0.4, 0.8), 8);
  pathTwigs(main, 0.0055, 0.0025, twigs);
  const branch = bentPath(...(pathAt(main, rng.range(0.3, 0.4)).slice(0, 2) as [number, number]), -side * rng.range(0.5, 0.8), rng.range(0.32, 0.42), side * rng.range(0.4, 0.8), 5);
  pathTwigs(branch, 0.004, 0.002, twigs);
  for (const [p, count] of [[main, rng.int(18, 22)], [branch, rng.int(11, 14)]] as [Path, number][]) {
    for (let i = 0; i < count; i++) {
      const t = 0.12 + 0.86 * (i + rng.range(-0.2, 0.2)) / count;
      const [x, y, a] = pathAt(p, t);
      const alt = i % 2 === 0 ? 1 : -1;
      if (rng.next() < 0.45) {
        // A spur: a stub of wood with two or three leaves fanned from its tip.
        const sa = a + alt * rng.range(0.7, 1.1), sl = rng.range(0.012, 0.025);
        const sx = x + Math.sin(sa) * sl, sy = y - Math.cos(sa) * sl;
        twigs.push({ ax: x, ay: y, bx: sx, by: sy, r0: 0.0035, r1: 0.003 });
        for (let k = rng.int(2, 3); k > 0; k--) birch(sx, sy, sa + rng.range(-0.8, 0.8), rng.range(0.12, 0.16), 0.85);
      } else birch(x, y, a + alt * rng.range(0.5, 1.2), rng.range(0.12, 0.17) * (1 - 0.2 * t), 0.9);
    }
  }
  return leafPainter(leaves, twigs);
}

/** A canopy blob for the mid-distance LOD: hundreds of small leaves in a lobed, ragged outline, darker toward the interior, with sky gaps. */
export function blobPainter(rng: Rng): Painter {
  const leaves: Leaf[] = [];
  const p1 = rng.range(0, TAU), p2 = rng.range(0, TAU), p3 = rng.range(0, TAU);
  for (let i = 0; i < 760; i++) {
    const a = rng.range(0, TAU), rad = Math.sqrt(rng.next());
    const edge = 0.8 + 0.12 * Math.sin(3 * a + p1) + 0.08 * Math.sin(5 * a + p2) + 0.04 * Math.sin(9 * a + p3);
    if (rad > 0.72 && rng.next() < (rad - 0.72) * 2.4) continue;
    const x = 0.5 + Math.cos(a) * rad * 0.42 * edge, y = 0.5 + Math.sin(a) * rad * 0.39 * edge;
    const len = rng.range(0.07, 0.11) * (1 - 0.25 * rad);
    const ang = rng.range(0, TAU), open = (0.3 + 0.7 * sat((rad - 0.1) / 0.9)) * (0.82 + 0.18 * sat(1 - y));
    const l = makeLeaf(rng, x - Math.sin(ang) * len * 0.5, y + Math.cos(ang) * len * 0.5, ang, len, len * rng.range(0.32, 0.42), 3, 0.1, open);
    l.petiole = 0;
    leaves.push(l);
  }
  const holes = Array.from({ length: 12 }, (_, k) => {
    const a = rng.range(0, TAU), rr = k < 8 ? rng.range(0, 0.28) : rng.range(0.28, 0.4);
    return [0.5 + Math.cos(a) * rr, 0.5 + Math.sin(a) * rr * 0.9, k < 8 ? rng.range(0.016, 0.034) : rng.range(0.03, 0.055)];
  });
  const paint = leafPainter(leaves, []);
  return (u, v, o) => {
    for (const h of holes) if (Math.hypot(u - h[0], v - h[1]) < h[2]) return false;
    return paint(u, v, o);
  };
}

/** Hazel-like shrub shoot: a zigzag twig with two ranks of broad, rounded, doubly serrate leaves with a short point. */
export function shrubPainter(rng: Rng): Painter {
  const leaves: Leaf[] = [], twigs: Twig[] = [];
  const main = bentPath(0.5, 0.965, rng.range(-0.1, 0.1), 0.82, rng.range(-0.3, 0.3), 7);
  pathTwigs(main, 0.007, 0.003, twigs);
  const count = rng.int(9, 11);
  for (let i = 0; i < count; i++) {
    const t = 0.1 + 0.88 * (i + rng.range(-0.15, 0.15)) / count;
    const [x, y, a] = pathAt(main, t);
    const len = rng.range(0.2, 0.26) * (1 - 0.3 * t) + (i === count - 1 ? 0.04 : 0);
    const l = makeLeaf(rng, x, y, a + (i % 2 === 0 ? 1 : -1) * rng.range(0.7, 1.15) * (i === count - 1 ? 0.1 : 1), len, len * rng.range(0.4, 0.46), 0, 0, 0.7 + 0.3 * t);
    // Hazel leaves are thin and fairly pale on the upper face.
    l.widest = rng.range(0.85, 1.05); l.teeth = rng.range(9, 12); l.toothAmp = rng.range(0.05, 0.09); l.petiole = 0.02; l.shade = Math.min(l.shade * 1.1, 1);
    leaves.push(fit(l));
  }
  return leafPainter(leaves, twigs);
}

/**
 * Beech spray: a fine zigzag twig with two or three side shoots, every shoot carrying two flat ranks of alternate leaves that fan out to fill the
 * gaps between them (beech builds a flat mosaic of leaves to catch light). The leaves are ovate with a short point, an entire, gently waved
 * margin and straight parallel veins, 5 to 10 cm long.
 */
export function beechPainter(rng: Rng): Painter {
  const leaves: Leaf[] = [], twigs: Twig[] = [];
  const beech = (x: number, y: number, ang: number, len: number, open: number): void => {
    const l = makeLeaf(rng, x, y, ang, len, len * rng.range(0.3, 0.36), rng.range(5, 8), rng.range(0.035, 0.06), open);
    l.widest = rng.range(0.7, 0.85); l.petiole = 0.012; l.roll = rng.range(-0.15, 0.15);
    leaves.push(fit(l));
  };
  const main = bentPath(0.5, 0.965, rng.range(-0.12, 0.12), 0.84, rng.range(-0.35, 0.35), 9);
  pathTwigs(main, 0.0055, 0.0025, twigs);
  const paths: Path[] = [main];
  for (let k = rng.int(2, 3); k > 0; k--) {
    const [x, y, a] = pathAt(main, rng.range(0.2, 0.55));
    const side = k % 2 === 0 ? 1 : -1;
    const p = bentPath(x, y, a + side * rng.range(0.6, 0.95), rng.range(0.3, 0.42), -side * rng.range(0.1, 0.4), 6);
    pathTwigs(p, 0.0035, 0.0018, twigs);
    paths.push(p);
  }
  for (const p of paths) {
    const count = rng.int(8, 10);
    for (let i = 0; i < count; i++) {
      const t = 0.1 + 0.88 * (i + rng.range(-0.2, 0.2)) / count;
      const [x, y, a] = pathAt(p, t);
      // Two ranks: the leaves alternate sides and lie nearly square to the shoot; the last one points on along it.
      const last = i === count - 1;
      beech(x, y, a + (last ? rng.range(-0.15, 0.15) : (i % 2 === 0 ? 1 : -1) * rng.range(0.85, 1.25)), rng.range(0.16, 0.22) * (1 - 0.25 * t), 0.75 + 0.25 * t);
    }
  }
  return leafPainter(leaves, twigs);
}

/** Hawthorn shoot: small, deeply three- to five-lobed leaves in tufts on short spurs along a stiff twig. */
export function hawthornPainter(rng: Rng): Painter {
  const leaves: Leaf[] = [], twigs: Twig[] = [];
  const main = bentPath(0.5, 0.965, rng.range(-0.1, 0.1), 0.82, rng.range(-0.25, 0.25), 7);
  pathTwigs(main, 0.0065, 0.003, twigs);
  const spurs = rng.int(6, 8);
  for (let i = 0; i < spurs; i++) {
    const t = 0.12 + 0.86 * (i + rng.range(-0.2, 0.2)) / spurs;
    const [x, y, a] = pathAt(main, t);
    const sa = a + (i % 2 === 0 ? 1 : -1) * rng.range(0.5, 1.0), sl = rng.range(0.01, 0.03);
    const sx = x + Math.sin(sa) * sl, sy = y - Math.cos(sa) * sl;
    twigs.push({ ax: x, ay: y, bx: sx, by: sy, r0: 0.004, r1: 0.003 });
    for (let k = rng.int(2, 4); k > 0; k--) {
      const len = rng.range(0.1, 0.15);
      const l = makeLeaf(rng, sx, sy, sa + rng.range(-1.1, 1.1), len, len * rng.range(0.36, 0.44), rng.range(2.6, 3.4), rng.range(0.55, 0.7), 0.75 + 0.25 * t);
      l.widest = rng.range(1.1, 1.4); l.petiole = 0.015;
      leaves.push(fit(l));
    }
  }
  return leafPainter(leaves, twigs);
}

/** Species of a single-leaf sheet tile. */
export type SheetSpecies = 'oak' | 'birch' | 'beech' | 'hazel';
/** Single-leaf sheets are SHEET x SHEET cells, one leaf per cell, its stalk end at the bottom middle of the cell and its tip at the top. */
export const SHEET = 4;
/** Cell coordinates (0..1 within a cell, v down) of a sheet leaf: the end of its stalk, the base of its blade and its tip. */
export const SHEET_STALK_V = 0.97;
export const SHEET_BASE_V = 0.88;
export const SHEET_TIP_V = 0.03;
/** Half width of the cell a sheet leaf may use, as a fraction of the cell. */
export const SHEET_HALF_W = 0.47;

/**
 * A sheet of single leaves of one species, each alone in its cell with its stalk, for the extreme tier's per-leaf geometry: every leaf of a
 * near tree is its own small bent mesh cut from one of these cells, so it shows its real outline, veins and teeth with nothing of its
 * neighbours. The leaves vary in shape, colour and blemishes like the shoot tiles' leaves.
 */
export function sheetPainter(rng: Rng, species: SheetSpecies): Painter {
  const leaves: Leaf[] = [], c = 1 / SHEET, len = (SHEET_BASE_V - SHEET_TIP_V) * c;
  for (let row = 0; row < SHEET; row++) {
    for (let col = 0; col < SHEET; col++) {
      const x = (col + 0.5) * c, y = (row + SHEET_BASE_V) * c;
      const shape = {
        oak: { ratio: rng.range(0.27, 0.33), lobes: rng.range(3.6, 5), amp: rng.range(0.42, 0.58), widest: rng.range(1.25, 1.6), teeth: 0, tooth: 0 },
        birch: { ratio: rng.range(0.34, 0.4), lobes: 0, amp: 0, widest: rng.range(0.55, 0.7), teeth: rng.range(7, 9), tooth: rng.range(0.08, 0.13) },
        beech: { ratio: rng.range(0.3, 0.36), lobes: rng.range(5, 8), amp: rng.range(0.035, 0.06), widest: rng.range(0.7, 0.85), teeth: 0, tooth: 0 },
        hazel: { ratio: rng.range(0.4, 0.46), lobes: 0, amp: 0, widest: rng.range(0.85, 1.05), teeth: rng.range(9, 12), tooth: rng.range(0.05, 0.09) },
      }[species];
      const w = Math.min(len * shape.ratio, (SHEET_HALF_W * c) / (1 + shape.amp));
      const l = makeLeaf(rng, x, y, 0, len, w, shape.lobes, shape.amp, 1);
      l.widest = shape.widest; l.teeth = shape.teeth; l.toothAmp = shape.tooth; l.petiole = (SHEET_STALK_V - SHEET_BASE_V) * c;
      if (species === 'hazel') l.shade = Math.min(l.shade * 1.1, 1);
      leaves.push(l);
    }
  }
  return leafPainter(leaves, []);
}
