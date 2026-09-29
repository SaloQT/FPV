/** Analytic RT proxies for the track: gate bars and legs, walls, rocks, trunks, poles and the first cones. */
import type { Quat, TerrainSampler, TrackData, TrackGate, TrackObstacle, Vec3 } from '../../contracts';
import { GATE_TUBE, archSpring, trackGateFrame } from '../../world/track/gate';
import type { RTMaterial, RTPrimitive } from '../contracts';
import { gateColour } from './materials';

/** Upper bound on registered primitives; when gates alone exceed it the round frames use fewer segments. */
export const RT_PRIM_CAP = 300;
export const RT_CONE_CAP = 60;

const HT = GATE_TUBE / 2;
const MAT_POLE: RTMaterial = { albedo: [0.6, 0.6, 0.62], roughness: 0.4, metalness: 0.8 };
const MAT_WALL: RTMaterial = { albedo: [0.35, 0.28, 0.2], roughness: 0.85, metalness: 0 };
const MAT_ROCK: RTMaterial = { albedo: [0.3, 0.29, 0.27], roughness: 0.95, metalness: 0 };
const MAT_TREE: RTMaterial = { albedo: [0.12, 0.09, 0.06], roughness: 0.95, metalness: 0 };
const MAT_CONE: RTMaterial = { albedo: [1, 0.25, 0.02], roughness: 0.5, metalness: 0 };
const MAT_BASE: RTMaterial = { albedo: [0.05, 0.05, 0.05], roughness: 0.8, metalness: 0 };

function quatFromBasis(x: Vec3, y: Vec3, z: Vec3): Quat {
  const tr = x[0] + y[1] + z[2];
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    return [(y[2] - z[1]) / s, (z[0] - x[2]) / s, (x[1] - y[0]) / s, s / 4];
  }
  if (x[0] > y[1] && x[0] > z[2]) {
    const s = Math.sqrt(1 + x[0] - y[1] - z[2]) * 2;
    return [s / 4, (y[0] + x[1]) / s, (z[0] + x[2]) / s, (y[2] - z[1]) / s];
  }
  if (y[1] > z[2]) {
    const s = Math.sqrt(1 + y[1] - x[0] - z[2]) * 2;
    return [(y[0] + x[1]) / s, s / 4, (z[1] + y[2]) / s, (z[0] - x[2]) / s];
  }
  const s = Math.sqrt(1 + z[2] - x[0] - y[1]) * 2;
  return [(z[0] + x[2]) / s, (z[1] + y[2]) / s, s / 4, (x[1] - y[0]) / s];
}

const yawQuat = (yaw: number): Quat => [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];

function gatePrims(g: TrackGate, sampler: TerrainSampler, ringSegments: number, out: RTPrimitive[]): void {
  const f = trackGateFrame(g);
  const c = g.pos;
  const hw = g.width / 2;
  const hh = g.height / 2;
  const T = GATE_TUBE;
  const mat: RTMaterial = { albedo: gateColour(g.index), roughness: 0.45, metalness: 0 };
  const rot = quatFromBasis(f.right, f.up, [-f.forward[0], -f.forward[1], -f.forward[2]]);
  const at = (u: number, v: number): Vec3 => [c[0] + f.right[0] * u + f.up[0] * v, c[1] + f.right[1] * u + f.up[1] * v, c[2] + f.right[2] * u + f.up[2] * v];
  const box = (u: number, v: number, hu: number, hv: number): void => {
    out.push({ type: 'obb', center: at(u, v), half: [hu, hv, HT], rot, material: mat });
  };
  const leg = (foot: Vec3, plate: boolean): void => {
    const gy = sampler.heightAt(foot[0], foot[2]);
    const len = foot[1] - gy + 0.05;
    if (len > 0.02) out.push({ type: 'obb', center: [foot[0], gy - 0.05 + len / 2, foot[2]], half: [HT, len / 2, HT], rot: yawQuat(g.yaw), material: mat });
    if (plate) out.push({ type: 'obb', center: [foot[0], gy + 0.012, foot[2]], half: [0.2, 0.012, 0.2], rot: yawQuat(g.yaw), material: MAT_BASE });
  };
  const arc = (rw: number, rh: number, cv: number, from: number, to: number, n: number): void => {
    for (let k = 0; k < n; k++) {
      const a0 = from + ((to - from) * k) / n;
      const a1 = from + ((to - from) * (k + 1)) / n;
      out.push({ type: 'capsule', a: at(rw * Math.cos(a0), cv + rh * Math.sin(a0)), b: at(rw * Math.cos(a1), cv + rh * Math.sin(a1)), radius: HT, material: mat });
    }
  };
  switch (g.kind) {
    case 'arch': {
      const vs = archSpring(g);
      const r = hw + HT;
      for (const s of [-1, 1]) {
        out.push({ type: 'capsule', a: at(s * r, -hh), b: at(s * r, vs), radius: HT, material: mat });
        leg(at(s * r, -hh), false);
      }
      arc(r, r, vs, 0, Math.PI, Math.max(4, ringSegments >> 1));
      break;
    }
    case 'hoop':
    case 'dive': {
      arc(hw + HT, hh + HT, 0, 0, Math.PI * 2, ringSegments);
      leg(at(0, -(hh + HT)), false);
      break;
    }
    case 'flag': {
      const top = c[1] + hh + 0.3;
      for (const s of [-1, 1]) {
        const p = at(s * (hw + 0.02), 0);
        out.push({ type: 'capsule', a: [p[0], sampler.heightAt(p[0], p[2]), p[2]], b: [p[0], top, p[2]], radius: 0.02, material: MAT_POLE });
      }
      break;
    }
    default:
      for (const s of [-1, 1]) box(s * (hw + HT), 0, HT, hh + T);
      box(0, hh + HT, hw, HT);
      box(0, -hh - HT, hw, HT);
      for (const s of [-1, 1]) leg(at(s * (hw + HT), -hh - T), true);
  }
}

function obstaclePrim(o: TrackObstacle): RTPrimitive {
  const [x, y, z] = o.pos;
  const [sx, sy, sz] = o.size;
  switch (o.kind) {
    case 'wall':
      return { type: 'obb', center: [x, y + sy / 2, z], half: [sx / 2, sy / 2, sz / 2], rot: yawQuat(o.yaw), material: MAT_WALL };
    case 'rock':
      return { type: 'obb', center: [x, y + sy * 0.4, z], half: [sx * 0.45, sy * 0.4, sz * 0.45], rot: yawQuat(o.yaw), material: MAT_ROCK };
    case 'tree':
      return { type: 'capsule', a: [x, y, z], b: [x, y + sy * 0.7, z], radius: sx, material: MAT_TREE };
    case 'cone':
      return { type: 'capsule', a: [x, y + 0.1, z], b: [x, y + sy - 0.1, z], radius: 0.1, material: MAT_CONE };
    default:
      return { type: 'capsule', a: [x, y, z], b: [x, y + sy, z], radius: sx, material: MAT_POLE };
  }
}

const PRIORITY: TrackObstacle['kind'][] = ['wall', 'rock', 'tree', 'pole', 'flagpole', 'cone'];

export function buildTrackProxies(track: TrackData, sampler: TerrainSampler, cap = RT_PRIM_CAP): RTPrimitive[] {
  let out: RTPrimitive[] = [];
  for (const seg of [24, 12, 8, 6]) {
    out = [];
    for (const g of track.gates) gatePrims(g, sampler, seg, out);
    if (out.length <= cap * 0.7) break;
  }
  let cones = 0;
  for (const kind of PRIORITY) {
    for (const o of track.obstacles) {
      if (o.kind !== kind) continue;
      if (out.length >= cap) return out;
      if (kind === 'cone' && ++cones > RT_CONE_CAP) break;
      out.push(obstaclePrim(o));
    }
  }
  return out.length > cap ? out.slice(0, cap) : out;
}
