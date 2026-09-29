import type { FrameInfo, RenderContext } from '../contracts';

/** Per-frame values the Renderer passes to `PostProcessor.encode`. */
export interface PostParams {
  outWidth: number;
  outHeight: number;
  /** Factor baked into every HDR-domain value this frame / last frame. */
  preExposure: number;
  prevPreExposure: number;
}

/** History-validity flags decided once per frame by the orchestrator (post/index.ts). */
export interface PostFlags {
  /** True on the first frame, after a resize, or a frameIndex discontinuity: history must be ignored, not blended. */
  reset: boolean;
  /** frame.misc.y bit 2 (settings TAA); when false TAAU only upsamples. */
  taa: boolean;
  /** frame.misc.y bit 1 (settings bloom). */
  bloom: boolean;
}

export type OutSize = { width: number; height: number };

/**
 * Every stage is a plain object owning its GPU resources. Stages never touch `rc.gbuf` / `rc.frame` state they do not read,
 * never cache `rc.gbuf`, and rebuild bind groups in `resize`. `resize` is called after `init` and on every G-buffer/out-size change.
 * Each stage exposes its output as a getter that is valid after `encode` in the same frame (views are recreated only in `resize`).
 * Shaders live in src/render/shaders/post/<stage>.wgsl and are loaded with `rc.module(path)`; frame-uniform group 0 is NOT bound
 * in post passes unless a stage's layout asks for `rc.frame.layout` itself.
 */
export interface PostStage {
  init(rc: RenderContext): void;
  resize(rc: RenderContext, out: OutSize): void;
  destroy(): void;
}

/** Optional motion blur at render resolution; `output` is gbuf.hdr's view when disabled/reset (never stale). */
export interface MotionBlurStage extends PostStage {
  encode(enc: GPUCommandEncoder, rc: RenderContext, f: FrameInfo, p: PostParams, flags: PostFlags): void;
  readonly output: GPUTextureView;
}

/** Temporal upsample + resolve; `resolved` is out-res rgba16f, pre-exposed with the CURRENT preExposure. */
export interface TaaStage extends PostStage {
  encode(enc: GPUCommandEncoder, rc: RenderContext, f: FrameInfo, p: PostParams, flags: PostFlags, input: GPUTextureView): void;
  readonly resolved: GPUTextureView;
}

/**
 * Histogram auto-exposure. `ratio` is a 16-byte storage/uniform-readable buffer whose first f32 is the multiplicative exposure the
 * composite applies on top of the pre-exposed image (1 = neutral); other floats are stage-defined. No CPU readback except `getStats`.
 */
export interface ExposureStage extends PostStage {
  encode(enc: GPUCommandEncoder, rc: RenderContext, f: FrameInfo, p: PostParams, flags: PostFlags, resolved: GPUTextureView): void;
  readonly ratio: GPUBuffer;
  /** Dev-only asynchronous readback of the last exposure in EV (null until the first result). */
  getStats(): { exposureEv: number | null };
}

/** Dual-filter bloom + veiling glare on the resolved image; `output` is rgba16f, pre-exposed, already scaled to its energy mix. */
export interface BloomStage extends PostStage {
  encode(enc: GPUCommandEncoder, rc: RenderContext, f: FrameInfo, p: PostParams, flags: PostFlags, resolved: GPUTextureView): void;
  readonly output: GPUTextureView;
}

export interface CompositeInput {
  resolved: GPUTextureView;
  bloom: GPUTextureView;
  exposure: GPUBuffer;
  target: GPUTextureView;
  /** 0 final, 1 no TAA (orchestrator passes gbuf hdr as `resolved`), 2 exposure heat, 3 bloom only. */
  debug: 0 | 1 | 2 | 3;
}

/** Final fullscreen pass: exposure, tonemap, lens, sensor/video effects, dither, sRGB encode into the swapchain. */
export interface CompositeStage extends PostStage {
  update(rc: RenderContext, f: FrameInfo): void;
  encode(enc: GPUCommandEncoder, rc: RenderContext, f: FrameInfo, p: PostParams, io: CompositeInput): void;
}
