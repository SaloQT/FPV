/** Flat plates: a polygon with holes extruded along +Y (frame plates, PCBs, pads). */
import type { MeshBuilder } from './meshBuilder';
import { triangulate, type Pt } from './polygon';

export interface PlateOptions {
  /** Wall corners sharper than this (radians) stay creased; gentler ones share a smooth normal. */
  hardAngle?: number;
  /** Skip the underside (plates that sit on something). */
  noBottom?: boolean;
  /** Material kind for the side walls (the top and bottom keep the builder's current kind). */
  wallKind?: number;
  /** 45 degree bevel width in metres on the top edge (and the bottom edge unless `noBottom`); it must stay small next to the plate features. */
  chamfer?: number;
}

const unit = (x: number, y: number): Pt => {
  const l = Math.hypot(x, y) || 1;
  return [x / l, y / l];
};

/**
 * Prism between y0 and y1 whose footprint is `outline` minus `holes`, points given as (x, z). Top and bottom uv are (x, z) in
 * metres; walls use (arc length, y).
 */
export function plate(b: MeshBuilder, outline: readonly Pt[], holes: readonly (readonly Pt[])[], y0: number, y1: number, o: PlateOptions = {}): void {
  const tri = triangulate(outline, holes);
  const pts = tri.points;
  const cosHard = Math.cos(o.hardAngle ?? 0.6);
  const c = o.chamfer ?? 0;
  const loops: [number, number][] = [[0, outline.length]];
  let start = outline.length;
  for (const h of holes) {
    loops.push([start, h.length]);
    start += h.length;
  }
  // Outward (away from the solid) unit normal of every edge, edge i running from point i to i + 1 of its loop.
  const edge: Pt[] = new Array<Pt>(pts.length);
  const inset: Pt[] = new Array<Pt>(pts.length);
  for (const [s0, len] of loops) {
    for (let i = 0; i < len; i++) {
      const a = pts[s0 + i];
      const d = pts[s0 + ((i + 1) % len)];
      edge[s0 + i] = unit(d[1] - a[1], -(d[0] - a[0]));
    }
    for (let i = 0; i < len; i++) {
      const n1 = edge[s0 + ((i + len - 1) % len)];
      const n2 = edge[s0 + i];
      const m = unit(n1[0] + n2[0], n1[1] + n2[1]);
      const k = c / Math.max(0.5, m[0] * n1[0] + m[1] * n1[1]);
      inset[s0 + i] = [-m[0] * k, -m[1] * k];
    }
  }
  const yTop = y1 - c;
  const yBot = o.noBottom ? y0 : y0 + c;
  const face = (y: number, ny: number): number[] => pts.map((p, i) => b.vertex([p[0] + (c > 0 ? inset[i][0] : 0), y, p[1] + (c > 0 ? inset[i][1] : 0)], [0, ny, 0], p[0], p[1]));
  const top = face(y1, 1);
  for (let i = 0; i < tri.triangles.length; i += 3) b.tri(top[tri.triangles[i]], top[tri.triangles[i + 1]], top[tri.triangles[i + 2]]);
  if (!o.noBottom) {
    const bot = face(y0, -1);
    for (let i = 0; i < tri.triangles.length; i += 3) b.tri(bot[tri.triangles[i]], bot[tri.triangles[i + 1]], bot[tri.triangles[i + 2]]);
  }
  const kind = b.kind;
  for (const [s0, len] of loops) {
    let arc = 0;
    for (let i = 0; i < len; i++) {
      const j = (i + 1) % len;
      const p = pts[s0 + i];
      const q = pts[s0 + j];
      const ni = edge[s0 + ((i + len - 1) % len)];
      const nj = edge[s0 + j];
      const ne = edge[s0 + i];
      const nStart = ni[0] * ne[0] + ni[1] * ne[1] > cosHard ? unit(ni[0] + ne[0], ni[1] + ne[1]) : ne;
      const nNext = ne[0] * nj[0] + ne[1] * nj[1] > cosHard ? unit(ne[0] + nj[0], ne[1] + nj[1]) : ne;
      const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (o.wallKind !== undefined) b.kind = o.wallKind;
      const a0 = b.vertex([p[0], yBot, p[1]], [nStart[0], 0, nStart[1]], arc, yBot);
      const a1 = b.vertex([p[0], yTop, p[1]], [nStart[0], 0, nStart[1]], arc, yTop);
      const c0 = b.vertex([q[0], yBot, q[1]], [nNext[0], 0, nNext[1]], arc + l, yBot);
      const c1 = b.vertex([q[0], yTop, q[1]], [nNext[0], 0, nNext[1]], arc + l, yTop);
      b.quad(a0, c0, c1, a1);
      if (c > 0) {
        b.kind = kind;
        for (const [sign, yEdge, yFace] of [[1, yTop, y1], ...(o.noBottom ? [] : [[-1, yBot, y0]])]) {
          const s = Math.SQRT1_2;
          const v0 = b.vertex([p[0], yEdge, p[1]], [nStart[0] * s, sign * s, nStart[1] * s], arc, yEdge);
          const v1 = b.vertex([p[0] + inset[s0 + i][0], yFace, p[1] + inset[s0 + i][1]], [nStart[0] * s, sign * s, nStart[1] * s], arc, yFace);
          const v2 = b.vertex([q[0], yEdge, q[1]], [nNext[0] * s, sign * s, nNext[1] * s], arc + l, yEdge);
          const v3 = b.vertex([q[0] + inset[s0 + j][0], yFace, q[1] + inset[s0 + j][1]], [nNext[0] * s, sign * s, nNext[1] * s], arc + l, yFace);
          b.quad(v0, v2, v3, v1);
        }
      }
      arc += l;
    }
  }
  b.kind = kind;
}
