import type { Vec3 } from '../../contracts';
import { GuestMode, type AvoidanceLine } from './crowd';
import { clamp, inverseRotate, pose, qmul, rotate } from './math';
import type { ParkRuntime } from './runtime';
import type { EnvironmentCollision, EnvironmentContact, ParkPart } from './types';
import { SweptBodyBounds } from './collisionMotion';

/** Flat binary BVH with no query candidate cap. Dynamic leaves refit without changing topology. */
export class PartBVH {
  readonly order: Int32Array;
  readonly bounds: Float64Array;
  readonly children: Int32Array;
  readonly leaves: Int32Array;
  private readonly parents: Int32Array;
  private readonly itemNodes: Int32Array;
  private readonly dirty: Uint8Array;
  private count = 0;
  private readonly stack = new Int32Array(64);
  constructor(readonly items: readonly ParkPart[], private readonly itemBounds: Float64Array) {
    this.order = Int32Array.from(items, (_, i) => i); this.bounds = new Float64Array(Math.max(1, items.length * 2) * 6);
    this.children = new Int32Array(Math.max(1, items.length * 2) * 2).fill(-1); this.leaves = new Int32Array(Math.max(1, items.length * 2)).fill(-1);
    this.parents = new Int32Array(this.leaves.length).fill(-1); this.itemNodes = new Int32Array(items.length); this.dirty = new Uint8Array(this.leaves.length);
    if (items.length) this.build(0, items.length);
  }
  private build(lo: number, hi: number): number {
    const node = this.count++;
    if (hi - lo === 1) { this.leaves[node] = this.order[lo]; this.itemNodes[this.order[lo]] = node; this.copyLeaf(node, this.order[lo]); return node; }
    const extent = [0, 0, 0], min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = lo; i < hi; i++) for (let k = 0; k < 3; k++) { const o = this.order[i] * 6; min[k] = Math.min(min[k], this.itemBounds[o + k]); max[k] = Math.max(max[k], this.itemBounds[o + 3 + k]); }
    for (let k = 0; k < 3; k++) extent[k] = max[k] - min[k];
    const axis = extent[0] > extent[1] ? extent[0] > extent[2] ? 0 : 2 : extent[1] > extent[2] ? 1 : 2;
    this.order.subarray(lo, hi).sort((a, b) => (this.itemBounds[a * 6 + axis] + this.itemBounds[a * 6 + axis + 3]) - (this.itemBounds[b * 6 + axis] + this.itemBounds[b * 6 + axis + 3]) || a - b);
    const mid = (lo + hi) >>> 1, a = this.build(lo, mid), b = this.build(mid, hi); this.children[node * 2] = a; this.children[node * 2 + 1] = b; this.parents[a] = this.parents[b] = node; this.merge(node, a, b); return node;
  }
  private copyLeaf(node: number, item: number): void {
    const a = this.bounds, b = this.itemBounds, n = node * 6, i = item * 6;
    a[n] = b[i]; a[n + 1] = b[i + 1]; a[n + 2] = b[i + 2]; a[n + 3] = b[i + 3]; a[n + 4] = b[i + 4]; a[n + 5] = b[i + 5];
  }
  private merge(node: number, a: number, b: number): void {
    const box = this.bounds, n = node * 6, x = a * 6, y = b * 6;
    box[n] = Math.min(box[x], box[y]); box[n + 1] = Math.min(box[x + 1], box[y + 1]); box[n + 2] = Math.min(box[x + 2], box[y + 2]);
    box[n + 3] = Math.max(box[x + 3], box[y + 3]); box[n + 4] = Math.max(box[x + 4], box[y + 4]); box[n + 5] = Math.max(box[x + 5], box[y + 5]);
  }
  refit(changed?: ArrayLike<number>, changedCount = changed?.length ?? 0): void {
    if (changed) {
      if (!changedCount) return;
      for (let i = 0; i < changedCount; i++) {
        const item = changed[i], leaf = this.itemNodes[item]; this.copyLeaf(leaf, item);
        let parent = this.parents[leaf]; while (parent >= 0 && !this.dirty[parent]) { this.dirty[parent] = 1; parent = this.parents[parent]; }
      }
      // Preorder node IDs put every child after its parent; reverse order is a valid bottom-up refit.
      for (let node = this.count - 1; node >= 0; node--) if (this.dirty[node]) { this.merge(node, this.children[node * 2], this.children[node * 2 + 1]); this.dirty[node] = 0; }
      return;
    }
    for (let node = this.count - 1; node >= 0; node--) {
      const i = this.leaves[node]; if (i >= 0) this.copyLeaf(node, i);
      else this.merge(node, this.children[node * 2], this.children[node * 2 + 1]);
    }
  }
  query(x: number, y: number, z: number, radius: number, visit: (index: number) => void): void {
    if (!this.count) return;
    // The explicit stack is bounded by tree depth, not by the number of intersecting parts.
    const stack = this.stack; let top = 1; stack[0] = 0;
    while (top) {
      const n = stack[--top], o = n * 6, a = this.bounds;
      if (x + radius < a[o] || y + radius < a[o + 1] || z + radius < a[o + 2] || x - radius > a[o + 3] || y - radius > a[o + 4] || z - radius > a[o + 5]) continue;
      const leaf = this.leaves[n]; if (leaf >= 0) visit(leaf); else { stack[top++] = this.children[n * 2 + 1]; stack[top++] = this.children[n * 2]; }
    }
  }
  /** Signed box distance is a lower bound even inside a node; an unsigned bound would incorrectly prune overlapping solids. */
  nearest(x: number, y: number, z: number, measure: (index: number) => number): number {
    if (!this.count) return Infinity;
    const boxDistance = (node: number): number => {
      const b = this.bounds, o = node * 6, dx = Math.max(b[o] - x, x - b[o + 3]), dy = Math.max(b[o + 1] - y, y - b[o + 4]), dz = Math.max(b[o + 2] - z, z - b[o + 5]);
      return Math.hypot(Math.max(0, dx), Math.max(0, dy), Math.max(0, dz)) + Math.min(Math.max(dx, dy, dz), 0);
    };
    let best = Infinity, top = 1; const stack = this.stack; stack[0] = 0;
    while (top) {
      const node = stack[--top]; if (boxDistance(node) > best) continue;
      const leaf = this.leaves[node];
      if (leaf >= 0) best = Math.min(best, measure(leaf));
      else { const a = this.children[node * 2], b = this.children[node * 2 + 1];
        if (boxDistance(a) < boxDistance(b)) { stack[top++] = b; stack[top++] = a; } else { stack[top++] = a; stack[top++] = b; }
      }
    }
    return best;
  }
}

export function partDistance(part: ParkPart, local: Vec3, normal: Vec3): number {
  const [x, y, z] = local, h = part.half;
  if (part.shape === 'gable') {
    // Exact Euclidean distance to a triangle extruded along Z, including edges and corners.
    let nearest = Infinity, nx = 0, ny = -1;
    const inside = y >= -h[1] && y <= h[1] - 2 * h[1] * Math.abs(x) / h[0];
    for (let edge = 0; edge < 3; edge++) {
      const ax = edge === 0 ? -h[0] : edge === 1 ? h[0] : 0, ay = edge < 2 ? -h[1] : h[1];
      const bx = edge === 0 ? h[0] : edge === 1 ? 0 : -h[0], by = edge === 1 ? h[1] : -h[1];
      const dx = bx - ax, dy = by - ay, t = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy), 0, 1);
      const px = x - ax - t * dx, py = y - ay - t * dy, d = Math.hypot(px, py);
      if (d < nearest) { nearest = d; const sign = inside ? -1 : 1;
        if (d > 1e-14) { nx = sign * px / d; ny = sign * py / d; }
        else { const len = Math.hypot(dx, dy); nx = dy / len; ny = -dx / len; }
      }
    }
    const a = nearest * (inside ? -1 : 1), b = Math.abs(z) - h[2], pa = Math.max(a, 0), pb = Math.max(b, 0), d = Math.hypot(pa, pb);
    if (d) { normal[0] = nx * pa / d; normal[1] = ny * pa / d; normal[2] = Math.sign(z) * pb / d; }
    else if (a >= b) { normal[0] = nx; normal[1] = ny; normal[2] = 0; }
    else { normal[0] = 0; normal[1] = 0; normal[2] = z < 0 ? -1 : 1; }
    return d + Math.min(Math.max(a, b), 0);
  }
  if (part.shape === 'cone') {
    // Exact distance to a capped circular cone through its radial cross-section.
    const r = Math.sqrt(x * x + z * z), height = 2 * h[1], t = clamp((r * h[0] + (h[1] - y) * height) / (h[0] ** 2 + height ** 2), 0, 1);
    const sr = r - t * h[0], sy = y - h[1] + t * height, cr = Math.max(0, r - h[0]), cy = y + h[1];
    const side = sr * sr + sy * sy, cap = cr * cr + cy * cy, isCap = cap <= side;
    const dr = isCap ? cr : sr, dy = isCap ? cy : sy, d = Math.sqrt(Math.min(side, cap));
    const sign = y >= -h[1] && y <= h[1] && r <= h[0] * (h[1] - y) / height ? -1 : 1;
    if (d > 1e-12) { const radial = sign * dr / d; normal[0] = radial * (r ? x / r : 1); normal[1] = sign * dy / d; normal[2] = radial * (r ? z / r : 0); }
    else if (isCap) { normal[0] = 0; normal[1] = -1; normal[2] = 0; }
    else { const len = Math.hypot(height, h[0]); normal[0] = height / len * (r ? x / r : 1); normal[1] = h[0] / len; normal[2] = height / len * (r ? z / r : 0); }
    return d * sign;
  }
  if (part.shape === 'sphere') {
    if (h[0] === h[1] && h[1] === h[2]) { const len = Math.hypot(x, y, z); normal[0] = len ? x / len : 1; normal[1] = y / (len || 1); normal[2] = z / (len || 1); return len - h[0]; }
    // Closest point on an ellipsoid, including interior points on its principal axes.
    const axes = h.map(v => v * v), v = [x, y, z], inside = (x / h[0]) ** 2 + (y / h[1]) ** 2 + (z / h[2]) ** 2 < 1;
    const min = Math.min(...axes), axis = axes.indexOf(min), f = (lambda: number) => axes.reduce((sum, a, i) => sum + a * v[i] ** 2 / (lambda + a) ** 2, 0);
    let lo = inside ? -min + min * 1e-12 : 0, hi = inside ? 0 : Math.max(...h) * Math.hypot(x, y, z);
    const closest: Vec3 = [0, 0, 0];
    if (inside && f(lo) <= 1) {
      let used = 0; for (let k = 0; k < 3; k++) if (axes[k] > min) { closest[k] = axes[k] * v[k] / (axes[k] - min); used += closest[k] ** 2 / axes[k]; }
      closest[axis] = (v[axis] < 0 ? -1 : 1) * h[axis] * Math.sqrt(Math.max(0, 1 - used));
    } else { for (let i = 0; i < 48; i++) { const mid = (lo + hi) / 2; if (f(mid) > 1) lo = mid; else hi = mid; } for (let k = 0; k < 3; k++) closest[k] = axes[k] * v[k] / ((lo + hi) / 2 + axes[k]); }
    for (let k = 0; k < 3; k++) normal[k] = closest[k] / axes[k]; const len = Math.hypot(...normal) || 1; for (let k = 0; k < 3; k++) normal[k] /= len;
    return Math.hypot(x - closest[0], y - closest[1], z - closest[2]) * (inside ? -1 : 1);
  }
  if (part.shape === 'cylinder') {
    const radial = Math.hypot(x, z), a = radial - h[0], b = Math.abs(y) - h[1];
    const ax = Math.max(a, 0), by = Math.max(b, 0), l = Math.hypot(ax, by);
    if (l > 0) { const f = ax / l / (radial || 1); normal[0] = x * f; normal[1] = Math.sign(y) * by / l; normal[2] = z * f; }
    else if (a > b) { normal[0] = radial ? x / radial : 1; normal[1] = 0; normal[2] = z / (radial || 1); }
    else { normal[0] = 0; normal[1] = y < 0 ? -1 : 1; normal[2] = 0; }
    return l + Math.min(Math.max(a, b), 0);
  }
  const dx = Math.abs(x) - h[0], dy = Math.abs(y) - h[1], dz = Math.abs(z) - h[2];
  const px = Math.max(dx, 0), py = Math.max(dy, 0), pz = Math.max(dz, 0), len = Math.hypot(px, py, pz);
  if (len > 0) { normal[0] = Math.sign(x) * px / len; normal[1] = Math.sign(y) * py / len; normal[2] = Math.sign(z) * pz / len; }
  else { normal[0] = normal[1] = normal[2] = 0; if (dx >= dy && dx >= dz) normal[0] = x < 0 ? -1 : 1; else if (dy >= dz) normal[1] = y < 0 ? -1 : 1; else normal[2] = z < 0 ? -1 : 1; }
  return len + Math.min(Math.max(dx, dy, dz), 0);
}

export class ParkCollision implements EnvironmentCollision {
  readonly statics: ParkPart[];
  readonly dynamics: ParkPart[];
  readonly staticTree: PartBVH;
  private diagnosticTree?: PartBVH;
  private diagnosticTick = -1;
  private readonly bodyTree: PartBVH;
  private readonly localTrees: PartBVH[];
  private readonly activeBodies: number[];
  private readonly sweptBounds: SweptBodyBounds;
  private readonly aggregateBounds: Float64Array;
  private readonly aggregateRadii: Float64Array;
  private readonly sweepIgnored: Uint32Array[];
  private sweepStamp = 0;
  private readonly walkingParts: ParkPart[];
  private readonly walkingTree: PartBVH;
  private readonly walkingBounds: Float64Array;
  private readonly staticBounds: Float64Array;
  private readonly dynamicBounds: Float64Array;
  private readonly localMatrices: Float64Array;
  private readonly bodyMatrices: Float64Array;
  private readonly motionRadii: Float64Array;
  private readonly currentBounds: Float64Array;
  private readonly previousBounds = new Float64Array(6);
  private readonly bodySignatures: Float64Array;
  private readonly bodyChanges: Uint8Array;
  private readonly bodyMotion: Float64Array;
  private readonly bodyParts: number[][];
  private readonly scratchPose = pose();
  private readonly center: Vec3 = [0, 0, 0];
  private readonly local: Vec3 = [0, 0, 0];
  private readonly normal: Vec3 = [0, 1, 0];
  private readonly worldNormal: Vec3 = [0, 1, 0];
  private readonly capsuleA: Vec3 = [0, 0, 0];
  private readonly capsuleB: Vec3 = [0, 0, 0];
  private lastTick = -1;
  private dt = 0;
  queries = 0;
  constructor(readonly runtime: ParkRuntime) {
    this.statics = runtime.park.parts.filter(p => p.solid && p.body < 0); this.dynamics = runtime.park.parts.filter(p => p.solid && p.body >= 0);
    this.localMatrices = new Float64Array(this.dynamics.length * 9); this.bodyMatrices = new Float64Array(runtime.bodies.length * 18);
    this.bodySignatures = new Float64Array(runtime.bodies.length * 16).fill(NaN); this.bodyChanges = new Uint8Array(runtime.bodies.length); this.bodyMotion = new Float64Array(runtime.bodies.length * 2);
    this.bodyParts = Array.from({ length: runtime.bodies.length }, () => []); this.currentBounds = new Float64Array(this.dynamics.length * 6);
    this.motionRadii = Float64Array.from(this.dynamics, p => Math.hypot(...p.pos) + Math.hypot(...p.half));
    this.dynamics.forEach((p, i) => { this.matrix(p.rot, this.localMatrices, i * 9); this.bodyParts[p.body].push(i); for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) this.localMatrices[i * 9 + row * 3 + col] *= p.half[col]; }); this.updateMatrices();
    this.staticBounds = new Float64Array(this.statics.length * 6); this.dynamicBounds = new Float64Array(this.dynamics.length * 6);
    this.statics.forEach((p, i) => this.bounds(p, this.staticBounds, i * 6, false)); this.dynamics.forEach((p, i) => this.bounds(p, this.dynamicBounds, i * 6, true));
    this.staticTree = new PartBVH(this.statics, this.staticBounds);
    // Detailed shapes are immutable in their rigid body's frame. Only one conservative world envelope per body needs refitting.
    this.activeBodies = this.bodyParts.flatMap((ids, i) => ids.length ? [i] : []);
    this.localTrees = this.activeBodies.map(body => {
      const parts = this.bodyParts[body].map(i => this.dynamics[i]), bounds = new Float64Array(parts.length * 6);
      parts.forEach((p, i) => this.bounds(p, bounds, i * 6, false)); return new PartBVH(parts, bounds);
    });
    this.sweepIgnored = this.localTrees.map(tree => new Uint32Array(tree.items.length));
    this.aggregateRadii = Float64Array.from(this.activeBodies, body => Math.max(...this.bodyParts[body].map(i => this.motionRadii[i])));
    this.aggregateBounds = new Float64Array(this.activeBodies.length * 6); this.sweptBounds = new SweptBodyBounds(runtime); this.sweptBounds.begin();
    this.activeBodies.forEach((body, i) => this.sweptBounds.bounds(body, this.aggregateRadii[i], this.aggregateBounds, i * 6));
    this.bodyTree = new PartBVH(this.activeBodies.map(body => this.dynamics[this.bodyParts[body][0]]), this.aggregateBounds);
    // Ground pedestrians step over pavement/curbs. Obstacles above ankle height and below the head use an exact, smaller tree.
    const walkingBounds: number[] = []; this.walkingParts = [];
    for (let i = 0; i < this.statics.length; i++) {
      const o = i * 6;
      if (this.staticBounds[o + 4] < 12.3 || this.staticBounds[o + 1] > 14.5) continue;
      this.walkingParts.push(this.statics[i]);
      for (let k = 0; k < 6; k++) walkingBounds.push(this.staticBounds[o + k]);
    }
    this.walkingBounds = Float64Array.from(walkingBounds); this.walkingTree = new PartBVH(this.walkingParts, this.walkingBounds);
    runtime.crowd.avoidObstacles = (x, y, z, lines) => this.walkLines(x, y, z, lines);
  }
  private walkLines(x: number, y: number, z: number, lines: AvoidanceLine[]): void {
    const ground = y >= 12 && y <= 12.5, tree = ground ? this.walkingTree : this.staticTree, parts = ground ? this.walkingParts : this.statics;
    tree.query(x, y + 0.95, z, 2, index => {
      const top = (ground ? this.walkingBounds : this.staticBounds)[index * 6 + 4];
      const probeY = Math.max(y + 0.15, Math.min(y + 0.95, top - 0.05));
      const d = this.distance(parts[index], x, probeY, z, this.runtime.elapsed), n = this.worldNormal, length = Math.hypot(n[0], n[2]);
      if (d < 2 && length > 0.7) lines.push({ nx: n[0] / length, nz: n[2] / length, c: (0.29 - d) / 0.7 });
    });
  }
  setStep(dt: number): void { this.dt = dt; }
  /** Exact per-primitive endpoint boxes retained for diagnostics. Production queries use the immutable local trees. */
  get dynamicTree(): PartBVH {
    if (this.diagnosticTick !== this.runtime.tick) {
      this.diagnosticTick = this.runtime.tick; this.updateMatrices();
      for (let i = 0; i < this.dynamics.length; i++) this.bounds(this.dynamics[i], this.dynamicBounds, i * 6, true);
      if (this.diagnosticTree) this.diagnosticTree.refit(); else this.diagnosticTree = new PartBVH(this.dynamics, this.dynamicBounds);
    }
    return this.diagnosticTree!;
  }
  private matrix(q: readonly number[], out: Float64Array, o: number): void {
    const [x, y, z, w] = q;
    out[o] = 1 - 2 * (y * y + z * z); out[o + 1] = 2 * (x * y - w * z); out[o + 2] = 2 * (x * z + w * y);
    out[o + 3] = 2 * (x * y + w * z); out[o + 4] = 1 - 2 * (x * x + z * z); out[o + 5] = 2 * (y * z - w * x);
    out[o + 6] = 2 * (x * z - w * y); out[o + 7] = 2 * (y * z + w * x); out[o + 8] = 1 - 2 * (x * x + y * y);
  }
  private updateMatrices(): void {
    const signatures = this.bodySignatures;
    for (let i = 0; i < this.runtime.bodies.length; i++) {
      if (!this.bodyParts[i].length) { this.bodyChanges[i] = 0; continue; }
      const current = this.runtime.bodies[i], previous = this.runtime.previousBodies[i], base = i * 16;
      const currentMotion = current.omega[0] ** 2 + current.omega[1] ** 2 + current.omega[2] ** 2, previousMotion = previous.omega[0] ** 2 + previous.omega[1] ** 2 + previous.omega[2] ** 2;
      let currentChanged = currentMotion !== signatures[base + 7], previousChanged = previousMotion !== signatures[base + 15], reusePrevious = previousMotion === signatures[base + 7];
      for (let k = 0; k < 7; k++) {
        const a = k < 3 ? current.pos[k] : current.rot[k - 3], b = k < 3 ? previous.pos[k] : previous.rot[k - 3];
        currentChanged ||= a !== signatures[base + k]; previousChanged ||= b !== signatures[base + 8 + k]; reusePrevious &&= b === signatures[base + k];
      }
      this.bodyChanges[i] = Number(currentChanged) | (Number(previousChanged) << 1) | (Number(reusePrevious) << 2);
      if (currentChanged) this.matrix(current.rot, this.bodyMatrices, i * 18);
      if (previousChanged) this.matrix(previous.rot, this.bodyMatrices, i * 18 + 9);
      for (let k = 0; k < 7; k++) { signatures[base + k] = k < 3 ? current.pos[k] : current.rot[k - 3]; signatures[base + 8 + k] = k < 3 ? previous.pos[k] : previous.rot[k - 3]; }
      signatures[base + 7] = currentMotion; signatures[base + 15] = previousMotion;
      this.bodyMotion[i * 2] = 0.5 * currentMotion * 0.004 ** 2; this.bodyMotion[i * 2 + 1] = 0.5 * previousMotion * 0.004 ** 2;
    }
  }
  private bounds(p: ParkPart, out: Float64Array, o: number, dynamic: boolean): void {
    if (dynamic) {
      const previous = this.previousBounds, current = this.currentBounds, change = this.bodyChanges[p.body];
      if (change & 4) for (let k = 0; k < 6; k++) previous[k] = current[o + k];
      else this.endpointBounds(p, o / 6, 1, previous, 0);
      if (change & 1) this.endpointBounds(p, o / 6, 0, current, o);
      for (let k = 0; k < 3; k++) { out[o + k] = Math.min(current[o + k], previous[k]); out[o + k + 3] = Math.max(current[o + k + 3], previous[k + 3]); }
    } else {
      // Exact world AABB of the common box enclosing every supported shape.
      const [x, y, z, w] = p.rot, h = p.half;
      const m = [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y), 2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x), 2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)];
      for (let k = 0; k < 3; k++) { const r = Math.abs(m[k * 3]) * h[0] + Math.abs(m[k * 3 + 1]) * h[1] + Math.abs(m[k * 3 + 2]) * h[2]; out[o + k] = p.pos[k] - r; out[o + k + 3] = p.pos[k] + r; }
    }
  }
  private endpointBounds(p: ParkPart, index: number, phase: number, out: Float64Array, offset: number): void {
    const a = this.localMatrices, m = this.bodyMatrices, local = index * 9, base = p.body * 18 + phase * 9;
    const position = (phase ? this.runtime.previousBodies[p.body] : this.runtime.bodies[p.body]).pos;
    const margin = 0.01 + this.bodyMotion[p.body * 2 + phase] * this.motionRadii[index];
    for (let k = 0; k < 3; k++) {
      const row = base + k * 3, x = m[row], y = m[row + 1], z = m[row + 2], center = position[k] + x * p.pos[0] + y * p.pos[1] + z * p.pos[2];
      const radius = margin + Math.abs(x * a[local] + y * a[local + 3] + z * a[local + 6]) + Math.abs(x * a[local + 1] + y * a[local + 4] + z * a[local + 7]) + Math.abs(x * a[local + 2] + y * a[local + 5] + z * a[local + 8]);
      out[offset + k] = center - radius; out[offset + k + 3] = center + radius;
    }
  }
  private sync(): void {
    if (this.lastTick === this.runtime.tick) return;
    this.lastTick = this.runtime.tick;
    this.sweptBounds.begin();
    for (let i = 0; i < this.activeBodies.length; i++) this.sweptBounds.bounds(this.activeBodies[i], this.aggregateRadii[i], this.aggregateBounds, i * 6);
    this.bodyTree.refit();
  }
  private queryMoving(x: number, y: number, z: number, radius: number, visit: (part: ParkPart) => void): void {
    this.bodyTree.query(x, y, z, radius, i => {
      const tree = this.localTrees[i];
      const b = this.runtime.bodyPose(this.activeBodies[i], this.runtime.elapsed, this.scratchPose);
      this.local[0] = x - b.pos[0]; this.local[1] = y - b.pos[1]; this.local[2] = z - b.pos[2]; inverseRotate(b.rot, this.local, this.local);
      const roundoff = Number.EPSILON * 64 * Math.max(1, Math.abs(x), Math.abs(y), Math.abs(z));
      tree.query(this.local[0], this.local[1], this.local[2], radius + roundoff, j => visit(tree.items[j]));
    });
  }
  private distance(p: ParkPart, x: number, y: number, z: number, time: number): number {
    this.local[0] = x; this.local[1] = y; this.local[2] = z;
    let rot = p.rot;
    if (p.body >= 0) {
      const b = this.runtime.bodyPose(p.body, time, this.scratchPose);
      rotate(b.rot, p.pos, this.center); for (let k = 0; k < 3; k++) this.center[k] += b.pos[k]; rot = qmul(b.rot, p.rot);
    } else for (let k = 0; k < 3; k++) this.center[k] = p.pos[k];
    for (let k = 0; k < 3; k++) this.local[k] -= this.center[k]; inverseRotate(rot, this.local, this.local);
    const d = partDistance(p, this.local, this.normal); rotate(rot, this.normal, this.worldNormal); return d;
  }
  private guestDistance(i: number, x: number, y: number, z: number, time: number): number {
    this.runtime.guestCapsule(i, this.capsuleA, this.capsuleB, time);
    const a = this.capsuleA, b = this.capsuleB, dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const t = clamp(((x - a[0]) * dx + (y - a[1]) * dy + (z - a[2]) * dz) / (dx * dx + dy * dy + dz * dz || 1), 0, 1);
    const rx = x - a[0] - t * dx, ry = y - a[1] - t * dy, rz = z - a[2] - t * dz, length = Math.hypot(rx, ry, rz);
    this.worldNormal[0] = length > 1e-9 ? rx / length : 1; this.worldNormal[1] = ry / (length || 1); this.worldNormal[2] = rz / (length || 1);
    return length - 0.26;
  }
  private surfaceVelocity(x: number, y: number, z: number, out: Vec3): void {
    const b = this.scratchPose, rx = x - b.pos[0], ry = y - b.pos[1], rz = z - b.pos[2];
    out[0] = b.vel[0] + b.omega[1] * rz - b.omega[2] * ry; out[1] = b.vel[1] + b.omega[2] * rx - b.omega[0] * rz; out[2] = b.vel[2] + b.omega[0] * ry - b.omega[1] * rx;
  }
  contact(x: number, y: number, z: number, radius: number, out: EnvironmentContact): boolean {
    this.sync(); this.queries++; let best = -Infinity;
    const check = (p: ParkPart): void => {
      const d = this.distance(p, x, y, z, this.runtime.elapsed), penetration = radius - d;
      if (penetration <= 0 || penetration <= best) return;
      best = penetration; out.penetration = penetration;
      for (let k = 0; k < 3; k++) { out.normal[k] = this.worldNormal[k]; out.velocity[k] = 0; }
      if (p.body >= 0) {
        this.surfaceVelocity(x, y, z, out.velocity);
      }
      out.friction = p.metalness > 0.5 ? 0.35 : 0.65; out.restitution = 0.1;
    };
    this.staticTree.query(x, y, z, radius, i => check(this.statics[i])); this.queryMoving(x, y, z, radius, check);
    const c = this.runtime.crowd;
    // The index updates at 25 Hz; include the fastest train's travel and a tilted rider's horizontal extent.
    c.neighbors(x, z, radius + 5, i => {
      const o = i * 3, pen = radius - this.guestDistance(i, x, y, z, this.runtime.elapsed);
      if (pen <= 0 || pen <= best) return; best = pen; out.penetration = pen;
      for (let k = 0; k < 3; k++) out.normal[k] = this.worldNormal[k];
      for (let k = 0; k < 3; k++) out.velocity[k] = c.vel[o + k]; out.friction = 0.5; out.restitution = 0.03;
      if (c.mode[i] === GuestMode.Riding) { this.runtime.guestSeat(i, this.scratchPose, this.runtime.elapsed); this.surfaceVelocity(x, y, z, out.velocity); }
    });
    return best > 0;
  }
  sweep(from: Vec3, to: Vec3, radius: number, out: EnvironmentContact): number {
    const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2], length = Math.hypot(dx, dy, dz);
    if (length < radius * 0.25 && this.dt <= 0.0005) return 1;
    let earliest = 1;
    const check = (p: ParkPart): void => {
      let t = 0;
      const speed = length + (p.body >= 0 ? Math.hypot(...this.runtime.bodies[p.body].vel) * this.dt + Math.hypot(...this.runtime.bodies[p.body].omega) * (Math.hypot(...p.pos) + Math.hypot(...p.half)) * this.dt : 0);
      for (let iteration = 0; iteration < 48 && t < earliest; iteration++) {
        const x = from[0] + dx * t, y = from[1] + dy * t, z = from[2] + dz * t;
        const d = this.distance(p, x, y, z, this.runtime.elapsed - this.dt * (1 - t)) - radius;
        if (d < 0.00005) {
          if (t < 1e-6) return; earliest = t;
          for (let k = 0; k < 3; k++) { out.normal[k] = this.worldNormal[k]; out.velocity[k] = p.body >= 0 ? this.scratchPose.vel[k] : 0; }
          if (p.body >= 0) this.surfaceVelocity(x, y, z, out.velocity);
          out.penetration = Math.max(0.0005, -(dx * out.normal[0] + dy * out.normal[1] + dz * out.normal[2]) * (1 - t)); out.friction = 0.45; out.restitution = 0.1; return;
        }
        t += Math.max(0.00001, d / Math.max(speed, 1e-9) * 0.9);
      }
    };
    const x = (from[0] + to[0]) / 2, y = (from[1] + to[1]) / 2, z = (from[2] + to[2]) / 2, reach = length / 2 + radius;
    this.staticTree.query(x, y, z, reach, i => check(this.statics[i])); this.sync();
    if (++this.sweepStamp >= 0xffffffff) { for (const stamps of this.sweepIgnored) stamps.fill(0); this.sweepStamp = 1; }
    this.bodyTree.query(x, y, z, reach, i => {
      const tree = this.localTrees[i], body = this.activeBodies[i], current = this.runtime.bodies[body], ignored = this.sweepIgnored[i];
      // Retain the existing CCD motion-rate approximation (endpoint linear/angular velocities), using the largest local radius.
      // The broad-phase envelope above is independently analytic; it does not assume these secant velocities bound nonlinear FK.
      const speed = length + Math.hypot(...current.vel) * this.dt + Math.hypot(...current.omega) * this.aggregateRadii[i] * this.dt;
      let t = 0;
      for (let iteration = 0; iteration < 48 && t < earliest; iteration++) {
        const px = from[0] + dx * t, py = from[1] + dy * t, pz = from[2] + dz * t, time = this.runtime.elapsed - this.dt * (1 - t);
        const b = this.runtime.bodyPose(body, time, this.scratchPose);
        this.local[0] = px - b.pos[0]; this.local[1] = py - b.pos[1]; this.local[2] = pz - b.pos[2]; inverseRotate(b.rot, this.local, this.local);
        let nearest = -1, distance = Infinity;
        tree.nearest(this.local[0], this.local[1], this.local[2], index => {
          if (ignored[index] === this.sweepStamp) return Infinity;
          const d = this.distance(tree.items[index], px, py, pz, time);
          if (d < distance) { nearest = index; distance = d; } return d;
        });
        const d = distance - radius;
        if (d < 0.00005) {
          // Existing per-primitive CCD ignores initial overlaps only for that shape, not all later obstacles on this body.
          if (t < 1e-6) { ignored[nearest] = this.sweepStamp; continue; }
          this.distance(tree.items[nearest], px, py, pz, time); earliest = t;
          for (let k = 0; k < 3; k++) out.normal[k] = this.worldNormal[k]; this.surfaceVelocity(px, py, pz, out.velocity);
          out.penetration = Math.max(0.0005, -(dx * out.normal[0] + dy * out.normal[1] + dz * out.normal[2]) * (1 - t)); out.friction = 0.45; out.restitution = 0.1; return;
        }
        t += Math.max(0.00001, d / Math.max(speed, 1e-9) * 0.9);
      }
      // Grazing one surface can stall advancement before a different surface. Keep the prior detailed sweep as a bounded fallback.
      if (t < earliest) for (const p of tree.items) check(p);
    });
    const c = this.runtime.crowd;
    c.neighbors(x, z, reach + 5, i => {
      let t = 0; const o = i * 3, speed = length + Math.hypot(c.vel[o], c.vel[o + 1], c.vel[o + 2]) * this.dt;
      for (let n = 0; n < 48 && t < earliest; n++) {
        const d = this.guestDistance(i, from[0] + dx * t, from[1] + dy * t, from[2] + dz * t, this.runtime.elapsed - this.dt * (1 - t)) - radius;
        if (d < 0.00005) { if (t < 1e-6) return; earliest = t; for (let k = 0; k < 3; k++) { out.normal[k] = this.worldNormal[k]; out.velocity[k] = c.vel[o + k]; } out.penetration = Math.max(0.0005, -(dx * out.normal[0] + dy * out.normal[1] + dz * out.normal[2]) * (1 - t)); out.friction = 0.5; out.restitution = 0.03; return; }
        t += Math.max(0.00001, d / Math.max(speed, 1e-9) * 0.9);
      }
    }); return earliest;
  }
}
