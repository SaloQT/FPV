import type { Vec3 } from '../../contracts';
import { PartBVH, partDistance } from './collision';
import { inverseRotate } from './math';
import type { ParkData, ParkPart } from './types';

/** Route public paths around the actual ground-level structure before generating their pavement. */
export function routeParkPaths(park: ParkData): void {
  const bounds: number[] = [], obstacles: ParkPart[] = [];
  for (const p of park.parts) {
    if (!p.solid || p.body >= 0) continue;
    const [x, y, z, w] = p.rot, h = p.half;
    const m = [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y), 2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x), 2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)];
    const extent = [0, 1, 2].map(k => Math.abs(m[k * 3]) * h[0] + Math.abs(m[k * 3 + 1]) * h[1] + Math.abs(m[k * 3 + 2]) * h[2]);
    if (p.pos[1] + extent[1] < 12.65 || p.pos[1] - extent[1] > 14.3) continue;
    obstacles.push(p); bounds.push(...p.pos.map((v, k) => v - extent[k]), ...p.pos.map((v, k) => v + extent[k]));
  }
  const tree = new PartBVH(obstacles, Float64Array.from(bounds)), local: Vec3 = [0, 0, 0], normal: Vec3 = [0, 1, 0];
  const cell = 3, origin = -1020, side = 681, total = side * side;
  const cost = new Float64Array(total), parent = new Int32Array(total), stamp = new Uint32Array(total), closed = new Uint32Array(total);
  const masks = new Map<number, Int8Array>(), wideMasks = new Map<number, Int8Array>(); let search = 0;
  const clear = (x: number, z: number, radius: number): boolean => {
    let ok = true;
    for (const r of park.rides) if (!r.curve && Math.hypot(x - r.pos[0], z - r.pos[2]) < r.radius + 3.3 + radius) return false;
    tree.query(x, 13.4, z, radius + 0.7, index => {
      if (!ok) return; const p = obstacles[index]; local[0] = x - p.pos[0]; local[1] = 13.4 - p.pos[1]; local[2] = z - p.pos[2]; inverseRotate(p.rot, local, local);
      if (partDistance(p, local, normal) < radius) ok = false;
    }); return ok;
  };
  const segment = (a: Vec3, b: Vec3, radius: number): boolean => {
    const dx = b[0] - a[0], dz = b[2] - a[2], length = Math.hypot(dx, dz), length2 = length * length;
    if (length < 1e-8) return clear(a[0], a[2], radius);
    for (const r of park.rides) if (!r.curve) {
      const t = Math.max(0, Math.min(1, ((r.pos[0] - a[0]) * dx + (r.pos[2] - a[2]) * dz) / length2));
      if (Math.hypot(r.pos[0] - a[0] - t * dx, r.pos[2] - a[2] - t * dz) < r.radius + 3.3 + radius) return false;
    }
    let ok = true;
    const minX = Math.min(a[0], b[0]) - radius, maxX = Math.max(a[0], b[0]) + radius, minZ = Math.min(a[2], b[2]) - radius, maxZ = Math.max(a[2], b[2]) + radius;
    tree.query((a[0] + b[0]) / 2, 13.4, (a[2] + b[2]) / 2, length / 2 + radius, index => {
      if (!ok) return;
      const o = index * 6;
      if (bounds[o] > maxX || bounds[o + 3] < minX || bounds[o + 2] > maxZ || bounds[o + 5] < minZ) return;
      const p = obstacles[index], start: Vec3 = [a[0] - p.pos[0], 13.4 - p.pos[1], a[2] - p.pos[2]], direction: Vec3 = [dx / length, 0, dz / length];
      inverseRotate(p.rot, start, start); inverseRotate(p.rot, direction, direction);
      // Signed distances are 1-Lipschitz: each advance proves the entire skipped interval clear.
      // Point sampling missed thin columns/walls between samples and A* grid vertices.
      let distance = 0;
      for (let i = 0; i < 48; i++) {
        local[0] = start[0] + direction[0] * distance; local[1] = start[1] + direction[1] * distance; local[2] = start[2] + direction[2] * distance;
        const gap = partDistance(p, local, normal) - radius;
        if (gap <= 0.0001) { ok = false; return; }
        if (distance + gap > length) return;
        distance += gap;
      }
      // A grazing edge that has not proved clear is rerouted, never accepted optimistically.
      ok = false;
    });
    return ok;
  };
  const point = (id: number): Vec3 => [origin + id % side * cell, 12.2, origin + Math.floor(id / side) * cell];
  const idFor = (p: Vec3) => Math.round((p[2] - origin) / cell) * side + Math.round((p[0] - origin) / cell);
  const original = park.paths; park.paths = []; for (const n of park.nodes) n.links = [];
  const junctionRadius = park.nodes.map((_, id) => original.reduce((v, p) => p.a === id || p.b === id ? Math.max(v, p.width / 2 + 0.35) : v, 0.35));
  const gridConnection = (p: Vec3, radius: number): boolean => {
    const gx = Math.round((p[0] - origin) / cell), gz = Math.round((p[2] - origin) / cell);
    for (let z = gz - 2; z <= gz + 2; z++) for (let x = gx - 2; x <= gx + 2; x++) {
      if (x < 0 || z < 0 || x >= side || z >= side) continue;
      const q = point(z * side + x); if (clear(q[0], q[2], radius) && segment(p, q, radius)) return true;
    }
    return false;
  };
  // Reserve a junction disc for the widest adjoining path; decorative objects may otherwise cover a sampled junction.
  for (let id = 0; id < park.nodes.length; id++) {
    const radius = junctionRadius[id], p = park.nodes[id].pos;
    if (clear(p[0], p[2], radius) && gridConnection(p, radius)) continue;
    let moved = false;
    for (let r = 3; r <= 60 && !moved; r += 3) for (let j = 0; j < 32; j++) { const a = j * Math.PI / 16, x = p[0] + Math.cos(a) * r, z = p[2] + Math.sin(a) * r;
      if (clear(x, z, radius) && gridConnection([x, p[1], z], radius)) { p[0] = x; p[2] = z; moved = true; break; }
    }
    if (!moved) throw new Error(`No clear pedestrian junction at ${id}`);
  }
  const connect = (a: number, b: number, width: number) => { park.paths.push({ a, b, width }); park.nodes[a].links.push(b); park.nodes[b].links.push(a); };
  const originalNodes = park.nodes.length;
  let lastBlocked = '';
  for (let attempt = 0; attempt < 24; attempt++) {
    park.nodes.length = originalNodes; park.paths = []; for (const n of park.nodes) n.links = [];
    let retry = false;
    for (const path of original) {
    const a = park.nodes[path.a].pos, b = park.nodes[path.b].pos, radius = path.width / 2 + 0.35;
    if (segment(a, b, radius)) { connect(path.a, path.b, path.width); continue; }
    if (!clear(a[0], a[2], radius) || !clear(b[0], b[2], radius)) throw new Error(`Path endpoint ${path.a}–${path.b} intersects a structure`);
    let mask = masks.get(path.width); if (!mask) { mask = new Int8Array(total); masks.set(path.width, mask); }
    const open = (id: number) => {
      if (id < 0 || id >= total) return false;
      if (!mask![id]) { const p = point(id); mask![id] = clear(p[0], p[2], radius) ? 1 : -1; } return mask![id] === 1;
    };
    const gridEnd = (p: Vec3): number => {
      const at = idFor(p), atX = Math.round((p[0] - origin) / cell), atZ = Math.round((p[2] - origin) / cell); let best = -1, distance = Infinity;
      for (let dz = -5; dz <= 5; dz++) for (let dx = -5; dx <= 5; dx++) {
        if (atX + dx < 0 || atX + dx >= side || atZ + dz < 0 || atZ + dz >= side) continue;
        const id = at + dz * side + dx; if (!open(id)) continue; const q = point(id), d = Math.hypot(p[0] - q[0], p[2] - q[2]);
        if (d < distance && segment(p, q, radius)) { distance = d; best = id; }
      }
      if (best < 0) throw new Error('Pedestrian junction has no clear grid connection'); return best;
    };
    const start = gridEnd(a), end = gridEnd(b); search++;
    let wide = wideMasks.get(path.width); if (!wide) { wide = new Int8Array(total); wideMasks.set(path.width, wide); }
    const edge = (from: number, to: number): boolean => {
      for (const id of [from, to]) if (!wide![id]) { const p = point(id); wide![id] = clear(p[0], p[2], radius + cell * Math.SQRT2) ? 1 : -1; }
      // Every graph edge is undirected. A finite conservative-advance budget can prove a grazing
      // segment from only one end, so use the same canonical test in both A* and component floods.
      return wide![from] === 1 || wide![to] === 1 || segment(point(Math.min(from, to)), point(Math.max(from, to)), radius);
    };
    const heap: { id: number; f: number }[] = [];
    const heuristic = (id: number) => Math.hypot(id % side - end % side, Math.floor(id / side) - Math.floor(end / side));
    const push = (id: number, f: number) => { let i = heap.length; heap.push({ id, f }); while (i) { const p = (i - 1) >>> 1; if (heap[p].f <= f) break; heap[i] = heap[p]; i = p; } heap[i] = { id, f }; };
    const pop = () => { const result = heap[0], tail = heap.pop()!; if (heap.length) { let i = 0; while (i * 2 + 1 < heap.length) { let j = i * 2 + 1; if (j + 1 < heap.length && heap[j + 1].f < heap[j].f) j++; if (heap[j].f >= tail.f) break; heap[i] = heap[j]; i = j; } heap[i] = tail; } return result.id; };
    stamp[start] = search; cost[start] = 0; parent[start] = -1; push(start, heuristic(start)); let found = false;
    while (heap.length) {
      const id = pop(); if (closed[id] === search) continue; closed[id] = search;
      if (id === end) { found = true; break; }
      const x = id % side, z = Math.floor(id / side);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if ((!dx && !dz) || x + dx < 0 || x + dx >= side || z + dz < 0 || z + dz >= side) continue;
        const next = id + dz * side + dx;
        if (closed[next] === search || next !== end && !open(next) || dx && dz && (!open(id + dx) || !open(id + dz * side)) || !edge(id, next)) continue;
        const v = cost[id] + Math.hypot(dx, dz);
        if (stamp[next] !== search || v < cost[next]) { cost[next] = v; stamp[next] = search; parent[next] = id; push(next, v + heuristic(next)); }
      }
    }
    if (!found) {
      lastBlocked = `${path.a}-${path.b} width ${path.width} from ${a[0].toFixed(1)},${a[2].toFixed(1)} to ${b[0].toFixed(1)},${b[2].toFixed(1)}`;
      // A decorative cluster can leave a clear but enclosed junction. Move it to the exterior component, then
      // reroute every adjoining road so an earlier road cannot become invalid when its endpoint changes.
      const exterior = new Uint8Array(total), pending = new Int32Array(total); let head = 0, tail = 1;
      pending[0] = gridEnd(park.nodes[0].pos); exterior[pending[0]] = 1;
      while (head < tail) { const id = pending[head++], x = id % side, z = Math.floor(id / side);
        for (const delta of [-side, -1, 1, side]) { const next = id + delta;
          if (delta === -1 && x === 0 || delta === 1 && x === side - 1 || delta === -side && z === 0 || delta === side && z === side - 1 || exterior[next] || !open(next) || !edge(id, next)) continue;
          exterior[next] = 1; pending[tail++] = next;
        }
      }
      for (const nodeId of [path.a, path.b]) {
        const p = park.nodes[nodeId].pos, required = junctionRadius[nodeId];
        if (exterior[gridEnd(p)]) continue;
        let nearest = -1, distance = Infinity;
        for (let i = 0; i < tail; i++) { const id = pending[i], q = point(id), d = Math.hypot(q[0] - p[0], q[2] - p[2]); if (d < distance && clear(q[0], q[2], required) && gridConnection(q, required)) { distance = d; nearest = id; } }
        if (nearest < 0) throw new Error('No exterior pedestrian network'); const q = point(nearest); p[0] = q[0]; p[2] = q[2];
      }
      retry = true; break;
    }
    const raw: Vec3[] = [b]; for (let id = end; id >= 0; id = parent[id]) raw.push(point(id)); raw.push(a); raw.reverse();
    const simplified = [a]; let from = 0;
    while (from < raw.length - 1) { let to = from + 1; for (let j = to + 1; j < raw.length; j++) if (segment(raw[from], raw[j], radius)) to = j; simplified.push(raw[to]); from = to; }
    let previous = path.a;
    for (let i = 1; i < simplified.length; i++) { const next = i === simplified.length - 1 ? path.b : park.nodes.push({ pos: simplified[i], links: [], kind: 'path' }) - 1; connect(previous, next, path.width); previous = next; }
    }
    if (!retry) return;
  }
  throw new Error(`Could not reserve a connected pedestrian network (${lastBlocked})`);
}
