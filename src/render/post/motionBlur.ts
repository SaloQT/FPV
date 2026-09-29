import type { FrameInfo, RenderContext } from '../contracts';
import type { MotionBlurStage, OutSize, PostFlags, PostParams } from './types';

/**
 * Blur length is physical: an FPV sensor exposes for `exposureTime` (~1/400 s) whatever the display rate, so the streak is
 * `velocity * exposureTime`, i.e. `motion(prevUV - currUV, per frame) * exposureTime / dt`. At 240 fps that is 0.6 of the frame motion
 * and at 60 fps 0.15. `maxBlurPx` bounds the streak to what the 16 px tile neighbourhood can bound (half a streak stays within one tile).
 */
export const MOTION_BLUR_TUNING = {
  exposureTime: 1 / 400,
  maxShutter: 1,
  samples: 10,
  tile: 16,
  maxBlurPx: 32,
  maxBlurFrac: 0.03,
  minBlurPx: 1,
  depthSoftRel: 0.08,
  depthSoftMin: 0.1,
} as const;

/** Fraction of the per-frame motion covered while the shutter is open. */
export function shutterFraction(dt: number): number {
  const T = MOTION_BLUR_TUNING;
  return Math.min(T.maxShutter, Math.max(0, T.exposureTime / Math.max(dt, 1e-4)));
}

export function maxBlurLengthPx(height: number): number {
  return Math.min(MOTION_BLUR_TUNING.maxBlurPx, MOTION_BLUR_TUNING.maxBlurFrac * height);
}

/** Streak length in render pixels for a motion vector in UV units per frame (mirror of `blurVelocity` in motionblur.wgsl). */
export function blurLengthPx(motionU: number, motionV: number, width: number, height: number, dt: number): number {
  const len = Math.hypot(motionU * width, motionV * height) * shutterFraction(dt);
  return Math.min(len, maxBlurLengthPx(height));
}

export function tileGrid(width: number, height: number): { x: number; y: number } {
  return { x: Math.ceil(width / MOTION_BLUR_TUNING.tile), y: Math.ceil(height / MOTION_BLUR_TUNING.tile) };
}

/** Position of gather sample `i` along the streak in [-0.5, 0.5] (stratified with a per-pixel jitter in [0, 1)). */
export function gatherOffset(i: number, jitter: number): number {
  return (i + jitter) / MOTION_BLUR_TUNING.samples - 0.5;
}

export function motionBlurDefines(): Record<string, number> {
  const T = MOTION_BLUR_TUNING;
  return {
    TILE: T.tile, SAMPLES: T.samples, EXPOSURE_TIME: T.exposureTime, MAX_SHUTTER: T.maxShutter, MAX_BLUR_PX: T.maxBlurPx,
    MAX_BLUR_FRAC: T.maxBlurFrac, MIN_BLUR_PX: T.minBlurPx, DEPTH_SOFT_REL: T.depthSoftRel, DEPTH_SOFT_MIN: T.depthSoftMin,
  };
}

const WG = 8;

export function createMotionBlurStage(): MotionBlurStage {
  let rc: RenderContext;
  let layout: GPUBindGroupLayout;
  let tilePipeline: GPUComputePipeline;
  let neighborPipeline: GPUComputePipeline;
  let blurPipeline: GPUComputePipeline;
  let outTex: GPUTexture | null = null;
  let outView: GPUTextureView | null = null;
  let tileMax: GPUBuffer | null = null;
  let tileNeighbor: GPUBuffer | null = null;
  let group: GPUBindGroup | null = null;
  let width = 0;
  let height = 0;
  let tiles = { x: 0, y: 0 };
  let active = false;

  function release(): void {
    outTex?.destroy();
    tileMax?.destroy();
    tileNeighbor?.destroy();
    outTex = outView = tileMax = tileNeighbor = group = null;
  }

  return {
    init(ctx: RenderContext) {
      rc = ctx;
      const C = GPUShaderStage.COMPUTE;
      const tex = (binding: number, sampleType: GPUTextureSampleType): GPUBindGroupLayoutEntry => ({ binding, visibility: C, texture: { sampleType } });
      const buf = (binding: number): GPUBindGroupLayoutEntry => ({ binding, visibility: C, buffer: { type: 'storage' } });
      layout = rc.device.createBindGroupLayout({
        label: 'motion blur',
        entries: [
          tex(0, 'float'), tex(1, 'float'), tex(2, 'depth'), buf(3), buf(4),
          { binding: 5, visibility: C, storageTexture: { access: 'write-only', format: 'rgba16float' } },
        ],
      });
      const module = rc.module('post/motionblur.wgsl', motionBlurDefines());
      const pipelineLayout = rc.device.createPipelineLayout({ bindGroupLayouts: [rc.frame.layout, layout] });
      const make = (entryPoint: string) => rc.device.createComputePipeline({ label: `motion blur ${entryPoint}`, layout: pipelineLayout, compute: { module, entryPoint } });
      tilePipeline = make('tile_max');
      neighborPipeline = make('neighbor_max');
      blurPipeline = make('blur');
    },

    resize(ctx: RenderContext, _out: OutSize) {
      rc = ctx;
      release();
      const g = rc.gbuf;
      width = g.width;
      height = g.height;
      tiles = tileGrid(width, height);
      const U = GPUTextureUsage;
      outTex = rc.device.createTexture({ label: 'motion blur out', format: 'rgba16float', size: [width, height], usage: U.STORAGE_BINDING | U.TEXTURE_BINDING });
      outView = outTex.createView();
      const bytes = tiles.x * tiles.y * 8;
      tileMax = rc.device.createBuffer({ label: 'mb tile max', size: bytes, usage: GPUBufferUsage.STORAGE });
      tileNeighbor = rc.device.createBuffer({ label: 'mb tile neighbour', size: bytes, usage: GPUBufferUsage.STORAGE });
      group = rc.device.createBindGroup({
        label: 'motion blur',
        layout,
        entries: [
          { binding: 0, resource: g.views.hdr }, { binding: 1, resource: g.views.motion }, { binding: 2, resource: g.views.depth },
          { binding: 3, resource: { buffer: tileMax } }, { binding: 4, resource: { buffer: tileNeighbor } }, { binding: 5, resource: outView },
        ],
      });
    },

    encode(enc: GPUCommandEncoder, ctx: RenderContext, _f: FrameInfo, _p: PostParams, flags: PostFlags) {
      active = false;
      // Motion vectors across a camera cut or first frame point at nothing: never smear then.
      if (flags.reset || !group) return;
      active = true;
      const pass = enc.beginComputePass({ label: 'motion blur' });
      pass.setBindGroup(0, ctx.frame.group);
      pass.setBindGroup(1, group);
      pass.setPipeline(tilePipeline);
      pass.dispatchWorkgroups(tiles.x, tiles.y);
      pass.setPipeline(neighborPipeline);
      pass.dispatchWorkgroups(Math.ceil(tiles.x / WG), Math.ceil(tiles.y / WG));
      pass.setPipeline(blurPipeline);
      pass.dispatchWorkgroups(Math.ceil(width / WG), Math.ceil(height / WG));
      pass.end();
    },

    get output(): GPUTextureView {
      return active && outView ? outView : rc.gbuf.views.hdr;
    },

    destroy() {
      release();
    },
  };
}
