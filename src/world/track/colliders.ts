/**
 * Track -> physics boxes. ObstacleCollider is yaw-only, so a bar that is not axis-aligned in the gate's yaw frame (rolled or
 * pitched gates, arches, hoops) becomes a short staircase of small boxes whose overshoot into the opening stays under 12 cm
 * (16 cm when rolled or pitched), which colliders.test.ts enforces. Walls, sleeves and composite obstacles are yaw-aligned by
 * construction (kindGeometry.ts), so each of their parts is one exact box.
 */
import type { ObstacleCollider, TerrainSampler, TrackData, TrackGate, TrackObstacle, Vec3 } from '../../contracts';
import { GATE_TUBE, archSpring, type GateFrame } from './gate';
import {
  LADDER_CAP, LADDER_RAIL, WALL_SINK, WINDOW_THICKNESS, archFeet, buildFrame, dropArm, frameFeet, isCompositeObstacle, ladderGroups, ladderRailU, obstacleParts,
  obstacleToWorld, tunnelSleeve, wallGroundPoints, windowWall, type SupportBase,
} from './kindGeometry';

const HT = GATE_TUBE / 2;
/** Length of leg used when no terrain is available to find the ground. */
export const FALLBACK_LEG = 3;
const FLAG_POLE_HALF = 0.02;
const PLATE_HALF = 0.2;
const PLATE_THICK = 0.012;

interface Ctx {
  gate: TrackGate;
  f: GateFrame;
  cy: number;
  sy: number;
  sampler?: TerrainSampler;
  out: ObstacleCollider[];
}

function pt(c: Ctx, u: number, v: number, w = 0): Vec3 {
  const p = c.gate.pos;
  const { right: r, up: q, forward: f } = c.f;
  return [p[0] + r[0] * u + q[0] * v + f[0] * w, p[1] + r[1] * u + q[1] * v + f[1] * w, p[2] + r[2] * u + q[2] * v + f[2] * w];
}

/** Adds a bar from a to b (square section, half side `half`) as the fewest yaw-aligned boxes that overshoot by <= tol / 2. */
function bar(c: Ctx, a: Vec3, b: Vec3, half: number, tol = 0.1): void {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  const lx = c.cy * dx - c.sy * dz;
  const lz = c.sy * dx + c.cy * dz;
  const ax = Math.abs(lx);
  const ay = Math.abs(dy);
  const az = Math.abs(lz);
  const mid = Math.max(Math.min(ax, ay), Math.min(Math.max(ax, ay), az));
  const n = Math.max(1, Math.ceil(mid / tol - 1e-9));
  const hx = ax / (2 * n) + half;
  const hy = ay / (2 * n) + half;
  const hz = az / (2 * n) + half;
  for (let k = 0; k < n; k++) {
    const t = (k + 0.5) / n;
    c.out.push({ kind: 'box', center: [a[0] + dx * t, a[1] + dy * t, a[2] + dz * t], half: [hx, hy, hz], yaw: c.gate.yaw });
  }
}

/**
 * A box spanning gate-local ranges u0..u1, v0..v1, w0..w1. Only for the upright kinds, whose frame is yaw-only, so the box is exact
 * (local x is `right`, y is up and z is `-forward`).
 */
function slab(c: Ctx, u0: number, u1: number, v0: number, v1: number, w0: number, w1: number): void {
  if (u1 - u0 < 1e-6 || v1 - v0 < 1e-6 || w1 - w0 < 1e-6) return;
  c.out.push({ kind: 'box', center: pt(c, (u0 + u1) / 2, (v0 + v1) / 2, (w0 + w1) / 2), half: [(u1 - u0) / 2, (v1 - v0) / 2, (w1 - w0) / 2], yaw: c.gate.yaw });
}

/** Vertical post from the ground up to (x, yTop, z) with a base plate; returns the ground height used. */
function leg(c: Ctx, x: number, yTop: number, z: number, half: number, plate: boolean): void {
  const ground = c.sampler ? c.sampler.heightAt(x, z) : yTop - FALLBACK_LEG;
  const len = yTop - ground + 0.05;
  if (len > 0.02) c.out.push({ kind: 'box', center: [x, ground - 0.05 + len / 2, z], half: [half, len / 2, half], yaw: c.gate.yaw });
  if (plate) c.out.push({ kind: 'box', center: [x, ground + PLATE_THICK, z], half: [PLATE_HALF, PLATE_THICK, PLATE_HALF], yaw: c.gate.yaw });
}

/**
 * Gate-local v of the lowest ground under a window wall or tunnel sleeve, sunk by WALL_SINK; without terrain, `fallback`. The
 * walls are built from here up.
 */
function groundV(c: Ctx, fallback: number): number {
  if (!c.sampler) return fallback;
  let lo = Infinity;
  for (const [u, w] of wallGroundPoints(c.gate)) {
    const p = pt(c, u, 0, w);
    lo = Math.min(lo, c.sampler.heightAt(p[0], p[2]));
  }
  return lo - c.gate.pos[1] - WALL_SINK;
}

function ring(c: Ctx, rw: number, rh: number, fromA: number, toA: number, cv: number): Vec3[] {
  const arc = ((toA - fromA) * (rw + rh)) / 2;
  const n = Math.max(6, Math.ceil(arc / 0.25));
  const pts: Vec3[] = [];
  for (let k = 0; k <= n; k++) {
    const a = fromA + ((toA - fromA) * k) / n;
    pts.push(pt(c, rw * Math.cos(a), cv + rh * Math.sin(a)));
  }
  return pts;
}

function polyline(c: Ctx, pts: Vec3[], closed: boolean): void {
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) bar(c, pts[i], pts[(i + 1) % pts.length], HT, 0.16);
}

/** The four tubes round a rectangular opening (posts T/2 outside the sides, bars T/2 outside the top and bottom). */
function rectBars(c: Ctx): void {
  const hw = c.gate.width / 2;
  const hh = c.gate.height / 2;
  const T = GATE_TUBE;
  for (const s of [-1, 1]) bar(c, pt(c, s * (hw + HT), -hh - T), pt(c, s * (hw + HT), hh + T), HT);
  bar(c, pt(c, -hw, hh + HT), pt(c, hw, hh + HT), HT);
  bar(c, pt(c, -hw, -hh - HT), pt(c, hw, -hh - HT), HT);
}

function squareFrame(c: Ctx): void {
  rectBars(c);
  for (const [u, v] of frameFeet(c.gate, c.f)) {
    const foot = pt(c, u, v);
    leg(c, foot[0], foot[1], foot[2], HT, true);
  }
}

function archFrame(c: Ctx): void {
  const hw = c.gate.width / 2;
  const hh = c.gate.height / 2;
  const vs = archSpring(c.gate);
  const r = hw + HT;
  const feet = archFeet(c.gate, c.f, vs);
  for (let k = 0; k < 2; k++) {
    const s = k === 0 ? -1 : 1;
    bar(c, pt(c, s * r, -hh), pt(c, s * r, vs), HT);
    const foot = pt(c, feet[k][0], feet[k][1]);
    leg(c, foot[0], foot[1], foot[2], HT, true);
  }
  polyline(c, ring(c, r, r, 0, Math.PI, vs), false);
}

function hoopFrame(c: Ctx): void {
  const pts = ring(c, c.gate.width / 2 + HT, c.gate.height / 2 + HT, 0, 2 * Math.PI, 0);
  pts.pop();
  polyline(c, pts, true);
  let low = pts[0];
  for (const p of pts) if (p[1] < low[1]) low = p;
  leg(c, low[0], low[1], low[2], HT, true);
}

/** Horizontal ring with an arm out from the rim on the `right` side to the top of a single post. */
function dropFrame(c: Ctx): void {
  const pts = ring(c, c.gate.width / 2 + HT, c.gate.height / 2 + HT, 0, 2 * Math.PI, 0);
  pts.pop();
  polyline(c, pts, true);
  const arm = dropArm(c.gate);
  const end = pt(c, arm.end[0], arm.end[1]);
  bar(c, pt(c, arm.rim[0], arm.rim[1]), end, HT);
  leg(c, end[0], end[1], end[2], HT, true);
}

function flagPoles(c: Ctx): void {
  const hw = c.gate.width / 2;
  const top = c.gate.pos[1] + c.gate.height / 2 + 0.3;
  for (const s of [-1, 1]) {
    const p = pt(c, s * (hw + FLAG_POLE_HALF), 0);
    leg(c, p[0], top, p[2], FLAG_POLE_HALF, false);
  }
}

/** Wall panel from the ground to WINDOW_HEAD above the opening, as four boxes round the opening (the LED tubes sit inside them). */
function windowFrame(c: Ctx): void {
  const hw = c.gate.width / 2;
  const hh = c.gate.height / 2;
  const wall = windowWall(c.gate);
  const d = WINDOW_THICKNESS / 2;
  const vg = groundV(c, -hh - FALLBACK_LEG);
  for (const s of [-1, 1]) slab(c, s < 0 ? -wall.half : hw, s < 0 ? -hw : wall.half, vg, wall.top, -d, d);
  slab(c, -hw, hw, hh, wall.top, -d, d);
  slab(c, -hw, hw, vg, -hh, -d, d);
}

/** Entry and exit frames (posts and a sill from the ground up to the opening), two walls and a roof `depth` long. */
function tunnelFrame(c: Ctx): void {
  const hw = c.gate.width / 2;
  const hh = c.gate.height / 2;
  const s = tunnelSleeve(c.gate);
  const vg = groundV(c, -hh - FALLBACK_LEG);
  for (const side of [-1, 1]) slab(c, side < 0 ? -s.outer : s.inner, side < 0 ? -s.inner : s.outer, vg, s.roofTop, 0, s.depth);
  // The roof box starts at the visible roof underside and reaches out over both frames.
  slab(c, -s.outer, s.outer, s.roof, s.roofTop, -HT, s.depth + HT);
  for (const w of [0, s.depth]) {
    for (const side of [-1, 1]) slab(c, side < 0 ? -hw - GATE_TUBE : hw, side < 0 ? -hw : hw + GATE_TUBE, -hh - GATE_TUBE, hh + GATE_TUBE, w - HT, w + HT);
    slab(c, -hw, hw, hh, s.roof, w - HT, w + HT);
    slab(c, -hw, hw, vg, -hh, w - HT, w + HT);
  }
  // The LED tube along the middle of the ceiling (gateMeshes.ts runs it from w = 0.3 to depth - 0.3).
  slab(c, -HT, HT, hh, s.roof, 0.3, s.depth - 0.3);
}

/** One ladder rung: the rectangular tube frame, plus the ladder's two side rails from the ground when `rails` is given. */
function ladderRung(c: Ctx, rails: { u: number; top: number } | null): void {
  rectBars(c);
  if (!rails) return;
  for (const s of [-1, 1]) {
    const p = pt(c, s * rails.u, 0);
    leg(c, p[0], rails.top, p[2], LADDER_RAIL / 2, true);
  }
}

/** Two posts from the ground to the top of the opening, a bar across the top and a sill bar across the bottom. */
function hurdleFrame(c: Ctx): void {
  const hw = c.gate.width / 2;
  const hh = c.gate.height / 2;
  for (const s of [-1, 1]) {
    const top = pt(c, s * (hw + HT), hh + GATE_TUBE);
    leg(c, top[0], top[1], top[2], HT, true);
  }
  bar(c, pt(c, -hw, hh + HT), pt(c, hw, hh + HT), HT);
  bar(c, pt(c, -hw, -hh - HT), pt(c, hw, -hh - HT), HT);
}

/** Rails of a standalone ladder rung: from the ground to just above its own frame. */
const ownRails = (g: TrackGate): { u: number; top: number } => ({ u: ladderRailU(g.width), top: g.pos[1] + g.height / 2 + GATE_TUBE + LADDER_CAP });

function buildGate(gate: TrackGate, sampler: TerrainSampler | undefined, out: ObstacleCollider[], rails: { u: number; top: number } | null): void {
  const c: Ctx = { gate, f: buildFrame(gate), cy: Math.cos(gate.yaw), sy: Math.sin(gate.yaw), sampler, out };
  switch (gate.kind) {
    case 'arch':
      archFrame(c);
      break;
    case 'hoop':
    case 'dive':
      hoopFrame(c);
      break;
    case 'drop':
      dropFrame(c);
      break;
    case 'flag':
      flagPoles(c);
      break;
    case 'window':
      windowFrame(c);
      break;
    case 'tunnel':
      tunnelFrame(c);
      break;
    case 'ladder':
      ladderRung(c, rails);
      break;
    case 'hurdle':
      hurdleFrame(c);
      break;
    default:
      squareFrame(c);
  }
}

/**
 * Appends the boxes of one gate. Pass the terrain so legs and masts reach the ground; without it they are FALLBACK_LEG long.
 * A ladder rung on its own gets side rails from the ground to its top; trackColliders builds one pair per ladder instead.
 */
export function gateColliders(gate: TrackGate, sampler?: TerrainSampler, out: ObstacleCollider[] = []): ObstacleCollider[] {
  buildGate(gate, sampler, out, gate.kind === 'ladder' ? ownRails(gate) : null);
  return out;
}

/** Round obstacles store [radius, height, radius]; box obstacles (rock, wall and the composite kinds) store full extents [x, y, z]. pos is on the ground. */
export function isRoundObstacle(kind: TrackObstacle['kind']): boolean {
  return kind === 'pole' || kind === 'cone' || kind === 'tree' || kind === 'flagpole';
}

/** The single box of a simple obstacle (the bounding box of a composite one). */
export function obstacleCollider(o: TrackObstacle): ObstacleCollider {
  const half: Vec3 = isRoundObstacle(o.kind) ? [o.size[0], o.size[1] / 2, o.size[2]] : [o.size[0] / 2, o.size[1] / 2, o.size[2] / 2];
  return { kind: 'box', center: [o.pos[0], o.pos[1] + half[1], o.pos[2]], half, yaw: o.yaw };
}

/** Lowest ground (obstacle-local y, sunk 5 cm) under a support footprint, from the terrain when there is one. */
export function supportBase(o: TrackObstacle, sampler?: TerrainSampler): SupportBase {
  if (!sampler) return () => 0;
  return (x, z, hx, hz) => {
    let lo = Infinity;
    for (const [px, pz] of [[0, 0], [-hx, -hz], [hx, -hz], [-hx, hz], [hx, hz]]) {
      const p = obstacleToWorld(o, x + px, 0, z + pz);
      lo = Math.min(lo, sampler.heightAt(p[0], p[2]));
    }
    return Math.min(0, lo - o.pos[1]) - 0.05;
  };
}

/**
 * Appends the boxes of one obstacle: one for the simple kinds, one per part for the composite ones (posts, decks, rails).
 * Pass the terrain so posts, piers and poles reach the ground under them; without it they stop at pos.y.
 */
export function obstacleColliders(o: TrackObstacle, out: ObstacleCollider[], sampler?: TerrainSampler): void {
  if (!isCompositeObstacle(o.kind)) {
    out.push(obstacleCollider(o));
    return;
  }
  for (const p of obstacleParts(o, supportBase(o, sampler))) out.push({ kind: 'box', center: obstacleToWorld(o, p.c[0], p.c[1], p.c[2]), half: p.h, yaw: o.yaw });
}

/** All boxes for the physics: every gate frame (one pair of rails per ladder), then every obstacle. Pass the sampler so legs stand on the ground. */
export function trackColliders(track: TrackData, sampler?: TerrainSampler): ObstacleCollider[] {
  const out: ObstacleCollider[] = [];
  const rails = new Map<number, { u: number; top: number }>();
  for (const g of ladderGroups(track.gates)) rails.set(g.top, { u: g.railU, top: g.railTop });
  track.gates.forEach((g, i) => buildGate(g, sampler, out, rails.get(i) ?? null));
  for (const o of track.obstacles) obstacleColliders(o, out, sampler);
  return out;
}

/** Distance from point p to the oriented box (0 when inside). */
export function distanceToBox(b: ObstacleCollider, x: number, y: number, z: number): number {
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  const dx = x - b.center[0];
  const dz = z - b.center[2];
  const lx = Math.abs(c * dx - s * dz) - b.half[0];
  const ly = Math.abs(y - b.center[1]) - b.half[1];
  const lz = Math.abs(s * dx + c * dz) - b.half[2];
  const ox = lx > 0 ? lx : 0;
  const oy = ly > 0 ? ly : 0;
  const oz = lz > 0 ? lz : 0;
  return Math.hypot(ox, oy, oz);
}
