import type { Vec3 } from '../../contracts';

/**
 * Keeps foliage from passing through itself. Every leaf mesh, shoot card or needle ribbon of a tree's near LOD is a Piece; before a piece is
 * emitted it is checked against the pieces already placed near it, and two pieces clash only where their triangles cross AND both are
 * painted (opaque) at the crossing, so transparent card corners crossing each other do not count. A clashing piece is tried again in other
 * poses (the caller's candidates) until it fits, and left out if none does. In the wind the whole tree moves as one smooth field whose slope
 * stays well under one (tree.wgsl treeSway), so pieces apart at rest stay apart; countCrossings can check that for any displacement.
 */

export interface Piece {
  pos: Vec3[];
  uv: [number, number][];
  tris: [number, number, number][];
  /** Opacity of the piece's texture at an atlas uv. */
  opaque: (u: number, v: number) => boolean;
  /** Whether the texture paints anything within a few centimetres of an atlas uv (for the clearance check, which probes a sparse grid). */
  near: (u: number, v: number) => boolean;
  /** Room (m) its paint keeps from its neighbours' (the larger of the two counts): the wind moves each triangle's corners and keeps it flat, which
   * bends a crown a little differently from the smooth field it follows, so pieces closer than that could touch. */
  room: number;
  /** How far (m) the foliage a piece stands for reaches off its surface either way (a whole shoot placed as its card), 0 for a plain piece. */
  spread?: number;
  /** Pieces of one group (a crossed pair of cards or ribbons meeting along a shared stem) may cross each other. */
  group: number;
}

const CELL = 0.4;
/** Points tested along the line where two triangles cross, for paint on both. */
const SAMPLES = 7;
/** Shortest crossing that counts (m). */
const MIN_CROSSING = 0.001;

/** A placed piece, its bounds, its order of placing, and the last neighbour query that found it. */
interface Placed { piece: Piece; lo: Vec3; hi: Vec3; id: number; seen: number }

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function bounds(pos: readonly Vec3[]): [Vec3, Vec3] {
  const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of pos) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
  return [lo, hi];
}

/** Segment where triangle a crosses the plane of triangle b, as two points, or null. */
function planeCut(a: readonly Vec3[], n: Vec3, d: number): [Vec3, Vec3] | null {
  const s = a.map((p) => dot(n, p) - d);
  const out: Vec3[] = [];
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3;
    if ((s[i] > 0) !== (s[j] > 0)) {
      const t = s[i] / (s[i] - s[j]);
      out.push([a[i][0] + (a[j][0] - a[i][0]) * t, a[i][1] + (a[j][1] - a[i][1]) * t, a[i][2] + (a[j][2] - a[i][2]) * t]);
    }
  }
  return out.length === 2 ? [out[0], out[1]] : null;
}

/** Barycentric weights of point p in triangle t (p on its plane). */
function bary(t: readonly Vec3[], p: Vec3): [number, number, number] {
  const v0 = sub(t[1], t[0]), v1 = sub(t[2], t[0]), v2 = sub(p, t[0]);
  const d00 = dot(v0, v0), d01 = dot(v0, v1), d11 = dot(v1, v1), d20 = dot(v2, v0), d21 = dot(v2, v1);
  const den = d00 * d11 - d01 * d01 || 1e-12;
  const v = (d11 * d20 - d01 * d21) / den, w = (d00 * d21 - d01 * d20) / den;
  return [1 - v - w, v, w];
}

function opaqueAt(piece: Piece, tri: readonly number[], w: readonly number[], near = false): boolean {
  const [a, b, c] = tri;
  const u = piece.uv[a][0] * w[0] + piece.uv[b][0] * w[1] + piece.uv[c][0] * w[2];
  const v = piece.uv[a][1] * w[0] + piece.uv[b][1] * w[1] + piece.uv[c][1] * w[2];
  return near ? piece.near(u, v) : piece.opaque(u, v);
}

/** Bounds of each triangle of a piece at the given positions, as [lo, hi] pairs; cached for a piece's rest positions. */
const restBoxes = new WeakMap<readonly Vec3[], [Vec3, Vec3][]>();
function triBoxes(piece: Piece, pos: readonly Vec3[]): [Vec3, Vec3][] {
  let boxes = pos === piece.pos ? restBoxes.get(pos) : undefined;
  if (!boxes) {
    boxes = piece.tris.map((t) => bounds(t.map((i) => pos[i])));
    if (pos === piece.pos) restBoxes.set(pos, boxes);
  }
  return boxes;
}

/**
 * Points of a triangle (barycentric weights on a grid) probed for how close they come to another piece: in twelfths (a few centimetres apart
 * on a shoot card), or in quarters where the room to keep is wide (a whole shoot placed as its card), which needs no finer look.
 */
const probeGrid = (steps: number): [number, number, number][] => {
  const out: [number, number, number][] = [];
  for (let i = 0; i <= steps; i++) for (let j = 0; j <= steps - i; j++) out.push([i / steps, j / steps, (steps - i - j) / steps]);
  return out;
};
const PROBES = probeGrid(12), COARSE_PROBES = probeGrid(4);
/** Spacing (m) the fine probes aim for. */
const PROBE_SPACING = 0.04;
/** Room (m) from which the coarse probes are used. */
const COARSE_ROOM = 0.03;

/** The probes of a triangle (by index) of a piece that land on or near paint; the same for every pose of a piece (they share its uv). */
const painted = new WeakMap<object, [number, number, number][][]>(), paintedCoarse = new WeakMap<object, [number, number, number][][]>();
function paintedProbes(p: Piece, tri: number, coarse: boolean): [number, number, number][] {
  const cache = coarse ? paintedCoarse : painted;
  let all = cache.get(p.uv);
  if (!all) {
    all = p.tris.map((t) => {
      // About PROBE_SPACING apart along the triangle's longest edge (a small leaf needs far fewer probes than a shoot card), at most the full grid.
      const e = Math.max(...[[0, 1], [1, 2], [2, 0]].map(([i, j]) => Math.hypot(...sub(p.pos[t[i]], p.pos[t[j]]))));
      const steps = coarse ? 4 : Math.min(12, Math.max(2, Math.ceil(e / PROBE_SPACING)));
      return (steps === 12 ? PROBES : steps === 4 && coarse ? COARSE_PROBES : probeGrid(steps)).filter((w) => opaqueAt(p, t, w, true));
    });
    cache.set(p.uv, all);
  }
  return all[tri];
}

/** Unit normal and offset of each triangle of a piece at rest (null for a degenerate one); cached, as a piece is compared many times. */
const restPlanes = new WeakMap<readonly Vec3[], ({ n: Vec3; d: number } | null)[]>();
function triPlanes(p: Piece): ({ n: Vec3; d: number } | null)[] {
  let planes = restPlanes.get(p.pos);
  if (!planes) {
    planes = p.tris.map((t) => {
      const n = cross(sub(p.pos[t[1]], p.pos[t[0]]), sub(p.pos[t[2]], p.pos[t[0]])), l = Math.hypot(n[0], n[1], n[2]);
      if (l < 1e-9) return null;
      const u: Vec3 = [n[0] / l, n[1] / l, n[2] / l];
      return { n: u, d: dot(u, p.pos[t[0]]) };
    });
    restPlanes.set(p.pos, planes);
  }
  return planes;
}

/** True if a painted point of b (probed on a grid over each triangle; near paint counts) lies within `gap` of paint on a, along a's normal. */
function within(a: Piece, b: Piece, gap: number): boolean {
  const boxesA = triBoxes(a, a.pos), boxesB = triBoxes(b, b.pos);
  const planesA = triPlanes(a);
  for (let i = 0; i < a.tris.length; i++) {
    const plane = planesA[i];
    if (!plane) continue;
    const [alo, ahi] = boxesA[i], ta = a.tris[i], A = ta.map((k) => a.pos[k]), { n, d } = plane;
    for (let j = 0; j < b.tris.length; j++) {
      const [blo, bhi] = boxesB[j];
      if (ahi[0] + gap < blo[0] || alo[0] - gap > bhi[0] || ahi[1] + gap < blo[1] || alo[1] - gap > bhi[1] || ahi[2] + gap < blo[2] || alo[2] - gap > bhi[2]) continue;
      const tb = b.tris[j], B = tb.map((k) => b.pos[k]);
      // The distance to a's plane is linear over b's triangle: skip it when all of it is further than the gap on one side.
      const s0 = dot(n, B[0]) - d, s1 = dot(n, B[1]) - d, s2 = dot(n, B[2]) - d;
      if ((s0 >= gap && s1 >= gap && s2 >= gap) || (s0 <= -gap && s1 <= -gap && s2 <= -gap)) continue;
      // Where each probe lands on a's triangle is linear in the probe's weights too: work it out at b's corners and blend.
      const c0 = bary(A, sub(B[0], [n[0] * s0, n[1] * s0, n[2] * s0])), c1 = bary(A, sub(B[1], [n[0] * s1, n[1] * s1, n[2] * s1]));
      const c2 = bary(A, sub(B[2], [n[0] * s2, n[1] * s2, n[2] * s2]));
      // b's triangle lands wholly outside a's (beyond one of its edges): nothing to probe.
      if ((c0[0] < 0 && c1[0] < 0 && c2[0] < 0) || (c0[1] < 0 && c1[1] < 0 && c2[1] < 0) || (c0[2] < 0 && c1[2] < 0 && c2[2] < 0)) continue;
      for (const w of paintedProbes(b, j, gap >= COARSE_ROOM)) {
        const s = s0 * w[0] + s1 * w[1] + s2 * w[2];
        if (s >= gap || s <= -gap) continue;
        const wa: Vec3 = [c0[0] * w[0] + c1[0] * w[1] + c2[0] * w[2], c0[1] * w[0] + c1[1] * w[1] + c2[1] * w[2], c0[2] * w[0] + c1[2] * w[1] + c2[2] * w[2]];
        if (wa[0] < 0 || wa[1] < 0 || wa[2] < 0) continue;
        if (opaqueAt(a, ta, wa, true)) return true;
      }
    }
  }
  return false;
}

/** True where some triangle of a crosses some triangle of b, at positions pa and pb, at a point both paint opaque. */
export function visiblyCross(a: Piece, pa: readonly Vec3[], b: Piece, pb: readonly Vec3[]): boolean {
  // Always tested the same way round (by first vertex), so a pair gives the same answer whichever of the two is placed first.
  if (pa[0][0] > pb[0][0] || (pa[0][0] === pb[0][0] && pa[0][2] > pb[0][2])) [a, pa, b, pb] = [b, pb, a, pa];
  const boxesA = triBoxes(a, pa), boxesB = triBoxes(b, pb);
  for (let i = 0; i < a.tris.length; i++) {
    const [alo, ahi] = boxesA[i];
    for (let j = 0; j < b.tris.length; j++) {
      const [blo, bhi] = boxesB[j];
      if (ahi[0] < blo[0] || alo[0] > bhi[0] || ahi[1] < blo[1] || alo[1] > bhi[1] || ahi[2] < blo[2] || alo[2] > bhi[2]) continue;
      const ta = a.tris[i], tb = b.tris[j];
      const a0 = pa[ta[0]], a1 = pa[ta[1]], a2 = pa[ta[2]], b0 = pb[tb[0]], b1 = pb[tb[1]], b2 = pb[tb[2]];
      // Each triangle must straddle the other's plane (the cheap test that rejects nearly every pair) before the crossing is worked out.
      const na = cross(sub(a1, a0), sub(a2, a0)), da = dot(na, a0);
      const s0 = dot(na, b0) - da, s1 = dot(na, b1) - da, s2 = dot(na, b2) - da;
      if ((s0 > 0 && s1 > 0 && s2 > 0) || (s0 <= 0 && s1 <= 0 && s2 <= 0)) continue;
      const nb = cross(sub(b1, b0), sub(b2, b0)), db = dot(nb, b0);
      const r0 = dot(nb, a0) - db, r1 = dot(nb, a1) - db, r2 = dot(nb, a2) - db;
      if ((r0 > 0 && r1 > 0 && r2 > 0) || (r0 <= 0 && r1 <= 0 && r2 <= 0)) continue;
      if (dot(na, na) < 1e-14 || dot(nb, nb) < 1e-14) continue;
      const A = [a0, a1, a2], B = [b0, b1, b2];
      const sa = planeCut(A, nb, db), sb = planeCut(B, na, da);
      if (!sa || !sb) continue;
      // Both segments lie on the line where the planes meet; the triangles cross on the overlap of the two.
      const dir = cross(na, nb);
      const ta0 = dot(dir, sa[0]), ta1 = dot(dir, sa[1]), tb0 = dot(dir, sb[0]), tb1 = dot(dir, sb[1]);
      const lo = Math.max(Math.min(ta0, ta1), Math.min(tb0, tb1)), hi = Math.min(Math.max(ta0, ta1), Math.max(tb0, tb1));
      // Pieces that only touch (two stalks meeting at one point on a twig) do not count: the crossing must be at least a millimetre long.
      if (hi - lo <= MIN_CROSSING * Math.hypot(dir[0], dir[1], dir[2])) continue;
      const seg = ta1 - ta0 || 1e-12;
      for (let s = 0; s < SAMPLES; s++) {
        const t = lo + (hi - lo) * (s + 0.5) / SAMPLES, f = (t - ta0) / seg;
        const p: Vec3 = [sa[0][0] + (sa[1][0] - sa[0][0]) * f, sa[0][1] + (sa[1][1] - sa[0][1]) * f, sa[0][2] + (sa[1][2] - sa[0][2]) * f];
        if (opaqueAt(a, ta, bary(A, p)) && opaqueAt(b, tb, bary(B, p))) return true;
      }
    }
  }
  return false;
}

export class FoliageSpace {
  private readonly cells = new Map<number, Placed[]>();
  /** Pieces placed, and pieces left out (they crossed something in every pose). */
  placed = 0;
  dropped = 0;
  /** The most room and spread of any placed piece, to know how far to look for neighbours. */
  private room = 0;
  private spread = 0;

  private keys(lo: Vec3, hi: Vec3): number[] {
    const out: number[] = [];
    for (let x = Math.floor(lo[0] / CELL); x <= Math.floor(hi[0] / CELL); x++)
      for (let y = Math.floor(lo[1] / CELL); y <= Math.floor(hi[1] / CELL); y++)
        for (let z = Math.floor(lo[2] / CELL); z <= Math.floor(hi[2] / CELL); z++) out.push(((x + 1024) * 2048 + y + 1024) * 2048 + z + 1024);
    return out;
  }

  private query = 0;
  private neighbours(lo: Vec3, hi: Vec3, pad: number): Placed[] {
    const out: Placed[] = [], stamp = ++this.query;
    const l: Vec3 = [lo[0] - pad, lo[1] - pad, lo[2] - pad], h: Vec3 = [hi[0] + pad, hi[1] + pad, hi[2] + pad];
    for (const k of this.keys(l, h)) for (const q of this.cells.get(k) ?? []) {
      if (q.seen === stamp || q.hi[0] < l[0] || q.lo[0] > h[0] || q.hi[1] < l[1] || q.lo[1] > h[1] || q.hi[2] < l[2] || q.lo[2] > h[2]) continue;
      q.seen = stamp;
      out.push(q);
    }
    return out;
  }

  /**
   * True if p visibly crosses a placed piece of another group, or a painted part of either comes within the room they keep of the other
   * (plus how far each one's foliage spreads off it).
   */
  private clashes(p: Piece, standIn?: Piece): boolean {
    const [lo, hi] = bounds(p.pos);
    return this.neighbours(lo, hi, Math.max(p.room, this.room) + (p.spread ?? 0) + this.spread).some((q) => {
      if (q.piece.group === p.group || q.piece === standIn) return false;
      // The query looked as far as the widest room of any piece; most pairs need far less.
      const room = Math.max(p.room, q.piece.room) + (p.spread ?? 0) + (q.piece.spread ?? 0);
      for (let k = 0; k < 3; k++) if (q.lo[k] > hi[k] + room || q.hi[k] < lo[k] - room) return false;
      return visiblyCross(p, p.pos, q.piece, q.piece.pos) || within(p, q.piece, room) || within(q.piece, p, room);
    });
  }

  /**
   * Places the first of the candidate poses (`make(k)`, k = 0, 1, ...; null when out of candidates) that crosses nothing, and returns it to
   * emit; a piece that crosses something in every pose is left out (null). With `also`, the pose must fit there too (ignoring `standIn`, the card that holds the place of the shoot the piece belongs to), and goes into both.
   */
  place(make: (k: number) => Piece | null, also?: FoliageSpace, standIn?: Piece): Piece | null {
    for (let k = 0; ; k++) {
      const p = make(k);
      if (!p) break;
      if (!this.clashes(p) && !also?.clashes(p, standIn)) { this.add(p); also?.add(p); return p; }
    }
    this.dropped++;
    return null;
  }

  /** A space holding the given pieces as they are, unchecked (to count what crosses among a finished set). */
  static of(pieces: readonly Piece[]): FoliageSpace {
    const s = new FoliageSpace();
    for (const p of pieces) s.add(p);
    return s;
  }

  private add(p: Piece): void {
    const [lo, hi] = bounds(p.pos);
    const entry: Placed = { piece: p, lo, hi, id: this.placed, seen: 0 };
    for (const k of this.keys(lo, hi)) {
      let list = this.cells.get(k);
      if (!list) this.cells.set(k, (list = []));
      list.push(entry);
    }
    this.placed++;
    this.room = Math.max(this.room, p.room);
    this.spread = Math.max(this.spread, p.spread ?? 0);
  }

  /** Pairs of placed pieces (of different groups) that visibly cross, at rest or with every vertex moved by . */
  countCrossings(move?: (p: Vec3) => Vec3): number {
    const all = new Set<Placed>();
    for (const list of this.cells.values()) for (const q of list) all.add(q);
    // Moved pieces are counted in a space of their own, so the neighbour search sees them where they moved to.
    if (move) return FoliageSpace.of([...all].map((q) => ({ ...q.piece, pos: q.piece.pos.map(move) }))).countCrossings();
    let n = 0;
    for (const a of all) {
      for (const b of this.neighbours(a.lo, a.hi, 0)) {
        if (b.id <= a.id || b.piece.group === a.piece.group) continue;
        if (visiblyCross(a.piece, a.piece.pos, b.piece, b.piece.pos)) n++;
      }
    }
    return n;
  }
}
