/**
 * Track -> physics boxes. ObstacleCollider is yaw-only, so a bar that is not axis-aligned in the gate's yaw frame (rolled or
 * pitched gates, arches, hoops) becomes a short staircase of small boxes whose overshoot into the opening stays under 12 cm
 * (16 cm when rolled or pitched), which colliders.test.ts enforces.
 */
import type { ObstacleCollider, TerrainSampler, TrackData, TrackGate, TrackObstacle, Vec3 } from '../../contracts';
import { GATE_TUBE, archSpring, trackGateFrame, type GateFrame } from './gate';

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

function pt(c: Ctx, u: number, v: number): Vec3 {
  const p = c.gate.pos;
  return [
    p[0] + c.f.right[0] * u + c.f.up[0] * v,
    p[1] + c.f.right[1] * u + c.f.up[1] * v,
    p[2] + c.f.right[2] * u + c.f.up[2] * v,
  ];
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

/** Vertical post from the ground up to (x, yTop, z) with a base plate; returns the ground height used. */
function leg(c: Ctx, x: number, yTop: number, z: number, half: number, plate: boolean): void {
  const ground = c.sampler ? c.sampler.heightAt(x, z) : yTop - FALLBACK_LEG;
  const len = yTop - ground + 0.05;
  if (len > 0.02) c.out.push({ kind: 'box', center: [x, ground - 0.05 + len / 2, z], half: [half, len / 2, half], yaw: c.gate.yaw });
  if (plate) c.out.push({ kind: 'box', center: [x, ground + PLATE_THICK, z], half: [PLATE_HALF, PLATE_THICK, PLATE_HALF], yaw: c.gate.yaw });
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

function squareFrame(c: Ctx): void {
  const hw = c.gate.width / 2;
  const hh = c.gate.height / 2;
  const T = GATE_TUBE;
  for (const s of [-1, 1]) bar(c, pt(c, s * (hw + HT), -hh - T), pt(c, s * (hw + HT), hh + T), HT);
  bar(c, pt(c, -hw, hh + HT), pt(c, hw, hh + HT), HT);
  bar(c, pt(c, -hw, -hh - HT), pt(c, hw, -hh - HT), HT);
  for (const s of [-1, 1]) {
    const foot = pt(c, s * (hw + HT), -hh - T);
    leg(c, foot[0], foot[1], foot[2], HT, true);
  }
}

function archFrame(c: Ctx): void {
  const hw = c.gate.width / 2;
  const hh = c.gate.height / 2;
  const vs = archSpring(c.gate);
  const r = hw + HT;
  for (const s of [-1, 1]) {
    bar(c, pt(c, s * r, -hh), pt(c, s * r, vs), HT);
    const foot = pt(c, s * r, -hh);
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

function flagPoles(c: Ctx): void {
  const hw = c.gate.width / 2;
  const top = c.gate.pos[1] + c.gate.height / 2 + 0.3;
  for (const s of [-1, 1]) {
    const p = pt(c, s * (hw + FLAG_POLE_HALF), 0);
    leg(c, p[0], top, p[2], FLAG_POLE_HALF, false);
  }
}

/** Appends the boxes of one gate. Pass the terrain so legs and masts reach the ground; without it they are FALLBACK_LEG long. */
export function gateColliders(gate: TrackGate, sampler?: TerrainSampler, out: ObstacleCollider[] = []): ObstacleCollider[] {
  const c: Ctx = { gate, f: trackGateFrame(gate), cy: Math.cos(gate.yaw), sy: Math.sin(gate.yaw), sampler, out };
  switch (gate.kind) {
    case 'arch':
      archFrame(c);
      break;
    case 'hoop':
    case 'dive':
      hoopFrame(c);
      break;
    case 'flag':
      flagPoles(c);
      break;
    default:
      squareFrame(c);
  }
  return out;
}

/** Round obstacles store [radius, height, radius]; box obstacles (rock, wall) store full extents [x, y, z]. pos is on the ground. */
export function isRoundObstacle(kind: TrackObstacle['kind']): boolean {
  return kind !== 'rock' && kind !== 'wall';
}

export function obstacleCollider(o: TrackObstacle): ObstacleCollider {
  const half: Vec3 = isRoundObstacle(o.kind) ? [o.size[0], o.size[1] / 2, o.size[2]] : [o.size[0] / 2, o.size[1] / 2, o.size[2] / 2];
  return { kind: 'box', center: [o.pos[0], o.pos[1] + half[1], o.pos[2]], half, yaw: o.yaw };
}

/** All boxes for the physics: every gate frame, then every obstacle. Pass the sampler so gate legs stand on the ground. */
export function trackColliders(track: TrackData, sampler?: TerrainSampler): ObstacleCollider[] {
  const out: ObstacleCollider[] = [];
  for (const g of track.gates) gateColliders(g, sampler, out);
  for (const o of track.obstacles) out.push(obstacleCollider(o));
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
