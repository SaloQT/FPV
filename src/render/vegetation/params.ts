import type { QualityProfile } from '../contracts';
import type { RenderQuality, Vec3 } from '../../contracts';

/** Side of a grass patch in metres; blades are hashed per (patch cell, slot), so this fixes the pattern for a given seed. */
export const PATCH_SIZE = 4;
/** Slots handled by one compute workgroup. */
export const CHUNK_SLOTS = 64;
export const BLADE_BYTES = 32;
export const CHUNK_BYTES = 16;
export const VEG_PARAM_BYTES = 160;
/** Blade instance buffers never exceed this, whatever the tier asks for (further clamped to the device limits). */
export const MAX_GRASS_BYTES = 192 * 1024 * 1024;
/** Share of the full-circle instance count each LOD region can hold. A wide FPV lens sees about 0.4 of the circle, but a tilted-down view
 * and the patch-level culling add to it, and an overflow drops whole patches (bare rectangles in the sward), so the margin is generous. */
const CAP_FRACTION = 0.8;
const NO_QUAD = -1e9;
/** The tier tables count blades loosely; a meadow has thousands per m2 and a near blade is a handful of pixels wide, so the near field is scaled up. */
export function nearDensity(tierBladesPerM2: number): number {
  return tierBladesPerM2 * Math.min(6, Math.max(3, 7 - tierBladesPerM2 / 250));
}
/** Blades beyond a few metres are sub-pixel anyway, so full density stops here whatever the tier's view distance. */
const FULL_RADIUS_MAX = 7;

export interface GrassBudget {
  patchSize: number;
  /** Patch grid is cellsPerSide x cellsPerSide, centred on the camera. */
  cellsPerSide: number;
  /** Hash slots per patch at full density (blades/m2 x patch area). */
  slotsPerPatch: number;
  /** Full density inside this radius, area density falling as 1/d^2 (constant screen-space density) beyond. */
  fullRadius: number;
  distance: number;
  lodDistance: [number, number];
  /** Instance capacity per LOD region and the chunk work-list capacity. */
  caps: [number, number, number];
  chunkCap: number;
  /** Byte offset of each LOD region in the blade buffer and its total size. */
  offsets: [number, number, number];
  bladeBytes: number;
}

function keepFraction(d: number, r0: number, far: number): number {
  const k = Math.min(1, (r0 / Math.max(d, 1e-3)) ** 2);
  const s = Math.min(1, Math.max(0, (d - 0.72 * far) / (0.28 * far)));
  return k * (1 - s * s * (3 - 2 * s));
}

/** Expected blade slots between radii `ra` and `rb` around the camera over the whole circle (midpoint rule, 96 rings). */
export function annulusSlots(ra: number, rb: number, density: number, r0: number, far: number): number {
  const n = 96, dr = (rb - ra) / n;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const r = ra + (i + 0.5) * dr;
    sum += 2 * Math.PI * r * dr * density * keepFraction(r, r0, far);
  }
  return sum;
}

const roundUp = (v: number, m: number): number => Math.ceil(v / m) * m;

/**
 * Instance and chunk capacities for a quality tier: preallocated once, never resized, clamped to `maxBytes`.
 * Estimated cost on a mid GPU at 1080p (not measured, the harness only has a software rasteriser): cull about 0.2 ms at high (roughly
 * 200k candidate slots, one hashed terrain-map fetch each) and 0.8 ms at ultra; draw about 1.5 ms at high (about 580k triangles from
 * 128k blades over three LODs, 32 B per blade) and about 3 ms at ultra.
 */
export function grassBudget(q: Pick<QualityProfile, 'grassBladesPerM2' | 'grassDistance'>, maxBytes: number = MAX_GRASS_BYTES): GrassBudget {
  const far = q.grassDistance;
  const fullRadius = Math.min(0.125 * far, FULL_RADIUS_MAX);
  const lod0 = Math.max(4, 0.09 * far), lod1 = Math.max(12, 0.28 * far);
  const density = nearDensity(q.grassBladesPerM2);
  const edges = [0, lod0, lod1, far];
  let caps = [0, 1, 2].map((i) => roundUp(CAP_FRACTION * annulusSlots(edges[i], edges[i + 1], density, fullRadius, far) + 4096, CHUNK_SLOTS));
  const total = caps[0] + caps[1] + caps[2];
  const limit = Math.floor(Math.min(maxBytes, MAX_GRASS_BYTES) / BLADE_BYTES / CHUNK_SLOTS) * CHUNK_SLOTS;
  if (total > limit) caps = caps.map((c) => Math.max(CHUNK_SLOTS, Math.floor((c * limit) / total / CHUNK_SLOTS) * CHUNK_SLOTS));
  const patches = Math.ceil((2 * far) / PATCH_SIZE) + 3;
  const slotsPerPatch = density * PATCH_SIZE * PATCH_SIZE;
  const c0 = caps[0], c1 = caps[1], c2 = caps[2];
  return {
    patchSize: PATCH_SIZE,
    cellsPerSide: patches,
    slotsPerPatch,
    fullRadius,
    distance: far,
    lodDistance: [lod0, lod1],
    caps: [c0, c1, c2],
    chunkCap: Math.ceil(annulusSlots(0, far, density, fullRadius, far) / CHUNK_SLOTS) + patches * patches,
    offsets: [0, c0 * BLADE_BYTES, (c0 + c1) * BLADE_BYTES],
    bladeBytes: (c0 + c1 + c2) * BLADE_BYTES,
  };
}

export interface TreeParams {
  /** Multiplies every variant's LOD hand-over distances. */
  lodScale: number;
  /** Instances further than this are culled (m). */
  maxDistance: number;
  /** Instances whose bounding sphere covers fewer pixels than this are culled. */
  minPixels: number;
  /** Instance slots (padding included), which is also the stride of each LOD's visible list; 0 disables the tree cull. */
  slots: number;
  draws: number;
}

/** Tree draw distance and LOD bias per quality tier (instance counts per tier are in placement.ts, TIER_LIMITS). */
export const TREE_TIER: Readonly<Record<RenderQuality, Pick<TreeParams, 'lodScale' | 'maxDistance' | 'minPixels'>>> = {
  low: { lodScale: 0.6, maxDistance: 700, minPixels: 1.5 },
  medium: { lodScale: 0.8, maxDistance: 1100, minPixels: 1.5 },
  high: { lodScale: 1, maxDistance: 1600, minPixels: 1.5 },
  ultra: { lodScale: 1.25, maxDistance: 2400, minPixels: 1.5 },
};

/** Canopy cards standing in for trees beyond the real-tree draw distance (treePlanFar.ts): the most cards a tier holds. */
export const FAR_TIER: Readonly<Record<RenderQuality, { cards: number }>> = {
  low: { cards: 14000 },
  medium: { cards: 30000 },
  high: { cards: 50000 },
  ultra: { cards: 70000 },
};
/** Cards for ground with no real trees show from this camera distance (m); a card in front of real trees shows from the tree draw distance. */
export const FAR_UNCOVERED_NEAR = 150;

export interface VegParamInput {
  windDir: readonly [number, number];
  windSpeed: number;
  quad: { pos: Vec3; vel: Vec3; thrust: number } | null;
  budget: GrassBudget;
  /** Below this world height there is water; use -Infinity or NaN for none. */
  waterLevel: number;
  seed: number;
  cameraXZ: readonly [number, number];
  tree: TreeParams;
  /** Cards fade out towards this camera distance (m); 0 draws none. */
  farDistance: number;
}

export interface VegParamViews {
  f32: Float32Array;
  i32: Int32Array;
  u32: Uint32Array;
}

export function createParamViews(): VegParamViews {
  const buf = new ArrayBuffer(VEG_PARAM_BYTES);
  return { f32: new Float32Array(buf), i32: new Int32Array(buf), u32: new Uint32Array(buf) };
}

/** Writes the VegParams uniform (layout in shaders/vegetation/veg_params.wgsl, 10 blocks of 16 bytes). */
export function packVegParams(v: VegParamViews, p: VegParamInput): void {
  const { f32, i32, u32 } = v;
  const b = p.budget;
  const len = Math.hypot(p.windDir[0], p.windDir[1]);
  f32[0] = len > 1e-6 ? p.windDir[0] / len : 1;
  f32[1] = len > 1e-6 ? p.windDir[1] / len : 0;
  f32[2] = p.windSpeed;
  f32[3] = 0;
  if (p.quad) {
    f32[4] = p.quad.pos[0]; f32[5] = p.quad.pos[1]; f32[6] = p.quad.pos[2]; f32[7] = p.quad.thrust;
    f32[8] = p.quad.vel[0]; f32[9] = p.quad.vel[1]; f32[10] = p.quad.vel[2];
  } else {
    f32[4] = 0; f32[5] = NO_QUAD; f32[6] = 0; f32[7] = 0;
    f32[8] = 0; f32[9] = 0; f32[10] = 0;
  }
  f32[11] = 0;
  f32[12] = b.patchSize; f32[13] = b.distance; f32[14] = b.fullRadius; f32[15] = b.slotsPerPatch / (b.patchSize * b.patchSize);
  f32[16] = b.lodDistance[0]; f32[17] = b.lodDistance[1];
  f32[18] = Number.isFinite(p.waterLevel) ? p.waterLevel : -1e9;
  f32[19] = b.slotsPerPatch;
  const half = (b.cellsPerSide * b.patchSize) / 2;
  i32[20] = Math.floor((p.cameraXZ[0] - half) / b.patchSize);
  i32[21] = Math.floor((p.cameraXZ[1] - half) / b.patchSize);
  i32[22] = b.cellsPerSide;
  i32[23] = p.seed | 0;
  u32[24] = b.caps[0]; u32[25] = b.caps[1]; u32[26] = b.caps[2]; u32[27] = b.chunkCap;
  f32[28] = p.tree.lodScale; f32[29] = p.tree.maxDistance; f32[30] = p.tree.minPixels; f32[31] = 0;
  u32[32] = p.tree.slots; u32[33] = p.tree.draws; u32[34] = 0; u32[35] = 0;
  f32[36] = p.farDistance; f32[37] = 0; f32[38] = 0; f32[39] = 0;
}
