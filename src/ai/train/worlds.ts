/**
 * Training worlds: the game's own terrain, track, start pad and colliders (track boxes plus the trees and rocks the vegetation
 * module scatters), built exactly as the app builds them, and packed into the GPU buffers world.wgsl reads.
 *
 * A world's track comes from a generator style, from a track-builder recipe, or from a track file (a TrackData built on the
 * terrain of the same seed and quality).
 */
import type { GeneratedStyle, ObstacleCollider, TerrainData, TerrainQuality, TerrainSampler, TrackData, TrackRecipe, Vec3 } from '../../contracts';
import { PadGround } from '../../app/padGround';
import { buildTrack, type TrackStyle } from '../../app/world';
import { buildColliders } from '../../render/vegetation/colliders';
import { TIER_LIMITS, placeVegetation } from '../../render/vegetation/placement';
import { generateTerrain } from '../../world/terrain/generate';
import { createTerrainSampler } from '../../world/terrain/sampler';
import { trackColliders } from '../../world/track/colliders';
import { archSpring, trackGateFrame } from '../../world/track/gate';
import { generateTrack } from '../../world/track/generator';
import { validateTrack } from '../../world/track/validate';
import { GRID_CELL, PROXY_REACH } from '../gpu/quadConsts';
import { gateShape } from '../spec';
import { PATH_WORDS, packPath } from './pathProgress';

export interface TrainWorld {
  seed: number;
  style: TrackStyle;
  terrain: TerrainData;
  sampler: TerrainSampler;
  /** The physics ground: terrain plus the start pad. */
  ground: PadGround;
  /** The track as the session flies it (start on top of the pad plate). */
  track: TrackData;
  colliders: ObstacleCollider[];
  /** Where the track came from (default 'style'). */
  source?: 'style' | 'recipe' | 'file';
  /** Problems validateTrack found in a track file (the world still trains). */
  warnings?: string[];
}

interface WorldOptions {
  /** Terrain seed (and the generator seed of a style track). */
  seed: number;
  quality?: TerrainQuality;
  gateCount?: number;
  difficulty?: number;
  laps?: number;
  /** Trees and rocks as obstacles (default true, as in the game). */
  vegetation?: boolean;
}

/** A generator style, a track-builder recipe (style 'custom') or a ready track on the terrain of `seed`. */
export type WorldSpec = WorldOptions & (
  | { style: GeneratedStyle; recipe?: undefined; track?: undefined }
  | { recipe: TrackRecipe; style?: undefined; track?: undefined }
  | { track: TrackData; style?: undefined; recipe?: undefined }
);

export function buildTrainWorld(spec: WorldSpec): TrainWorld {
  const terrain = generateTerrain({ seed: spec.seed, quality: spec.quality ?? 'low' });
  const sampler = createTerrainSampler(terrain);
  let made: TrackData;
  let seed = spec.seed;
  let style: TrackStyle;
  let source: TrainWorld['source'];
  const warnings: string[] = [];
  if (spec.track) {
    made = fileTrack(spec.track, sampler, warnings);
    style = made.style;
    source = 'file';
    const v = safeValidate(made, sampler);
    for (const e of v) warnings.push(e);
  } else if (spec.recipe) {
    const r = spec.recipe;
    const res = buildTrack(sampler, { seed: r.seed, style: 'custom', gateCount: r.gateCount, laps: r.laps, difficulty: r.difficulty, recipe: r }, { generateTrack });
    made = res.track;
    seed = res.seed;
    style = res.style;
    source = 'recipe';
  } else {
    const res = buildTrack(sampler, { seed: spec.seed, style: spec.style, gateCount: spec.gateCount ?? 12, laps: spec.laps ?? 3, difficulty: spec.difficulty ?? 0.5 }, { generateTrack });
    made = res.track;
    seed = res.seed;
    style = res.style;
    source = 'style';
  }
  const ground = new PadGround(sampler, made);
  const track: TrackData = Number.isFinite(ground.padTop)
    ? { ...made, start: { pos: [made.start.pos[0], ground.padTop, made.start.pos[2]], yaw: made.start.yaw } }
    : made;
  const colliders = trackColliders(made, sampler);
  if (spec.vegetation !== false) for (const c of buildColliders(placeVegetation(terrain, made, TIER_LIMITS.ultra))) colliders.push(c);
  const w: TrainWorld = { seed, style, terrain, sampler, ground, track, colliders, source };
  if (warnings.length) w.warnings = warnings;
  return w;
}

/**
 * A track file's track on its terrain: open runs fly one lap, and every gate and the start must lie inside the terrain. A start
 * up to PAD_SNAP_M above the ground (an export of a flown track, whose start sits on the pad plate) goes back onto the ground.
 */
function fileTrack(t: TrackData, sampler: TerrainSampler, warnings: string[]): TrackData {
  const terrain = sampler.data;
  const n = terrain.resolution;
  const x0 = terrain.origin[0], z0 = terrain.origin[1], x1 = x0 + (n - 1) * terrain.cellSize, z1 = z0 + (n - 1) * terrain.cellSize;
  const inside = (p: readonly number[]): boolean => p[0] > x0 && p[0] < x1 && p[2] > z0 && p[2] < z1;
  t.gates.forEach((g, i) => {
    if (!inside(g.pos)) throw new Error(`gate ${i} at (${g.pos[0].toFixed(0)}, ${g.pos[2].toFixed(0)}) is outside the terrain: wrong terrain seed or quality?`);
  });
  if (!inside(t.start.pos)) throw new Error('the start is outside the terrain: wrong terrain seed or quality?');
  if (t.path.length < 2) warnings.push('no centreline path: progress is rewarded in straight lines to the next gate');
  const ground = sampler.heightAt(t.start.pos[0], t.start.pos[2]);
  const lift = t.start.pos[1] - ground;
  const start = lift > 0 && lift <= PAD_SNAP_M ? { pos: [t.start.pos[0], ground, t.start.pos[2]] as Vec3, yaw: t.start.yaw } : t.start;
  return { ...t, start, laps: t.closed ? t.laps : 1 };
}

/** Largest start height above the ground a track file may carry and still count as on the ground, metres. */
const PAD_SNAP_M = 1;

/** validateTrack's errors; a track it cannot even check (a style without a spec) yields that as the one problem. */
function safeValidate(t: TrackData, sampler: TerrainSampler): string[] {
  try {
    return validateTrack(t, sampler).errors;
  } catch (e) {
    return [`not validated: ${(e as Error).message}`];
  }
}

/** Track record size in 4-byte words (world.wgsl `Track`). */
export const TRACK_WORDS = 40;
export const GATE_WORDS = 20;
export const BOX_WORDS = 12;

export interface PackedWorlds {
  tracks: ArrayBuffer;
  heights: Float32Array;
  gates: Float32Array;
  boxes: Float32Array;
  gridCells: Uint32Array;
  gridItems: Uint32Array;
  /** Every track's centreline, PATH_WORDS floats per sample (pathProgress.ts). */
  paths: Float32Array;
}

/** Grid lists hold every box whose reach circle touches the cell, padded so f32 rounding can never drop a candidate. */
const GRID_SLACK = 0.05;

export function packWorlds(worlds: readonly TrainWorld[]): PackedWorlds {
  const tracks = new ArrayBuffer(TRACK_WORDS * 4 * Math.max(worlds.length, 1));
  const tu = new Uint32Array(tracks);
  const tf = new Float32Array(tracks);
  const heights: number[] = [];
  const gates: number[] = [];
  const boxes: number[] = [];
  const cells: number[] = [];
  const items: number[] = [];
  const paths: Float32Array[] = [];
  let hOff = 0;
  let pathOff = 0;
  worlds.forEach((w, k) => {
    const o = k * TRACK_WORDS;
    const t = w.terrain;
    const n = t.resolution;
    for (let i = 0; i < t.height.length; i++) heights.push(t.height[i]);
    const x0 = t.origin[0], z0 = t.origin[1], x1 = x0 + (n - 1) * t.cellSize, z1 = z0 + (n - 1) * t.cellSize;
    const path = packPath(w.track);
    const gateOff = gates.length / GATE_WORDS;
    w.track.gates.forEach((g, i) => {
      const f = trackGateFrame(g);
      gates.push(g.pos[0], g.pos[1], g.pos[2], g.width / 2, f.forward[0], f.forward[1], f.forward[2], g.height / 2,
        f.right[0], f.right[1], f.right[2], gateShape(g.kind), f.up[0], f.up[1], f.up[2], archSpring(g), g.yaw, path.gateSample[i], 0, 0);
    });
    const boxOff = boxes.length / BOX_WORDS;
    let bx0 = x0, bz0 = z0, bx1 = x1, bz1 = z1;
    const radius: number[] = [];
    for (const c of w.colliders) {
      const r = Math.hypot(c.half[0], c.half[1], c.half[2]);
      radius.push(r);
      boxes.push(c.center[0], c.center[1], c.center[2], c.half[0], c.half[1], c.half[2], Math.cos(c.yaw), Math.sin(c.yaw), r, 0, 0, 0);
      bx0 = Math.min(bx0, c.center[0] - r); bx1 = Math.max(bx1, c.center[0] + r);
      bz0 = Math.min(bz0, c.center[2] - r); bz1 = Math.max(bz1, c.center[2] + r);
    }
    const gx0 = Math.floor(bx0 / GRID_CELL) * GRID_CELL - GRID_CELL, gz0 = Math.floor(bz0 / GRID_CELL) * GRID_CELL - GRID_CELL;
    const nx = Math.ceil((bx1 - gx0) / GRID_CELL) + 2, nz = Math.ceil((bz1 - gz0) / GRID_CELL) + 2;
    const gridOff = cells.length / 2;
    const lists: number[][] = Array.from({ length: nx * nz }, () => []);
    w.colliders.forEach((c, b) => {
      const reach = radius[b] + PROXY_REACH + GRID_SLACK;
      const cx = c.center[0], cz = c.center[2];
      const i0 = Math.max(0, Math.floor((cx - reach - gx0) / GRID_CELL)), i1 = Math.min(nx - 1, Math.floor((cx + reach - gx0) / GRID_CELL));
      const j0 = Math.max(0, Math.floor((cz - reach - gz0) / GRID_CELL)), j1 = Math.min(nz - 1, Math.floor((cz + reach - gz0) / GRID_CELL));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          // Distance from the box centre to the cell rectangle in the ground plane
          const ax = gx0 + i * GRID_CELL, az = gz0 + j * GRID_CELL;
          const dx = Math.max(ax - cx, 0, cx - (ax + GRID_CELL)), dz = Math.max(az - cz, 0, cz - (az + GRID_CELL));
          if (dx * dx + dz * dz <= reach * reach) lists[j * nx + i].push(b);
        }
      }
    });
    for (const l of lists) {
      cells.push(items.length, l.length);
      for (const b of l) items.push(b);
    }
    tu[o] = hOff; tu[o + 1] = n; tf[o + 2] = x0; tf[o + 3] = z0;
    tf[o + 4] = t.cellSize; tf[o + 5] = 1 / t.cellSize;
    const pad = padInfo(w);
    tf[o + 6] = pad.x; tf[o + 7] = pad.z; tf[o + 8] = pad.cos; tf[o + 9] = pad.sin; tf[o + 10] = pad.top; tu[o + 11] = pad.active ? 1 : 0;
    tu[o + 12] = gateOff; tu[o + 13] = w.track.gates.length; tu[o + 14] = w.track.closed ? 1 : 0; tu[o + 15] = boxOff;
    tu[o + 16] = w.colliders.length; tu[o + 17] = gridOff; tu[o + 18] = nx; tu[o + 19] = nz;
    tf[o + 20] = gx0; tf[o + 21] = gz0; tf[o + 22] = w.track.start.pos[0]; tf[o + 23] = w.track.start.pos[1];
    tf[o + 24] = w.track.start.pos[2]; tf[o + 25] = w.track.start.yaw; tu[o + 26] = w.track.laps; tf[o + 27] = t.minHeight;
    tf[o + 28] = t.maxHeight; tf[o + 29] = x0; tf[o + 30] = x1; tf[o + 31] = z0; tf[o + 32] = z1;
    tu[o + 33] = pathOff; tu[o + 34] = path.count; tf[o + 35] = path.length; tu[o + 36] = path.startSample;
    hOff += t.height.length;
    paths.push(path.points);
    pathOff += path.count;
  });
  const nonEmpty = (a: number[], w: number): number[] => (a.length ? a : new Array(w).fill(0));
  return {
    tracks,
    heights: new Float32Array(nonEmpty(heights, 4)),
    gates: new Float32Array(nonEmpty(gates, GATE_WORDS)),
    boxes: new Float32Array(nonEmpty(boxes, BOX_WORDS)),
    gridCells: new Uint32Array(nonEmpty(cells, 2)),
    gridItems: new Uint32Array(nonEmpty(items, 1)),
    paths: concat(paths, PATH_WORDS),
  };
}

/** The arrays end to end (one zero record when they are all empty: a storage binding cannot be empty). */
function concat(parts: Float32Array[], words: number): Float32Array {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Float32Array(Math.max(n, words));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** The pad square as PadGround holds it (its fields are private; they follow from the track start and the pad top). */
function padInfo(w: TrainWorld): { x: number; z: number; cos: number; sin: number; top: number; active: boolean } {
  const top = w.ground.padTop;
  const s = w.track.start;
  return { x: s.pos[0], z: s.pos[2], cos: Math.cos(s.yaw), sin: Math.sin(s.yaw), top: Number.isFinite(top) ? top : -3.0e38, active: Number.isFinite(top) };
}
