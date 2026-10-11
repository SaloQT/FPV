import type { Vec3 } from '../../contracts';
import { basisQuat, cross, rotate, unit } from './math';
import { Parts } from './parts';
import {
  circlePolygon, layerObstacles, PAVING_COLOR, PAVING_CHORD_ERROR, PARK_GRADE, pathJoinPads, PAVING_RISE, PAVING_SLIVER, PAVING_TOP, pavementArea, pavementRectangle, pavementWidth, PlanIndex, subtractPavement,
  type Point2,
} from './surfaces';
import type { PartInterface } from './construction';
import type { ParkData, ParkPart } from './types';

export { heightRange, pavementFootprint } from './surfaces';
export { PAVING_CHORD_ERROR, pavementArea, pavementRectangle, subtractPavement };
export type { Point2 };

/** Circumscription retains every point of the authored disk; edge midpoints are tangent to its circle. */
export function pavementCircle(part: ParkPart): Point2[] {
  return circlePolygon([part.pos[0], part.pos[2]], part.half[0], true);
}

/** What a triangular paving prism copies from the slab it replaces. */
type PavingStyle = Pick<ParkPart, 'color' | 'roughness' | 'metalness' | 'category'>;

/** One isosceles gable prism: the base runs from `p` to `q`, the apex is the point opposite it. */
type Gable = [Point2, Point2, Point2];

/** A triangle as the fewest isosceles triangles that exactly tile it: itself when it is isosceles; two when it is right (the
 * midpoint of the hypotenuse is as far from all three corners); three when it is acute (the circumcentre is as far from all
 * three corners and lies inside); otherwise the two right triangles either side of the longest edge's altitude, split again. */
export function gableTriangles(points: [Point2, Point2, Point2]): Gable[] {
  let edge = 0, longest = 0;
  for (let i = 0; i < 3; i++) { const a = points[i], c = points[(i + 1) % 3], d = (a[0] - c[0]) ** 2 + (a[1] - c[1]) ** 2; if (d > longest) { longest = d; edge = i; } }
  if (longest < 1e-12 || pavementWidth(points) < PAVING_SLIVER) return [];
  const a = points[edge], c = points[(edge + 1) % 3], peak = points[(edge + 2) % 3], t = ((peak[0] - a[0]) * (c[0] - a[0]) + (peak[1] - a[1]) * (c[1] - a[1])) / longest;
  const foot: Point2 = [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t], result: Gable[] = [];
  const triangle = (p: Point2, q: Point2, apex: Point2) => {
    if (pavementWidth([p, q, apex]) >= PAVING_SLIVER) result.push([p, q, apex]);
  };
  for (let i = 0; i < 3; i++) {
    const p = points[i], q = points[(i + 1) % 3], apex = points[(i + 2) % 3], d0 = (apex[0] - p[0]) ** 2 + (apex[1] - p[1]) ** 2, d1 = (apex[0] - q[0]) ** 2 + (apex[1] - q[1]) ** 2;
    if (Math.abs(d0 - d1) <= 1e-9 * Math.max(1, d0, d1)) { triangle(p, q, apex); return result; }
  }
  for (let i = 0; i < 3; i++) {
    const corner = points[i], p = points[(i + 1) % 3], q = points[(i + 2) % 3];
    const ax = p[0] - corner[0], az = p[1] - corner[1], bx = q[0] - corner[0], bz = q[1] - corner[1];
    if (Math.abs(ax * bx + az * bz) <= 1e-10 * Math.max(1, Math.hypot(ax, az) * Math.hypot(bx, bz))) {
      const midpoint: Point2 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      triangle(p, corner, midpoint); triangle(corner, q, midpoint); return result;
    }
  }
  // Acute: every angle is under 90 degrees, so the circumcentre lies inside. Three prisms instead of four.
  const [p0, p1, p2] = points, d = 2 * (p0[0] * (p1[1] - p2[1]) + p1[0] * (p2[1] - p0[1]) + p2[0] * (p0[1] - p1[1]));
  const acute = [0, 1, 2].every(i => { const o = points[i], u = points[(i + 1) % 3], w = points[(i + 2) % 3]; return (u[0] - o[0]) * (w[0] - o[0]) + (u[1] - o[1]) * (w[1] - o[1]) > 0; });
  if (acute && Math.abs(d) > 1e-12) {
    const s0 = p0[0] ** 2 + p0[1] ** 2, s1 = p1[0] ** 2 + p1[1] ** 2, s2 = p2[0] ** 2 + p2[1] ** 2;
    const centre: Point2 = [(s0 * (p1[1] - p2[1]) + s1 * (p2[1] - p0[1]) + s2 * (p0[1] - p1[1])) / d, (s0 * (p2[0] - p1[0]) + s1 * (p0[0] - p2[0]) + s2 * (p1[0] - p0[0])) / d];
    for (let i = 0; i < 3; i++) triangle(points[i], points[(i + 1) % 3], centre);
    return result;
  }
  for (const end of [a, c]) {
    const midpoint: Point2 = [(end[0] + peak[0]) / 2, (end[1] + peak[1]) / 2];
    triangle(end, foot, midpoint); triangle(foot, peak, midpoint);
  }
  return result;
}

/** An arbitrary triangle is split into the fewest exact isosceles gable prisms. */
export function pavementTriangle(b: Parts, points: [Point2, Point2, Point2], style: PavingStyle): ParkPart[] {
  return gableTriangles(points).map(([p, q, apex]) => {
    const mid: Point2 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], base = Math.hypot(q[0] - p[0], q[1] - p[1]), height = Math.hypot(apex[0] - mid[0], apex[1] - mid[1]);
    const right = unit([q[0] - p[0], 0, q[1] - p[1]]), up = unit([apex[0] - mid[0], 0, apex[1] - mid[1]]), back = cross(right, up);
    return b.part('gable', [(mid[0] + apex[0]) / 2, PARK_GRADE + PAVING_RISE / 2, (mid[1] + apex[1]) / 2], [base / 2, height / 2, PAVING_RISE / 2], style.color,
      { rot: basisQuat(right, up, back), surface: 'paving', roughness: style.roughness, metalness: style.metalness, category: style.category });
  });
}

/** Triangulation of a convex polygon that needs the fewest gable prisms. Fans from each corner are far from optimal: a
 * trapezoid cut as a fan can cost twice what its better diagonal does. */
export function pavementTriangulation(polygon: Point2[]): [Point2, Point2, Point2][] {
  const n = polygon.length;
  if (n < 3) return [];
  if (n === 3 || n > 16) return Array.from({ length: n - 2 }, (_, i): [Point2, Point2, Point2] => [polygon[0], polygon[i + 1], polygon[i + 2]]);
  const cost = (i: number, k: number, j: number) => gableTriangles([polygon[i], polygon[k], polygon[j]]).length;
  const best: number[][] = Array.from({ length: n }, () => new Array(n).fill(0)), split: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let width = 2; width < n; width++) for (let i = 0; i + width < n; i++) {
    const j = i + width; best[i][j] = Infinity;
    for (let k = i + 1; k < j; k++) { const total = best[i][k] + best[k][j] + cost(i, k, j); if (total < best[i][j]) { best[i][j] = total; split[i][j] = k; } }
  }
  const out: [Point2, Point2, Point2][] = [];
  const walk = (i: number, j: number) => { if (j - i < 2) return; const k = split[i][j]; out.push([polygon[i], polygon[k], polygon[j]]); walk(i, k); walk(k, j); };
  walk(0, n - 1);
  return out;
}

/** Disjoint coplanar pavement for raster, collision and RT. Apron boundaries share the explicit chord bound.
 * Besides the placed slabs it lays a round pad on every node where paths meet at an angle, and leaves out the footprint of
 * everything that stands through the paving layer (ride masts, decks, steps), so paving never overlaps another solid. */
export function unionPublicPaving(park: ParkData): void {
  // Ride/building finishes own shared areas before paths; stable source order resolves overlaps within each class.
  const slabs = park.parts.filter(p => p.body < 0 && (p.shape === 'box' || p.shape === 'cylinder') && p.surface === 'paving' && p.solid && Math.abs(p.pos[1] + p.half[1] - PAVING_TOP) < 1e-7)
    .sort((a, b) => Number(a.category === 'path') - Number(b.category === 'path'));
  const pathStyle: PavingStyle = { color: PAVING_COLOR, roughness: 0.95, metalness: 0, category: 'path' };
  const pads = pathJoinPads(park);
  /** A paving shape to lay. Discs (aprons) and join pads carry their centre and are laid one sector at a time. */
  interface Source { part: ParkPart | null; style: PavingStyle; polygon: Point2[]; sectors: Point2[][] | null }
  const fan = (centre: Point2, rim: Point2[], close: boolean) => rim.slice(0, close ? rim.length : rim.length - 1).map((v, k): Point2[] => [centre, v, rim[(k + 1) % rim.length]]);
  const sources: Source[] = [
    ...slabs.map((part): Source => {
      const polygon = part.shape === 'cylinder' ? pavementCircle(part) : pavementRectangle(part);
      return { part, style: part, polygon, sectors: part.shape === 'cylinder' ? fan([part.pos[0], part.pos[2]], polygon, true) : null };
    }),
    ...pads.map((pad): Source => ({ part: null, style: pathStyle, polygon: pad.outline, sectors: fan(pad.outline[0], pad.rim, false) })),
  ];
  const index = new PlanIndex();
  for (const source of sources) index.add(source.polygon);
  const first = sources.length;
  for (const outline of layerObstacles(park)) index.add(outline);
  const b = new Parts(park, [0, 0, 0], 0, -1, 'path');
  const lay = (p: Point2[], style: PavingStyle) => {
    if (p.length === 4) {
      const dx = p[1][0] - p[0][0], dz = p[1][1] - p[0][1], ex = p[2][0] - p[1][0], ez = p[2][1] - p[1][1];
      const orthogonal = Math.abs(dx * ex + dz * ez) <= 1e-8 * Math.max(1, Math.hypot(dx, dz) * Math.hypot(ex, ez));
      const parallelogram = Math.hypot(p[0][0] + p[2][0] - p[1][0] - p[3][0], p[0][1] + p[2][1] - p[1][1] - p[3][1]) < 1e-7;
      if (orthogonal && parallelogram) {
        const right = unit([dx, 0, dz]), up: Vec3 = [0, 1, 0];
        b.box([(p[0][0] + p[2][0]) / 2, PARK_GRADE + PAVING_RISE / 2, (p[0][1] + p[2][1]) / 2], [Math.hypot(dx, dz) / 2, PAVING_RISE / 2, Math.hypot(ex, ez) / 2], style.color,
          { rot: basisQuat(right, up, cross(right, up)), surface: 'paving', roughness: style.roughness, metalness: style.metalness, category: style.category });
        return;
      }
    }
    for (const triangle of pavementTriangulation(p)) pavementTriangle(b, triangle, style);
  };
  // Declared interfaces (a mast foot cast into a pad, a column set into a landing) name the slab they were built against.
  // When the slab is replaced, every piece laid in its place takes over the interface, so the declaration still covers the
  // paving the member really touches.
  const declared = new Map<number, PartInterface[]>(), slabIndex = new Map<ParkPart, number>();
  for (const c of park.interfaces ?? []) for (const side of [c.a, c.b]) (declared.get(side) ?? declared.set(side, []).get(side)!).push(c);
  const slabSet = new Set(slabs);
  if (declared.size) park.parts.forEach((p, k) => { if (slabSet.has(p) && declared.has(k)) slabIndex.set(p, k); });
  const inherit = (slab: ParkPart, from: number) => {
    const slabAt = slabIndex.get(slab); if (slabAt === undefined) return;
    for (const c of declared.get(slabAt)!) {
      const other = park.parts[c.a === slabAt ? c.b : c.a], reach = Math.hypot(...other.half);
      for (let k = from; k < park.parts.length; k++) {
        const piece = park.parts[k];
        if (Math.hypot(piece.pos[0] - other.pos[0], piece.pos[1] - other.pos[1], piece.pos[2] - other.pos[2]) > Math.hypot(...piece.half) + reach) continue;
        (park.interfaces ??= []).push({ ...c, a: c.a === slabAt ? k : c.a, b: c.b === slabAt ? k : c.b });
      }
    }
  };
  for (let i = 0; i < first; i++) {
    const { part, style, polygon, sectors } = sources[i];
    // A disc is cut sector by sector: a sector no neighbour or footing touches stays one whole prism (one isosceles
    // triangle each, with exactly shared radial seams) instead of being re-cut with the rest of the disc.
    const subjects = sectors ?? [polygon];
    const cutters = new Set(index.near(PlanIndex.boxOf(polygon)).filter(j => j !== i && (j >= first || j < i)));
    const results = subjects.map(subject => {
      let pieces = [subject];
      for (const j of index.near(PlanIndex.boxOf(subject))) {
        if (!cutters.has(j)) continue;
        pieces = pieces.flatMap(p => subtractPavement(p, index.polygons[j])); if (!pieces.length) break;
      }
      const intact = Math.abs(pieces.reduce((sum, p) => sum + pavementArea(p), 0) - pavementArea(subject)) < 1e-7;
      return { subject, pieces, intact };
    });
    if (part && !sectors && results[0].intact) continue;
    // Keep indices stable for construction-joint ledgers. Hidden source slabs no longer collide or render.
    if (part) { part.render = false; part.solid = false; }
    const laidFrom = park.parts.length;
    for (const { subject, pieces, intact } of results) {
      if (intact && sectors) pavementTriangle(b, [subject[0], subject[1], subject[2]], style);
      else for (const p of pieces) lay(p, style);
    }
    if (part) inherit(part, laidFrom);
  }
}
