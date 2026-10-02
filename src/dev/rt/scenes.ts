import type { Quat, TerrainData, TerrainSampler, Vec3 } from '../../contracts';
import { MaterialId, type RTPrimitive } from '../../render/contracts';
import { createTerrainSampler, generateTerrain } from '../../world/terrain';
import type { TimeOfDay } from '../render/astro';

export type SceneName = 'gate' | 'bleed' | 'canyon' | 'hills' | 'gen' | 'plain';
export const SCENE_NAMES: readonly SceneName[] = ['gate', 'bleed', 'canyon', 'hills', 'gen', 'plain'];

export interface DevProp { prim: RTPrimitive; id: MaterialId }

export interface DevScene {
  name: SceneName;
  terrain: TerrainData;
  sampler: TerrainSampler;
  props: DevProp[];
  ground: { albedo: Vec3; roughness: number };
  camera: { pos: Vec3; target: Vec3; fovDeg: number };
  /** Time of day used when the URL does not give one, and the sun placement override (elevation, azimuth in degrees) if the scene wants one. */
  time: TimeOfDay;
  sun: [number, number] | null;
  /** Rectangle (fractions of the screen: x0, y0, x1, y1) of flat, lit, unoccluded ground for the noise statistic. */
  flatRegion: [number, number, number, number];
}

const smooth = (a: number, b: number, x: number): number => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

function makeTerrain(n: number, cell: number, height: (x: number, z: number) => number): TerrainData {
  const origin = -(n * cell) / 2;
  const h = new Float32Array(n * n);
  let lo = Infinity, hi = -Infinity;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const v = height(origin + i * cell, origin + j * cell);
      h[j * n + i] = v;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  }
  const map = (): Float32Array => new Float32Array(n * n).fill(0.5);
  return { seed: 0, resolution: n, cellSize: cell, origin: [origin, origin], height: h, maps: { soil: map(), flow: map(), deposit: map(), wetness: new Float32Array(n * n) }, minHeight: lo, maxHeight: hi, waterLevel: -Infinity };
}

const axisAngle = (axis: Vec3, angle: number): Quat => {
  const s = Math.sin(angle / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
};
const yawQuat = (yaw: number): Quat => axisAngle([0, 1, 0], yaw);

const gateFrame = { albedo: [0.9, 0.32, 0.05] as Vec3, roughness: 0.55, metalness: 0 };
const plastic = (albedo: Vec3, roughness = 0.5) => ({ albedo, roughness, metalness: 0 });
const metal = (albedo: Vec3, roughness: number) => ({ albedo, roughness, metalness: 1 });

/** A square gate frame (two posts, top and bottom bars) standing on the ground at (x, z), turned by `yaw`. */
function gate(sampler: TerrainSampler, x: number, z: number, yaw: number, width = 4.4, height = 4.4, t = 0.14): DevProp[] {
  const y0 = sampler.heightAt(x, z), q = yawQuat(yaw);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const at = (lx: number, ly: number): Vec3 => [x + c * lx, y0 + ly, z - s * lx];
  const post = (lx: number): DevProp => ({ id: MaterialId.GateFrame, prim: { type: 'obb', center: at(lx, height / 2 + t), half: [t, height / 2 + t, t], rot: q, material: gateFrame } });
  const bar = (ly: number): DevProp => ({ id: MaterialId.GateFrame, prim: { type: 'obb', center: at(0, ly), half: [width / 2 + t, t, t], rot: q, material: gateFrame } });
  return [post(-width / 2), post(width / 2), bar(height + t), bar(t)];
}

function pole(sampler: TerrainSampler, x: number, z: number, height: number, radius: number): DevProp {
  const y0 = sampler.heightAt(x, z);
  return { id: MaterialId.Rock, prim: { type: 'capsule', a: [x, y0 + radius, z], b: [x, y0 + height, z], radius, material: plastic([0.2, 0.35, 0.85]) } };
}

function ball(sampler: TerrainSampler, x: number, z: number, radius: number, material: RTPrimitive['material']): DevProp {
  return { id: MaterialId.Rock, prim: { type: 'sphere', center: [x, sampler.heightAt(x, z) + radius - 0.05, z], radius, material } };
}

function box(sampler: TerrainSampler, x: number, z: number, half: Vec3, yaw: number, material: RTPrimitive['material']): DevProp {
  return { id: MaterialId.Ground, prim: { type: 'obb', center: [x, sampler.heightAt(x, z) + half[1] - 0.05, z], half, rot: yawQuat(yaw), material } };
}

function ring(sampler: TerrainSampler, x: number, z: number, yaw: number, major = 2, minor = 0.16): DevProp {
  const rot = yawQuat(yaw);
  const tilt = axisAngle([1, 0, 0], Math.PI / 2);
  const q: Quat = [
    rot[3] * tilt[0] + rot[0] * tilt[3] + rot[1] * tilt[2] - rot[2] * tilt[1],
    rot[3] * tilt[1] - rot[0] * tilt[2] + rot[1] * tilt[3] + rot[2] * tilt[0],
    rot[3] * tilt[2] + rot[0] * tilt[1] - rot[1] * tilt[0] + rot[2] * tilt[3],
    rot[3] * tilt[3] - rot[0] * tilt[0] - rot[1] * tilt[1] - rot[2] * tilt[2],
  ];
  return { id: MaterialId.GateFrame, prim: { type: 'torus', center: [x, sampler.heightAt(x, z) + major + 0.3, z], rot: q, major, minor, material: plastic([0.1, 0.65, 0.2], 0.4) } };
}

function scene(name: SceneName, terrain: TerrainData, rest: Omit<DevScene, 'name' | 'terrain' | 'sampler'>): DevScene {
  return { name, terrain, sampler: createTerrainSampler(terrain), ...rest };
}

function gateScene(): DevScene {
  const terrain = makeTerrain(256, 1, () => 0);
  const s = createTerrainSampler(terrain);
  return scene('gate', terrain, {
    props: [...gate(s, 0, 0, 1, 6, 5, 0.22), pole(s, 9, -6, 12, 1), ball(s, -7, 6, 1.6, plastic([0.85, 0.85, 0.85], 0.6)), box(s, 4, 6, [1.2, 0.8, 2.6], 0.3, plastic([0.6, 0.6, 0.65]))],
    ground: { albedo: [0.72, 0.72, 0.7], roughness: 0.85 },
    camera: { pos: [5, 11, 13], target: [-4, 0, -7], fovDeg: 62 },
    time: 'noon', sun: [24, 100], flatRegion: [0.72, 0.72, 0.98, 0.98],
  });
}

function bleedScene(): DevScene {
  const terrain = makeTerrain(256, 1, () => 0);
  const s = createTerrainSampler(terrain);
  return scene('bleed', terrain, {
    props: [
      box(s, 0, 0, [1.4, 1.4, 1.4], 0.35, plastic([0.85, 0.04, 0.03], 0.7)),
      box(s, 6, -3, [1.4, 1.4, 1.4], -0.2, plastic([0.04, 0.55, 0.1], 0.7)),
    ],
    ground: { albedo: [0.9, 0.9, 0.88], roughness: 0.9 },
    camera: { pos: [-7, 7, 9], target: [1.5, 0.2, -0.5], fovDeg: 60 },
    time: 'noon', sun: [50, 105], flatRegion: [0.02, 0.05, 0.22, 0.3],
  });
}

function canyonScene(): DevScene {
  const wall = (x: number, z: number): number => 34 * smooth(5, 26, Math.abs(x - 26 * Math.sin(z * 0.011)));
  const terrain = makeTerrain(256, 2, (x, z) => wall(x, z) + 1.2 * Math.sin(x * 0.17) * Math.sin(z * 0.13) * smooth(0, 10, wall(x, z)) + 0.3 * Math.sin(z * 0.4));
  const s = createTerrainSampler(terrain);
  const cx = 26 * Math.sin(150 * 0.011);
  return scene('canyon', terrain, {
    props: [ball(s, cx + 1, 130, 0.8, plastic([0.8, 0.8, 0.8])), box(s, cx - 2, 100, [1, 0.8, 1], 0.5, plastic([0.6, 0.55, 0.4]))],
    ground: { albedo: [0.6, 0.55, 0.45], roughness: 0.9 },
    camera: { pos: [cx, 4.5, 165], target: [cx + 2, 8, 100], fovDeg: 70 },
    time: 'noon', sun: [62, 180], flatRegion: [0.4, 0.75, 0.6, 0.95],
  });
}

function hillsScene(): DevScene {
  const h = (x: number, z: number): number => 22 * Math.sin(x * 0.03 + 0.7 * Math.sin(z * 0.011)) + 10 * Math.sin(z * 0.02 + 1) * Math.cos(x * 0.017) + 4 * Math.sin(x * 0.09) * Math.sin(z * 0.07);
  const terrain = makeTerrain(256, 4, h);
  const s = createTerrainSampler(terrain);
  return scene('hills', terrain, {
    props: [...gate(s, 40, -60, 1.2, 6, 5), box(s, 20, -20, [1.5, 1.5, 1.5], 0.2, plastic([0.7, 0.2, 0.15]))],
    ground: { albedo: [0.55, 0.5, 0.4], roughness: 0.9 },
    camera: { pos: [-150, 75, 200], target: [40, 0, -100], fovDeg: 60 },
    time: 'dusk', sun: [4, 250], flatRegion: [0.02, 0.6, 0.2, 0.9],
  });
}

/** An 8 km gently rolling plain seen from 900 m up: big enough for the km-scale shadow patches of the clouds to show. */
function plainScene(): DevScene {
  const terrain = makeTerrain(512, 16, (x, z) => 5 * Math.sin(x * 0.004) * Math.cos(z * 0.0033) + 1.5 * Math.sin(x * 0.02 + z * 0.015));
  return scene('plain', terrain, {
    props: [],
    ground: { albedo: [0.45, 0.42, 0.3], roughness: 0.9 },
    camera: { pos: [0, 900, 2800], target: [0, 0, -400], fovDeg: 70 },
    time: 'noon', sun: [45, 200], flatRegion: [0.4, 0.6, 0.6, 0.9],
  });
}

function genScene(): DevScene {
  const terrain = generateTerrain({ seed: 1, quality: 'low', resolution: 256, cellSize: 4 });
  const s = createTerrainSampler(terrain);
  const cx = 0, cz = 0;
  return scene('gen', terrain, {
    props: [
      ...gate(s, cx, cz, 0.4), ring(s, cx + 11, cz + 3, 0.9), pole(s, cx + 7, cz - 8, 12, 0.4),
      ball(s, cx - 6, cz + 6, 1, metal([0.95, 0.64, 0.54], 0.2)), ball(s, cx + 3, cz + 9, 0.8, plastic([0.8, 0.35, 0.1], 0.35)),
      box(s, cx - 9, cz - 4, [1.2, 1.2, 1.2], 0.2, plastic([0.85, 0.05, 0.04], 0.7)),
      { id: MaterialId.Rock, prim: { type: 'capsule', a: [cx - 3, s.heightAt(cx - 3, cz - 10) + 0.5, cz - 10], b: [cx + 2, s.heightAt(cx + 2, cz - 12) + 0.5, cz - 12], radius: 0.5, material: plastic([0.4, 0.28, 0.16], 0.8) } },
    ],
    ground: { albedo: [0.4, 0.42, 0.3], roughness: 0.9 },
    camera: { pos: [22, s.heightAt(0, 0) + 16, 26], target: [0, s.heightAt(0, 0) + 1, 0], fovDeg: 60 },
    time: 'noon', sun: null, flatRegion: [0.02, 0.62, 0.3, 0.98],
  });
}

export function buildScene(name: SceneName): DevScene {
  switch (name) {
    case 'bleed': return bleedScene();
    case 'canyon': return canyonScene();
    case 'hills': return hillsScene();
    case 'gen': return genScene();
    case 'plain': return plainScene();
    default: return gateScene();
  }
}
