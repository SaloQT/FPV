import type { Vec3 } from '../../contracts';
import { Rng, deriveSeed } from '../track/rng';
import { GUEST_MAX_HEIGHT, GUEST_SEAT_PAN_FRONT, guestMaxWalkSpeed } from './guestPose';
import { clamp, distance } from './math';
import type { ParkData } from './types';

export const GuestMode = { Walk: 0, Queue: 1, Boarding: 2, Riding: 3, Exit: 4, Rest: 5 } as const;
const CELL = 3, SIDE = 688, ORIGIN = -1032;
// ORCA's finite horizon only needs the closest neighbours, not every person on a busy plaza.
const MAX_NEIGHBORS = 20;
const SHIRTS = [[0.045, 0.085, 0.16], [0.55, 0.075, 0.055], [0.14, 0.25, 0.2], [0.72, 0.65, 0.5], [0.12, 0.24, 0.42], [0.42, 0.18, 0.29], [0.65, 0.66, 0.62], [0.06, 0.065, 0.075]];
/** Standard normal quantile of a uniform draw (Abramowitz and Stegun 26.2.23, error under 5e-4). */
export function normalQuantile(u: number): number {
  const p = clamp(u, 1e-6, 1 - 1e-6), q = p < 0.5 ? p : 1 - p, t = Math.sqrt(-2 * Math.log(q));
  const x = t - (2.515517 + 0.802853 * t + 0.010328 * t * t) / (1 + 1.432788 * t + 0.189269 * t * t + 0.001308 * t ** 3);
  return p < 0.5 ? -x : x;
}

/**
 * Standing height in metres from a uniform draw. Adults follow a bell curve about the adult average, not an even spread: US men aged 20 and over average about
 * 1.75 m (CDC NCHS Anthropometric Reference Data 2015-2018, stacks.cdc.gov/view/cdc/100478) and women about 1.61 m (not confirmed), so mixed adults centre on about 1.68 m.
 * Children are spread evenly over the 1.05 to 1.5 m of roughly four to twelve years old.
 */
export function guestStature(child: boolean, u: number): number {
  return child ? 1.05 + 0.45 * u : clamp(1.68 + 0.09 * normalQuantile(u), 1.5, GUEST_MAX_HEIGHT);
}

/**
 * Body mass in kilograms from a stature and a uniform draw, through a body mass index so that no guest is far lighter or heavier than a person of that height could be.
 * Adults centre on an index of 26 and stay within 17 to 40 (WHO bands: under 16 is severe thinness, 40 and over is class III obesity); children use 14.5 to 20.
 */
export function guestMass(child: boolean, height: number, u: number): number {
  const index = child ? 14.5 + 5.5 * u : clamp(26 * Math.exp(0.16 * normalQuantile(u)), 17, 40);
  return index * height * height;
}

export interface AvoidanceLine { nx: number; nz: number; c: number }

/** Closest feasible velocity in the speed disc and ORCA half-planes (incremental 2D linear program). */
export function avoidVelocity(vx: number, vz: number, speed: number, lines: readonly AvoidanceLine[], out: Float64Array): void {
  let x = vx, z = vz;
  const length = Math.sqrt(x * x + z * z); if (length > speed) { x *= speed / length; z *= speed / length; }
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]; if (l.nx * x + l.nz * z >= l.c - 1e-9) continue;
    const c = clamp(l.c, -speed, speed), px = l.nx * c, pz = l.nz * c, tx = -l.nz, tz = l.nx;
    let lo = -Math.sqrt(Math.max(0, speed * speed - c * c)), hi = -lo;
    for (let j = 0; j < i; j++) {
      const a = lines[j], den = a.nx * tx + a.nz * tz, num = a.c - a.nx * px - a.nz * pz;
      if (Math.abs(den) < 1e-9) { if (num > 0) { lo = 1; hi = 0; break; } }
      else if (den > 0) lo = Math.max(lo, num / den); else hi = Math.min(hi, num / den);
    }
    if (lo <= hi) { const t = clamp((vx - px) * tx + (vz - pz) * tz, lo, hi); x = px + tx * t; z = pz + tz * t; }
    else { // Dense infeasible packs decelerate; never manufacture unbounded velocities.
      x *= 0.5; z *= 0.5;
    }
  }
  out[0] = x; out[1] = z;
}

export class Crowd {
  readonly count: number;
  readonly pos: Float64Array;
  readonly previous: Float64Array;
  readonly vel: Float64Array;
  readonly yaw: Float64Array;
  readonly height: Float32Array;
  readonly mass: Float32Array;
  readonly tint: Float32Array;
  readonly mode: Uint8Array;
  readonly ride: Int16Array;
  readonly train: Int8Array;
  readonly seat: Int16Array;
  readonly transition: Float64Array;
  /** Zero on foot, one attached to the seat; fixed-tick history drives render interpolation. */
  readonly seatBlend: Float64Array;
  readonly previousSeatBlend: Float64Array;
  readonly seatAngle: Float64Array;
  /** 1 for a guest riding astride a mount (a carousel horse), whose legs go either side of it; 0 for everyone else. */
  readonly straddle: Float32Array;
  /** How far in front of the seat origin the guest's seat pan reaches, metres; seats deeper than the standard one need the guest to sit further forward. */
  readonly seatFront: Float32Array;
  /** Only boarding/exit walkers near a generated stair flight use explicit foot contacts. */
  readonly stairFlight: Int16Array;
  readonly stairActivity: Float64Array;
  readonly previousStairActivity: Float64Array;
  readonly node: Int16Array;
  readonly target: Int16Array;
  readonly goal: Int16Array;
  readonly queue: number[][];
  readonly queueProgress: Float64Array;
  private readonly widths: Float32Array;
  private readonly edges: Float64Array;
  private readonly occupied: Int32Array;
  private occupiedCount = 0;
  private readonly velocitySnapshot: Float64Array;
  private readonly queuePlace: Int16Array;
  private readonly facilities: number[];
  private readonly neighborIds = new Int32Array(MAX_NEIGHBORS);
  private readonly neighborDistances = new Float64Array(MAX_NEIGHBORS);
  private readonly linePool: AvoidanceLine[] = [];
  readonly heads = new Int32Array(SIDE * SIDE).fill(-1);
  readonly next: Int32Array;
  readonly nextHop: Int16Array;
  avoidObstacles?: (x: number, y: number, z: number, lines: AvoidanceLine[]) => void;
  private readonly lines: AvoidanceLine[] = [];
  private readonly result = new Float64Array(2);
  private readonly rng: Rng;
  private readonly nodeCount: number;

  constructor(readonly park: ParkData) {
    this.count = park.recipe.guests; const n = this.count;
    this.pos = new Float64Array(n * 3); this.previous = new Float64Array(n * 3); this.vel = new Float64Array(n * 3);
    this.yaw = new Float64Array(n); this.height = new Float32Array(n); this.mass = new Float32Array(n); this.tint = new Float32Array(n * 3);
    this.mode = new Uint8Array(n); this.ride = new Int16Array(n).fill(-1); this.train = new Int8Array(n); this.seat = new Int16Array(n).fill(-1); this.transition = new Float64Array(n);
    this.seatBlend = new Float64Array(n); this.previousSeatBlend = new Float64Array(n);
    this.seatAngle = new Float64Array(n).fill(1.45);
    this.straddle = new Float32Array(n);
    this.seatFront = new Float32Array(n).fill(GUEST_SEAT_PAN_FRONT);
    this.stairFlight = new Int16Array(n).fill(-1);
    this.stairActivity = new Float64Array(n).fill(1); this.previousStairActivity = new Float64Array(n).fill(1);
    this.node = new Int16Array(n); this.target = new Int16Array(n); this.goal = new Int16Array(n);
    this.next = new Int32Array(n).fill(-1); this.queue = park.rides.map(() => []);
    this.queueProgress = new Float64Array(n);
    this.occupied = new Int32Array(Math.min(n, SIDE * SIDE)); this.velocitySnapshot = new Float64Array(n * 3); this.queuePlace = new Int16Array(n);
    this.facilities = park.nodes.flatMap((node, i) => node.kind === 'facility' ? [i] : []);
    this.rng = new Rng(deriveSeed(park.recipe.seed, 910)); this.nodeCount = park.nodes.length;
    const k = this.nodeCount, d = new Float64Array(k * k).fill(Infinity); this.nextHop = new Int16Array(k * k).fill(-1);
    this.widths = new Float32Array(k * k).fill(6);
    this.edges = new Float64Array(k * k * 4);
    for (const p of park.paths) this.widths[p.a * k + p.b] = this.widths[p.b * k + p.a] = p.width;
    for (let i = 0; i < k; i++) for (const j of park.nodes[i].links) {
      const a = park.nodes[i].pos, b = park.nodes[j].pos, o = (i * k + j) * 4, dx = b[0] - a[0], dz = b[2] - a[2], length2 = dx * dx + dz * dz;
      this.edges[o] = dx; this.edges[o + 1] = dz; this.edges[o + 2] = 1 / (length2 || 1); this.edges[o + 3] = 1 / (Math.sqrt(length2) || 1);
    }
    for (let i = 0; i < k; i++) { d[i * k + i] = 0; for (const j of park.nodes[i].links) { d[i * k + j] = distance(park.nodes[i].pos, park.nodes[j].pos); this.nextHop[i * k + j] = j; } }
    for (let mid = 0; mid < k; mid++) for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) {
      const v = d[i * k + mid] + d[mid * k + j]; if (v < d[i * k + j]) { d[i * k + j] = v; this.nextHop[i * k + j] = this.nextHop[i * k + mid]; }
    }
    // Navigation detours may introduce tiny segments; density must depend on walkable area,
    // otherwise every little corner receives the population of an entire broad avenue.
    const areas = new Float64Array(park.paths.length); let totalArea = 0;
    for (let i = 0; i < park.paths.length; i++) { const path = park.paths[i]; totalArea += distance(park.nodes[path.a].pos, park.nodes[path.b].pos) * path.width; areas[i] = totalArea; }
    for (let i = 0; i < n; i++) {
      const rng = new Rng(deriveSeed(park.recipe.seed, 911, i)), sample = rng.next() * totalArea;
      let lo = 0, hi = areas.length - 1; while (lo < hi) { const mid = (lo + hi) >>> 1; if (sample < areas[mid]) hi = mid; else lo = mid + 1; }
      const path = park.paths[lo], reverse = rng.chance(0.5), from = reverse ? path.b : path.a, to = reverse ? path.a : path.b;
      const a = park.nodes[from].pos, b = park.nodes[to].pos, f = rng.next();
      const dx = b[0] - a[0], dz = b[2] - a[2], len = Math.hypot(dx, dz) || 1, side = rng.range(-path.width * 0.35, path.width * 0.35);
      this.pos.set([a[0] + dx * f + dz / len * side, a[1], a[2] + dz * f - dx / len * side], i * 3);
      this.node[i] = from; this.target[i] = to;
      this.yaw[i] = Math.atan2(-dx, -dz);
      this.ride[i] = rng.int(0, park.rides.length - 1); this.goal[i] = park.rides[this.ride[i]].station;
      const child = rng.chance(0.17);
      this.height[i] = guestStature(child, rng.next());
      this.mass[i] = guestMass(child, this.height[i], rng.next());
      const shirt = rng.pick(SHIRTS), fade = rng.range(0.8, 1.1);
      this.tint.set(shirt.map(channel => channel * fade), i * 3);
    }
    this.previous.set(this.pos); this.reindex();
  }
  reindex(): void {
    // Clear only occupied cells: most of the 688² grid is empty, including on a full Mega park.
    for (let i = 0; i < this.occupiedCount; i++) this.heads[this.occupied[i]] = -1;
    this.occupiedCount = 0;
    for (let i = this.count - 1; i >= 0; i--) {
      const x = Math.floor((this.pos[i * 3] - ORIGIN) / CELL), z = Math.floor((this.pos[i * 3 + 2] - ORIGIN) / CELL);
      if (x < 0 || z < 0 || x >= SIDE || z >= SIDE) continue;
      const cell = z * SIDE + x; if (this.heads[cell] < 0) this.occupied[this.occupiedCount++] = cell;
      this.next[i] = this.heads[cell]; this.heads[cell] = i;
    }
  }
  neighbors(x: number, z: number, radius: number, visit: (i: number) => void): void {
    const x0 = Math.max(0, Math.floor((x - radius - ORIGIN) / CELL)), x1 = Math.min(SIDE - 1, Math.floor((x + radius - ORIGIN) / CELL));
    const z0 = Math.max(0, Math.floor((z - radius - ORIGIN) / CELL)), z1 = Math.min(SIDE - 1, Math.floor((z + radius - ORIGIN) / CELL));
    for (let zz = z0; zz <= z1; zz++) for (let xx = x0; xx <= x1; xx++) for (let i = this.heads[zz * SIDE + xx]; i >= 0; i = this.next[i]) visit(i);
  }
  chooseDestination(i: number): void {
    const facilities = this.facilities;
    if (facilities.length && this.rng.chance(0.18)) { this.ride[i] = -1; this.goal[i] = this.rng.pick(facilities); return; }
    // A full queue used to reselect itself, producing a nonexistent station→entrance edge.
    // Two sampled alternatives give guests a preference for shorter waits without a global sort.
    const rides = this.park.rides, start = this.rng.int(0, rides.length - 1);
    let chosen = -1, best = Infinity;
    for (let offset = 0; offset < rides.length; offset++) {
      const id = (start + offset) % rides.length, r = rides[id];
      if (r.station === this.node[i] || this.queue[id].length >= r.queue.length) continue;
      const wait = this.queue[id].length / Math.max(1, r.capacity);
      if (wait < best) { chosen = id; best = wait; }
      if (offset >= 1 && chosen >= 0) break;
    }
    this.ride[i] = chosen >= 0 ? chosen : start;
    this.goal[i] = this.park.rides[this.ride[i]].station;
  }
  private addLine(nx: number, nz: number, c: number): void {
    const index = this.lines.length, line = this.linePool[index] ?? (this.linePool[index] = { nx: 0, nz: 0, c: 0 });
    line.nx = nx; line.nz = nz; line.c = c; this.lines.push(line);
  }
  decide(dt: number): void {
    for (let i = 0; i < this.count; i++) if (this.mode[i] === GuestMode.Rest) {
      this.transition[i] -= dt;
      if (this.transition[i] <= 0) { this.mode[i] = GuestMode.Walk; this.chooseDestination(i); const next = this.nextHop[this.node[i] * this.nodeCount + this.goal[i]]; this.target[i] = next >= 0 ? next : this.park.nodes[this.node[i]].links[0]; }
    }
  }
  steer(dt: number, drone: Vec3 | null): void {
    this.reindex();
    this.velocitySnapshot.set(this.vel);
    for (const q of this.queue) for (let place = 0; place < q.length; place++) this.queuePlace[q[place]] = place;
    const p = this.pos, v = this.vel, previousV = this.velocitySnapshot, nodes = this.park.nodes;
    for (let i = 0; i < this.count; i++) {
      const o = i * 3, mode = this.mode[i];
      if (mode === GuestMode.Riding || mode === GuestMode.Boarding || mode === GuestMode.Exit || mode === GuestMode.Rest) continue;
      let tx: number, tz: number;
      if (mode === GuestMode.Queue) {
        const place = this.queuePlace[i], path = this.park.rides[this.ride[i]].queue;
        let progress = Math.max(place, Math.round(this.queueProgress[i]));
        if (progress > place && (path[progress][0] - p[o]) ** 2 + (path[progress][2] - p[o + 2]) ** 2 < 0.25) progress--;
        this.queueProgress[i] = progress; const dst = path[progress]; tx = dst[0]; tz = dst[2];
      } else {
        let goal = nodes[this.target[i]].pos;
        if ((goal[0] - p[o]) ** 2 + (goal[2] - p[o + 2]) ** 2 < 1.44) {
          this.node[i] = this.target[i];
          if (this.node[i] === this.goal[i]) {
            if (this.ride[i] < 0) { this.mode[i] = GuestMode.Rest; this.transition[i] = this.rng.range(15, 50); v[o] = v[o + 2] = 0; continue; }
            const q = this.queue[this.ride[i]];
            if (q.length < this.park.rides[this.ride[i]].queue.length) { this.mode[i] = GuestMode.Queue; this.queueProgress[i] = this.park.rides[this.ride[i]].queue.length - 1; q.push(i); v[o] = v[o + 2] = 0; continue; }
            this.chooseDestination(i);
          }
          const next = this.nextHop[this.node[i] * this.nodeCount + this.goal[i]];
          this.target[i] = next >= 0 ? next : nodes[this.node[i]].links[0];
          goal = nodes[this.target[i]].pos;
        }
        tx = goal[0]; tz = goal[2];
        // Bidirectional traffic naturally keeps right; ease back to the junction centre at turns.
        const edge = (this.node[i] * this.nodeCount + this.target[i]) * 4, invLength = this.edges[edge + 3];
        const remaining = Math.sqrt((tx - p[o]) ** 2 + (tz - p[o + 2]) ** 2);
        const lane = Math.min(1.1, this.widths[edge / 4] * 0.19) * Math.min(1, remaining / 5);
        tx += this.edges[edge + 1] * invLength * lane; tz -= this.edges[edge] * invLength * lane;
      }
      const dx = tx - p[o], dz = tz - p[o + 2], len = Math.sqrt(dx * dx + dz * dz), speed = Math.min((1.05 + (i % 9) * 0.065) * Math.min(1, Math.sqrt(this.height[i] / 1.75)), guestMaxWalkSpeed(), len * 1.8);
      let wantedX = dx / (len || 1) * speed, wantedZ = dz / (len || 1) * speed;
      this.lines.length = 0;
      if (mode === GuestMode.Walk) {
        const a = nodes[this.node[i]].pos, edge = (this.node[i] * this.nodeCount + this.target[i]) * 4;
        const nx = -this.edges[edge + 1] * this.edges[edge + 3], nz = this.edges[edge] * this.edges[edge + 3];
        const side = (p[o] - a[0]) * nx + (p[o + 2] - a[2]) * nz, half = this.widths[edge / 4] / 2 - 0.35;
        this.addLine(nx, nz, (-half - side) / dt); this.addLine(-nx, -nz, (side - half) / dt);
      }
      this.avoidObstacles?.(p[o], p[o + 1], p[o + 2], this.lines);
      let neighborCount = 0;
      const x0 = Math.max(0, Math.floor((p[o] - 3 - ORIGIN) / CELL)), x1 = Math.min(SIDE - 1, Math.floor((p[o] + 3 - ORIGIN) / CELL));
      const z0 = Math.max(0, Math.floor((p[o + 2] - 3 - ORIGIN) / CELL)), z1 = Math.min(SIDE - 1, Math.floor((p[o + 2] + 3 - ORIGIN) / CELL));
      for (let zz = z0; zz <= z1; zz++) for (let xx = x0; xx <= x1; xx++) for (let j = this.heads[zz * SIDE + xx]; j >= 0; j = this.next[j]) {
        if (j === i || this.mode[j] === GuestMode.Riding || Math.abs(p[j * 3 + 1] - p[o + 1]) > 1.5) continue;
        const rx = p[j * 3] - p[o], rz = p[j * 3 + 2] - p[o + 2], d2 = rx * rx + rz * rz;
        if (d2 > 9 || neighborCount === MAX_NEIGHBORS && d2 >= this.neighborDistances[neighborCount - 1]) continue;
        let at = Math.min(neighborCount, MAX_NEIGHBORS - 1);
        while (at > 0 && (d2 < this.neighborDistances[at - 1] || d2 === this.neighborDistances[at - 1] && j < this.neighborIds[at - 1])) {
          this.neighborDistances[at] = this.neighborDistances[at - 1]; this.neighborIds[at] = this.neighborIds[at - 1]; at--;
        }
        this.neighborDistances[at] = d2; this.neighborIds[at] = j; neighborCount = Math.min(neighborCount + 1, MAX_NEIGHBORS);
      }
      for (let neighbor = 0; neighbor < neighborCount; neighbor++) {
        const j = this.neighborIds[neighbor], d2 = this.neighborDistances[neighbor], rx = p[j * 3] - p[o], rz = p[j * 3 + 2] - p[o + 2];
        const radius = 0.58, rvx = previousV[o] - previousV[j * 3], rvz = previousV[o + 2] - previousV[j * 3 + 2];
        const inv = d2 > radius * radius ? 0.65 : 1 / dt;
        const wx = rvx - rx * inv, wz = rvz - rz * inv, wl = Math.sqrt(wx * wx + wz * wz);
        let nx: number, nz: number, ux: number, uz: number;
        if (d2 <= radius * radius || ((wx * rx + wz * rz) < 0 && (wx * rx + wz * rz) ** 2 > radius * radius * wl * wl)) {
          nx = wl > 1e-8 ? wx / wl : i < j ? 1 : -1; nz = wl > 1e-8 ? wz / wl : 0;
          ux = (radius * inv - wl) * nx; uz = (radius * inv - wl) * nz;
        } else {
          const leg = Math.sqrt(Math.max(0, d2 - radius * radius)), left = rx * wz - rz * wx > 0;
          const lx = left ? (rx * leg - rz * radius) / d2 : -(rx * leg + rz * radius) / d2;
          const lz = left ? (rx * radius + rz * leg) / d2 : -(-rx * radius + rz * leg) / d2;
          const proj = rvx * lx + rvz * lz; ux = proj * lx - rvx; uz = proj * lz - rvz; nx = -lz; nz = lx;
        }
        // Boarding/resting guests cannot reciprocate a pedestrian's avoidance manoeuvre.
        const share = this.mode[j] === GuestMode.Walk || this.mode[j] === GuestMode.Queue ? 0.5 : 1;
        this.addLine(nx, nz, nx * (previousV[o] + ux * share) + nz * (previousV[o + 2] + uz * share));
      }
      if (drone && drone[1] - p[o + 1] < 4 && drone[1] > p[o + 1] - 1) {
        const rx = p[o] - drone[0], rz = p[o + 2] - drone[2], d = Math.sqrt(rx * rx + rz * rz);
        if (d < 5 && d > 0.01) { const f = (5 - d) * 0.45; wantedX += rx / d * f; wantedZ += rz / d * f; }
      }
      avoidVelocity(wantedX, wantedZ, guestMaxWalkSpeed(), this.lines, this.result);
      const acceleration = 2.5 * dt, dvx = this.result[0] - v[o], dvz = this.result[1] - v[o + 2], dv2 = dvx * dvx + dvz * dvz;
      const factor = dv2 > acceleration * acceleration ? acceleration / Math.sqrt(dv2) : 1;
      v[o] += dvx * factor; v[o + 2] += dvz * factor;
      if (v[o] * v[o] + v[o + 2] * v[o + 2] > 0.0025) {
        const desired = Math.atan2(-v[o], -v[o + 2]); let delta = desired - this.yaw[i];
        if (delta > Math.PI) delta -= Math.PI * 2; else if (delta < -Math.PI) delta += Math.PI * 2;
        this.yaw[i] += clamp(delta, -3.5 * dt, 3.5 * dt);
        if (this.yaw[i] > Math.PI) this.yaw[i] -= Math.PI * 2; else if (this.yaw[i] < -Math.PI) this.yaw[i] += Math.PI * 2;
      }
    }
  }
  move(dt: number): void {
    this.previous.set(this.pos);
    this.previousSeatBlend.set(this.seatBlend);
    for (let i = 0; i < this.count; i++) {
      if (this.mode[i] !== GuestMode.Walk && this.mode[i] !== GuestMode.Queue) continue;
      const o = i * 3; this.pos[o] += this.vel[o] * dt; this.pos[o + 2] += this.vel[o + 2] * dt;
      if (this.mode[i] === GuestMode.Walk) {
        const a = this.park.nodes[this.node[i]].pos, edge = (this.node[i] * this.nodeCount + this.target[i]) * 4, dx = this.edges[edge], dz = this.edges[edge + 1];
        const t = clamp(((this.pos[o] - a[0]) * dx + (this.pos[o + 2] - a[2]) * dz) * this.edges[edge + 2], 0, 1), x = a[0] + t * dx, z = a[2] + t * dz;
        const rx = this.pos[o] - x, rz = this.pos[o + 2] - z, d2 = rx * rx + rz * rz, half = this.widths[edge / 4] / 2 - 0.32;
        if (d2 > half * half) { const factor = half / Math.sqrt(d2); this.pos[o] = x + rx * factor; this.pos[o + 2] = z + rz * factor; }
      }
    }
  }
}
