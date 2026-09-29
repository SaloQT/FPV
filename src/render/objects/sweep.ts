/** Sweeps a 2D cross-section along a 3D polyline (gate bars, rings, wires, antenna). */
import type { Vec3 } from '../../contracts';
import type { MeshBuilder } from './meshBuilder';
import type { Pt } from './polygon';

/** One run of a section outline sharing a material decision; `normals` are the outward 2D normals at each point. */
export interface SectionFace {
  id: number;
  pts: Pt[];
  normals: Pt[];
  /** uv.y at the face start (default: perimeter distance so far) and its direction along the face (default +1). */
  v0?: number;
  vDir?: number;
}
export type Section = SectionFace[];

/** Rectangle `w` x `h` centred on the origin; a positive `chamfer` adds a flat 45 degree bevel at each corner. Face ids: 0 +x, 1 +y, 2 -x, 3 -y, 4..7 the corner bevels; faces are listed in outline order. */
export function rectSection(w: number, h: number, chamfer = 0): Section {
  const hw = w / 2;
  const hh = h / 2;
  const c: Pt[] = [[hw, -hh], [hw, hh], [-hw, hh], [-hw, -hh]];
  const dir: Pt[] = [[0, 1], [-1, 0], [0, -1], [1, 0]];
  const out: Section = [];
  for (let i = 0; i < 4; i++) {
    const a = c[i];
    const b = c[(i + 1) % 4];
    const d = dir[i];
    const n: Pt = [d[1], -d[0]];
    out.push({ id: i, pts: [[a[0] + d[0] * chamfer, a[1] + d[1] * chamfer], [b[0] - d[0] * chamfer, b[1] - d[1] * chamfer]], normals: [n, n] });
    if (chamfer > 0) {
      const d1 = dir[(i + 1) % 4];
      const nc: Pt = [(d[1] + d1[1]) * Math.SQRT1_2, -(d[0] + d1[0]) * Math.SQRT1_2];
      out.push({ id: 4 + i, pts: [[b[0] - d[0] * chamfer, b[1] - d[1] * chamfer], [b[0] + d1[0] * chamfer, b[1] + d1[1] * chamfer]], normals: [nc, nc] });
    }
  }
  return out;
}

/** Round section of radius `r`; a single smooth face with id 0 (first and last point coincide). */
export function circleSection(r: number, n: number): Section {
  const pts: Pt[] = [];
  const normals: Pt[] = [];
  for (let k = 0; k <= n; k++) {
    const a = (k / n) * Math.PI * 2;
    normals.push([Math.cos(a), Math.sin(a)]);
    pts.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return [{ id: 0, pts, normals }];
}

export interface SweepOptions {
  /** Direction that section x follows (projected perpendicular to the path); fixes the roll of the section. */
  up: Vec3;
  capStart?: boolean;
  capEnd?: boolean;
  /** Called before each face's vertices at each station: choose `b.kind` / attributes from the face id and the world normal. */
  onFace?: (b: MeshBuilder, faceId: number, normal: Vec3) => void;
  /** Section scale along the path, t in [0, 1]. */
  scale?: (t: number) => number;
}

const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const sub = (a: Vec3, c: Vec3): Vec3 => [a[0] - c[0], a[1] - c[1], a[2] - c[2]];
const cross = (a: Vec3, c: Vec3): Vec3 => [a[1] * c[2] - a[2] * c[1], a[2] * c[0] - a[0] * c[2], a[0] * c[1] - a[1] * c[0]];
const dot = (a: Vec3, c: Vec3): number => a[0] * c[0] + a[1] * c[1] + a[2] * c[2];

/** A path whose first and last points coincide is treated as a closed ring (smooth tangent across the seam). */
export function sweep(b: MeshBuilder, path: readonly Vec3[], section: Section, o: SweepOptions): void {
  const n = path.length;
  const closed = n > 2 && Math.hypot(...sub(path[0], path[n - 1])) < 1e-9;
  const arc: number[] = [0];
  for (let i = 1; i < n; i++) arc.push(arc[i - 1] + Math.hypot(...sub(path[i], path[i - 1])));
  const total = arc[n - 1] || 1;
  const faceOffset: number[] = [];
  const faceDir: number[] = [];
  let perim = 0;
  for (const f of section) {
    faceOffset.push(f.v0 ?? perim);
    faceDir.push(f.vDir ?? 1);
    for (let k = 1; k < f.pts.length; k++) perim += Math.hypot(f.pts[k][0] - f.pts[k - 1][0], f.pts[k][1] - f.pts[k - 1][1]);
  }
  const X: Vec3[] = [];
  const Y: Vec3[] = [];
  const T: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const a = i > 0 ? path[i - 1] : closed ? path[n - 2] : path[0];
    const c = i < n - 1 ? path[i + 1] : closed ? path[1] : path[n - 1];
    const t = norm(sub(c, a));
    const x = norm(sub(o.up, [t[0] * dot(o.up, t), t[1] * dot(o.up, t), t[2] * dot(o.up, t)]));
    T.push(t);
    X.push(x);
    Y.push(cross(t, x));
  }
  const rings: number[][] = section.map(() => []);
  const faceStride = section.map((f) => f.pts.length);
  for (let i = 0; i < n; i++) {
    const s = o.scale ? o.scale(arc[i] / total) : 1;
    for (let fi = 0; fi < section.length; fi++) {
      const f = section[fi];
      let along = 0;
      for (let k = 0; k < f.pts.length; k++) {
        if (k > 0) along += Math.hypot(f.pts[k][0] - f.pts[k - 1][0], f.pts[k][1] - f.pts[k - 1][1]);
        const [px, py] = f.pts[k];
        const [nx, ny] = f.normals[k];
        const nw: Vec3 = [X[i][0] * nx + Y[i][0] * ny, X[i][1] * nx + Y[i][1] * ny, X[i][2] * nx + Y[i][2] * ny];
        if (k === 0) o.onFace?.(b, f.id, nw);
        const pos: Vec3 = [
          path[i][0] + (X[i][0] * px + Y[i][0] * py) * s,
          path[i][1] + (X[i][1] * px + Y[i][1] * py) * s,
          path[i][2] + (X[i][2] * px + Y[i][2] * py) * s,
        ];
        rings[fi].push(b.vertex(pos, nw, arc[i], (faceOffset[fi] + faceDir[fi] * along) * s));
      }
    }
  }
  for (let fi = 0; fi < section.length; fi++) {
    const w = faceStride[fi];
    for (let i = 0; i < n - 1; i++) {
      for (let k = 0; k < w - 1; k++) {
        const a = rings[fi][i * w + k];
        const c = rings[fi][i * w + k + 1];
        const d = rings[fi][(i + 1) * w + k + 1];
        const e = rings[fi][(i + 1) * w + k];
        b.quad(a, c, d, e);
      }
    }
  }
  if (!closed) {
    if (o.capStart) cap(b, path[0], X[0], Y[0], T[0], -1, section, o.scale ? o.scale(0) : 1);
    if (o.capEnd) cap(b, path[n - 1], X[n - 1], Y[n - 1], T[n - 1], 1, section, o.scale ? o.scale(1) : 1);
  }
}

function cap(b: MeshBuilder, p: Vec3, X: Vec3, Y: Vec3, T: Vec3, sign: number, section: Section, s: number): void {
  const ring: Pt[] = [];
  for (const f of section) for (let k = 0; k < f.pts.length - 1; k++) ring.push(f.pts[k]);
  let cx = 0;
  let cy = 0;
  for (const q of ring) {
    cx += q[0];
    cy += q[1];
  }
  cx /= ring.length;
  cy /= ring.length;
  const nrm: Vec3 = [T[0] * sign, T[1] * sign, T[2] * sign];
  const at = (x: number, y: number): number =>
    b.vertex([p[0] + (X[0] * x + Y[0] * y) * s, p[1] + (X[1] * x + Y[1] * y) * s, p[2] + (X[2] * x + Y[2] * y) * s], nrm, x, y);
  const centre = at(cx, cy);
  const ids = ring.map((q) => at(q[0], q[1]));
  for (let k = 0; k < ids.length; k++) b.tri(centre, ids[k], ids[(k + 1) % ids.length]);
}

/** Straight bar between two points. */
export function bar(b: MeshBuilder, from: Vec3, to: Vec3, section: Section, o: SweepOptions): void {
  sweep(b, [from, to], section, o);
}
