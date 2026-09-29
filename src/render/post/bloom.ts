import type { FrameInfo, RenderContext } from '../contracts';
import type { BloomStage, OutSize, PostFlags, PostParams } from './types';

/**
 * Bloom = lens scatter, a linear operator on scene radiance, so it runs before exposure/tonemap on the pre-exposed image.
 * Level i of the pyramid is 2^(i+1) times coarser than the resolved image. The output is
 *   sum_i weight[i] * upsample(D_i),   weight[i] = energy * soft[i] + glare * veil[i]
 * with every D_i and every upsample kernel normalised to sum 1, so the output carries exactly `energy + glare` of the scene energy.
 * soft: near-field bloom (levels 0..5, falling off), equal energy per octave would give a 1/r^2 lens PSF, this one is a bit steeper.
 * veil: veiling glare, only the three coarsest levels (a very wide, faint halo around the sun and lamps).
 * `energy + glare` is the fraction of light scattered out of the direct image: the composite adds `output` to the resolved image, so
 * scaling the resolved image by `1 - bloomEnergy()` first keeps total energy exact (lerp form).
 */
export const BLOOM_TUNING = {
  levels: 6,
  energy: 0.05,
  glare: 0.015,
  soft: [0.28, 0.24, 0.2, 0.14, 0.09, 0.05],
  veil: [0, 0, 0, 0.2, 0.35, 0.45],
} as const;

const FORMAT: GPUTextureFormat = 'rgba16float';

/** Fraction of the scene radiance the bloom output adds (and the resolved image should give up). */
export function bloomEnergy(): number {
  return BLOOM_TUNING.energy + BLOOM_TUNING.glare;
}

/** Blend weight of pyramid level i; sums to `bloomEnergy()`. */
export function bloomLevelWeights(): number[] {
  const T = BLOOM_TUNING;
  return T.soft.map((s, i) => T.energy * s + T.glare * T.veil[i]);
}

/**
 * Level sizes for an output of `width` x `height`: level 0 is half size, each next level halves again (rounding up so the whole
 * image stays covered). Always exactly `levels` entries and never smaller than 1 x 1, so tiny or minimised canvases are safe.
 */
export function bloomLevelSizes(width: number, height: number, levels: number = BLOOM_TUNING.levels): OutSize[] {
  let w = Math.max(1, Math.floor(width) || 1);
  let h = Math.max(1, Math.floor(height) || 1);
  const sizes: OutSize[] = [];
  for (let i = 0; i < levels; i++) {
    w = Math.max(1, Math.ceil(w / 2));
    h = Math.max(1, Math.ceil(h / 2));
    sizes.push({ width: w, height: h });
  }
  return sizes;
}

export type BloomStageDev = BloomStage & { readonly outputTexture: GPUTexture };

type Level = { tex: GPUTexture; view: GPUTextureView };

export function createBloomStage(): BloomStageDev {
  let device: GPUDevice;
  let layout: GPUBindGroupLayout;
  let sampler: GPUSampler;
  let karisPipeline: GPURenderPipeline;
  let downPipeline: GPURenderPipeline;
  let downScaledPipeline: GPURenderPipeline;
  let upPipeline: GPURenderPipeline;
  let levels: Level[] = [];
  let width = 0;
  let height = 0;
  let downGroups: GPUBindGroup[] = [];
  let upGroups: GPUBindGroup[] = [];
  let firstGroup: GPUBindGroup | null = null;
  let firstView: GPUTextureView | null = null;
  let downDescs: GPURenderPassDescriptor[] = [];
  let upDescs: GPURenderPassDescriptor[] = [];
  let clearDesc: GPURenderPassDescriptor | null = null;
  let blend: number[][] = [];
  // Fresh textures are zero-filled, so the output is a valid "no bloom" until the first enabled frame writes it.
  let zeroed = true;

  function release(): void {
    for (const l of levels) l.tex.destroy();
    levels = [];
    downGroups = [];
    upGroups = [];
    downDescs = [];
    upDescs = [];
    clearDesc = null;
    firstGroup = firstView = null;
  }

  function sourceGroup(view: GPUTextureView, label: string): GPUBindGroup {
    return device.createBindGroup({ label, layout, entries: [{ binding: 0, resource: view }, { binding: 1, resource: sampler }] });
  }

  function pipeline(module: GPUShaderModule, entryPoint: string, blendState?: GPUBlendState): GPURenderPipeline {
    return device.createRenderPipeline({
      label: `bloom ${entryPoint}${blendState ? ' blend' : ''}`,
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint, targets: [{ format: FORMAT, blend: blendState }] },
      primitive: { topology: 'triangle-list' },
    });
  }

  function encodePass(enc: GPUCommandEncoder, desc: GPURenderPassDescriptor, pipe: GPURenderPipeline, group: GPUBindGroup, constant?: number[]): void {
    const pass = enc.beginRenderPass(desc);
    pass.setPipeline(pipe);
    pass.setBindGroup(0, group);
    if (constant) pass.setBlendConstant(constant);
    pass.draw(3);
    pass.end();
  }

  return {
    init(rc: RenderContext) {
      device = rc.device;
      const F = GPUShaderStage.FRAGMENT;
      layout = device.createBindGroupLayout({
        label: 'bloom',
        entries: [
          { binding: 0, visibility: F, texture: { sampleType: 'float' } },
          { binding: 1, visibility: F, sampler: { type: 'filtering' } },
        ],
      });
      sampler = device.createSampler({ label: 'bloom linear clamp', magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
      const module = rc.module('post/bloom.wgsl');
      const blendOf = (srcFactor: GPUBlendFactor, dstFactor: GPUBlendFactor): GPUBlendState => {
        const c: GPUBlendComponent = { operation: 'add', srcFactor, dstFactor };
        return { color: c, alpha: c };
      };
      karisPipeline = pipeline(module, 'fs_down_karis');
      downPipeline = pipeline(module, 'fs_down');
      // out = src * constant: applies the coarsest level's weight while it is written.
      downScaledPipeline = pipeline(module, 'fs_down', blendOf('constant', 'zero'));
      // out = tent(src) + dst * constant: the level's own weighted content joins the upsampled coarser levels.
      upPipeline = pipeline(module, 'fs_up', blendOf('one', 'constant'));
    },

    resize(_rc: RenderContext, out: OutSize) {
      const sizes = bloomLevelSizes(out.width, out.height);
      if (levels.length === sizes.length && sizes[0].width === width && sizes[0].height === height) return;
      release();
      width = sizes[0].width;
      height = sizes[0].height;
      const U = GPUTextureUsage;
      levels = sizes.map((s, i) => {
        const tex = device.createTexture({ label: `bloom level ${i}`, format: FORMAT, size: [s.width, s.height], usage: U.TEXTURE_BINDING | U.RENDER_ATTACHMENT | U.COPY_SRC });
        return { tex, view: tex.createView() };
      });
      const n = levels.length;
      const target = (i: number, loadOp: GPULoadOp): GPURenderPassDescriptor => ({
        label: `bloom ${loadOp === 'load' ? 'up' : 'down'} ${i}`,
        colorAttachments: [{ view: levels[i].view, loadOp, storeOp: 'store', clearValue: [0, 0, 0, 0] }],
      });
      downDescs = levels.map((_, i) => target(i, 'clear'));
      upDescs = levels.slice(0, n - 1).map((_, i) => target(i, 'load'));
      clearDesc = { label: 'bloom clear', colorAttachments: [{ view: levels[0].view, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] };
      downGroups = levels.slice(0, n - 1).map((l, i) => sourceGroup(l.view, `bloom down ${i + 1}`));
      upGroups = levels.slice(1).map((l, i) => sourceGroup(l.view, `bloom up ${i}`));
      blend = bloomLevelWeights().map((w) => [w, w, w, w]);
      zeroed = true;
    },

    encode(enc: GPUCommandEncoder, _rc: RenderContext, _f: FrameInfo, _p: PostParams, flags: PostFlags, resolved: GPUTextureView) {
      const n = levels.length;
      if (n === 0 || !clearDesc) return;
      if (!flags.bloom) {
        if (!zeroed) {
          enc.beginRenderPass(clearDesc).end();
          zeroed = true;
        }
        return;
      }
      zeroed = false;
      if (resolved !== firstView) {
        firstView = resolved;
        firstGroup = sourceGroup(resolved, 'bloom down 0');
      }
      encodePass(enc, downDescs[0], karisPipeline, firstGroup!);
      for (let i = 1; i < n - 1; i++) encodePass(enc, downDescs[i], downPipeline, downGroups[i - 1]);
      encodePass(enc, downDescs[n - 1], downScaledPipeline, downGroups[n - 2], blend[n - 1]);
      for (let i = n - 2; i >= 0; i--) encodePass(enc, upDescs[i], upPipeline, upGroups[i], blend[i]);
    },

    get output(): GPUTextureView {
      return levels[0].view;
    },

    get outputTexture(): GPUTexture {
      return levels[0].tex;
    },

    destroy() {
      release();
    },
  };
}
