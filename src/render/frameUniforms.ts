import type { AstroState, CameraState } from '../contracts';
import { SUN_TOA_LUX, moonIlluminanceLux } from './exposure';
import { mat4Invert, mat4Mul, mat4PerspectiveReverseZ, mat4ViewFromPosQuat, mat4WorldFromPosQuat } from './mat4';

/** Byte size of `Frame` in shaders/common/frame.wgsl (9 mat4 + 12 vec4). */
export const FRAME_UNIFORM_BYTES = 768;

/** Float32 element offsets of each `Frame` member (u32 view uses the same indices for `misc`). */
export const FRAME_OFFSETS = {
  view: 0, proj: 16, viewProj: 32, viewProjUnjittered: 48, invView: 64, invProj: 80, invViewProj: 96, prevViewProj: 112, celestial: 128,
  camPos: 144, screen: 148, jitter: 152, sunDir: 156, sunIrradiance: 160, moonDir: 164, moonIrradiance: 168,
  terrain: 172, terrainOrigin: 176, misc: 180, params: 184, sky: 188,
} as const;

export const QUALITY_FLAG_RT_SPECULAR = 1;
export const QUALITY_FLAG_BLOOM = 2;
export const QUALITY_FLAG_TAA = 4;

export const SUN_ANGULAR_RADIUS = 0.00465;
export const MOON_ANGULAR_RADIUS = 0.0045;
const SUN_HORIZON_ELEVATION = -0.0145;
const MOON_HORIZON_ELEVATION = -0.0145;
const KEY_HYSTERESIS = 1.25;
export const JITTER_SEQUENCE_LENGTH = 16;

const MOON_TINT_RAW = [0.86, 1.0, 1.16] as const;
const MOON_TINT_LUMA = 0.2126 * MOON_TINT_RAW[0] + 0.7152 * MOON_TINT_RAW[1] + 0.0722 * MOON_TINT_RAW[2];
/**
 * Colour of moonlight at the top of the atmosphere, scaled to luminance 1 so the photometric lux stay exact: reflected sunlight (~4100 K at the
 * lunar surface) that dark-adapted vision reads as bluish-white, so the lit terrain should look cool rather than warm.
 */
export const MOON_TINT: readonly [number, number, number] = [MOON_TINT_RAW[0] / MOON_TINT_LUMA, MOON_TINT_RAW[1] / MOON_TINT_LUMA, MOON_TINT_RAW[2] / MOON_TINT_LUMA];

export function halton(index: number, base: number): number {
  let f = 1, r = 0;
  while (index > 0) { f /= base; r += f * (index % base); index = Math.floor(index / base); }
  return r;
}

/** TAA jitter in NDC units for a frame; Halton(2,3), 16 samples, centred so the mean is ~0. */
export function jitterNdc(frameIndex: number, width: number, height: number, out: Float32Array | number[], o = 0): void {
  const i = (frameIndex % JITTER_SEQUENCE_LENGTH) + 1;
  out[o] = ((halton(i, 2) - 0.5) * 2) / width;
  out[o + 1] = ((halton(i, 3) - 0.5) * 2) / height;
}

export function frameSeed(frameIndex: number): number {
  let s = (Math.imul(frameIndex >>> 0, 747796405) + 2891336453) >>> 0;
  const w = (Math.imul(((s >>> ((s >>> 28) + 4)) ^ s) >>> 0, 277803737)) >>> 0;
  return ((w >>> 22) ^ w) >>> 0;
}

export interface TerrainUniformInfo { resolution: number; cellSize: number; minHeight: number; maxHeight: number; origin: [number, number] }

export interface FrameUniformInput {
  camera: CameraState;
  astro: AstroState;
  dt: number;
  time: number;
  frameIndex: number;
  width: number;
  height: number;
  preExposure: number;
  qualityFlags: number;
  observerAltitudeM: number;
  jitter: boolean;
  terrain: TerrainUniformInfo | null;
}

/** Owns the CPU copy of the frame uniform block and the small amount of cross-frame state it needs (prev viewProj, key light). */
export class FrameUniforms {
  readonly buffer = new ArrayBuffer(FRAME_UNIFORM_BYTES);
  readonly f32 = new Float32Array(this.buffer);
  readonly u32 = new Uint32Array(this.buffer);
  private readonly view = new Float32Array(16);
  private readonly proj = new Float32Array(16);
  private readonly projUnjit = new Float32Array(16);
  private readonly viewProj = new Float32Array(16);
  private readonly viewProjUnjit = new Float32Array(16);
  private readonly world = new Float32Array(16);
  private readonly invProj = new Float32Array(16);
  private readonly invViewProj = new Float32Array(16);
  private readonly prevViewProj = new Float32Array(16);
  private readonly jitterCur = new Float32Array(2);
  private readonly jitterPrev = new Float32Array(2);
  private havePrev = false;
  private key = 0;

  get keyLight(): number { return this.key; }

  /** Forget the previous frame (camera teleport / scene change) so motion vectors do not smear. */
  resetHistory(): void { this.havePrev = false; }

  write(p: FrameUniformInput): void {
    const { camera: c, astro } = p;
    const f = this.f32, u = this.u32, O = FRAME_OFFSETS;
    mat4ViewFromPosQuat(this.view, c.pos[0], c.pos[1], c.pos[2], c.quat[0], c.quat[1], c.quat[2], c.quat[3]);
    mat4WorldFromPosQuat(this.world, c.pos[0], c.pos[1], c.pos[2], c.quat[0], c.quat[1], c.quat[2], c.quat[3]);
    const near = c.near > 0 ? c.near : 0.05;
    const aspect = p.width / Math.max(p.height, 1);
    mat4PerspectiveReverseZ(this.projUnjit, c.fovY, aspect, near);
    this.proj.set(this.projUnjit);
    this.jitterPrev[0] = this.jitterCur[0]; this.jitterPrev[1] = this.jitterCur[1];
    if (p.jitter) jitterNdc(p.frameIndex, p.width, p.height, this.jitterCur);
    else { this.jitterCur[0] = 0; this.jitterCur[1] = 0; }
    // clip.x = ... + m[8] * z_view and w = -z_view, so NDC shifts by -m[8]; hence the negation.
    this.proj[8] = -this.jitterCur[0];
    this.proj[9] = -this.jitterCur[1];
    mat4Mul(this.viewProj, this.proj, this.view);
    mat4Mul(this.viewProjUnjit, this.projUnjit, this.view);
    mat4Invert(this.invProj, this.proj);
    mat4Invert(this.invViewProj, this.viewProj);
    if (!this.havePrev) { this.prevViewProj.set(this.viewProjUnjit); this.jitterPrev.set(this.jitterCur); this.havePrev = true; }

    f.set(this.view, O.view); f.set(this.proj, O.proj); f.set(this.viewProj, O.viewProj); f.set(this.viewProjUnjit, O.viewProjUnjittered);
    f.set(this.world, O.invView); f.set(this.invProj, O.invProj); f.set(this.invViewProj, O.invViewProj); f.set(this.prevViewProj, O.prevViewProj);
    this.writeCelestial(astro.equatorialToWorld);
    this.prevViewProj.set(this.viewProjUnjit);

    f[O.camPos] = c.pos[0]; f[O.camPos + 1] = c.pos[1]; f[O.camPos + 2] = c.pos[2]; f[O.camPos + 3] = p.time;
    f[O.screen] = p.width; f[O.screen + 1] = p.height; f[O.screen + 2] = 1 / p.width; f[O.screen + 3] = 1 / p.height;
    f[O.jitter] = this.jitterCur[0]; f[O.jitter + 1] = this.jitterCur[1]; f[O.jitter + 2] = this.jitterPrev[0]; f[O.jitter + 3] = this.jitterPrev[1];

    this.writeLights(astro);
    const t = p.terrain;
    if (t) {
      const extent = t.resolution * t.cellSize;
      f[O.terrain] = t.resolution; f[O.terrain + 1] = t.cellSize; f[O.terrain + 2] = t.minHeight; f[O.terrain + 3] = t.maxHeight;
      f[O.terrainOrigin] = t.origin[0]; f[O.terrainOrigin + 1] = t.origin[1]; f[O.terrainOrigin + 2] = extent; f[O.terrainOrigin + 3] = extent;
    } else {
      f.fill(0, O.terrain, O.terrain + 8);
      f[O.terrain] = 1; f[O.terrain + 1] = 1;
    }
    u[O.misc] = p.frameIndex >>> 0; u[O.misc + 1] = p.qualityFlags >>> 0; u[O.misc + 2] = frameSeed(p.frameIndex); u[O.misc + 3] = this.key;
    f[O.params] = p.dt; f[O.params + 1] = p.preExposure; f[O.params + 2] = near; f[O.params + 3] = 0;
    f[O.sky] = 6360; f[O.sky + 1] = 6460;
    f[O.sky + 2] = Math.max(0.0001, c.pos[1] / 1000 + p.observerAltitudeM / 1000);
    f[O.sky + 3] = 1;
  }

  // Input is row-major 3x3 (row r, col c at r*3+c); output block is column-major mat4 with the 3x3 in the upper-left.
  private writeCelestial(e: number[]): void {
    const f = this.f32, o = FRAME_OFFSETS.celestial;
    f.fill(0, o, o + 16);
    for (let col = 0; col < 3; col++) for (let row = 0; row < 3; row++) f[o + col * 4 + row] = e[row * 3 + col];
    f[o + 15] = 1;
  }

  private writeLights(astro: AstroState): void {
    const f = this.f32, O = FRAME_OFFSETS;
    const sd = astro.sunDir, md = astro.moonDir;
    f[O.sunDir] = sd[0]; f[O.sunDir + 1] = sd[1]; f[O.sunDir + 2] = sd[2]; f[O.sunDir + 3] = SUN_ANGULAR_RADIUS;
    f[O.moonDir] = md[0]; f[O.moonDir + 1] = md[1]; f[O.moonDir + 2] = md[2]; f[O.moonDir + 3] = MOON_ANGULAR_RADIUS;
    const sunUp = astro.sunElevation > SUN_HORIZON_ELEVATION;
    const moonUp = astro.moonElevation > MOON_HORIZON_ELEVATION;
    f[O.sunIrradiance] = SUN_TOA_LUX; f[O.sunIrradiance + 1] = SUN_TOA_LUX; f[O.sunIrradiance + 2] = SUN_TOA_LUX; f[O.sunIrradiance + 3] = sunUp ? 1 : 0;
    const moonLux = moonIlluminanceLux(astro.moonPhaseAngle);
    f[O.moonIrradiance] = moonLux * MOON_TINT[0]; f[O.moonIrradiance + 1] = moonLux * MOON_TINT[1]; f[O.moonIrradiance + 2] = moonLux * MOON_TINT[2];
    f[O.moonIrradiance + 3] = astro.moonIlluminatedFraction;
    const sunH = sunUp ? SUN_TOA_LUX * Math.max(sd[1], 0) : 0;
    const moonH = moonUp ? moonLux * Math.max(md[1], 0) : 0;
    if (this.key === 0 && moonH > sunH * KEY_HYSTERESIS) this.key = 1;
    else if (this.key === 1 && sunH > moonH * KEY_HYSTERESIS) this.key = 0;
  }
}
