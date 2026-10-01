import type { Rng } from '../../world/track/rng';

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

/** A pointed leaf: base point, unit axis (tile coordinates), length and half width, with veins, midrib and a lobed margin. */
export interface Leaf {
  bx: number; by: number; dx: number; dy: number; len: number; w: number;
  shade: number; hue: number; open: number;
  lobes: number; lobeAmp: number; lobePhase: number;
  /** Per-leaf tilt along the axis and across it, so neighbouring leaves catch the light differently. */
  bias: number; roll: number;
  petiole: number;
}

export function leafShade(rng: Rng): number {
  return 0.62 + 0.38 * rng.next();
}

/** Mostly green, some yellow-green, a few dead yellow-brown leaves. */
export function leafHue(rng: Rng): number {
  const r = rng.next();
  return r < 0.06 ? 0.85 + 0.15 * rng.next() : r < 0.28 ? 0.3 + 0.3 * rng.next() : 0.08 * rng.next();
}

export function makeLeaf(rng: Rng, bx: number, by: number, angle: number, len: number, w: number, lobes: number, lobeAmp: number, open = 1): Leaf {
  const hue = leafHue(rng);
  return {
    bx, by, dx: Math.sin(angle), dy: -Math.cos(angle), len, w, shade: leafShade(rng) * (hue > 0.8 ? 0.78 : 1), hue, open,
    lobes, lobeAmp, lobePhase: rng.range(0, TAU), bias: rng.range(-0.3, 0.3), roll: rng.range(-0.22, 0.22), petiole: 0.06,
  };
}

const STEM_SHADE = 0.3;

export function paintLeaf(l: Leaf, u: number, v: number, o: Sample): boolean {
  const px = u - l.bx, py = v - l.by;
  const s = (px * l.dx + py * l.dy) / l.len;
  const lat = -px * l.dy + py * l.dx;
  const a = Math.abs(lat);
  if (s <= 0) {
    if (s * l.len > -l.petiole && a < 0.006) {
      o.shade = STEM_SHADE; o.hue = 0; o.thin = 0; o.tu = 0; o.tv = 0; o.open = l.open;
      return true;
    }
    return false;
  }
  if (s >= 1) return false;
  const hw = l.w * Math.sin(Math.PI * Math.pow(s, 0.72)) * (1 + l.lobeAmp * Math.sin(s * l.lobes * TAU + l.lobePhase));
  if (a >= hw) return false;
  const r = a / hw;
  const f = s * 7 - r * 1.5;
  const vein = sat(1 - Math.abs(f - Math.floor(f) - 0.5) / 0.09);
  const rib = sat(1 - a / (0.004 + 0.012 * l.w * (1 - s) * 10));
  o.shade = l.shade * (0.84 + 0.16 * vein + 0.22 * rib) * (1 - 0.14 * r);
  o.hue = Math.min(l.hue + 0.12 * vein + 0.25 * rib, 1);
  o.thin = 1 - 0.7 * Math.max(0.6 * vein, rib);
  const across = (lat >= 0 ? 1 : -1) * 0.55 * Math.pow(r, 0.8) + l.roll, along = l.bias - 0.5 * (s - 0.5);
  o.tu = across * -l.dy + along * l.dx;
  o.tv = across * l.dx + along * l.dy;
  o.open = l.open;
  return true;
}

function leafBox(l: Leaf): [number, number, number, number] {
  const tx = l.bx + l.dx * l.len, ty = l.by + l.dy * l.len, e = l.w * (1 + l.lobeAmp) + 0.006;
  const px = -l.dy * e, py = l.dx * e;
  return [Math.min(l.bx, tx) - Math.abs(px), Math.min(l.by, ty) - Math.abs(py), Math.max(l.bx, tx) + Math.abs(px), Math.max(l.by, ty) + Math.abs(py)];
}

function leafPainter(leaves: readonly Leaf[], grid: Grid<Leaf>, extra: Painter | null): Painter {
  for (const l of leaves) {
    const [x0, y0, x1, y1] = leafBox(l);
    grid.add(l, x0 - l.petiole, y0 - l.petiole, x1 + l.petiole, y1 + l.petiole);
  }
  return (u, v, o) => {
    const list = grid.at(u, v);
    for (let i = list.length - 1; i >= 0; i--) if (paintLeaf(list[i], u, v, o)) return true;
    return extra ? extra(u, v, o) : false;
  };
}

interface SprigSpec { count: number; len: number; w: number; lobes: number; lobeAmp: number; angle: [number, number]; droop: number }

/** A twig with alternating leaves: `droop` bends the whole twig sideways (pendulous birch shoots). */
function sprig(rng: Rng, s: SprigSpec): Painter {
  const stemX = (y: number): number => 0.5 + 0.035 * Math.sin(((0.96 - y) / 0.62) * 3.1) + s.droop * (0.96 - y) * (0.96 - y);
  const leaves: Leaf[] = [];
  for (let i = 0; i < s.count; i++) {
    const t = 0.08 + 0.82 * (i / (s.count - 1)), y = 0.94 - 0.62 * t;
    const ang = (i % 2 === 0 ? 1 : -1) * rng.range(s.angle[0], s.angle[1]);
    leaves.push(makeLeaf(rng, stemX(y), y, ang, s.len * (1 - 0.28 * t) * rng.range(0.9, 1.1), s.w * rng.range(0.9, 1.15), s.lobes, s.lobeAmp));
  }
  leaves.push(makeLeaf(rng, stemX(0.32), 0.32, -s.droop * 2, s.len * 0.9, s.w, s.lobes, s.lobeAmp));
  const stem: Painter = (u, v, o) => {
    if (v < 0.34 || v > 0.96 || Math.abs(u - stemX(v)) >= 0.011) return false;
    o.shade = STEM_SHADE; o.hue = 0; o.thin = 0; o.tu = 0; o.tv = 0; o.open = 0.7;
    return true;
  };
  return leafPainter(leaves, new Grid<Leaf>(12), stem);
}

/** Broadleaf twig with lobed, oak-like leaves about 0.14 m long on a 0.48 m card. */
export const sprigPainter = (rng: Rng): Painter => sprig(rng, { count: 9, len: 0.3, w: 0.085, lobes: 3, lobeAmp: 0.16, angle: [0.65, 1.05], droop: 0 });

/** Small serrated ovate birch leaves on a drooping twig. */
export const birchPainter = (rng: Rng): Painter => sprig(rng, { count: 11, len: 0.22, w: 0.078, lobes: 9, lobeAmp: 0.06, angle: [0.7, 1.15], droop: 0.35 });

/** A canopy blob for the mid-distance LOD: hundreds of small leaves in a ragged ellipse, darker toward the interior, with sky gaps. */
export function blobPainter(rng: Rng): Painter {
  const leaves: Leaf[] = [];
  for (let i = 0; i < 520; i++) {
    const a = rng.range(0, TAU), rad = Math.sqrt(rng.next());
    if (rad > 0.72 && rng.next() < (rad - 0.72) * 2.4) continue;
    const x = 0.5 + Math.cos(a) * rad * 0.4, y = 0.5 + Math.sin(a) * rad * 0.37;
    const len = rng.range(0.07, 0.11) * (1 - 0.25 * rad);
    const ang = rng.range(0, TAU), open = (0.3 + 0.7 * sat((rad - 0.1) / 0.9)) * (0.82 + 0.18 * sat(1 - y));
    const l = makeLeaf(rng, x - Math.sin(ang) * len * 0.5, y + Math.cos(ang) * len * 0.5, ang, len, len * rng.range(0.32, 0.42), 3, 0.1, open);
    l.petiole = 0;
    leaves.push(l);
  }
  const holes = Array.from({ length: 12 }, () => [rng.range(0.3, 0.7), rng.range(0.32, 0.68), rng.range(0.018, 0.038)]);
  const paint = leafPainter(leaves, new Grid<Leaf>(12), null);
  return (u, v, o) => {
    for (const h of holes) if (Math.hypot(u - h[0], v - h[1]) < h[2]) return false;
    return paint(u, v, o);
  };
}
