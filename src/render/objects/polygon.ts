/** Ear-clipping triangulation of a simple polygon with holes (holes are joined to the outline by bridge edges). */
export type Pt = [number, number];

export interface Triangulation {
  /** Outline points followed by every hole's points (each loop re-oriented: outline counter-clockwise, holes clockwise). */
  points: Pt[];
  /** Counter-clockwise triangles as indices into `points`. */
  triangles: number[];
}

export function polygonArea(p: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length];
    a += p[i][0] * q[1] - q[0] * p[i][1];
  }
  return a / 2;
}

export function pointInPolygon(x: number, y: number, p: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i];
    const [xj, yj] = p[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const cross = (ax: number, ay: number, bx: number, by: number): number => ax * by - ay * bx;

/** True when segments ab and cd cross at a point interior to both. */
function properCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const d1 = cross(b[0] - a[0], b[1] - a[1], c[0] - a[0], c[1] - a[1]);
  const d2 = cross(b[0] - a[0], b[1] - a[1], d[0] - a[0], d[1] - a[1]);
  const d3 = cross(d[0] - c[0], d[1] - c[1], a[0] - c[0], a[1] - c[1]);
  const d4 = cross(d[0] - c[0], d[1] - c[1], b[0] - c[0], b[1] - c[1]);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

const same = (a: Pt, b: Pt): boolean => a[0] === b[0] && a[1] === b[1];

function orient(loop: readonly Pt[], ccw: boolean): Pt[] {
  return polygonArea(loop) > 0 === ccw ? loop.slice() : loop.slice().reverse();
}

interface HoleRef {
  start: number;
  len: number;
}

/** Cuts a bridge from hole `cur` to the ring: the shortest hole-vertex / ring-vertex segment that crosses no boundary. */
function bridgeHole(points: Pt[], ring: number[], cur: HoleRef, pending: HoleRef[]): number[] {
  const loopOf = (h: HoleRef): Pt[] => points.slice(h.start, h.start + h.len);
  const ringPts = ring.map((i) => points[i]);
  const pendingLoops = pending.map(loopOf);
  const cands: { d: number; h: number; k: number }[] = [];
  for (let h = 0; h < cur.len; h++) {
    const hp = points[cur.start + h];
    for (let k = 0; k < ring.length; k++) cands.push({ d: (hp[0] - ringPts[k][0]) ** 2 + (hp[1] - ringPts[k][1]) ** 2, h, k });
  }
  cands.sort((a, b) => a.d - b.d);
  const blocked = (a: Pt, b: Pt, loop: readonly Pt[]): boolean => {
    for (let i = 0; i < loop.length; i++) if (properCross(a, b, loop[i], loop[(i + 1) % loop.length])) return true;
    return false;
  };
  for (const c of cands) {
    const a = points[cur.start + c.h];
    const b = ringPts[c.k];
    if (blocked(a, b, ringPts) || pendingLoops.some((l) => blocked(a, b, l))) continue;
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    if (!pointInPolygon(mx, my, ringPts) || pendingLoops.some((l) => pointInPolygon(mx, my, l))) continue;
    const out = ring.slice(0, c.k + 1);
    for (let j = 0; j <= cur.len; j++) out.push(cur.start + ((c.h + j) % cur.len));
    out.push(ring[c.k]);
    for (let j = c.k + 1; j < ring.length; j++) out.push(ring[j]);
    return out;
  }
  throw new Error('triangulate: no valid bridge to hole');
}

function clipEars(points: readonly Pt[], ring: number[], out: number[]): void {
  const n0 = ring.length;
  const next = ring.map((_, i) => (i + 1) % n0);
  const prev = ring.map((_, i) => (i + n0 - 1) % n0);
  const alive = new Array<boolean>(n0).fill(true);
  const pt = (i: number): Pt => points[ring[i]];
  const isEar = (i: number): boolean => {
    const a = pt(prev[i]);
    const b = pt(i);
    const c = pt(next[i]);
    if (cross(b[0] - a[0], b[1] - a[1], c[0] - a[0], c[1] - a[1]) <= 0) return false;
    for (let j = next[next[i]]; j !== prev[i]; j = next[j]) {
      const q = pt(j);
      if (same(q, a) || same(q, b) || same(q, c)) continue;
      if (cross(b[0] - a[0], b[1] - a[1], q[0] - a[0], q[1] - a[1]) >= 0 && cross(c[0] - b[0], c[1] - b[1], q[0] - b[0], q[1] - b[1]) >= 0 && cross(a[0] - c[0], a[1] - c[1], q[0] - c[0], q[1] - c[1]) >= 0) return false;
    }
    return true;
  };
  const remove = (i: number): void => {
    alive[i] = false;
    next[prev[i]] = next[i];
    prev[next[i]] = prev[i];
  };
  let count = n0;
  let i = 0;
  let sinceClip = 0;
  while (count > 3) {
    if (isEar(i)) {
      out.push(ring[prev[i]], ring[i], ring[next[i]]);
      const nx = next[i];
      remove(i);
      count--;
      i = nx;
      sinceClip = 0;
    } else {
      i = next[i];
      if (++sinceClip > count) {
        // No ear left (collinear or duplicated bridge vertices): drop the flattest vertex so the loop always ends.
        let best = i;
        let bestC = Infinity;
        for (let j = i, k = 0; k < count; j = next[j], k++) {
          const a = pt(prev[j]), b = pt(j), c = pt(next[j]);
          const cr = Math.abs(cross(b[0] - a[0], b[1] - a[1], c[0] - a[0], c[1] - a[1]));
          if (cr < bestC) {
            bestC = cr;
            best = j;
          }
        }
        i = next[best];
        remove(best);
        count--;
        sinceClip = 0;
      }
    }
  }
  const last = alive.indexOf(true);
  const a = pt(prev[last]), b = pt(last), c = pt(next[last]);
  if (cross(b[0] - a[0], b[1] - a[1], c[0] - a[0], c[1] - a[1]) > 0) out.push(ring[prev[last]], ring[last], ring[next[last]]);
}

export function triangulate(outline: readonly Pt[], holes: readonly (readonly Pt[])[] = []): Triangulation {
  const points: Pt[] = orient(outline, true);
  let ring = points.map((_, i) => i);
  const refs: HoleRef[] = [];
  for (const h of holes) {
    const loop = orient(h, false);
    refs.push({ start: points.length, len: loop.length });
    points.push(...loop);
  }
  // Rightmost holes first: their bridges are the least likely to be blocked by the holes still to be joined.
  const order = refs.slice().sort((a, b) => Math.max(...points.slice(b.start, b.start + b.len).map((p) => p[0])) - Math.max(...points.slice(a.start, a.start + a.len).map((p) => p[0])));
  for (let k = 0; k < order.length; k++) ring = bridgeHole(points, ring, order[k], order.slice(k));
  const triangles: number[] = [];
  clipEars(points, ring, triangles);
  return { points, triangles };
}
