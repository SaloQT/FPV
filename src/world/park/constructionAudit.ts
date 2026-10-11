import type { Vec3 } from '../../contracts';
import type { Monolith, PartInterface } from './construction';
import { containment, cylinderCaps, gjk, intrusion, maxOnCircle, signedDistance, solidBounds, solidOf, support, toWorld, truncate, type Solid } from './interference';
import { partRide, partSource } from './parts';
import { PARK_GRADE } from './surfaces';
import type { BodyPose, ParkData } from './types';

/** Geometric contact tolerance, metres. Below this, two surfaces are in contact rather than separated or
 * interpenetrating. It is set at 0.5 mm, under a pixel (0.97 px) at 0.6 m in a 1080p, 50 degree view, so a defect
 * it hides is not visible as a step. */
export const CONTACT_TOLERANCE = 5e-4;

/** Broad phase: median-split AABB tree over world solids; every candidate is then tested exactly. */
export function candidatePairs(bounds: Float64Array, count: number, margin: number, include: (i: number) => boolean): Int32Array {
  const tree = buildTree(bounds, count, include), out: number[] = [];
  for (const i of tree.items) queryTree(tree, bounds, i * 6, margin, j => { if (j > i) out.push(i, j); });
  return Int32Array.from(out);
}
interface Tree { items: number[]; order: Int32Array; nodes: { lo: number; hi: number; box: Float64Array; left: number; right: number }[] }
function buildTree(bounds: Float64Array, count: number, include: (i: number) => boolean): Tree {
  const items = Array.from({ length: count }, (_, i) => i).filter(include), order = Int32Array.from(items), nodes: Tree['nodes'] = [];
  const build = (lo: number, hi: number): number => {
    const box = new Float64Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
    for (let i = lo; i < hi; i++) { const o = order[i] * 6; for (let k = 0; k < 3; k++) { box[k] = Math.min(box[k], bounds[o + k]); box[3 + k] = Math.max(box[3 + k], bounds[o + 3 + k]); } }
    const id = nodes.length; nodes.push({ lo, hi, box, left: -1, right: -1 });
    if (hi - lo > 6) {
      const axis = [0, 1, 2].reduce((a, k) => box[3 + k] - box[k] > box[3 + a] - box[a] ? k : a, 0);
      const slice = Array.from(order.subarray(lo, hi)).sort((a, b) => bounds[a * 6 + axis] + bounds[a * 6 + 3 + axis] - bounds[b * 6 + axis] - bounds[b * 6 + 3 + axis]);
      order.set(slice, lo); const mid = (lo + hi) >>> 1;
      nodes[id].left = build(lo, mid); nodes[id].right = build(mid, hi);
    }
    return id;
  };
  if (order.length) build(0, order.length);
  return { items, order, nodes };
}
function queryTree(tree: Tree, box: Float64Array, o: number, margin: number, visit: (j: number) => void): void {
  if (!tree.nodes.length) return;
  const stack = [0];
  const apart = (b: Float64Array, p: number) => box[o] - margin > b[p + 3] || box[o + 3] + margin < b[p] || box[o + 1] - margin > b[p + 4] || box[o + 4] + margin < b[p + 1] || box[o + 2] - margin > b[p + 5] || box[o + 5] + margin < b[p + 2];
  while (stack.length) {
    const n = tree.nodes[stack.pop()!];
    if (apart(n.box, 0)) continue;
    if (n.left < 0) for (let k = n.lo; k < n.hi; k++) visit(tree.order[k]);
    else stack.push(n.left, n.right);
  }
}

export interface WorldScene { solids: Solid[]; bounds: Float64Array }
export function worldScene(park: ParkData, poses: readonly BodyPose[]): WorldScene {
  const solids = park.parts.map((part, i) => solidOf(part, i, part.body >= 0 ? poses[part.body] : undefined));
  const bounds = new Float64Array(solids.length * 6); solids.forEach((s, i) => solidBounds(s, bounds, i * 6));
  return { solids, bounds };
}

export type FindingKind = 'penetration' | 'protruding-end' | 'contract-violation' | 'chain-overlap' | 'floating' | 'coplanar-conflict' | 'degenerate-part' | 'exposed-end' | 'motion-interference';
export interface AuditView { name: string; time: number; part: number; dir: Vec3; distance: number; highlight: number[] }
export interface Finding {
  kind: FindingKind;
  /** `defect` fails validation; `note` is measured and reported but does not by itself fail. */
  severity: 'defect' | 'note';
  parts: number[];
  sources: string[];
  ride: number;
  family: string;
  /** Measured error in metres: penetration depth, protrusion, gap or component size. */
  measured: number;
  location: Vec3;
  time: number;
  detail: string;
  view: AuditView;
}
export interface AuditOptions {
  time?: number;
  tolerance?: number;
  /** Restrict to parts for which this returns true (the other side of a pair may be any part). */
  focus?: (part: number) => boolean;
  ground?: (x: number, z: number) => number;
  checks?: Partial<Record<'pairs' | 'ends' | 'support' | 'coplanar' | 'degenerate', boolean>>;
}
export interface AuditReport { findings: Finding[]; stats: Record<string, number>; insertions: { name: string; depth: number; protrusion: number }[] }

export function ownerRide(park: ParkData, part: number): number {
  const p = park.parts[part]; return p.body >= 0 ? park.bodies[p.body].ride : partRide(p);
}
function familyOf(park: ParkData, ride: number, part: number): string { return ride >= 0 ? park.rides[ride].family : park.parts[part].category ?? 'static'; }
/** Ride family for ride parts, otherwise the part's static category (building, path, service...). */
export function partFamily(park: ParkData, part: number): string { return familyOf(park, ownerRide(park, part), part); }

/** Lookup tables for declared interfaces and monoliths. */
export class Contracts {
  readonly byPair = new Map<string, PartInterface[]>();
  readonly byEnd = new Map<string, PartInterface[]>();
  readonly monolith = new Map<number, { piece: Monolith; index: number; order: number }>();
  /** Members declared to pass into each part, as shafts in its bore or ends inserted into it. Such a member
   * goes in through the part's surface, end faces included, so it may leave those faces pierced. */
  readonly entering = new Map<number, Set<number>>();
  constructor(readonly park: ParkData) {
    (park.monoliths ?? []).forEach((piece, index) => piece.parts.forEach((part, order) => this.monolith.set(part, { piece, index, order })));
    for (const c of park.interfaces ?? []) {
      const key = c.a < c.b ? `${c.a},${c.b}` : `${c.b},${c.a}`; (this.byPair.get(key) ?? this.byPair.set(key, []).get(key)!).push(c);
      if (c.kind === 'coaxial' || c.kind === 'insert') for (const a of this.receivers([c])) (this.entering.get(a) ?? this.entering.set(a, new Set()).get(a)!).add(c.b);
      if (c.kind === 'insert') { const end = `${c.b},${c.end}`; (this.byEnd.get(end) ?? this.byEnd.set(end, []).get(end)!).push(c); }
    }
  }
  /** Interfaces between two parts. A contract with a monolith's first part covers every piece of it,
   * so a wheel rolling along a bent rail meets whichever rail segment it is on. */
  pair(a: number, b: number): PartInterface[] {
    const get = (x: number, y: number) => this.byPair.get(x < y ? `${x},${y}` : `${y},${x}`) ?? [];
    const ra = this.monolith.get(a)?.piece.parts[0] ?? a, rb = this.monolith.get(b)?.piece.parts[0] ?? b;
    const found = get(a, b); if (ra === a && rb === b) return found;
    return [...found, ...(ra !== a ? get(ra, b) : []), ...(rb !== b ? get(a, rb) : [])];
  }
  /** Receiving parts of a member end. A receiver named by a monolith's first part means the whole piece
   * (a tie entering a bent rail meets whichever rail segment is there). */
  receivers(list: PartInterface[]): number[] {
    const out = new Set<number>();
    for (const c of list) { const piece = this.monolith.get(c.a); if (piece && piece.order === 0) for (const p of piece.piece.parts) out.add(p); else out.add(c.a); }
    return [...out];
  }
}

/** Section of a member at distance `along` from one end: the cap circle for rods, the end face's corners for boxes. */
function sectionInside(m: Solid, axis: 0 | 1 | 2, end: -1 | 1, along: number, field: (p: Vec3) => number): number {
  if (m.shape === 'cylinder' && axis === 1) {
    const center = toWorld(m, [0, end * (m.h[1] - along), 0]);
    return maxOnCircle(field, center, m.ax[0], m.ax[2], m.h[0]).upper;
  }
  if (m.shape === 'box') {
    const u = (axis + 1) % 3, w = (axis + 2) % 3; let max = -Infinity;
    for (const a of [-1, 1]) for (const b of [-1, 1]) { const l: Vec3 = [0, 0, 0]; l[axis] = end * (m.h[axis] - along); l[u] = a * m.h[u]; l[w] = b * m.h[w]; max = Math.max(max, field(toWorld(m, l))); }
    return max;
  }
  return Infinity;
}
/** Length of a member, measured from an inserted end, whose every section lies inside one receiver.
 * Receiver and member are convex, so the piece between two contained sections is contained; the
 * contained sections form one interval starting at the end, found by bisection. 0 when the end is not received. */
export function receivedLength(scene: WorldScene, member: number, end: -1 | 1, axis: 0 | 1 | 2, receivers: number[], tol: number): number {
  const m = scene.solids[member], full = 2 * m.h[axis];
  let best = 0;
  for (const r of receivers) {
    const field = (p: Vec3) => signedDistance(scene.solids[r], p);
    if (sectionInside(m, axis, end, 0, field) > tol) continue;
    if (sectionInside(m, axis, end, full, field) <= tol) return full;
    let lo = 0, hi = full;
    for (let i = 0; i < 24 && hi - lo > 1e-4; i++) { const mid = (lo + hi) / 2; if (sectionInside(m, axis, end, mid, field) <= tol) lo = mid; else hi = mid; }
    best = Math.max(best, lo);
  }
  return best;
}
const outsideCache = new WeakMap<WorldScene, Map<number, Solid | null>>();
/** The member with every declared, verified received length removed from its ends: the part a viewer can see. */
function exposedPart(scene: WorldScene, contracts: Contracts, i: number, tol: number): Solid | null {
  let cache = outsideCache.get(scene); if (!cache) outsideCache.set(scene, cache = new Map());
  if (cache.has(i)) return cache.get(i)!;
  let s: Solid | null = scene.solids[i];
  for (const end of [-1, 1] as const) {
    const list = contracts.byEnd.get(`${i},${end}`); if (!list || !s) continue;
    const axis = list[0].axis ?? 1, length = receivedLength(scene, i, end, axis, contracts.receivers(list), tol);
    if (length > 0) s = truncate(s, axis, end, length);
  }
  cache.set(i, s); return s;
}

/** End section of an inserted member: a cap circle for cylinders, or a box face's four corners. */
function endField(scene: WorldScene, receivers: number[]): (p: Vec3) => number {
  const solids = receivers.map(r => scene.solids[r]);
  return p => { let d = Infinity; for (const s of solids) d = Math.min(d, signedDistance(s, p)); return d; };
}
/** Maximum of the receivers' (union) signed distance over the member's end section: <= 0 means received. */
export function endProtrusion(scene: WorldScene, member: number, end: -1 | 1, axis: 0 | 1 | 2, receivers: number[]): { max: number; upper: number; at: Vec3 } {
  const m = scene.solids[member], field = endField(scene, receivers);
  if (m.shape === 'cylinder' && axis === 1) { const cap = cylinderCaps(m)[end < 0 ? 0 : 1], r = maxOnCircle(field, cap.center, cap.u, cap.w, cap.radius); return { max: r.max, upper: r.upper, at: r.at }; }
  if (m.shape === 'box') {
    // A union of convex receivers is not convex: bound each edge of the face, then the face interior on a grid.
    const u = (axis + 1) % 3, w = (axis + 2) % 3, local = (a: number, b: number): Vec3 => { const l: Vec3 = [0, 0, 0]; l[axis] = end * m.h[axis]; l[u] = a * m.h[u]; l[w] = b * m.h[w]; return l; };
    let max = -Infinity, at: Vec3 = m.c;
    const steps = receivers.length > 1 ? 24 : 1;
    for (let i = 0; i <= steps; i++) for (let j = 0; j <= steps; j++) { const p = toWorld(m, local(-1 + 2 * i / steps, -1 + 2 * j / steps)), d = field(p); if (d > max) { max = d; at = p; } }
    const spacing = receivers.length > 1 ? Math.hypot(m.h[u], m.h[w]) * 2 / steps : 0;
    return { max, upper: max + spacing, at };
  }
  return containment(scene.solids[receivers[0]], m, field);
}
/** Length of the member that lies inside the receiver, measured from its end by bisection. */
export function insertionDepth(scene: WorldScene, member: number, end: -1 | 1, axis: 0 | 1 | 2, receiver: number): number {
  const m = scene.solids[member], r = scene.solids[receiver], full = 2 * m.h[axis];
  if (!gjk(r, m).intersect) return 0;
  let lo = 0, hi = full;
  const touches = (d: number) => { const t = truncate(m, axis, end, d); return t ? gjk(r, t).intersect : false; };
  if (touches(full * 0.999999)) return full;
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (touches(mid)) lo = mid; else hi = mid; }
  return hi;
}

function viewFor(park: ParkData, scene: WorldScene, parts: number[], name: string, time: number): AuditView {
  const s = scene.solids[parts[0]], size = Math.max(0.4, ...parts.map(p => Math.min(4, Math.hypot(...scene.solids[p].h))));
  return { name, time, part: parts[0], dir: [0.8 + 0.1 * (s.part % 3), 0.55, 1], distance: Math.max(1.2, size * 3.5), highlight: parts };
}

export function auditPark(park: ParkData, poses: readonly BodyPose[], options: AuditOptions = {}): AuditReport {
  const tol = options.tolerance ?? CONTACT_TOLERANCE, time = options.time ?? 0, checks = { pairs: true, ends: true, support: true, coplanar: true, degenerate: true, ...options.checks };
  const scene = worldScene(park, poses), contracts = new Contracts(park), findings: Finding[] = [], stats: Record<string, number> = {};
  const insertions: AuditReport['insertions'] = [];
  const visible = (i: number) => park.parts[i].render !== false;
  const focus = options.focus ?? (() => true);
  const count = (key: string, n = 1) => { stats[key] = (stats[key] ?? 0) + n; };
  const add = (kind: FindingKind, severity: Finding['severity'], parts: number[], measured: number, location: Vec3, detail: string) => {
    const ride = ownerRide(park, parts[0]) >= 0 ? ownerRide(park, parts[0]) : parts.length > 1 ? ownerRide(park, parts[1]) : -1;
    findings.push({ kind, severity, parts, sources: parts.map(p => partSource(park.parts[p])), ride, family: familyOf(park, ride, parts[0]), measured, location, time, detail,
      view: viewFor(park, scene, parts, `${kind}-${parts.join('-')}`, time) });
    count(`${kind}:${severity}`);
  };
  const tree = buildTree(scene.bounds, park.parts.length, visible);

  // 1. Declared insertions: the member's whole end section lies inside its receivers.
  const checkedEnds = new Set<string>();
  for (const [key, list] of contracts.byEnd) {
    const member = list[0].b, end = list[0].end!, axis = list[0].axis ?? 1;
    if (!focus(member) && !list.some(c => focus(c.a))) continue;
    checkedEnds.add(key);
    const o = member * 6, near = (a: number) => { const p = a * 6, b = scene.bounds; return !(b[o] > b[p + 3] || b[o + 3] < b[p] || b[o + 1] > b[p + 4] || b[o + 4] < b[p + 1] || b[o + 2] > b[p + 5] || b[o + 5] < b[p + 2]); };
    const named = contracts.receivers(list), receivers = named.length > 4 ? named.filter(near) : named;
    if (!receivers.length) { add('contract-violation', 'defect', [member, list[0].a], Infinity, scene.solids[member].c, `${list[0].name}: declared insertion, but the member does not reach its receiver.`); continue; }
    const r = endProtrusion(scene, member, end, axis, receivers);
    const depth = Math.max(...receivers.map(a => insertionDepth(scene, member, end, axis, a)));
    insertions.push({ name: list[0].name, depth, protrusion: r.max }); count('insertions');
    if (r.max > tol) add('contract-violation', 'defect', [member, ...receivers], r.max, r.at, `${list[0].name}: declared insertion, but its end section reaches ${(r.max * 1000).toFixed(1)} mm outside the receiving part (inserted ${(depth * 1000).toFixed(0)} mm).`);
  }

  // 2. Exact pairwise overlaps, each explained by a monolith, an interface, or reported.
  if (checks.pairs) {
    for (const i of tree.items) {
      if (!focus(i)) continue;
      queryTree(tree, scene.bounds, i * 6, 0, j => {
        if (j === i || (focus(j) && j < i)) return;
        const a = scene.solids[i], b = scene.solids[j];
        count('candidates'); if (!gjk(a, b).intersect) return;
        // Decide overlap cheaply (stop once deeper than the tolerance); measure fully only for defects.
        let ab = intrusion(a, b, 16, tol), ba = ab.lower > tol ? ab : intrusion(b, a, 16, tol);
        if (Math.max(ab.lower, ba.lower) <= tol) { count('touching'); return; }
        count('overlaps');
        const verdict = classifyOverlap(scene, contracts, i, j, Math.max(ab.lower, ba.lower), tol, checkedEnds);
        if (verdict.explained) { count(`explained:${verdict.explained}`); return; }
        ab = intrusion(a, b, 48); ba = intrusion(b, a, 48);
        const depth = Math.max(ab.lower, ba.lower);
        add(verdict.kind!, 'defect', verdict.parts!, depth, ab.lower >= ba.lower ? ab.point : ba.point, verdict.detail!.replace(/^Undeclared interpenetration \d+ mm deep/, `Undeclared interpenetration ${(depth * 1000).toFixed(0)} mm deep`));
      });
    }
  }

  // 3. Rod ends: covered, flush, exposed, or partly buried with the cap edge showing.
  if (checks.ends) for (const i of tree.items) {
    const s = scene.solids[i]; if (s.shape !== 'cylinder' || !focus(i)) continue;
    for (const cap of cylinderCaps(s)) {
      if (checkedEnds.has(`${i},${cap.end}`)) continue;
      const box = new Float64Array(6); for (let k = 0; k < 3; k++) { const e = cap.radius * Math.sqrt(Math.max(0, 1 - cap.normal[k] ** 2)); box[k] = cap.center[k] - e; box[3 + k] = cap.center[k] + e; }
      // A shaft running through its bore, or a member inserted through an end face, leaves that face pierced, as built.
      // So does a boss of the same moulding or weldment; the segments of a bent member are still checked at their knuckles.
      const entering = contracts.entering.get(i), piece = contracts.monolith.get(i)?.piece, sibling = (j: number) => !!piece && !piece.chain && contracts.monolith.get(j)?.piece === piece;
      const neighbours: number[] = []; queryTree(tree, box, 0, tol, j => { if (j !== i && !entering?.has(j) && !sibling(j)) neighbours.push(j); });
      count('ends');
      if (!neighbours.length) { count('ends:free'); continue; }
      const field = endField(scene, neighbours), r = maxOnCircle(field, cap.center, cap.u, cap.w, cap.radius);
      if (r.max <= tol) { count('ends:covered'); continue; }
      const centre = field(cap.center);
      if (r.min < -tol || centre < -tol) {
        add('protruding-end', 'defect', [i, ...neighbours.filter(j => signedDistance(scene.solids[j], cap.center) < cap.radius)].slice(0, 4), r.max, r.at, `Rod end is partly buried: its ${(cap.radius * 2000).toFixed(0)} mm cap edge stands ${(r.max * 1000).toFixed(1)} mm out of the part it enters.`);
      } else count('ends:free');
    }
  }

  // 4. Support: every rendered part connects to the ground through contacts and declared joints.
  if (checks.support) {
    const parent = Int32Array.from({ length: park.parts.length }, (_, i) => i);
    const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const unite = (a: number, b: number) => { const x = find(a), y = find(b); if (x !== y) parent[Math.max(x, y)] = Math.min(x, y); };
    for (const i of tree.items) queryTree(tree, scene.bounds, i * 6, tol, j => { if (j > i && find(i) !== find(j) && gjk(scene.solids[i], scene.solids[j], 1e-7).distance <= tol) unite(i, j); });
    for (const joint of park.joints ?? []) if (visible(joint.a.part) && visible(joint.b.part)) unite(joint.a.part, joint.b.part);
    const ground = options.ground ?? (() => PARK_GRADE), grounded = new Set<number>();
    for (const i of tree.items) { const b = scene.bounds; if (b[i * 6 + 1] <= ground(scene.solids[i].c[0], scene.solids[i].c[2]) + tol) grounded.add(find(i)); }
    const components = new Map<number, number[]>();
    for (const i of tree.items) { const root = find(i); if (!grounded.has(root)) (components.get(root) ?? components.set(root, []).get(root)!).push(i); }
    for (const parts of components.values()) {
      if (!parts.some(focus)) continue;
      let lowest = parts[0]; for (const p of parts) if (scene.bounds[p * 6 + 1] < scene.bounds[lowest * 6 + 1]) lowest = p;
      const gap = scene.bounds[lowest * 6 + 1] - ground(scene.solids[lowest].c[0], scene.solids[lowest].c[2]);
      add('floating', 'defect', [lowest, ...parts.filter(p => p !== lowest).slice(0, 5)], gap, scene.solids[lowest].c, `${parts.length} part(s) touch nothing that reaches the ground; lowest is ${gap.toFixed(3)} m above grade.`);
    }
  }

  // 5. Coplanar faces with different finishes flicker in the depth test.
  if (checks.coplanar) for (const i of tree.items) {
    if (!focus(i)) continue;
    queryTree(tree, scene.bounds, i * 6, tol, j => {
      if (j <= i && focus(j)) return;
      const conflict = coplanarConflict(park, scene, i, j); if (conflict) add('coplanar-conflict', 'defect', [i, j], conflict.area, conflict.at, `Coincident ${conflict.area.toFixed(4)} m² faces with different finishes.`);
    });
  }
  if (checks.degenerate) for (const i of tree.items) {
    const h = park.parts[i].half; if (!focus(i)) continue;
    if (Math.min(...h) < 1e-4 || Math.max(...h) / Math.min(...h) > 1e5) add('degenerate-part', 'defect', [i], Math.min(...h), scene.solids[i].c, `Sliver primitive with half extents ${h.map(v => v.toExponential(2)).join(', ')} m.`);
  }
  return { findings, stats, insertions };
}

/** Explain one exact overlap by a monolith or interface contract, or describe it as a defect.
 * Insertions are explained only once their end-section containment has been checked (`checkedEnds`). */
export function classifyOverlap(scene: WorldScene, contracts: Contracts, i: number, j: number, depth: number, tol: number, checkedEnds?: Set<string>):
  { explained?: string; kind?: FindingKind; parts?: number[]; detail?: string } {
  const mi = contracts.monolith.get(i), mj = contracts.monolith.get(j);
  if (mi && mj && mi.index === mj.index) {
    const piece = mi.piece, n = piece.parts.length, step = Math.abs(mi.order - mj.order);
    if (!piece.chain || step === 1 || (piece.chain === 'closed' && step === n - 1)) return { explained: 'monolith' };
    return { kind: 'chain-overlap', parts: [i, j], detail: `${piece.name}: non-adjacent pieces of one bent member intersect.` };
  }
  for (const c of contracts.pair(i, j)) {
    if (c.kind === 'insert' && (!checkedEnds || checkedEnds.has(`${c.b},${c.end}`))) return { explained: 'insert' };
    if (c.kind === 'coaxial') {
      const failure = coaxialFailure(scene, c.a, c.b, tol);
      return failure ? { kind: 'contract-violation', parts: [c.b, c.a], detail: `${c.name}: ${failure}` } : { explained: 'coaxial' };
    }
    if (c.kind === 'bear') return { kind: 'contract-violation', parts: [c.b, c.a], detail: `${c.name}: declared bearing contact penetrates ${(depth * 1000).toFixed(1)} mm.` };
  }
  // Shared node: when a member's end is received (a brace into a spine, a tie into a rail), the length that
  // lies wholly inside its receiver is hidden; any overlap there is part of the receiver's own audit. The
  // two members must not overlap anywhere else.
  const hasEnd = (k: number) => contracts.byEnd.has(`${k},-1`) || contracts.byEnd.has(`${k},1`);
  if ((hasEnd(i) || hasEnd(j)) && (!checkedEnds || [i, j].every(k => !hasEnd(k) || [-1, 1].every(e => !contracts.byEnd.has(`${k},${e}`) || checkedEnds.has(`${k},${e}`))))) {
    const a = exposedPart(scene, contracts, i, tol), b = exposedPart(scene, contracts, j, tol);
    if (!a || !b || !gjk(a, b).intersect) return { explained: 'node' };
    const visible = Math.max(intrusion(a, b, 16, tol).lower, intrusion(b, a, 16, tol).lower);
    if (visible <= tol) return { explained: 'node' };
    return { kind: 'penetration', parts: [i, j], detail: `Members cross ${(visible * 1000).toFixed(0)} mm deep outside the node that receives them (${(depth * 1000).toFixed(0)} mm deep overall).` };
  }
  return { kind: 'penetration', parts: [i, j], detail: `Undeclared interpenetration ${(depth * 1000).toFixed(0)} mm deep.` };
}

/** A shaft inside a bore: coaxial within tolerance, and every section of the shaft inside the bore's span fits. */
export function coaxialFailure(scene: WorldScene, outer: number, inner: number, tol: number): string | null {
  const a = scene.solids[outer], b = scene.solids[inner];
  if (b.shape !== 'cylinder') return 'coaxial shaft must be a cylinder';
  const axis = b.ax[1], span = (s: Solid) => { const hi = support(s, axis), lo = support(s, [-axis[0], -axis[1], -axis[2]]); const o = (p: Vec3) => (p[0] - b.c[0]) * axis[0] + (p[1] - b.c[1]) * axis[1] + (p[2] - b.c[2]) * axis[2]; return [o(lo), o(hi)]; };
  const [lo, hi] = span(a), t0 = Math.max(-b.h[1], lo), t1 = Math.min(b.h[1], hi);
  if (t1 <= t0) return null;
  const field = (p: Vec3) => signedDistance(a, p);
  let worst = -Infinity;
  for (const t of [t0 + 1e-6, t1 - 1e-6]) {
    const center = toWorld(b, [0, t, 0]);
    worst = Math.max(worst, maxOnCircle(field, center, b.ax[0], b.ax[2], b.h[0]).max);
  }
  return worst > tol ? `shaft section stands ${(worst * 1000).toFixed(1)} mm outside its bore or hub` : null;
}

interface Face { normal: Vec3; offset: number; points: Vec3[] }
function faces(s: Solid): Face[] {
  const out: Face[] = [], h = s.h;
  const add = (local: Vec3[], n: Vec3) => {
    const pts = local.map(p => toWorld(s, p)), normal: Vec3 = [s.ax[0][0] * n[0] + s.ax[1][0] * n[1] + s.ax[2][0] * n[2], s.ax[0][1] * n[0] + s.ax[1][1] * n[1] + s.ax[2][1] * n[2], s.ax[0][2] * n[0] + s.ax[1][2] * n[1] + s.ax[2][2] * n[2]];
    out.push({ normal, offset: normal[0] * pts[0][0] + normal[1] * pts[0][1] + normal[2] * pts[0][2], points: pts });
  };
  if (s.shape === 'box') for (let k = 0; k < 3; k++) for (const sign of [-1, 1]) {
    const u = (k + 1) % 3, w = (k + 2) % 3, pts: Vec3[] = [];
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const p: Vec3 = [0, 0, 0]; p[k] = sign * h[k]; p[u] = a * h[u]; p[w] = b * h[w]; pts.push(p); }
    const n: Vec3 = [0, 0, 0]; n[k] = sign; add(pts, n);
  }
  if (s.shape === 'gable') {
    for (const z of [-1, 1]) add([[-h[0], -h[1], z * h[2]], [h[0], -h[1], z * h[2]], [0, h[1], z * h[2]]], [0, 0, z]);
    add([[-h[0], -h[1], -h[2]], [h[0], -h[1], -h[2]], [h[0], -h[1], h[2]], [-h[0], -h[1], h[2]]], [0, -1, 0]);
    for (const side of [-1, 1]) { const n: Vec3 = [side * 2 * h[1], h[0], 0], l = Math.hypot(...n); add([[side * h[0], -h[1], -h[2]], [0, h[1], -h[2]], [0, h[1], h[2]], [side * h[0], -h[1], h[2]]], [n[0] / l, n[1] / l, 0]); }
  }
  if (s.shape === 'cylinder' || s.shape === 'cone') for (const end of s.shape === 'cylinder' ? [-1, 1] : [-1]) {
    const pts: Vec3[] = []; for (let i = 0; i < 32; i++) { const a = i * Math.PI / 16; pts.push([Math.cos(a) * h[0], end * h[1], Math.sin(a) * h[2]]); }
    add(pts, [0, end, 0]);
  }
  return out;
}
const faceCache = new WeakMap<Solid, Face[]>();
function cachedFaces(s: Solid): Face[] { let f = faceCache.get(s); if (!f) faceCache.set(s, f = faces(s)); return f; }
/** Convex polygon intersection area on a shared plane (Sutherland-Hodgman). */
function overlapArea(a: Vec3[], b: Vec3[], normal: Vec3): { area: number; at: Vec3 } {
  const u: Vec3 = Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const e1 = (() => { const c: Vec3 = [normal[1] * u[2] - normal[2] * u[1], normal[2] * u[0] - normal[0] * u[2], normal[0] * u[1] - normal[1] * u[0]]; const l = Math.hypot(...c); return c.map(v => v / l) as Vec3; })();
  const e2: Vec3 = [normal[1] * e1[2] - normal[2] * e1[1], normal[2] * e1[0] - normal[0] * e1[2], normal[0] * e1[1] - normal[1] * e1[0]];
  const flat = (p: Vec3): [number, number] => [p[0] * e1[0] + p[1] * e1[1] + p[2] * e1[2], p[0] * e2[0] + p[1] * e2[1] + p[2] * e2[2]];
  const orient = (poly: [number, number][]) => { let s = 0; for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; s += p[0] * q[1] - q[0] * p[1]; } return s < 0 ? poly.reverse() : poly; };
  let subject = orient(a.map(flat)); const clip = orient(b.map(flat));
  for (let i = 0; i < clip.length && subject.length; i++) {
    const p = clip[i], q = clip[(i + 1) % clip.length], inside = (x: [number, number]) => (q[0] - p[0]) * (x[1] - p[1]) - (q[1] - p[1]) * (x[0] - p[0]) >= 0;
    const next: [number, number][] = [];
    for (let k = 0; k < subject.length; k++) {
      const c = subject[k], d = subject[(k + 1) % subject.length], ci = inside(c), di = inside(d);
      if (ci) next.push(c);
      if (ci !== di) { const dx = d[0] - c[0], dy = d[1] - c[1], ex = q[0] - p[0], ey = q[1] - p[1], t = (ex * (c[1] - p[1]) - ey * (c[0] - p[0])) / (ey * dx - ex * dy); next.push([c[0] + dx * t, c[1] + dy * t]); }
    }
    subject = next;
  }
  let area = 0, cx = 0, cy = 0;
  for (let i = 0; i < subject.length; i++) { const p = subject[i], q = subject[(i + 1) % subject.length], cr = p[0] * q[1] - q[0] * p[1]; area += cr; cx += (p[0] + q[0]) * cr; cy += (p[1] + q[1]) * cr; }
  area /= 2; if (Math.abs(area) < 1e-12) return { area: 0, at: a[0] };
  cx /= 6 * area; cy /= 6 * area;
  const d = normal[0] * a[0][0] + normal[1] * a[0][1] + normal[2] * a[0][2];
  return { area: Math.abs(area), at: [e1[0] * cx + e2[0] * cy + normal[0] * d, e1[1] * cx + e2[1] * cy + normal[1] * d, e1[2] * cx + e2[2] * cy + normal[2] * d] };
}
function sameFinish(park: ParkData, i: number, j: number): boolean {
  const a = park.parts[i], b = park.parts[j];
  return a.color.every((v, k) => Math.abs(v - b.color[k]) < 1e-6) && a.roughness === b.roughness && a.metalness === b.metalness && (a.surface ?? 'paint') === (b.surface ?? 'paint') && a.emissive === b.emissive;
}
/** Faces facing the same way on the same plane with overlapping area: the depth test picks either. */
export function coplanarConflict(park: ParkData, scene: WorldScene, i: number, j: number): { area: number; at: Vec3 } | null {
  if (sameFinish(park, i, j)) return null;
  const a = scene.solids[i], b = scene.solids[j];
  if (!['box', 'gable', 'cylinder', 'cone'].includes(a.shape) || !['box', 'gable', 'cylinder', 'cone'].includes(b.shape)) return null;
  for (const fa of cachedFaces(a)) for (const fb of cachedFaces(b)) {
    if (fa.normal[0] * fb.normal[0] + fa.normal[1] * fb.normal[1] + fa.normal[2] * fb.normal[2] < 1 - 1e-7) continue;
    if (Math.abs(fa.offset - fb.offset) > 1e-4) continue;
    const r = overlapArea(fa.points, fb.points, fa.normal);
    if (r.area > 1e-6) return r;
  }
  return null;
}
