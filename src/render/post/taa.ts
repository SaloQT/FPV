import type { FrameInfo, RenderContext } from '../contracts';
import { nightSkyScale } from './exposure';
import type { OutSize, PostFlags, PostParams, TaaStage } from './types';

/**
 * TAAU knobs (also injected into the shader as defines, so this is the single source of truth).
 * kernelK: weight = exp(-K d^2), d in render pixels (gaussian fit of Blackman-Harris; radius 1.5 px is the 3x3 gather).
 * feedback: history share when static / at motionPx or more output px per frame of motion.
 * varianceGamma: history is clipped to mean +- gamma * sigma of the 3x3 neighbourhood (and its min/max).
 * disoccLo/Hi: relative depth excess of the history over the reprojected surface that ramps the history weight to zero.
 */
export const TAA_TUNING = {
  kernelK: 2.29,
  varianceGamma: 1.25,
  feedback: 0.9,
  feedbackMotion: 0.7,
  motionPx: 10,
  disoccLo: 0.06,
  disoccHi: 0.18,
} as const;

const HISTORY_FORMAT: GPUTextureFormat = 'rgba16float';
const UNIFORM_BYTES = 16;
const GROUP_SIZE = 8;
const MAX_INPUT_GROUPS = 4;

/** Multiplier taking last frame's pre-exposed history to this frame's pre-exposure (1 for invalid inputs). */
export function historyRescale(preExposure: number, prevPreExposure: number): number {
  const r = preExposure / prevPreExposure;
  return Number.isFinite(r) && r > 0 ? r : 1;
}

/** Position shift, in render pixels, of the jittered image relative to the unjittered one (matches frameUniforms.ts: NDC +x right, +y up). */
export function jitterShiftPx(jitterNdcX: number, jitterNdcY: number, renderWidth: number, renderHeight: number, out: Float64Array | number[] = [0, 0]): typeof out {
  out[0] = jitterNdcX * 0.5 * renderWidth;
  out[1] = -jitterNdcY * 0.5 * renderHeight;
  return out;
}

/** History is blended only when this frame asks for TAA, is not a reset, and the previous frame left valid history behind. */
export function useHistory(flags: PostFlags, historyValid: boolean): boolean {
  return flags.taa && !flags.reset && historyValid;
}

/** Sample-weight sum the 3x3 gather has on average per output pixel (integral of exp(-K d^2)); the blend normalises by it. */
export function expectedKernelSum(kernelK: number = TAA_TUNING.kernelK): number {
  return Math.PI / kernelK;
}

export function taaDefines(): Record<string, number> {
  const t = TAA_TUNING;
  return {
    KERNEL_K: t.kernelK, VARIANCE_GAMMA: t.varianceGamma, FEEDBACK: t.feedback, FEEDBACK_MOTION: t.feedbackMotion,
    MOTION_PX: t.motionPx, DISOCC_LO: t.disoccLo, DISOCC_HI: t.disoccHi,
  };
}

export type TaaStageDev = TaaStage & { readonly resolvedTexture: GPUTexture };

export function createTaaStage(): TaaStageDev {
  let device: GPUDevice;
  let taaPipeline: GPUComputePipeline;
  let upsamplePipeline: GPUComputePipeline;
  let frameLayout: GPUBindGroupLayout;
  let stateLayout: GPUBindGroupLayout;
  let inputLayout: GPUBindGroupLayout;
  let sampler: GPUSampler;
  let uniform: GPUBuffer;
  const uniformBytes = new ArrayBuffer(UNIFORM_BYTES);
  const uniformF32 = new Float32Array(uniformBytes);
  const uniformU32 = new Uint32Array(uniformBytes);

  let outW = 0;
  let outH = 0;
  let resolvedTex: GPUTexture | null = null;
  let resolvedView!: GPUTextureView;
  let history: GPUTexture[] = [];
  let historyViews: GPUTextureView[] = [];
  let stateGroups: GPUBindGroup[] = [];
  let inputGroups: { view: GPUTextureView; group: GPUBindGroup }[] = [];
  let read = 0;
  let historyValid = false;

  const makeTexture = (label: string, extra: number): GPUTexture =>
    device.createTexture({ label, size: [outW, outH], format: HISTORY_FORMAT, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | extra });

  const releaseTextures = (): void => {
    resolvedTex?.destroy();
    for (const t of history) t.destroy();
    resolvedTex = null;
    history = [];
    historyViews = [];
  };

  const inputGroup = (input: GPUTextureView): GPUBindGroup => {
    for (const e of inputGroups) if (e.view === input) return e.group;
    if (inputGroups.length >= MAX_INPUT_GROUPS) inputGroups.shift();
    const group = device.createBindGroup({ label: 'taa input', layout: inputLayout, entries: [{ binding: 0, resource: input }] });
    inputGroups.push({ view: input, group });
    return group;
  };

  return {
    init(rc: RenderContext): void {
      device = rc.device;
      const C = GPUShaderStage.COMPUTE;
      frameLayout = rc.frame.layout;
      stateLayout = device.createBindGroupLayout({
        label: 'taa state',
        entries: [
          { binding: 0, visibility: C, buffer: { type: 'uniform' } },
          { binding: 1, visibility: C, texture: { sampleType: 'float' } },
          { binding: 2, visibility: C, sampler: { type: 'filtering' } },
          { binding: 3, visibility: C, storageTexture: { access: 'write-only', format: HISTORY_FORMAT } },
          { binding: 4, visibility: C, storageTexture: { access: 'write-only', format: HISTORY_FORMAT } },
          { binding: 5, visibility: C, texture: { sampleType: 'float' } },
          { binding: 6, visibility: C, texture: { sampleType: 'depth' } },
        ],
      });
      inputLayout = device.createBindGroupLayout({ label: 'taa input', entries: [{ binding: 0, visibility: C, texture: { sampleType: 'float' } }] });
      const layout = device.createPipelineLayout({ label: 'taa', bindGroupLayouts: [frameLayout, stateLayout, inputLayout] });
      const module = rc.module('post/taau.wgsl', taaDefines());
      taaPipeline = device.createComputePipeline({ label: 'taau', layout, compute: { module, entryPoint: 'main' } });
      upsamplePipeline = device.createComputePipeline({ label: 'taau upsample', layout, compute: { module, entryPoint: 'upsample' } });
      sampler = device.createSampler({ label: 'taa linear', magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
      uniform = device.createBuffer({ label: 'taa params', size: UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    },

    resize(rc: RenderContext, out: OutSize): void {
      if (out.width !== outW || out.height !== outH || !resolvedTex) {
        releaseTextures();
        outW = out.width;
        outH = out.height;
        resolvedTex = makeTexture('taa resolved', GPUTextureUsage.COPY_SRC);
        resolvedView = resolvedTex.createView();
        history = [makeTexture('taa history 0', 0), makeTexture('taa history 1', 0)];
        historyViews = history.map((t) => t.createView());
        historyValid = false;
      }
      inputGroups = [];
      const g = rc.gbuf.views;
      stateGroups = [0, 1].map((r) => device.createBindGroup({
        label: `taa state ${r}`,
        layout: stateLayout,
        entries: [
          { binding: 0, resource: { buffer: uniform } },
          { binding: 1, resource: historyViews[r] },
          { binding: 2, resource: sampler },
          { binding: 3, resource: resolvedView },
          { binding: 4, resource: historyViews[1 - r] },
          { binding: 5, resource: g.motion },
          { binding: 6, resource: g.depth },
        ],
      }));
    },

    encode(enc: GPUCommandEncoder, rc: RenderContext, _f: FrameInfo, p: PostParams, flags: PostFlags, input: GPUTextureView): void {
      const temporal = useHistory(flags, historyValid);
      uniformF32[0] = historyRescale(p.preExposure, p.prevPreExposure);
      uniformU32[1] = temporal ? 0 : 1;
      uniformF32[2] = nightSkyScale(p.preExposure);
      device.queue.writeBuffer(uniform, 0, uniformBytes);
      const pass = enc.beginComputePass({ label: flags.taa ? 'taau' : 'taa off upsample' });
      pass.setPipeline(flags.taa ? taaPipeline : upsamplePipeline);
      pass.setBindGroup(0, rc.frame.group);
      pass.setBindGroup(1, stateGroups[read]);
      pass.setBindGroup(2, inputGroup(input));
      pass.dispatchWorkgroups(Math.ceil(outW / GROUP_SIZE), Math.ceil(outH / GROUP_SIZE));
      pass.end();
      // With TAA off the history texture is not written, so the next TAA frame must start over.
      historyValid = flags.taa;
      if (flags.taa) read = 1 - read;
    },

    get resolved(): GPUTextureView { return resolvedView; },
    get resolvedTexture(): GPUTexture { return resolvedTex!; },

    destroy(): void {
      releaseTextures();
      uniform?.destroy();
    },
  };
}
