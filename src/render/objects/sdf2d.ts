/** 2D signed distance shapes and a marching-squares contour extractor: frame plates are described as a distance field and traced to polygons. */
import { polygonArea, pointInPolygon, type Pt } from './polygon';

/** Distance to the shape at (x, z); negative inside. */
export type Sdf = (x: number, z: number) => number;

export const sdCircle = (x: number, z: number, cx: number, cz: number, r: number): number => Math.hypot(x - cx, z - cz) - r;

/** Box with half extents (hx, hz) whose corners are rounded with radius `r` (r <= min(hx, hz)). */
export function sdRoundBox(x: number, z: number, cx: number, cz: number, hx: number, hz: number, r: number): number {
  const dx = Math.abs(x - cx) - (hx - r);
  const dz = Math.abs(z - cz) - (hz - r);
  return Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dz), 0) - r;
}

/** Segment a-b swollen from radius `ra` at a to `rb` at b (a straight-sided tapered arm with round ends). */
export function sdTaperedCapsule(x: number, z: number, ax: number, az: number, bx: number, bz: number, ra: number, rb: number): number {
  const h = Math.hypot(bx - ax, bz - az);
  const ux = (bx - ax) / h;
  const uz = (bz - az) / h;
  const px = x - ax;
  const pz = z - az;
  const along = px * ux + pz * uz;
  const across = Math.abs(-px * uz + pz * ux);
  const b = (ra - rb) / h;
  const a = Math.sqrt(1 - b * b);
  const k = across * -b + along * a;
  if (k < 0) return Math.hypot(across, along) - ra;
  if (k > a * h) return Math.hypot(across, along - h) - rb;
  return across * a + along * b - ra;
}

export const sdCapsule = (x: number, z: number, ax: number, az: number, bx: number, bz: number, r: number): number => sdTaperedCapsule(x, z, ax, az, bx, bz, r, r);

/** Polynomial smooth minimum: union of two distances with a blend radius `k`. */
export function smoothMin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/** Shape `a` with `b` cut out. */
export const subtract = (a: number, b: number): number => Math.max(a, -b);

export interface Shape2D {
  outline: Pt[];
  holes: Pt[][];
}

export interface ContourBounds {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** Closed iso-contour loops of `f` at zero (inside is negative), sampled on a `cell` sized grid. */
export function contourLoops(f: Sdf, box: ContourBounds, cell: number): Pt[][] {
  const nx = Math.ceil((box.x1 - box.x0) / cell);
  const nz = Math.ceil((box.z1 - box.z0) / cell);
  const w = nx + 1;
  const field = new Float64Array(w * (nz + 1));
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) field[j * w + i] = f(box.x0 + i * cell, box.z0 + j * cell);
  // Edge ids: horizontal edge (i, j) -> j * w + i, vertical edge (i, j) -> hCount + j * w + i.
  const hCount = w * (nz + 1);
  const pointOf = (id: number): Pt => {
    const vertical = id >= hCount;
    const k = vertical ? id - hCount : id;
    const i = k % w;
    const j = (k - i) / w;
    const a = field[j * w + i];
    const b = vertical ? field[(j + 1) * w + i] : field[j * w + i + 1];
    const t = a / (a - b);
    return vertical ? [box.x0 + i * cell, box.z0 + (j + t) * cell] : [box.x0 + (i + t) * cell, box.z0 + j * cell];
  };
  const links = new Map<number, number[]>();
  const link = (a: number, b: number): void => {
    (links.get(a) ?? links.set(a, []).get(a)!).push(b);
    (links.get(b) ?? links.set(b, []).get(b)!).push(a);
  };
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const v0 = field[j * w + i], v1 = field[j * w + i + 1], v2 = field[(j + 1) * w + i + 1], v3 = field[(j + 1) * w + i];
      const bottom = j * w + i;
      const top = (j + 1) * w + i;
      const left = hCount + j * w + i;
      const right = hCount + j * w + i + 1;
      const c = (v0 < 0 ? 1 : 0) | (v1 < 0 ? 2 : 0) | (v2 < 0 ? 4 : 0) | (v3 < 0 ? 8 : 0);
      const centreInside = (v0 + v1 + v2 + v3) / 4 < 0;
      switch (c) {
        case 1: case 14: link(bottom, left); break;
        case 2: case 13: link(bottom, right); break;
        case 3: case 12: link(left, right); break;
        case 4: case 11: link(right, top); break;
        case 6: case 9: link(bottom, top); break;
        case 7: case 8: link(left, top); break;
        case 5: if (centreInside) { link(bottom, right); link(left, top); } else { link(bottom, left); link(right, top); } break;
        case 10: if (centreInside) { link(bottom, left); link(right, top); } else { link(bottom, right); link(left, top); } break;
        default: break;
      }
    }
  }
  const loops: Pt[][] = [];
  const seen = new Set<number>();
  for (const start of links.keys()) {
    if (seen.has(start)) continue;
    const loop: Pt[] = [];
    let prev = -1;
    let cur = start;
    while (!seen.has(cur)) {
      seen.add(cur);
      loop.push(pointOf(cur));
      const next = links.get(cur)!.find((n) => n !== prev && !seen.has(n));
      if (next === undefined) break;
      prev = cur;
      cur = next;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

/** Douglas-Peucker on a closed loop: drops points closer than `tol` to the chord between kept neighbours. */
export function simplifyLoop(loop: readonly Pt[], tol: number): Pt[] {
  const n = loop.length;
  let far = 0;
  let best = -1;
  for (let i = 1; i < n; i++) {
    const d = Math.hypot(loop[i][0] - loop[0][0], loop[i][1] - loop[0][1]);
    if (d > best) { best = d; far = i; }
  }
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[far] = 1;
  const run = (lo: number, hi: number): void => {
    const [ax, az] = loop[lo % n];
    const [bx, bz] = loop[hi % n];
    const len = Math.hypot(bx - ax, bz - az) || 1e-12;
    let worst = -1;
    let at = -1;
    for (let i = lo + 1; i < hi; i++) {
      const [px, pz] = loop[i % n];
      const d = Math.abs((px - ax) * (bz - az) - (pz - az) * (bx - ax)) / len;
      if (d > worst) { worst = d; at = i; }
    }
    if (worst > tol) {
      keep[at % n] = 1;
      run(lo, at);
      run(at, hi);
    }
  };
  run(0, far);
  run(far, n);
  return loop.filter((_, i) => keep[i] === 1);
}

/** Traces `f` into polygons with holes: each loop not inside another is an outline, loops inside it are its holes. */
export function contourShapes(f: Sdf, box: ContourBounds, cell: number, tol: number): Shape2D[] {
  const loops = contourLoops(f, box, cell).map((l) => simplifyLoop(l, tol)).filter((l) => l.length >= 3);
  const depth = loops.map((l, i) => loops.reduce((d, o, k) => d + (k !== i && pointInPolygon(l[0][0], l[0][1], o) ? 1 : 0), 0));
  const shapes: Shape2D[] = [];
  const owners = new Map<number, Shape2D>();
  loops.forEach((l, i) => {
    if (depth[i] % 2 === 0) {
      const s = { outline: l, holes: [] };
      shapes.push(s);
      owners.set(i, s);
    }
  });
  loops.forEach((l, i) => {
    if (depth[i] % 2 === 1) {
      let owner: Shape2D | undefined;
      let ownerArea = Infinity;
      for (const [k, s] of owners) {
        const area = Math.abs(polygonArea(loops[k]));
        if (pointInPolygon(l[0][0], l[0][1], loops[k]) && area < ownerArea) { owner = s; ownerArea = area; }
      }
      owner?.holes.push(l);
    }
  });
  return shapes;
}
