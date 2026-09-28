/**
 * Renderer architecture contract. The Renderer (render/renderer.ts) owns the frame graph; feature modules plug in
 * through RenderModule hooks and never talk to each other directly. Everything a module may share with another
 * module is a named resource on RenderContext (G-buffer, world bindings, RT scene registry).
 *
 * FRAME GRAPH (Renderer calls hooks in this order every frame):
 *   1. update            CPU-side uniform/buffer writes (frame uniforms are already written)
 *   2. encodePre         compute before raster: atmosphere LUTs, terrain LOD select, grass culling, probe upkeep
 *   3. encodeGBuffer     ONE render pass (MRT + depth): terrain, objects, grass, trees write the G-buffer
 *   4. encodeRT          compute ray tracing: sun shadow, diffuse GI, specular  -> sunShadow, giDiffuse, giSpecular
 *   5. (Renderer)        deferred lighting compute -> hdr   (also applies aerial perspective)
 *   6. encodeSky         render pass into hdr with depth test: sky dome, stars, moon, sun, clouds
 *   7. encodeForward     render pass into hdr: emissive LEDs, transparent bits, particles (depth-tested, no write)
 *   8. (Renderer)        TAA resolve, exposure, bloom, FPV lens/video effects, tonemap -> swapchain
 *
 * RADIANCE UNITS  Physical: irradiance in lux, radiance in cd/m². Every value written into an HDR-domain target
 * (hdr, giDiffuse, giSpecular) is multiplied by frame.params.y (pre-exposure) so fp16 never overflows. Consumers
 * must NOT re-apply it. Sun at zenith is ~1.2e5 lux; full moon ~0.25 lux; starlight ~2e-3 lux.
 */

import type { AstroState, CameraState, QuadState, Quat, Settings, TerrainData, TerrainSampler, TrackData, Vec3, RenderQuality } from '../contracts';

// ───────────────────────────── Formats ─────────────────────────────

export const FORMATS = {
  depth: 'depth32float',
  /** rgb = linear albedo, a = baked cavity/AO (1 = open). */
  gAlbedo: 'rgba8unorm',
  /** rg = octahedral world normal (see common/math.wgsl octEncode), b = roughness, a = metalness. */
  gNormal: 'rgba16float',
  /** r = MaterialId/255, g = translucency (foliage), b = wetness, a = emissive strength (x EMISSIVE_MAX_NITS). */
  gMisc: 'rgba8unorm',
  /** rg = (prevUV - currUV), unjittered, in UV units. */
  gMotion: 'rg16float',
  hdr: 'rgba16float',
  /** rgb = cosine-weighted incident radiance (Lambert irradiance / pi), a = ambient visibility. Pre-exposed. */
  giDiffuse: 'rgba16float',
  /** rgb = specular radiance along the reflection ray (rough-filtered), a = confidence 0..1. Pre-exposed. */
  giSpecular: 'rgba16float',
  /** Sun visibility 0..1 (soft penumbra, denoised). */
  sunShadow: 'r16float',
} as const;

/** Colour targets, in attachment order, for every pipeline that draws into the G-buffer pass. */
export const GBUFFER_TARGETS: GPUColorTargetState[] = [
  { format: FORMATS.gAlbedo },
  { format: FORMATS.gNormal },
  { format: FORMATS.gMisc },
  { format: FORMATS.gMotion },
];

/** Depth is reverse-Z: near = 1, far = 0, cleared to 0, compare 'greater'. Infinite far plane projection. */
export const DEPTH_STATE: GPUDepthStencilState = { format: FORMATS.depth, depthWriteEnabled: true, depthCompare: 'greater' };
export const SKY_DEPTH_STATE: GPUDepthStencilState = { format: FORMATS.depth, depthWriteEnabled: false, depthCompare: 'equal' };
export const FORWARD_DEPTH_STATE: GPUDepthStencilState = { format: FORMATS.depth, depthWriteEnabled: false, depthCompare: 'greater' };

export enum MaterialId {
  Sky = 0,
  Terrain = 1,
  Grass = 2,
  GateFrame = 3,
  Quad = 4,
  Foliage = 5,
  Rock = 6,
  Emissive = 7,
  Water = 8,
  Fabric = 9,
  Ground = 10,
}
export const EMISSIVE_MAX_NITS = 20000;

// ───────────────────────────── Quality ─────────────────────────────

export interface QualityProfile {
  tier: RenderQuality;
  /** GI/shadow trace resolution = render resolution / divisor. */
  rtDivisor: 1 | 2 | 4;
  /** Diffuse GI rays per traced pixel per frame (0 = probes/sky only). */
  giRays: number;
  /** Max steps for heightfield ray marching and the number of BVH nodes visited per ray. */
  rtMaxSteps: number;
  rtSpecular: boolean;
  /** Radiance-probe grid used for multi-bounce and rough fallback. */
  probes: { dim: [number, number, number]; raysPerProbe: number; spacing: number };
  grassBladesPerM2: number;
  grassDistance: number;
  terrainViewDistance: number;
  cloudSteps: number;
  bloom: boolean;
  taa: boolean;
  /** Extra octaves of procedural micro-relief in the terrain normal/material. */
  detailOctaves: number;
}

export function qualityProfile(tier: RenderQuality): QualityProfile {
  switch (tier) {
    case 'low':
      return { tier, rtDivisor: 4, giRays: 1, rtMaxSteps: 48, rtSpecular: false, probes: { dim: [16, 8, 16], raysPerProbe: 32, spacing: 8 }, grassBladesPerM2: 60, grassDistance: 35, terrainViewDistance: 1500, cloudSteps: 16, bloom: false, taa: true, detailOctaves: 2 };
    case 'medium':
      return { tier, rtDivisor: 2, giRays: 1, rtMaxSteps: 64, rtSpecular: false, probes: { dim: [24, 12, 24], raysPerProbe: 48, spacing: 6 }, grassBladesPerM2: 150, grassDistance: 55, terrainViewDistance: 2500, cloudSteps: 24, bloom: true, taa: true, detailOctaves: 3 };
    case 'high':
      return { tier, rtDivisor: 2, giRays: 2, rtMaxSteps: 96, rtSpecular: true, probes: { dim: [32, 16, 32], raysPerProbe: 64, spacing: 5 }, grassBladesPerM2: 400, grassDistance: 80, terrainViewDistance: 3500, cloudSteps: 32, bloom: true, taa: true, detailOctaves: 4 };
    case 'ultra':
      return { tier, rtDivisor: 1, giRays: 2, rtMaxSteps: 128, rtSpecular: true, probes: { dim: [48, 24, 48], raysPerProbe: 96, spacing: 4 }, grassBladesPerM2: 900, grassDistance: 120, terrainViewDistance: 5000, cloudSteps: 48, bloom: true, taa: true, detailOctaves: 5 };
  }
}

// ───────────────────────────── GPU resources shared across modules ─────────────────────────────

export interface GBuffer {
  width: number;
  height: number;
  depth: GPUTexture;
  albedo: GPUTexture;
  normal: GPUTexture;
  misc: GPUTexture;
  motion: GPUTexture;
  hdr: GPUTexture;
  giDiffuse: GPUTexture;
  giSpecular: GPUTexture;
  sunShadow: GPUTexture;
  /** RT targets are (width/rtDivisor) x (height/rtDivisor); these hold the size actually allocated. */
  rtWidth: number;
  rtHeight: number;
  /** One view per texture, same keys; depth view is depth-only. */
  views: Record<'depth' | 'albedo' | 'normal' | 'misc' | 'motion' | 'hdr' | 'giDiffuse' | 'giSpecular' | 'sunShadow', GPUTextureView>;
}

/**
 * Textures/samplers bound at @group(1) in every shader (layout below; WGSL side in shaders/common/world_bindings.wgsl).
 * Owned and created by the Renderer; modules that produce data (atmosphere, terrain) write into them.
 *
 *  binding 0  sampler  linearClamp            binding 1  sampler linearRepeat
 *  binding 2  texture_2d<f32> terrainHeight   r32float, N x N, mip 0 only, sample with textureLoad (manual bilinear)
 *  binding 3  texture_2d<f32> terrainMaxPyr   r32float, N x N with full mip chain: mip m = max over 2^m x 2^m texels
 *  binding 4  texture_2d<f32> terrainNormal   rgba8unorm, xyz = world normal*0.5+0.5, a = terrain horizon AO
 *  binding 5  texture_2d<f32> terrainMaps     rgba8unorm, r = soil, g = flow, b = deposit, a = wetness
 *  binding 6  texture_2d<f32> transmittanceLUT   rgba16float 256x64   (Hillaire 2020 parameterisation)
 *  binding 7  texture_2d<f32> multiScatterLUT    rgba16float 32x32
 *  binding 8  texture_2d<f32> skyViewLUT         rgba16float 192x108  (rgb = radiance in nits, NOT pre-exposed)
 *  binding 9  texture_3d<f32> aerialPerspective  rgba16float 32x32x32 froxels (rgb inscatter nits, a = transmittance)
 *  binding 10 texture_2d<f32> blueNoise          rg8unorm 128x128, two decorrelated blue-noise channels
 */
export interface WorldBindings {
  layout: GPUBindGroupLayout;
  group: GPUBindGroup;
  tex: {
    terrainHeight: GPUTexture;
    terrainMaxPyr: GPUTexture;
    terrainNormal: GPUTexture;
    terrainMaps: GPUTexture;
    transmittance: GPUTexture;
    multiScatter: GPUTexture;
    skyView: GPUTexture;
    aerialPerspective: GPUTexture;
    blueNoise: GPUTexture;
  };
  samplers: { linearClamp: GPUSampler; linearRepeat: GPUSampler };
}

/** Group 0 layout: a single uniform buffer holding `Frame` (shaders/common/frame.wgsl). */
export interface FrameBindings {
  layout: GPUBindGroupLayout;
  group: GPUBindGroup;
  buffer: GPUBuffer;
}

// ───────────────────────────── Ray-traced scene proxy registry ─────────────────────────────

export interface RTMaterial {
  albedo: Vec3;
  emissive?: Vec3;
  roughness: number;
  metalness: number;
}

export type RTPrimitive =
  | { type: 'obb'; center: Vec3; half: Vec3; rot: Quat; material: RTMaterial }
  | { type: 'capsule'; a: Vec3; b: Vec3; radius: number; material: RTMaterial }
  | { type: 'sphere'; center: Vec3; radius: number; material: RTMaterial }
  | { type: 'torus'; center: Vec3; rot: Quat; major: number; minor: number; material: RTMaterial };

/**
 * Objects register analytic proxies of their geometry here; the RT module builds/refits its BVH from them.
 * `static` groups (gates, trees, rocks) are rebuilt only when their set changes; `dynamic` groups (the quad)
 * may change every frame and must stay small (<= 64 primitives).
 */
export interface RTSceneRegistry {
  setStatic(groupId: string, prims: RTPrimitive[]): void;
  setDynamic(groupId: string, prims: RTPrimitive[]): void;
  remove(groupId: string): void;
  /** Bumps whenever any group changes so the RT module knows to repack. */
  readonly version: number;
  allStatic(): RTPrimitive[];
  allDynamic(): RTPrimitive[];
}

// ───────────────────────────── Module contract ─────────────────────────────

export interface RenderContext {
  device: GPUDevice;
  canvasFormat: GPUTextureFormat;
  features: ReadonlySet<string>;
  frame: FrameBindings;
  world: WorldBindings;
  gbuf: GBuffer;
  rt: RTSceneRegistry;
  quality: QualityProfile;
  settings: Settings;
  /** Resolve `#include "path"` in WGSL and return the final source (see shaderLib.ts). Paths are relative to src/render/shaders/. */
  shader(path: string, defines?: Record<string, string | number | boolean>): string;
  /** Create a shader module from an include-resolved source with compilation-error reporting. */
  module(path: string, defines?: Record<string, string | number | boolean>): GPUShaderModule;
}

export interface FrameInfo {
  /** Monotonic frame counter and wall-clock delta seconds. */
  frameIndex: number;
  dt: number;
  time: number;
  camera: CameraState;
  astro: AstroState;
  quad: QuadState | null;
  /** Viewport in render-resolution pixels (after dynamic scaling). */
  width: number;
  height: number;
}

export interface SceneData {
  terrain: TerrainData;
  sampler: TerrainSampler;
  track: TrackData | null;
}

export interface RenderModule {
  readonly name: string;
  init(rc: RenderContext): void | Promise<void>;
  /** Render resolution changed; G-buffer textures were recreated. Recreate bind groups that reference them. */
  resize?(rc: RenderContext): void;
  /** New terrain/track. The Renderer has already uploaded terrain textures into rc.world. */
  setScene?(rc: RenderContext, scene: SceneData): void;
  update?(rc: RenderContext, f: FrameInfo): void;
  encodePre?(enc: GPUCommandEncoder, rc: RenderContext, f: FrameInfo): void;
  encodeGBuffer?(pass: GPURenderPassEncoder, rc: RenderContext, f: FrameInfo): void;
  encodeRT?(enc: GPUCommandEncoder, rc: RenderContext, f: FrameInfo): void;
  encodeSky?(pass: GPURenderPassEncoder, rc: RenderContext, f: FrameInfo): void;
  encodeForward?(pass: GPURenderPassEncoder, rc: RenderContext, f: FrameInfo): void;
  destroy?(): void;
}
