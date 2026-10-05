/** Analytic RT proxies for the track: gate bars, legs, walls and sleeves, ladder rails, obstacles and the first cones. */
import type { Quat, TerrainSampler, TrackData, TrackGate, TrackObstacle, Vec3 } from '../../contracts';
import { supportBase } from '../../world/track/colliders';
import { GATE_TUBE, archSpring } from '../../world/track/gate';
import {
  LADDER_RAIL, WALL_SINK, WINDOW_THICKNESS, archFeet, buildFrame, dropArm, frameFeet, isCompositeObstacle, ladderGroups, obstacleParts, obstacleToWorld,
  towerLayout, tunnelSleeve, wallGroundPoints, windowWall, TOWER_LEG,
} from '../../world/track/kindGeometry';
import type { RTMaterial, RTPrimitive } from '../contracts';
import { CONTAINER_COLOURS, STEEL_COLOURS, STEEL_GALVANISED, STEEL_RED, STEEL_YELLOW, gateColour } from './materials';
import { seeded } from './obstacleMeshes';

/** Upper bound on registered primitives; when gates alone exceed it the round frames use fewer segments. */
export const RT_PRIM_CAP = 300;
export const RT_CONE_CAP = 60;

const HT = GATE_TUBE / 2;
const RING_STATIONS = 64;
const MAT_POLE: RTMaterial = { albedo: [0.6, 0.6, 0.62], roughness: 0.4, metalness: 0.8 };
const MAT_WALL: RTMaterial = { albedo: [0.35, 0.28, 0.2], roughness: 0.85, metalness: 0 };
const MAT_ROCK: RTMaterial = { albedo: [0.3, 0.29, 0.27], roughness: 0.95, metalness: 0 };
const MAT_TREE: RTMaterial = { albedo: [0.12, 0.09, 0.06], roughness: 0.95, metalness: 0 };
const MAT_CONE: RTMaterial = { albedo: [1, 0.25, 0.02], roughness: 0.5, metalness: 0 };
const MAT_BASE: RTMaterial = { albedo: [0.05, 0.05, 0.05], roughness: 0.8, metalness: 0 };
const MAT_PANEL: RTMaterial = { albedo: [0.55, 0.55, 0.53], roughness: 0.7, metalness: 0 };
const MAT_CONCRETE: RTMaterial = { albedo: [0.4, 0.39, 0.37], roughness: 0.9, metalness: 0 };
const MAT_HAZARD: RTMaterial = { albedo: [0.32, 0.24, 0.02], roughness: 0.5, metalness: 0 };
const MAT_WOOD: RTMaterial = { albedo: [0.3, 0.17, 0.08], roughness: 0.85, metalness: 0 };
const steel = (paint: number): RTMaterial => ({ albedo: STEEL_COLOURS[paint], roughness: 0.45, metalness: paint === STEEL_GALVANISED ? 0.8 : 0 });

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

/** How detailed the gate proxies are: segments per full ring, and whether legs get their ballast plates. */
interface Detail {
  ring: number;
  plates: boolean;
}

function gatePrims(g: TrackGate, sampler: TerrainSampler, detail: Detail, out: RTPrimitive[]): void {
  const f = buildFrame(g);
  const c = g.pos;
  const hw = g.width / 2;
  const hh = g.height / 2;
  const T = GATE_TUBE;
  const mat: RTMaterial = { albedo: gateColour(g.index), roughness: 0.45, metalness: 0 };
  const rot = quatFromBasis(f.right, f.up, [-f.forward[0], -f.forward[1], -f.forward[2]]);
  const at = (u: number, v: number, w = 0): Vec3 => [
    c[0] + f.right[0] * u + f.up[0] * v + f.forward[0] * w,
    c[1] + f.right[1] * u + f.up[1] * v + f.forward[1] * w,
    c[2] + f.right[2] * u + f.up[2] * v + f.forward[2] * w,
  ];
  const box = (u: number, v: number, hu: number, hv: number): void => {
    out.push({ type: 'obb', center: at(u, v), half: [hu, hv, HT], rot, material: mat });
  };
  /** Box spanning gate-local ranges (u, v, w), for walls and sleeves. */
  const slab = (u0: number, u1: number, v0: number, v1: number, w0: number, w1: number, m: RTMaterial): void => {
    if (u1 - u0 < 1e-6 || v1 - v0 < 1e-6 || w1 - w0 < 1e-6) return;
    out.push({ type: 'obb', center: at((u0 + u1) / 2, (v0 + v1) / 2, (w0 + w1) / 2), half: [(u1 - u0) / 2, (v1 - v0) / 2, (w1 - w0) / 2], rot, material: m });
  };
  const leg = (foot: Vec3, plate: boolean, half = HT): void => {
    const gy = sampler.heightAt(foot[0], foot[2]);
    const len = foot[1] - gy + 0.05;
    if (len > 0.02) out.push({ type: 'obb', center: [foot[0], gy - 0.05 + len / 2, foot[2]], half: [half, len / 2, half], rot: yawQuat(g.yaw), material: mat });
    if (plate && detail.plates) out.push({ type: 'obb', center: [foot[0], gy + 0.012, foot[2]], half: [0.2, 0.012, 0.2], rot: yawQuat(g.yaw), material: MAT_BASE });
  };
  const arc = (rw: number, rh: number, cv: number, from: number, to: number, n: number): void => {
    for (let k = 0; k < n; k++) {
      const a0 = from + ((to - from) * k) / n;
      const a1 = from + ((to - from) * (k + 1)) / n;
      out.push({ type: 'capsule', a: at(rw * Math.cos(a0), cv + rh * Math.sin(a0)), b: at(rw * Math.cos(a1), cv + rh * Math.sin(a1)), radius: HT, material: mat });
    }
  };
  const rectBars = (): void => {
    for (const s of [-1, 1]) box(s * (hw + HT), 0, HT, hh + T);
    box(0, hh + HT, hw, HT);
    box(0, -hh - HT, hw, HT);
  };
  const wallBottom = (): number => {
    let lo = Infinity;
    for (const [u, w] of wallGroundPoints(g)) {
      const p = at(u, 0, w);
      lo = Math.min(lo, sampler.heightAt(p[0], p[2]));
    }
    return lo - c[1] - WALL_SINK;
  };
  switch (g.kind) {
    case 'arch': {
      const vs = archSpring(g);
      const r = hw + HT;
      const feet = archFeet(g, f, vs);
      for (let k = 0; k < 2; k++) {
        const s = k === 0 ? -1 : 1;
        out.push({ type: 'capsule', a: at(s * r, -hh), b: at(s * r, vs), radius: HT, material: mat });
        leg(at(feet[k][0], feet[k][1]), false);
      }
      arc(r, r, vs, 0, Math.PI, Math.max(4, detail.ring >> 1));
      break;
    }
    case 'hoop':
    case 'dive':
    case 'drop': {
      arc(hw + HT, hh + HT, 0, 0, Math.PI * 2, detail.ring);
      if (g.kind === 'drop') {
        const arm = dropArm(g);
        const end = at(arm.end[0], arm.end[1]);
        out.push({ type: 'capsule', a: at(arm.rim[0], arm.rim[1]), b: end, radius: HT, material: mat });
        leg(end, true);
        break;
      }
      // The leg leaves the bottom of the ring, or the lowest of the mesh's ring stations when a roll or pitch moves it, as the mesh
      // and colliders do.
      let low = at(0, -(hh + HT));
      for (let k = 0; k < RING_STATIONS; k++) {
        const a = (k / RING_STATIONS) * Math.PI * 2;
        const p = at((hw + HT) * Math.cos(a), (hh + HT) * Math.sin(a));
        if (p[1] < low[1] - 1e-6) low = p;
      }
      leg(low, false);
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
    case 'window': {
      const wall = windowWall(g);
      const vg = wallBottom();
      const d = WINDOW_THICKNESS / 2;
      for (const s of [-1, 1]) slab(s < 0 ? -wall.half : hw, s < 0 ? -hw : wall.half, vg, wall.top, -d, d, MAT_PANEL);
      slab(-hw, hw, hh, wall.top, -d, d, MAT_PANEL);
      slab(-hw, hw, vg, -hh, -d, d, MAT_PANEL);
      break;
    }
    case 'tunnel': {
      const s = tunnelSleeve(g);
      const vg = wallBottom();
      for (const side of [-1, 1]) slab(side < 0 ? -s.outer : s.inner, side < 0 ? -s.inner : s.outer, vg, s.roofTop, 0, s.depth, MAT_PANEL);
      slab(-s.outer, s.outer, s.roof, s.roofTop, 0, s.depth, MAT_PANEL);
      for (const w of [0, s.depth]) slab(-hw - T, hw + T, vg, -hh, w - HT, w + HT, mat);
      break;
    }
    case 'ladder':
      rectBars();
      break;
    case 'hurdle':
      for (const s of [-1, 1]) leg(at(s * (hw + HT), hh + T), true);
      box(0, hh + HT, hw, HT);
      box(0, -hh - HT, hw, HT);
      break;
    default:
      rectBars();
      for (const [u, v] of frameFeet(g, f)) leg(at(u, v), true);
  }
}

/** The two side rails of each ladder (built once per ladder, in the top rung's frame). */
function ladderPrims(track: TrackData, sampler: TerrainSampler, out: RTPrimitive[]): void {
  for (const group of ladderGroups(track.gates)) {
    const top = track.gates[group.top];
    const f = buildFrame(top);
    const mat: RTMaterial = { albedo: gateColour(top.index), roughness: 0.45, metalness: 0 };
    for (const s of [-1, 1]) {
      const x = top.pos[0] + f.right[0] * s * group.railU;
      const z = top.pos[2] + f.right[2] * s * group.railU;
      const gy = sampler.heightAt(x, z);
      const len = group.railTop - gy + 0.05;
      if (len > 0.02) out.push({ type: 'obb', center: [x, gy - 0.05 + len / 2, z], half: [LADDER_RAIL / 2, len / 2, LADDER_RAIL / 2], rot: yawQuat(top.yaw), material: mat });
    }
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

/**
 * Proxies of a composite obstacle, appended to `out`. Most are its collider parts as OBBs; the lattice tower is its four legs,
 * the platform and the mast instead of the solid hull, so its shadow stays open.
 */
export function compositePrims(o: TrackObstacle, sampler: TerrainSampler, index: number, out: RTPrimitive[]): void {
  const rot = yawQuat(o.yaw);
  const base = supportBase(o, sampler);
  if (o.kind === 'tower') {
    const t = towerLayout(o);
    const m = steel(STEEL_RED);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const y0 = base(sx * t.base[0], sz * t.base[1], TOWER_LEG / 2, TOWER_LEG / 2);
        out.push({ type: 'capsule', a: obstacleToWorld(o, sx * t.base[0], y0, sz * t.base[1]), b: obstacleToWorld(o, sx * t.top[0], t.platform, sz * t.top[1]), radius: TOWER_LEG * 0.6, material: m });
      }
    }
    out.push({ type: 'obb', center: obstacleToWorld(o, 0, t.platform + 0.075, 0), half: [t.deck[0], 0.075, t.deck[1]], rot, material: steel(STEEL_GALVANISED) });
    out.push({ type: 'capsule', a: obstacleToWorld(o, 0, t.platform, 0), b: obstacleToWorld(o, 0, o.size[1], 0), radius: 0.07, material: m });
    return;
  }
  const containerMat: RTMaterial = { albedo: CONTAINER_COLOURS[Math.floor(seeded(index * 3 + 1) * CONTAINER_COLOURS.length)], roughness: 0.55, metalness: 0.3 };
  for (const p of obstacleParts(o, base)) {
    let material: RTMaterial;
    switch (o.kind) {
      case 'container':
        material = containerMat;
        break;
      case 'pillar':
      case 'bridge':
        material = MAT_CONCRETE;
        break;
      case 'beam':
        material = p.role === 'support' ? steel(STEEL_YELLOW) : MAT_HAZARD;
        break;
      default:
        material = p.role === 'deck' ? MAT_WOOD : steel(STEEL_GALVANISED);
    }
    // Scaffold standards are thin round tubes: capsules shade them better than boxes.
    if (o.kind === 'scaffold' && p.role === 'support') {
      out.push({ type: 'capsule', a: obstacleToWorld(o, p.c[0], p.c[1] - p.h[1], p.c[2]), b: obstacleToWorld(o, p.c[0], p.c[1] + p.h[1], p.c[2]), radius: p.h[0], material });
    } else out.push({ type: 'obb', center: obstacleToWorld(o, p.c[0], p.c[1], p.c[2]), half: p.h, rot, material });
  }
}

/** Obstacle kinds in the order they claim what is left of the budget after the gates: the biggest shadow casters first. */
const PRIORITY: TrackObstacle['kind'][] = ['bridge', 'tower', 'container', 'pillar', 'beam', 'wall', 'scaffold', 'rock', 'tree', 'pole', 'flagpole', 'cone'];
/** Ring segments and plates, from most to least detailed; the first level whose gates fit in 70% of the cap is used. */
const DETAIL: Detail[] = [
  { ring: 24, plates: true },
  { ring: 12, plates: true },
  { ring: 8, plates: true },
  { ring: 6, plates: true },
  { ring: 6, plates: false },
];

export function buildTrackProxies(track: TrackData, sampler: TerrainSampler, cap = RT_PRIM_CAP): RTPrimitive[] {
  let out: RTPrimitive[] = [];
  for (const detail of DETAIL) {
    out = [];
    for (const g of track.gates) gatePrims(g, sampler, detail, out);
    ladderPrims(track, sampler, out);
    if (out.length <= cap * 0.7) break;
  }
  let cones = 0;
  const scratch: RTPrimitive[] = [];
  for (const kind of PRIORITY) {
    for (let i = 0; i < track.obstacles.length; i++) {
      const o = track.obstacles[i];
      if (o.kind !== kind) continue;
      if (out.length >= cap) return out;
      if (kind === 'cone' && ++cones > RT_CONE_CAP) break;
      if (!isCompositeObstacle(kind)) {
        out.push(obstaclePrim(o));
        continue;
      }
      // A composite obstacle is added whole or not at all, so a smaller one later in the list may still fit.
      scratch.length = 0;
      compositePrims(o, sampler, i, scratch);
      if (out.length + scratch.length <= cap) out.push(...scratch);
    }
  }
  return out.length > cap ? out.slice(0, cap) : out;
}
