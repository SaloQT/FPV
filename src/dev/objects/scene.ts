import type { GateKind, TerrainData, TrackData, TrackGate, TrackObstacle, Vec3 } from '../../contracts';
import type { SceneData } from '../../render/contracts';
import { generateTrack } from '../../world/track';
import { testSampler, testTerrainData } from '../../world/track/testTerrain';

const N = 256;
const CELL = 4;
const ORIGIN = -(N * CELL) / 2;

function terrainHeight(x: number, z: number, amp: number): number {
  return amp * (Math.sin(x * 0.05 + 1) * Math.cos(z * 0.04) + 0.5 * Math.sin(x * 0.13 + z * 0.11));
}

/** Gently rolling ground (peak-to-peak about 3 x `amp` metres) with no water. */
function devTerrain(amp: number): TerrainData {
  const height = new Float32Array(N * N);
  let lo = Infinity;
  let hi = -Infinity;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const h = terrainHeight(ORIGIN + i * CELL, ORIGIN + j * CELL, amp);
      height[j * N + i] = h;
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
  }
  const zeros = new Float32Array(N * N);
  return { seed: 1, resolution: N, cellSize: CELL, origin: [ORIGIN, ORIGIN], height, maps: { soil: zeros, flow: zeros, deposit: zeros, wetness: zeros }, minHeight: lo, maxHeight: hi, waterLevel: -Infinity };
}

export type TrackKind = 'none' | 'row' | 'gen';

export interface DevScene {
  scene: SceneData;
  /** Ground-level centre of the start pad (or the origin without a track). */
  pad: Vec3;
  padYaw: number;
  gates: number;
}

export function makeDevScene(track: TrackKind, seed: number, amp: number): DevScene {
  const data = track === 'gen' ? testTerrainData({ seed, roughness: 0.4, relief: 60 }) : devTerrain(amp);
  const sampler = testSampler(data);
  const at = (x: number, z: number): Vec3 => [x, sampler.heightAt(x, z), z];
  if (track === 'none') return { scene: { terrain: data, sampler, track: null }, pad: at(0, 0), padYaw: 0, gates: 0 };
  const trackData = track === 'gen' ? generateTrack({ seed, style: 'race' }, sampler) : rowTrack(sampler.heightAt);
  return { scene: { terrain: data, sampler, track: trackData }, pad: trackData.start.pos, padYaw: trackData.start.yaw, gates: trackData.gates.length };
}

function gate(index: number, kind: GateKind, x: number, z: number, yaw: number, w: number, h: number, ground: (x: number, z: number) => number, lift = 0.15, pitch = 0, roll = 0): TrackGate {
  return { index, kind, pos: [x, ground(x, z) + h / 2 + lift, z], yaw, roll, pitch, width: w, height: h };
}

/** A fixed lineup of every gate kind heading north (-Z) from the pad, with cones, poles, a wall, a rock and a tree. */
function rowTrack(ground: (x: number, z: number) => number): TrackData {
  const gates: TrackGate[] = [
    gate(0, 'start', 0, -2, 0, 2.4, 2, ground),
    gate(1, 'square', 1.5, -12, -0.12, 2.2, 2.2, ground),
    gate(2, 'arch', -1, -22, 0.1, 2, 2.6, ground),
    gate(3, 'hoop', 0.5, -32, -0.05, 2, 2, ground, 0.9),
    gate(4, 'dive', 2, -42, 0.08, 2.2, 2.2, ground, 3.2, -0.5),
    gate(5, 'flag', 0, -52, 0, 2.6, 1.4, ground),
    gate(6, 'finish', -0.5, -62, 0, 2.8, 2, ground),
  ];
  const ob = (kind: TrackObstacle['kind'], x: number, z: number, yaw: number, size: Vec3): TrackObstacle => ({ kind, pos: [x, ground(x, z), z], yaw, size });
  const obstacles: TrackObstacle[] = [
    ob('cone', -1.2, 3.5, 0, [0.15, 0.45, 0.15]),
    ob('cone', 1.2, 3.5, 0, [0.15, 0.45, 0.15]),
    ob('cone', -1.2, 6.5, 0, [0.15, 0.45, 0.15]),
    ob('cone', 1.2, 6.5, 0, [0.15, 0.45, 0.15]),
    ob('cone', 3, -8, 0, [0.15, 0.45, 0.15]),
    ob('cone', 4, -9, 0, [0.15, 0.45, 0.15]),
    ob('pole', -3.5, -15, 0, [0.025, 2, 0.025]),
    ob('pole', 4.5, -26, 0, [0.025, 2, 0.025]),
    ob('flagpole', -2.6, -2, 0, [0.02, 3, 0.02]),
    ob('wall', -7, -18, 0.3, [4, 1.6, 0.5]),
    ob('wall', 8, -34, -0.5, [3.5, 1.2, 0.4]),
    ob('rock', 6.5, -6, 0.8, [1.6, 1.1, 1.3]),
    ob('rock', -6, -40, 2.1, [2.2, 1.5, 1.8]),
    ob('tree', -9, -8, 0, [0.35, 8, 0.35]),
    ob('tree', 10, -20, 0, [0.4, 10, 0.4]),
  ];
  const p0 = gates[0].pos;
  const path: Vec3[] = gates.map((g) => g.pos);
  return { seed: 1, style: 'race', gates, obstacles, path, closed: false, length: Math.abs(gates[gates.length - 1].pos[2] - p0[2]), start: { pos: [0, ground(0, 8), 8], yaw: 0 }, laps: 1 };
}
