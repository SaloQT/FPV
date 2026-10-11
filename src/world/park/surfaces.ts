import type { Vec3 } from '../../contracts';
import { axisAngle, inverseRotate, rotate } from './math';
import { CONCRETE, Parts, type PartOptions } from './parts';
import type { ParkData, ParkPart } from './types';

/** All public contact geometry is built from this finished level, including ride aprons and shoes. */
export const PARK_GRADE = 12;
export const PAVING_RISE = 0.2;
export const PAVING_TOP = PARK_GRADE + PAVING_RISE;
export const PAVING_COLOR: Vec3 = [0.3, 0.29, 0.26];
export const KERB_WIDTH = 0.24;
export const KERB_RISE = 0.05;
/** Longest single kerb unit, metres; longer runs are cut into equal units. */
export const KERB_UNIT = 12;
/** A kerb offcut shorter than this is left out; it would read as a stray stub. */
export const KERB_MIN_LENGTH = 0.1;
/** Overlaps and gaps smaller than this are rounding, not geometry, when kerbs are fitted against paving, metres. */
const KERB_FIT = 1e-9;

export type Point2 = [number, number];
/** Largest distance a polygon outline may stray from the circle it stands for, metres. */
export const PAVING_CHORD_ERROR = 0.01;
/** Paving offcuts thinner than this are left out: they come from two edges that nearly coincide, and no foot or wheel can tell them apart, metres. */
export const PAVING_SLIVER = 1e-3;

/** A slab referenced to world contact planes, not to a caller's unrelated local origin height. */
export function surfaceBox(b: Parts, center: [number, number], half: [number, number], color: Vec3 = PAVING_COLOR, options: PartOptions = {}): ParkPart {
  return b.box([center[0], (PARK_GRADE + PAVING_TOP) / 2 - b.origin[1], center[1]], [half[0], PAVING_RISE / 2, half[1]], color,
    { metalness: 0, roughness: 0.95, surface: 'paving', ...options });
}

/** Exact butt joints between short slabs retain local collision bounds without overlap offsets. */
export function surfaceStrip(b: Parts, a: Vec3, c: Vec3, width: number, color: Vec3 = PAVING_COLOR): ParkPart[] {
  const length = Math.hypot(c[0] - a[0], c[2] - a[2]); if (length < 1e-8) return [];
  const count = Math.ceil(length / 12), yaw = Math.atan2(c[0] - a[0], c[2] - a[2]), result: ParkPart[] = [];
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    result.push(surfaceBox(b, [a[0] + (c[0] - a[0]) * t, a[2] + (c[2] - a[2]) * t], [width / 2, length / count / 2], color, { localRot: axisAngle([0, 1, 0], yaw) }));
  }
  return result;
}

/** Exact segment intervals inside horizontal slabs, including apron disks. */
export function pavedInterval(a: Vec3, c: Vec3, part: ParkPart, margin = 0): [number, number] | null {
  const p = inverseRotate(part.rot, [a[0] - part.pos[0], 0, a[2] - part.pos[2]]), q = inverseRotate(part.rot, [c[0] - part.pos[0], 0, c[2] - part.pos[2]]);
  const dx = q[0] - p[0], dz = q[2] - p[2];
  if (part.shape === 'cylinder') {
    const radius = part.half[0] + margin, aa = dx * dx + dz * dz, bb = 2 * (p[0] * dx + p[2] * dz), cc = p[0] ** 2 + p[2] ** 2 - radius ** 2;
    if (aa < 1e-14) return cc <= 0 ? [0, 1] : null;
    const discriminant = bb * bb - 4 * aa * cc; if (discriminant < 0) return null;
    const root = Math.sqrt(discriminant), lo = Math.max(0, (-bb - root) / (2 * aa)), hi = Math.min(1, (-bb + root) / (2 * aa));
    return hi > lo ? [lo, hi] : null;
  }
  if (part.shape !== 'box') return null;
  let lo = 0, hi = 1;
  for (const k of [0, 2]) {
    const d = q[k] - p[k], half = part.half[k] + margin;
    if (Math.abs(d) < 1e-12) { if (Math.abs(p[k]) > half) return null; continue; }
    const t0 = (-half - p[k]) / d, t1 = (half - p[k]) / d;
    lo = Math.max(lo, Math.min(t0, t1)); hi = Math.min(hi, Math.max(t0, t1)); if (hi <= lo) return null;
  }
  return [lo, hi];
}

export function uncoveredIntervals(blocked: [number, number][]): [number, number][] {
  const result: [number, number][] = []; let end = 0;
  for (const [lo, hi] of blocked.sort((a, b) => a[0] - b[0])) {
    if (lo > end + 1e-8) result.push([end, lo]); end = Math.max(end, hi);
  }
  if (end < 1 - 1e-8) result.push([end, 1]); return result;
}

// Plan-view geometry shared by the paving union and the kerbs. Polygons are convex, as lists of [x, z] points.

const signedArea = (p: Point2[]) => p.reduce((sum, a, i) => { const b = p[(i + 1) % p.length]; return sum + a[0] * b[1] - b[0] * a[1]; }, 0) / 2;
export const pavementArea = (p: Point2[]) => Math.abs(signedArea(p));
const cross2 = (a: Point2, b: Point2, p: Point2) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);

/** The part of a polygon on one side of the line a to b: the left side when `inside`, the right side otherwise. */
export function halfPlane(polygon: Point2[], a: Point2, b: Point2, inside: boolean): Point2[] {
  const result: Point2[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i], q = polygon[(i + 1) % polygon.length], dp = cross2(a, b, p) * (inside ? 1 : -1), dq = cross2(a, b, q) * (inside ? 1 : -1);
    if (dp >= -1e-9) result.push(p);
    if ((dp > 1e-9 && dq < -1e-9) || (dp < -1e-9 && dq > 1e-9)) { const t = dp / (dp - dq); result.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
  }
  return result.filter((p, i) => i === 0 || Math.hypot(p[0] - result[i - 1][0], p[1] - result[i - 1][1]) > 1e-8);
}

/** Whether two convex polygons share area; touching along an edge or at a corner does not count. */
export function polygonsOverlap(a: Point2[], b: Point2[]): boolean {
  for (const polygon of [a, b]) for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i], q = polygon[(i + 1) % polygon.length], length = Math.hypot(q[0] - p[0], q[1] - p[1]); if (length < 1e-12) continue;
    const nx = (q[1] - p[1]) / length, nz = (p[0] - q[0]) / length;
    let loA = Infinity, hiA = -Infinity, loB = Infinity, hiB = -Infinity;
    for (const v of a) { const d = v[0] * nx + v[1] * nz; loA = Math.min(loA, d); hiA = Math.max(hiA, d); }
    for (const v of b) { const d = v[0] * nx + v[1] * nz; loB = Math.min(loB, d); hiB = Math.max(hiB, d); }
    if (hiA <= loB + 1e-9 || hiB <= loA + 1e-9) return false;
  }
  return true;
}

/** Narrowest width of a convex polygon: the smallest, over its edges, of how far the polygon reaches from that edge. */
export function pavementWidth(polygon: Point2[]): number {
  let width = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length], length = Math.hypot(b[0] - a[0], b[1] - a[1]); if (length < 1e-12) continue;
    width = Math.min(width, Math.max(...polygon.map(p => Math.abs(cross2(a, b, p)))) / length);
  }
  return width;
}

/** The polygon without corners that lie on the straight line between their neighbours. */
function withoutStraightCorners(polygon: Point2[]): Point2[] {
  return polygon.filter((v, i) => Math.abs(cross2(polygon[(i + polygon.length - 1) % polygon.length], v, polygon[(i + 1) % polygon.length])) > 1e-9);
}

/** Joins two counter-clockwise convex polygons that share a whole edge when the result is still convex; otherwise null. */
function mergeConvex(a: Point2[], b: Point2[]): Point2[] | null {
  const same = (p: Point2, q: Point2) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-7;
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) {
    if (!same(a[i], b[(j + 1) % b.length]) || !same(a[(i + 1) % a.length], b[j])) continue;
    // Walk all of `a` starting just after the shared edge, then `b` without the two shared corners.
    const merged: Point2[] = [];
    for (let k = 1; k <= a.length; k++) merged.push(a[(i + k) % a.length]);
    for (let k = 2; k < b.length; k++) merged.push(b[(j + k) % b.length]);
    const outline = withoutStraightCorners(merged);
    if (outline.length >= 3 && outline.every((v, k) => cross2(outline[k], outline[(k + 1) % outline.length], outline[(k + 2) % outline.length]) >= -1e-9)) return outline;
    return null;
  }
  return null;
}

/** Convex difference as disjoint convex fragments; unlike visual offsets it preserves exact area. A cutter that does
 * not reach the subject leaves it whole, since cutting would only slice it along the cutter's edge lines. Cutting by
 * every edge in turn can leave a region in several slices that together are one convex shape; those are joined again. */
export function subtractPavement(subject: Point2[], cutter: Point2[]): Point2[][] {
  const clip = signedArea(cutter) < 0 ? [...cutter].reverse() : cutter;
  let remaining = signedArea(subject) < 0 ? [...subject].reverse() : subject;
  if (!polygonsOverlap(remaining, clip)) return [remaining];
  let result: Point2[][] = [];
  for (let i = 0; i < clip.length && remaining.length >= 3; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length], outside = halfPlane(remaining, a, b, false);
    if (outside.length >= 3 && pavementArea(outside) > 1e-7 && pavementWidth(outside) >= PAVING_SLIVER) result.push(withoutStraightCorners(outside));
    remaining = halfPlane(remaining, a, b, true);
  }
  for (let again = result.length > 1; again;) {
    again = false;
    for (let i = 0; i < result.length && !again; i++) for (let j = i + 1; j < result.length && !again; j++) {
      const merged = mergeConvex(result[i], result[j]);
      if (merged) { result = result.filter((_, k) => k !== i && k !== j); result.push(merged); again = true; }
    }
  }
  return result;
}

export function pavementRectangle(part: ParkPart): Point2[] {
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]) => {
    const v = rotate(part.rot, [x * part.half[0], 0, z * part.half[2]]); return [part.pos[0] + v[0], part.pos[2] + v[2]];
  });
}

/** Smallest convex polygon around the points, counter-clockwise; fewer than three distinct points give none. */
export function convexHull(points: Point2[]): Point2[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const half = (list: Point2[]) => {
    const out: Point2[] = [];
    for (const p of list) { while (out.length >= 2 && cross2(out[out.length - 2], out[out.length - 1], p) <= 1e-12) out.pop(); out.push(p); }
    out.pop(); return out;
  };
  const hull = [...half(sorted), ...half([...sorted].reverse())];
  return hull.length >= 3 ? hull : [];
}

/** A regular polygon standing for a circle. `around` encloses the whole circle (edges tangent to it, corners up to `error`
 * outside); otherwise the corners lie on the circle and the edges fall at most `error` inside it. */
export function circlePolygon(centre: Point2, radius: number, around: boolean, error = PAVING_CHORD_ERROR): Point2[] {
  const ratio = around ? radius / (radius + error) : 1 - error / radius;
  const sides = Math.max(8, ratio > 0 && ratio < 1 ? Math.ceil(Math.PI / Math.acos(ratio) / 4) * 4 : 8);
  const vertexRadius = around ? radius / Math.cos(Math.PI / sides) : radius, turn = around ? Math.PI / sides : 0;
  return Array.from({ length: sides }, (_, i): Point2 => {
    const angle = (2 * i) * Math.PI / sides + turn;
    return [centre[0] + vertexRadius * Math.cos(angle), centre[1] + vertexRadius * Math.sin(angle)];
  });
}

/** Polygons looked up by area, on a coarse grid. */
export class PlanIndex {
  readonly polygons: Point2[][] = [];
  private readonly boxes: number[][] = [];
  private readonly cells = new Map<string, number[]>();
  constructor(private readonly cell = 24) {}
  private cellsOf(box: number[]): string[] {
    const out: string[] = [];
    for (let x = Math.floor(box[0] / this.cell); x <= Math.floor(box[2] / this.cell); x++) for (let z = Math.floor(box[1] / this.cell); z <= Math.floor(box[3] / this.cell); z++) out.push(`${x},${z}`);
    return out;
  }
  static boxOf(polygon: Point2[]): number[] {
    return [Math.min(...polygon.map(v => v[0])), Math.min(...polygon.map(v => v[1])), Math.max(...polygon.map(v => v[0])), Math.max(...polygon.map(v => v[1]))];
  }
  add(polygon: Point2[]): number {
    const index = this.polygons.length, box = PlanIndex.boxOf(polygon);
    this.polygons.push(polygon); this.boxes.push(box);
    for (const key of this.cellsOf(box)) { const list = this.cells.get(key) ?? []; list.push(index); this.cells.set(key, list); }
    return index;
  }
  /** Indices of polygons whose bounding boxes properly overlap the given box, in the order they were added. */
  near(box: number[]): number[] {
    const found = new Set<number>();
    for (const key of this.cellsOf(box)) for (const index of this.cells.get(key) ?? []) {
      const other = this.boxes[index];
      if (box[0] < other[2] - 1e-7 && box[2] > other[0] + 1e-7 && box[1] < other[3] - 1e-7 && box[3] > other[1] + 1e-7) found.add(index);
    }
    return [...found].sort((a, b) => a - b);
  }
}

/** The fill where public paths meet at a node: `outline` is the paving to lay (the node, then the rim) and `rim` the curved edge. */
export interface JoinPad { outline: Point2[]; rim: Point2[] }

/** Round pads where public paths meet. Straight strips that end on a node leave a wedge-shaped notch on the outside of a
 * turn, and a node with a dead end or a spur leaves a larger one. Each gap between two neighbouring paths that opens wider
 * than a straight line is filled with a sector of a disc whose radius is half the widest path there, bounded by the end
 * faces of the two strips and rounded by the rim. Gaps narrower than a straight line are already covered by the strips. */
export function pathJoinPads(park: ParkData): JoinPad[] {
  const arms = new Map<number, { angle: number; half: number }[]>();
  for (const path of park.paths) {
    const a = park.nodes[path.a].pos, c = park.nodes[path.b].pos, length = Math.hypot(c[0] - a[0], c[2] - a[2]); if (length < 1e-8) continue;
    const angle = Math.atan2(c[2] - a[2], c[0] - a[0]);
    for (const [id, direction] of [[path.a, angle], [path.b, angle + Math.PI]]) (arms.get(id) ?? arms.set(id, []).get(id)!).push({ angle: ((direction % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), half: path.width / 2 });
  }
  const pads: JoinPad[] = [];
  for (const [id, list] of arms) {
    if (list.length < 2) continue;
    list.sort((p, q) => p.angle - q.angle);
    const radius = Math.max(...list.map(arm => arm.half)), step = 2 * Math.acos(1 - PAVING_CHORD_ERROR / radius), centre: Point2 = [park.nodes[id].pos[0], park.nodes[id].pos[2]];
    for (let k = 0; k < list.length; k++) {
      const next = list[(k + 1) % list.length], gap = k + 1 < list.length ? next.angle - list[k].angle : next.angle + 2 * Math.PI - list[k].angle;
      if (gap - Math.PI < 1e-4) continue;
      const from = list[k].angle + Math.PI / 2, span = gap - Math.PI, count = Math.ceil(span / step);
      const rim = Array.from({ length: count + 1 }, (_, i): Point2 => [centre[0] + radius * Math.cos(from + span * i / count), centre[1] + radius * Math.sin(from + span * i / count)]);
      pads.push({ outline: [centre, ...rim], rim });
    }
  }
  return pads;
}

/** Anything this much or less inside the paving layer only touches it, as in the construction audit, metres. */
export const CONTACT = 5e-4;

/** Lowest and highest point of a part (a box around it, so a cone or a gable may be a little shorter). */
export function heightRange(part: ParkPart): [number, number] {
  const h = part.half, vertical = (local: Vec3) => rotate(part.rot, local)[1];
  const reach = part.shape === 'sphere' ? Math.max(...h)
    : part.shape === 'cylinder' || part.shape === 'cone' ? Math.abs(vertical([0, h[1], 0])) + h[0] * Math.sqrt(Math.max(0, 1 - (vertical([0, h[1], 0]) / h[1]) ** 2))
    : Math.abs(vertical([h[0], 0, 0])) + Math.abs(vertical([0, h[1], 0])) + Math.abs(vertical([0, 0, h[2]]));
  return [part.pos[1] - reach, part.pos[1] + reach];
}

/** Outline, seen from above, of the part of a rendered part that lies inside the paving layer; null when it stays clear of
 * the layer (standing on top of it, hanging above it, or only touching). Cylinders, cones and spheres are enclosed by a
 * polygon, so the hole left in the paving never clips them. */
export function pavementFootprint(part: ParkPart): Point2[] | null {
  const bottom = PARK_GRADE, top = PAVING_TOP, h = part.half;
  const world = (local: Vec3): Vec3 => { const v = rotate(part.rot, local); return [part.pos[0] + v[0], part.pos[1] + v[1], part.pos[2] + v[2]]; };
  /** Outline of the corner points of a convex solid, including where its edges cross the layer's two planes. */
  const hull = (corners: Vec3[], edges: [number, number][]): Point2[] | null => {
    if (Math.min(...corners.map(p => p[1])) >= top - CONTACT || Math.max(...corners.map(p => p[1])) <= bottom + CONTACT) return null;
    const points: Point2[] = corners.filter(p => p[1] >= bottom && p[1] <= top).map((p): Point2 => [p[0], p[2]]);
    for (const [i, j] of edges) {
      const p = corners[i], q = corners[j];
      for (const plane of [bottom, top]) if ((p[1] - plane) * (q[1] - plane) < 0) { const t = (plane - p[1]) / (q[1] - p[1]); points.push([p[0] + (q[0] - p[0]) * t, p[2] + (q[2] - p[2]) * t]); }
    }
    const outline = convexHull(points); return outline.length ? outline : null;
  };
  if (part.shape === 'box') {
    const corners: Vec3[] = [], edges: [number, number][] = [];
    for (let i = 0; i < 8; i++) corners.push(world([(i & 1 ? 1 : -1) * h[0], (i & 2 ? 1 : -1) * h[1], (i & 4 ? 1 : -1) * h[2]]));
    for (let i = 0; i < 8; i++) for (const bit of [1, 2, 4]) if (!(i & bit)) edges.push([i, i | bit]);
    return hull(corners, edges);
  }
  if (part.shape === 'gable') {
    const corners: Vec3[] = [];
    for (const z of [-1, 1]) for (const [x, y] of [[-h[0], -h[1]], [h[0], -h[1]], [0, h[1]]]) corners.push(world([x, y, z * h[2]]));
    return hull(corners, [[0, 1], [1, 2], [2, 0], [3, 4], [4, 5], [5, 3], [0, 3], [1, 4], [2, 5]]);
  }
  if (part.shape === 'sphere') {
    // The widest slice of the (enclosing) sphere inside the layer is the one nearest its centre.
    const radius = Math.max(...h), gap = Math.max(0, bottom - part.pos[1], part.pos[1] - top);
    if (part.pos[1] - radius >= top - CONTACT || part.pos[1] + radius <= bottom + CONTACT) return null;
    return circlePolygon([part.pos[0], part.pos[2]], Math.sqrt(radius * radius - gap * gap), true);
  }
  // Cylinder and cone: a disc swept along the axis. The caps tilt with the axis, so the layer reaches `lean` past the axis ends.
  const axis = rotate(part.rot, [0, h[1], 0]), radius = h[0], lean = radius * Math.sqrt(Math.max(0, 1 - (axis[1] / h[1]) ** 2));
  if (part.pos[1] - Math.abs(axis[1]) - lean >= top - CONTACT || part.pos[1] + Math.abs(axis[1]) + lean <= bottom + CONTACT) return null;
  const ends: Point2[] = [], reach = (plane: number): number => axis[1] === 0 ? 0 : (plane - part.pos[1]) / axis[1];
  // Parameter along the axis (-1 to 1) of the lowest and highest point of it inside the layer, widened by the cap lean.
  const lowT = Math.max(-1, Math.min(1, axis[1] === 0 ? -1 : Math.min(reach(bottom - lean), reach(top + lean)))), highT = Math.max(-1, Math.min(1, axis[1] === 0 ? 1 : Math.max(reach(bottom - lean), reach(top + lean))));
  for (const t of [lowT, highT]) ends.push([part.pos[0] + axis[0] * t, part.pos[2] + axis[2] * t]);
  const discs = ends.map(e => circlePolygon(e, radius, true));
  return Math.hypot(ends[0][0] - ends[1][0], ends[0][1] - ends[1][1]) < 1e-9 ? discs[0] : convexHull(discs.flat());
}

/** Kerb units placed by `buildPublicKerbs`, so later passes can tell them from structure standing on the paving. */
const kerbParts = new WeakSet<ParkPart>();
export const isPublicKerb = (part: ParkPart) => kerbParts.has(part);

/** Outlines, seen from above, of everything that stands on the ground and rises through the paving layer (a mast footing, a
 * lamp base, a deck slab, a wall). Paving and kerbs both leave these out. A part that only begins partway up the layer was
 * set too low, and a thin plate that never reaches the top lies under the paving; neither is hidden by a hole, so the
 * construction audit still reports them for their builders. */
export function layerObstacles(park: ParkData): Point2[][] {
  const outlines: Point2[][] = [];
  for (const part of park.parts) {
    if (part.body >= 0 || part.render === false || part.surface === 'paving' || kerbParts.has(part)) continue;
    const [low, high] = heightRange(part); if (low > PARK_GRADE + CONTACT || high < PAVING_TOP - CONTACT) continue;
    const outline = pavementFootprint(part); if (outline) outlines.push(outline);
  }
  return outlines;
}

/** The stretch of an edge's kerb band, as distances along the edge, that a convex polygon overlaps; null when it only touches. */
function bandOverlap(polygon: Point2[], origin: Point2, along: Point2, outward: Point2): [number, number] | null {
  const local = polygon.map((p): Point2 => [(p[0] - origin[0]) * along[0] + (p[1] - origin[1]) * along[1], (p[0] - origin[0]) * outward[0] + (p[1] - origin[1]) * outward[1]]);
  const band = halfPlane(halfPlane(local, [0, KERB_FIT], [1, KERB_FIT], true), [1, KERB_WIDTH - KERB_FIT], [0, KERB_WIDTH - KERB_FIT], true);
  if (band.length < 3 || pavementArea(band) < 1e-9) return null;
  return [Math.min(...band.map(p => p[0])), Math.max(...band.map(p => p[0]))];
}

/** Draw borders only after every forecourt/terrace exists. Each kerb runs along the exposed edge of the paving, on the outside,
 * and stops where another paving, a path pad or a kerb laid before it begins, so units butt against each other and never cross. */
export function buildPublicKerbs(park: ParkData): void {
  const paving = park.parts.filter(p => p.body < 0 && p.surface === 'paving' && Math.abs(p.pos[1] + p.half[1] - PAVING_TOP) < 1e-7);
  const index = new PlanIndex();
  for (const slab of paving) {
    if (slab.shape === 'cylinder') index.add(circlePolygon([slab.pos[0], slab.pos[2]], slab.half[0], true));
    else if (slab.shape === 'box') index.add(pavementRectangle(slab));
  }
  const pads = pathJoinPads(park);
  for (const pad of pads) index.add(pad.outline);
  for (const outline of layerObstacles(park)) index.add(outline);
  const b = new Parts(park, [0, 0, 0], 0, -1, 'path');
  /** Lay kerb units along the exposed length of one edge. `outward` is the unit direction away from the paving it borders. */
  const lay = (start: Point2, along: Point2, outward: Point2, length: number) => {
    if (length < KERB_MIN_LENGTH) return;
    const box = PlanIndex.boxOf([start, [start[0] + along[0] * length, start[1] + along[1] * length], [start[0] + outward[0] * KERB_WIDTH, start[1] + outward[1] * KERB_WIDTH], [start[0] + along[0] * length + outward[0] * KERB_WIDTH, start[1] + along[1] * length + outward[1] * KERB_WIDTH]]);
    const blocked: [number, number][] = [];
    for (const other of index.near(box)) { const span = bandOverlap(index.polygons[other], start, along, outward); if (span) blocked.push(span); }
    blocked.sort((x, y) => x[0] - y[0]);
    const free: [number, number][] = []; let end = 0;
    for (const [lo, hi] of blocked) { if (lo > end + 1e-8) free.push([end, Math.min(lo, length)]); end = Math.max(end, hi); if (end >= length) break; }
    if (end < length - 1e-8) free.push([end, length]);
    const yaw = Math.atan2(along[0], along[1]);
    for (const [lo, hi] of free) {
      if (hi - lo < KERB_MIN_LENGTH) continue;
      const count = Math.ceil((hi - lo) / KERB_UNIT), unit = (hi - lo) / count;
      for (let i = 0; i < count; i++) {
        const t0 = lo + unit * i, mid = t0 + unit / 2, offset = KERB_WIDTH / 2;
        const centre: Point2 = [start[0] + along[0] * mid + outward[0] * offset, start[1] + along[1] * mid + outward[1] * offset];
        kerbParts.add(b.box([centre[0], (PARK_GRADE + PAVING_TOP + KERB_RISE) / 2, centre[1]], [KERB_WIDTH / 2, (PAVING_RISE + KERB_RISE) / 2, unit / 2], CONCRETE,
          { metalness: 0, roughness: 0.85, surface: 'concrete', rot: axisAngle([0, 1, 0], yaw) }));
        const near: Point2 = [start[0] + along[0] * t0, start[1] + along[1] * t0], far: Point2 = [start[0] + along[0] * (t0 + unit), start[1] + along[1] * (t0 + unit)];
        index.add([near, far, [far[0] + outward[0] * KERB_WIDTH, far[1] + outward[1] * KERB_WIDTH], [near[0] + outward[0] * KERB_WIDTH, near[1] + outward[1] * KERB_WIDTH]]);
      }
    }
  };
  // The straight sides of every path come first, then the arcs of the pads, which fit around them.
  for (const path of park.paths) {
    const a = park.nodes[path.a].pos, c = park.nodes[path.b].pos, length = Math.hypot(c[0] - a[0], c[2] - a[2]); if (length < 1e-8) continue;
    const along: Point2 = [(c[0] - a[0]) / length, (c[2] - a[2]) / length];
    for (const side of [-1, 1]) {
      const outward: Point2 = [side * along[1], -side * along[0]];
      lay([a[0] + outward[0] * path.width / 2, a[2] + outward[1] * path.width / 2], along, outward, length);
    }
  }
  for (const pad of pads) {
    for (let i = 0; i + 1 < pad.rim.length; i++) {
      const from = pad.rim[i], to = pad.rim[i + 1], length = Math.hypot(to[0] - from[0], to[1] - from[1]);
      const along: Point2 = [(to[0] - from[0]) / length, (to[1] - from[1]) / length];
      lay(from, along, [along[1], -along[0]], length);
    }
  }
}
